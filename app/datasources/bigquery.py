"""BigQuery data source helpers."""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

from ..config import settings
from ..models import Edge, Graph, Node
from ..gcp_auth import get_credentials


def load_bigquery(
    dataset: Optional[str] = None,
    nodes_table: Optional[str] = None,
    edges_table: Optional[str] = None,
    project_id: Optional[str] = None,
) -> Graph:
    dataset_name = dataset or settings.bq_dataset
    nodes_name = nodes_table or settings.bq_nodes_table
    edges_name = edges_table or settings.bq_edges_table
    project = project_id or settings.bq_project_id or settings.gcp_project_id
    if not project or not dataset_name:
        raise HTTPException(status_code=400, detail="bq project_id and dataset required")
    try:
        from google.cloud import bigquery

        creds = get_credentials(["https://www.googleapis.com/auth/bigquery"])
        client = bigquery.Client(project=project, credentials=creds)
        q_nodes = f"SELECT * FROM `{project}.{dataset_name}.{nodes_name}`"
        q_edges = f"SELECT * FROM `{project}.{dataset_name}.{edges_name}`"
        nodes_rows = client.query(q_nodes).result()
        edges_rows = client.query(q_edges).result()

        def _split_ids(value):
            if value is None:
                return []
            if isinstance(value, list):
                return [str(item) for item in value if item is not None]
            if isinstance(value, str):
                return [part.strip() for part in value.replace(",", ";").split(";") if part.strip()]
            return []

        def to_nodes():
            for row in nodes_rows:
                data = dict(row)
                yield Node(
                    id=str(data.get("id")),
                    name=data.get("name") or data.get("nom") or "",
                    type=data.get("type") or "OUVRAGE",
                    branch_id=data.get("branch_id") or data.get("id_branche") or "",
                    site_id=data.get("site_id"),
                    diameter_mm=data.get("diameter_mm") or data.get("diametre_mm"),
                    sdr_ouvrage=data.get("sdr_ouvrage") or data.get("sdr") or "",
                    material=data.get("material") or data.get("materiau") or data.get("matériau") or "",
                    collector_well_ids=_split_ids(data.get("collector_well_ids") or data.get("puits_amont")),
                    well_collector_id=data.get("well_collector_id") or "",
                    well_pos_index=data.get("well_pos_index"),
                    pm_collector_id=data.get("pm_collector_id") or data.get("pm_collecteur_id") or "",
                    pm_pos_index=data.get("pm_pos_index"),
                    gps_lat=data.get("gps_lat"),
                    gps_lon=data.get("gps_lon"),
                    x=data.get("x"),
                    y=data.get("y"),
                )

        def _parse_wkt_linestring(value: str) -> list[list[float]]:
            try:
                import re as _re
                match = _re.search(r"LINESTRING\s*\(([^)]*)\)", value, flags=_re.IGNORECASE)
                if not match:
                    return []
                body = match.group(1)
                coords: list[list[float]] = []
                for part in body.split(","):
                    segment = [item for item in _re.split(r"[\s]+", part.strip()) if item]
                    if len(segment) >= 2:
                        lon = float(segment[0].replace(",", "."))
                        lat = float(segment[1].replace(",", "."))
                        coords.append([lon, lat])
                return coords
            except Exception:
                return []

        def to_edges():
            for row in edges_rows:
                data = dict(row)
                from_id = data.get("from_id") or data.get("source_id")
                to_id = data.get("to_id") or data.get("cible_id")
                active = data.get("active") if "active" in data else data.get("actif")
                geometry = None
                try:
                    geometry_wkt = data.get("geometry_wkt") or data.get("geometry")
                    if isinstance(geometry_wkt, str):
                        coords = _parse_wkt_linestring(geometry_wkt)
                        if coords:
                            geometry = coords
                except Exception:
                    pass
                yield Edge(
                    id=data.get("id"),
                    from_id=str(from_id),
                    to_id=str(to_id),
                    active=bool(active) if active is not None else True,
                    commentaire=data.get("commentaire") or data.get("comment"),
                    geometry=geometry,
                    branch_id=data.get("branch_id") or data.get("pipe_group_id") or "",
                    pipe_group_id=data.get("pipe_group_id"),
                    diameter_mm=float(data.get("diameter_mm") or data.get("diametre_mm") or 0.0),
                    length_m=data.get("length_m") or data.get("longueur_m"),
                    site_id=data.get("site_id"),
                    material=data.get("material"),
                    sdr=data.get("sdr") or data.get("sdr_pipe") or data.get("sdr_ouvrage"),
                    slope_pct=data.get("slope_pct"),
                )

        nodes = [node for node in to_nodes() if getattr(node, "id", None)]
        edges = [edge for edge in to_edges() if getattr(edge, "from_id", None) and getattr(edge, "to_id", None)]
        # Retourne Graph avec site_id si homogène dans BQ (optionnel)
        site_id = None
        if nodes:
            site_ids = {getattr(n, "site_id", None) for n in nodes if getattr(n, "site_id", None)}
            if len(site_ids) == 1:
                site_id = list(site_ids)[0]
        return Graph(site_id=site_id, nodes=nodes, edges=edges)
    except Exception as exc:  # pragma: no cover - requires BigQuery
        raise HTTPException(status_code=501, detail=f"bigquery_unavailable: {exc}")


def save_bigquery(*_args, **_kwargs) -> None:
    raise HTTPException(status_code=501, detail="bigquery write not implemented")


__all__ = ["load_bigquery", "save_bigquery"]
