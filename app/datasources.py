from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Tuple

from fastapi import HTTPException

from .config import settings
from .models import Graph, Node, Edge
from .gcp_auth import get_credentials
from . import sheets as sheets_mod


def _parse_gs_uri(uri: str) -> Tuple[str, str]:
    if not uri.startswith("gs://"):
        raise HTTPException(status_code=400, detail="gcs_uri must start with gs://")
    path = uri[len("gs://") :]
    parts = path.split("/", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="gcs_uri must be gs://bucket/path")
    bucket, blob_path = parts[0], parts[1]
    return bucket, blob_path


def _clean_sheet_id(s: str | None) -> str:
    if not s:
        return ""
    t = str(s).strip()
    # Remove trailing slash and URL-encoded slash (%2F)
    t = t.rstrip("/")
    t = re.sub(r"(%2F)+$", "", t, flags=re.IGNORECASE)
    return t.strip()


# Sheets loader/saver
def loadSheet(
    sheet_id: str | None = None,
    nodes_tab: str | None = None,
    edges_tab: str | None = None,
    site_id: str | None = None,
) -> Graph:
    sid = _clean_sheet_id(sheet_id or settings.sheet_id_default)
    if not sid:
        raise HTTPException(status_code=400, detail="sheet_id required")
    return sheets_mod.read_nodes_edges(
        sid,
        nodes_tab or settings.sheet_nodes_tab,
        edges_tab or settings.sheet_edges_tab,
        site_id=site_id,
    )


def saveSheet(graph: Graph, sheet_id: str | None = None, nodes_tab: str | None = None, edges_tab: str | None = None, *, site_id: str | None = None) -> None:
    sid = _clean_sheet_id(sheet_id or settings.sheet_id_default)
    if not sid:
        raise HTTPException(status_code=400, detail="sheet_id required")
    graph = _sanitize_graph_for_write(graph)
    sheets_mod.write_nodes_edges(
        sid,
        nodes_tab or settings.sheet_nodes_tab,
        edges_tab or settings.sheet_edges_tab,
        graph,
        site_id=site_id,
    )


# GCS JSON loader/saver
def loadJson(gcs_uri: str | None = None) -> Graph:
    uri = gcs_uri or settings.gcs_json_uri_default
    if not uri:
        raise HTTPException(status_code=400, detail="gcs_uri required")

    if uri.startswith("file://") or os.path.isabs(uri):
        # local dev support
        path = uri.replace("file://", "")
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"read_local_json_failed: {exc}")
        graph = Graph.model_validate(data)
        return graph

    # gs:// path
    bucket_name, blob_path = _parse_gs_uri(uri)
    try:
        from google.cloud import storage

        creds = get_credentials(["https://www.googleapis.com/auth/devstorage.read_only"])
        client = storage.Client(project=settings.gcp_project_id or None, credentials=creds)
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        text = blob.download_as_text()
        data = json.loads(text)
        graph = Graph.model_validate(data)
        return graph
    except Exception as exc:
        raise HTTPException(status_code=501, detail=f"gcs_json_unavailable: {exc}")


def saveJson(graph: Graph, gcs_uri: str | None = None) -> None:
    uri = gcs_uri or settings.gcs_json_uri_default
    if not uri:
        raise HTTPException(status_code=400, detail="gcs_uri required")
    graph = _sanitize_graph_for_write(graph)

    # Preserve existing canonical positions (x, y) by merging from the
    # current JSON when available; only x_ui/y_ui should change from the UI.
    try:
        existing: Graph | None = None
        if uri.startswith("file://") or os.path.isabs(uri):
            path = uri.replace("file://", "")
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as rf:
                    existing = Graph.model_validate(json.load(rf))
        else:
            from google.cloud import storage

            creds_ro = get_credentials(["https://www.googleapis.com/auth/devstorage.read_only"])
            client_ro = storage.Client(project=settings.gcp_project_id or None, credentials=creds_ro)
            bucket_name, blob_path = _parse_gs_uri(uri)
            bucket = client_ro.bucket(bucket_name)
            blob = bucket.blob(blob_path)
            if blob.exists(client_ro):
                text = blob.download_as_text()
                existing = Graph.model_validate(json.loads(text))
        if existing is not None:
            by_id = {n.id: n for n in (existing.nodes or [])}
            for n in graph.nodes or []:
                prev = by_id.get(n.id)
                if prev is not None:
                    # Only preserve canonical x/y; UI saves manage x_ui/y_ui
                    n.x = prev.x
                    n.y = prev.y
    except Exception:
        # Non-fatal: if merge fails, continue with provided payload
        pass

    payload = json.dumps(graph.model_dump(), ensure_ascii=False)
    if uri.startswith("file://") or os.path.isabs(uri):
        path = uri.replace("file://", "")
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(payload)
            return
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"write_local_json_failed: {exc}")
    try:
        from google.cloud import storage

        creds = get_credentials(["https://www.googleapis.com/auth/devstorage.read_write"])
        client = storage.Client(project=settings.gcp_project_id or None, credentials=creds)
        bucket_name, blob_path = _parse_gs_uri(uri)
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        blob.upload_from_string(payload, content_type="application/json; charset=utf-8")
    except Exception as exc:
        raise HTTPException(status_code=501, detail=f"gcs_write_unavailable: {exc}")


