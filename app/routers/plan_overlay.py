from typing import Optional
import json

from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse

from ..datasources import (
    load_plan_overlay_config,
    save_plan_overlay_bounds,
    list_plan_overlay_drive_files,
    import_plan_overlay_media,
    upload_plan_overlay_media,
    clear_plan_overlay_media,
)
from ..models import (
    PlanOverlayConfig,
    PlanOverlayUpdateRequest,
    PlanOverlayImportRequest,
    DriveFileListResponse,
    PlanOverlayBounds,
)
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


@router.get("/drive-files", response_model=DriveFileListResponse)
def get_drive_files(
    source: Optional[str] = Query(None, description="sheet only"),
    sheet_id: Optional[str] = Query(None, description="optional explicit sheet context"),
    drive_id: Optional[str] = Query(None, description="Shared drive ID"),
    parent_id: Optional[str] = Query(None, description="Folder to list (default root)"),
    query_text: Optional[str] = Query(None, alias="query", description="substring filter"),
    page_size: Optional[int] = Query(50, ge=1, le=100),
    page_token: Optional[str] = Query(None),
):
    payload = list_plan_overlay_drive_files(
        source=source,
        query=query_text,
        page_size=page_size,
        page_token=page_token,
        drive_id=drive_id,
        parent_id=parent_id,
    )
    return DriveFileListResponse.model_validate(payload)


@router.post("/import", response_model=PlanOverlayConfig)
def import_plan_overlay(
    payload: PlanOverlayImportRequest,
    source: Optional[str] = Query(None, description="sheet only"),
    sheet_id: Optional[str] = Query(None),
    site_id: Optional[str] = Query(None),
):
    return import_plan_overlay_media(
        source=source,
        sheet_id=sheet_id,
        site_id=site_id,
        drive_file_id=payload.drive_file_id,
        display_name=payload.display_name,
    )


@router.post("/upload", response_model=PlanOverlayConfig)
async def upload_plan_overlay(
    source: Optional[str] = Query(None, description="sheet only"),
    sheet_id: Optional[str] = Query(None),
    site_id: Optional[str] = Query(None),
    file: UploadFile = File(...),
    display_name: Optional[str] = Form(None),
    bounds: Optional[str] = Form(None),
):
    content = await file.read()
    fallback_bounds: Optional[PlanOverlayBounds] = None
    if bounds:
        try:
            data = json.loads(bounds)
            fallback_bounds = PlanOverlayBounds.model_validate(data)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"invalid_bounds: {exc}") from exc
    try:
        return upload_plan_overlay_media(
            source=source,
            sheet_id=sheet_id,
            site_id=site_id,
            filename=file.filename or 'plan',
            content=content,
            content_type=file.content_type,
            display_name=display_name,
            fallback_bounds=fallback_bounds,
        )
    finally:
        await file.close()


@router.delete("/media")
def delete_plan_overlay(
    source: Optional[str] = Query(None, description="sheet only"),
    sheet_id: Optional[str] = Query(None),
    site_id: Optional[str] = Query(None),
):
    clear_plan_overlay_media(
        source=source,
        sheet_id=sheet_id,
        site_id=site_id,
    )
    return {"ok": True}
