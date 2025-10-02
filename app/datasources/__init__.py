"""Data source dispatch layer."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException

from ..config import settings
from ..models import Graph, PlanOverlayConfig, PlanOverlayUpdateRequest, PlanOverlayBounds
from ..services.graph_sanitizer import sanitize_graph_for_write
from .sheets import (
    load_sheet,
    save_sheet,
    load_plan_overlay_config as load_sheet_plan_config,
    save_plan_overlay_bounds as save_sheet_plan_bounds,
    write_plan_overlay_media,
    clear_plan_overlay_media as clear_sheet_plan_media,
)
from .gcs_json import load_json, save_json
from .bigquery import load_bigquery, save_bigquery
from ..services.plan_overlay_import import (
    list_drive_media_files as drive_list_media,
    store_plan_media_from_drive,
    store_plan_media_from_upload,
)


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


def load_plan_overlay_config(source: Optional[str] = None, **kwargs: Any) -> Optional[PlanOverlayConfig]:
    kind = _normalise_source(source)
    if kind in {"sheet", "sheets", "google_sheets"}:
        site = kwargs.get("site_id") or settings.site_id_filter_default or None
        if settings.require_site_id and not site:
            raise HTTPException(
                status_code=400,
                detail="site_id required (set query param site_id or SITE_ID_FILTER_DEFAULT)",
            )
        return load_sheet_plan_config(
            sheet_id=kwargs.get("sheet_id"),
            site_id=site,
        )
    raise HTTPException(status_code=400, detail=f"plan overlay unsupported for data source: {kind}")


def save_plan_overlay_bounds(
    *,
    source: Optional[str] = None,
    payload: PlanOverlayUpdateRequest,
    **kwargs: Any,
) -> PlanOverlayConfig:
    kind = _normalise_source(source)
    if kind in {"sheet", "sheets", "google_sheets"}:
        site = kwargs.get("site_id") or settings.site_id_filter_default or None
        if settings.require_site_id and not site:
            raise HTTPException(
                status_code=400,
                detail="site_id required (set query param site_id or SITE_ID_FILTER_DEFAULT)",
            )
        sheet_id = kwargs.get("sheet_id")
        if not sheet_id:
            raise HTTPException(status_code=400, detail="sheet_id required for plan overlay save")
        return save_sheet_plan_bounds(
        sheet_id=sheet_id,
        site_id=site,
        payload=payload,
    )
    raise HTTPException(status_code=400, detail=f"plan overlay unsupported for data source: {kind}")


def list_plan_overlay_drive_files(
    source: Optional[str] = None,
    *,
    query: Optional[str] = None,
    page_size: Optional[int] = None,
    page_token: Optional[str] = None,
    drive_id: Optional[str] = None,
    parent_id: Optional[str] = None,
) -> Dict[str, Any]:
    kind = _normalise_source(source)
    if kind not in {"sheet", "sheets", "google_sheets"}:
        raise HTTPException(status_code=400, detail=f"plan overlay unsupported for data source: {kind}")
    page = drive_list_media(
        query=query,
        page_size=page_size or 50,
        page_token=page_token,
        drive_id=drive_id,
        parent_id=parent_id,
    )
    return {
        "files": [item.model_dump() for item in page.files],
        "next_page_token": page.next_page_token,
    }


def import_plan_overlay_media(
    *,
    source: Optional[str] = None,
    sheet_id: Optional[str] = None,
    site_id: Optional[str] = None,
    drive_file_id: str,
    display_name: Optional[str] = None,
) -> PlanOverlayConfig:
    kind = _normalise_source(source)
    if kind not in {"sheet", "sheets", "google_sheets"}:
        raise HTTPException(status_code=400, detail=f"plan overlay unsupported for data source: {kind}")
    sid = sheet_id or settings.sheet_id_default
    if not sid:
        raise HTTPException(status_code=400, detail="sheet_id required for plan import")
    site = site_id or settings.site_id_filter_default or None
    if not site:
        raise HTTPException(status_code=400, detail="site_id required for plan import")
    if settings.require_site_id and not site:
        raise HTTPException(
            status_code=400,
            detail="site_id required (set query param site_id or SITE_ID_FILTER_DEFAULT)",
        )

    stored = store_plan_media_from_drive(
        sheet_id=sid,
        site_id=site,
        drive_file_id=drive_file_id,
        display_name=display_name,
    )

    fallback_bounds: PlanOverlayBounds | None = None
    try:
        existing_config = load_plan_overlay_config(
            source=source,
            sheet_id=sheet_id,
            site_id=site,
        )
        fallback_bounds = existing_config.bounds if existing_config else None
    except HTTPException:
        fallback_bounds = None

    return write_plan_overlay_media(
        sheet_id=sid,
        site_id=site,
        display_name=stored.display_name,
        source_drive_file_id=stored.source_drive_file_id,
        png_original_id=stored.png_original_id,
        png_transparent_id=stored.png_transparent_id,
        fallback_bounds=fallback_bounds,
    )


def upload_plan_overlay_media(
    *,
    source: Optional[str] = None,
    sheet_id: Optional[str] = None,
    site_id: Optional[str] = None,
    filename: str,
    content: bytes,
    content_type: Optional[str] = None,
    display_name: Optional[str] = None,
    fallback_bounds: Optional[PlanOverlayBounds] = None,
) -> PlanOverlayConfig:
    kind = _normalise_source(source)
    if kind not in {"sheet", "sheets", "google_sheets"}:
        raise HTTPException(status_code=400, detail=f"plan overlay unsupported for data source: {kind}")
    sid = sheet_id or settings.sheet_id_default
    if not sid:
        raise HTTPException(status_code=400, detail="sheet_id required for plan import")
    site = site_id or settings.site_id_filter_default or None
    if not site:
        raise HTTPException(status_code=400, detail="site_id required for plan import")
    if settings.require_site_id and not site:
        raise HTTPException(
            status_code=400,
            detail="site_id required (set query param site_id or SITE_ID_FILTER_DEFAULT)",
        )

    stored = store_plan_media_from_upload(
        sheet_id=sid,
        site_id=site,
        filename=filename,
        content=content,
        content_type=content_type,
        display_name=display_name,
    )

    return write_plan_overlay_media(
        sheet_id=sid,
        site_id=site,
        display_name=stored.display_name,
        source_drive_file_id=stored.source_drive_file_id,
        png_original_id=stored.png_original_id,
        png_transparent_id=stored.png_transparent_id,
        fallback_bounds=fallback_bounds,
    )


def clear_plan_overlay_media(
    *,
    source: Optional[str] = None,
    sheet_id: Optional[str] = None,
    site_id: Optional[str] = None,
) -> None:
    kind = _normalise_source(source)
    if kind not in {"sheet", "sheets", "google_sheets"}:
        raise HTTPException(status_code=400, detail=f"plan overlay unsupported for data source: {kind}")
    sid = sheet_id or settings.sheet_id_default
    if not sid:
        raise HTTPException(status_code=400, detail="sheet_id required for plan import")
    site = site_id or settings.site_id_filter_default or None
    if not site:
        raise HTTPException(status_code=400, detail="site_id required for plan import")
    if settings.require_site_id and not site:
        raise HTTPException(
            status_code=400,
            detail="site_id required (set query param site_id or SITE_ID_FILTER_DEFAULT)",
        )

    clear_sheet_plan_media(
        sheet_id=sid,
        site_id=site,
    )


__all__ = [
    "load_graph",
    "save_graph",
    "load_plan_overlay_config",
    "save_plan_overlay_bounds",
    "list_plan_overlay_drive_files",
    "import_plan_overlay_media",
    "upload_plan_overlay_media",
    "clear_plan_overlay_media",
]
