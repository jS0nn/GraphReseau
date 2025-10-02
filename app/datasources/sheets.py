"""Google Sheets data source helpers."""
from __future__ import annotations

import re
from typing import Optional

from fastapi import HTTPException

from ..config import settings
from ..models import Graph, PlanOverlayConfig, PlanOverlayUpdateRequest, PlanOverlayBounds
from .. import sheets as sheets_mod


def _clean_sheet_id(sheet_id: str | None) -> str:
    if not sheet_id:
        return ""
    text = str(sheet_id).strip()
    text = text.rstrip("/")
    text = re.sub(r"(%2F)+$", "", text, flags=re.IGNORECASE)
    return text.strip()


def load_sheet(
    sheet_id: Optional[str] = None,
    nodes_tab: Optional[str] = None,
    edges_tab: Optional[str] = None,
    site_id: Optional[str] = None,
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


def save_sheet(
    graph: Graph,
    sheet_id: Optional[str] = None,
    nodes_tab: Optional[str] = None,
    edges_tab: Optional[str] = None,
    *,
    site_id: Optional[str] = None,
) -> None:
    sid = _clean_sheet_id(sheet_id or settings.sheet_id_default)
    if not sid:
        raise HTTPException(status_code=400, detail="sheet_id required")
    sheets_mod.write_nodes_edges(
        sid,
        nodes_tab or settings.sheet_nodes_tab,
        edges_tab or settings.sheet_edges_tab,
        graph,
        site_id=site_id,
    )


def load_plan_overlay_config(
    sheet_id: Optional[str] = None,
    *,
    site_id: Optional[str] = None,
) -> Optional[PlanOverlayConfig]:
    sid = _clean_sheet_id(sheet_id or settings.sheet_id_default)
    if not sid:
        raise HTTPException(status_code=400, detail="sheet_id required")
    return sheets_mod.read_plan_overlay_config(sid, site_id=site_id)


def save_plan_overlay_bounds(
    sheet_id: Optional[str] = None,
    *,
    site_id: Optional[str] = None,
    payload: PlanOverlayUpdateRequest,
) -> PlanOverlayConfig:
    sid = _clean_sheet_id(sheet_id or settings.sheet_id_default)
    if not sid:
        raise HTTPException(status_code=400, detail="sheet_id required")
    return sheets_mod.write_plan_overlay_bounds(
        sid,
        bounds=payload.bounds,
        rotation_deg=payload.rotation_deg,
        opacity=payload.opacity,
        site_id=site_id,
    )


def write_plan_overlay_media(
    sheet_id: Optional[str] = None,
    *,
    site_id: Optional[str] = None,
    display_name: Optional[str] = None,
    source_drive_file_id: Optional[str] = None,
    png_original_id: str,
    png_transparent_id: Optional[str],
    fallback_bounds: Optional[PlanOverlayBounds] = None,
) -> PlanOverlayConfig:
    sid = _clean_sheet_id(sheet_id or settings.sheet_id_default)
    if not sid:
        raise HTTPException(status_code=400, detail="sheet_id required")
    return sheets_mod.write_plan_overlay_media_config(
        sid,
        site_id=site_id,
        display_name=display_name,
        source_drive_file_id=source_drive_file_id,
        png_original_id=png_original_id,
        png_transparent_id=png_transparent_id,
        fallback_bounds=fallback_bounds,
    )


def clear_plan_overlay_media(
    sheet_id: Optional[str] = None,
    *,
    site_id: Optional[str] = None,
) -> None:
    sid = _clean_sheet_id(sheet_id or settings.sheet_id_default)
    if not sid:
        raise HTTPException(status_code=400, detail="sheet_id required")
    sheets_mod.clear_plan_overlay_media_config(
        sid,
        site_id=site_id,
    )


__all__ = [
    "load_sheet",
    "save_sheet",
    "load_plan_overlay_config",
    "save_plan_overlay_bounds",
    "write_plan_overlay_media",
    "clear_plan_overlay_media",
]
