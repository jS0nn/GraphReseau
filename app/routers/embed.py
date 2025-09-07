from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from ..auth_embed import build_csp, check_embed_access
from ..config import settings


router = APIRouter()
templates = Jinja2Templates(directory=settings.templates_root)


@router.get("/editor", response_class=HTMLResponse)
def embed_editor(request: Request, k: str = Query(...), sheet_id: str = Query(...), mode: str = Query("ro")):
    if mode != "ro":
        raise HTTPException(status_code=400, detail="unsupported mode")

    check_embed_access(request, k)
    headers = {"Content-Security-Policy": build_csp()}
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "sheet_id": sheet_id, "mode": mode},
        headers=headers,
    )

