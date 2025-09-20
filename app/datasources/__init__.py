"""Data source dispatch layer."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from ..config import settings
from ..models import Graph
from ..services.graph_sanitizer import sanitize_graph_for_write
from .sheets import load_sheet, save_sheet
from .gcs_json import load_json, save_json
from .bigquery import load_bigquery, save_bigquery


def _normalise_source(source: Optional[str]) -> str:
    return (source or settings.data_source_default or "sheet").lower()


def load_graph(source: Optional[str] = None, **kwargs: Any) -> Graph:
    kind = _normalise_source(source)
    if kind in {"sheet", "sheets", "google_sheets"}:
        site = kwargs.get("site_id") or settings.site_id_filter_default or None
        if settings.require_site_id and not site:
            raise HTTPException(
                status_code=400,
                detail="site_id required (set query param site_id or SITE_ID_FILTER_DEFAULT)",
            )
        return load_sheet(
            sheet_id=kwargs.get("sheet_id"),
            nodes_tab=kwargs.get("nodes_tab"),
            edges_tab=kwargs.get("edges_tab"),
            site_id=site,
        )
    if kind in {"gcs", "gcs_json", "json"}:
        return load_json(gcs_uri=kwargs.get("gcs_uri"))
    if kind in {"bq", "bigquery"}:
        return load_bigquery(
            dataset=kwargs.get("bq_dataset"),
            nodes_table=kwargs.get("bq_nodes"),
            edges_table=kwargs.get("bq_edges"),
            project_id=kwargs.get("bq_project"),
        )
    raise HTTPException(status_code=400, detail=f"unknown data source: {kind}")


def save_graph(source: Optional[str] = None, graph: Graph | None = None, **kwargs: Any) -> None:
    if graph is None:
        raise HTTPException(status_code=400, detail="graph payload required")

    kind = _normalise_source(source)
    graph = sanitize_graph_for_write(graph)
    graph.generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    if kind in {"sheet", "sheets", "google_sheets"}:
        site = kwargs.get("site_id") or settings.site_id_filter_default or None
        if settings.require_site_id and not site:
            raise HTTPException(
                status_code=400,
                detail="site_id required for write (set query param site_id or SITE_ID_FILTER_DEFAULT)",
            )
        save_sheet(
            graph,
            sheet_id=kwargs.get("sheet_id"),
            nodes_tab=kwargs.get("nodes_tab"),
            edges_tab=kwargs.get("edges_tab"),
            site_id=site,
        )
        return
    if kind in {"gcs", "gcs_json", "json"}:
        save_json(graph, gcs_uri=kwargs.get("gcs_uri"))
        return
    if kind in {"bq", "bigquery"}:
        save_bigquery()
        return
    raise HTTPException(status_code=400, detail=f"unknown data source: {kind}")


__all__ = ["load_graph", "save_graph"]