def _sanitize_graph_for_write(graph: Graph) -> Graph:
    """Ensure edge ids are unique and drop duplicates with identical id+endpoints.

    - Keep the first occurrence of a given id/from/to combination.
    - If the same id is reused for different endpoints, assign a fresh id to the later ones.
    - If an edge has no id, assign one.
    """
    try:
        nodes = list(graph.nodes or [])
        edges_in = list(graph.edges or [])
    except Exception:
        return graph

    def _gen_edge_id() -> str:
        import os, time
        t = int(time.time() * 1000)
        t36 = format(t, 'x').upper()  # hex timestamp (stable and short)
        r = format(int.from_bytes(os.urandom(3), 'big'), 'x').upper()
        return f"E-{t36}{r}"

    seen_ids: set[str] = set()
    kept: list[Edge] = []
    for e in edges_in:
        if not getattr(e, 'from_id', None) or not getattr(e, 'to_id', None):
            continue
        cur_id = (e.id or '').strip() or _gen_edge_id()
        if cur_id in seen_ids:
            # if identical already kept, drop; else reassign
            dup_same = any(x.id == cur_id and x.from_id == e.from_id and x.to_id == e.to_id for x in kept)
            if dup_same:
                continue
            nid = _gen_edge_id()
            guard = 0
            while nid in seen_ids and guard < 5:
                nid = _gen_edge_id(); guard += 1
            e = Edge(id=nid, from_id=e.from_id, to_id=e.to_id, active=(e.active if e.active is not None else True), commentaire=getattr(e, 'commentaire', '') or '')
            seen_ids.add(nid)
            kept.append(e)
        else:
            seen_ids.add(cur_id)
            if not getattr(e, 'commentaire', None):
                setattr(e, 'commentaire', '')
            if e.active is None:
                e.active = True
            e.id = cur_id
            kept.append(e)

    return Graph(nodes=nodes, edges=kept)


