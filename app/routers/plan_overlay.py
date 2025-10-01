from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from ..datasources import load_plan_overlay_config, save_plan_overlay_bounds
from ..models import PlanOverlayConfig, PlanOverlayUpdateRequest
from ..services.plan_overlay import ensure_plan_media, media_service

router = APIRouter(prefix="/api/plan-overlay", tags=["plan-overlay"])


@router.get("/config", response_model=PlanOverlayConfig)
def get_plan_overlay_config(
    source: Optional[str] = Query(None, description="sheet only"),
    sheet_id: Optional[str] = Query(None),
    site_id: Optional[str] = Query(None),
):
    config = load_plan_overlay_config(
        source=source,
        sheet_id=sheet_id,
        site_id=site_id,
    )
    if not config:
        raise HTTPException(status_code=404, detail="plan_overlay_not_found")
    return config


@router.get("/media")
def get_plan_overlay_media(
    source: Optional[str] = Query(None, description="sheet only"),
    sheet_id: Optional[str] = Query(None),
    site_id: Optional[str] = Query(None),
    transparent: bool = Query(True, description="If false, conserve original white background"),
):
    config = load_plan_overlay_config(
        source=source,
        sheet_id=sheet_id,
        site_id=site_id,
    )
    config = ensure_plan_media(config)
    payload, mime_type, ttl = media_service.fetch_media(config.media, transparent=transparent)
    headers = {
        "Cache-Control": f"public, max-age={ttl}",
    }
    return StreamingResponse(iter([payload]), media_type=mime_type, headers=headers)


@router.post("/config", response_model=PlanOverlayConfig)
def update_plan_overlay_config(
    payload: PlanOverlayUpdateRequest,
    source: Optional[str] = Query(None, description="sheet only"),
    sheet_id: Optional[str] = Query(None),
    site_id: Optional[str] = Query(None),
):
    return save_plan_overlay_bounds(
        source=source,
        sheet_id=sheet_id,
        site_id=site_id,
        payload=payload,
    )
