from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from ..auth_embed import build_csp, check_embed_access
from ..config import settings


router = APIRouter()
templates = Jinja2Templates(directory=settings.templates_root)


@router.get("/editor", response_class=HTMLResponse)
def embed_editor(
    request: Request,
    k: str = Query(...),
    sheet_id: Optional[str] = Query(None),
    mode: str = Query("ro"),
    source: Optional[str] = Query(None),
    gcs_uri: Optional[str] = Query(None),
    bq_project: Optional[str] = Query(None),
    bq_dataset: Optional[str] = Query(None),
    bq_nodes: Optional[str] = Query(None),
    bq_edges: Optional[str] = Query(None),
):
    if mode not in {"ro", "rw"}:
        raise HTTPException(status_code=400, detail="unsupported mode")

    check_embed_access(request, k)
    headers = {"Content-Security-Policy": build_csp()}
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "sheet_id": sheet_id, "mode": mode},
        headers=headers,
    )