# BigQuery loader/saver
def loadBQ(
    dataset: str | None = None,
    nodes_table: str | None = None,
    edges_table: str | None = None,
    project_id: str | None = None,
) -> Graph:
    ds = dataset or settings.bq_dataset
    tn = nodes_table or settings.bq_nodes_table
    te = edges_table or settings.bq_edges_table
    pj = project_id or settings.bq_project_id or settings.gcp_project_id
    if not pj or not ds:
        raise HTTPException(status_code=400, detail="bq project_id and dataset required")
    try:
        from google.cloud import bigquery

        creds = get_credentials(["https://www.googleapis.com/auth/bigquery"])
        client = bigquery.Client(project=pj, credentials=creds)
        # Select * and coerce to unified UI schema
        q_nodes = f"SELECT * FROM `{pj}.{ds}.{tn}`"
        q_edges = f"SELECT * FROM `{pj}.{ds}.{te}`"
        nodes_rows = client.query(q_nodes).result()
        edges_rows = client.query(q_edges).result()

        def _split_ids(v):
            if v is None:
                return []
            if isinstance(v, list):
                return [str(x) for x in v if x is not None]
            if isinstance(v, str):
                return [p.strip() for p in v.replace(',', ';').split(';') if p.strip()]
            return []

        # Convert rows to UI schema; accept FR/EN field names
        def to_nodes():
            for r in nodes_rows:
                d = dict(r)
                yield Node(
                    id=str(d.get('id')),
                    name=d.get('name') or d.get('nom') or '',
                    type=(d.get('type') or 'PUITS'),
                    branch_id=d.get('branch_id') or d.get('id_branche') or '',
                    diameter_mm=d.get('diameter_mm') or d.get('diametre_mm'),
                    collector_well_ids=_split_ids(d.get('collector_well_ids') or d.get('puits_amont')),
                    well_collector_id=d.get('well_collector_id') or '',
                    well_pos_index=d.get('well_pos_index'),
                    pm_collector_id=d.get('pm_collector_id') or d.get('pm_collecteur_id') or '',
                    pm_pos_index=d.get('pm_pos_index'),
                    gps_lat=d.get('gps_lat'), gps_lon=d.get('gps_lon'),
                    x=d.get('x'), y=d.get('y'),
                )

        def to_edges():
            for r in edges_rows:
                d = dict(r)
                from_id = d.get('from_id') or d.get('source_id')
                to_id = d.get('to_id') or d.get('cible_id')
                active = d.get('active') if 'active' in d else d.get('actif')
                yield Edge(id=d.get('id'), from_id=str(from_id), to_id=str(to_id), active=bool(active) if active is not None else True)

        nodes = [n for n in to_nodes() if getattr(n, "id", None)]
        # Filter only edges that have both endpoints defined (from_id/to_id)
        edges = [e for e in to_edges() if getattr(e, "from_id", None) and getattr(e, "to_id", None)]
        return Graph(nodes=nodes, edges=edges)
    except Exception as exc:
        raise HTTPException(status_code=501, detail=f"bigquery_unavailable: {exc}")


def saveBQ(*_args, **_kwargs) -> None:
    # Not implemented for V1
    raise HTTPException(status_code=501, detail="bigquery write not implemented")


# Generic dispatchers
def load_graph(
    source: str | None = None,
    **kwargs: Any,
) -> Graph:
    s = (source or settings.data_source_default or "sheet").lower()
    if s in {"sheet", "sheets", "google_sheets"}:
        site = kwargs.get("site_id") or settings.site_id_filter_default or None
        if settings.require_site_id and not site:
            raise HTTPException(status_code=400, detail="site_id required (set query param site_id or SITE_ID_FILTER_DEFAULT)")
        return loadSheet(
            sheet_id=kwargs.get("sheet_id"),
            nodes_tab=kwargs.get("nodes_tab"),
            edges_tab=kwargs.get("edges_tab"),
            site_id=site,
        )
    if s in {"gcs", "gcs_json", "json"}:
        return loadJson(gcs_uri=kwargs.get("gcs_uri"))
    if s in {"bq", "bigquery"}:
        return loadBQ(
            dataset=kwargs.get("bq_dataset"),
            nodes_table=kwargs.get("bq_nodes"),
            edges_table=kwargs.get("bq_edges"),
            project_id=kwargs.get("bq_project"),
        )
    raise HTTPException(status_code=400, detail=f"unknown data source: {s}")


def save_graph(source: str | None = None, graph: Graph | None = None, **kwargs: Any) -> None:
    if graph is None:
        raise HTTPException(status_code=400, detail="graph payload required")
    s = (source or settings.data_source_default or "sheet").lower()
    if s in {"sheet", "sheets", "google_sheets"}:
        site = kwargs.get("site_id") or settings.site_id_filter_default or None
        if settings.require_site_id and not site:
            raise HTTPException(status_code=400, detail="site_id required for write (set query param site_id or SITE_ID_FILTER_DEFAULT)")
        return saveSheet(
            graph,
            sheet_id=kwargs.get("sheet_id"),
            nodes_tab=kwargs.get("nodes_tab"),
            edges_tab=kwargs.get("edges_tab"),
            site_id=site,
        )
    if s in {"gcs", "gcs_json", "json"}:
        return saveJson(graph, gcs_uri=kwargs.get("gcs_uri"))
    if s in {"bq", "bigquery"}:
        return saveBQ()
    raise HTTPException(status_code=400, detail=f"unknown data source: {s}")
