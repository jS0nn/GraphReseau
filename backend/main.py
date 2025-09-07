import os
from typing import List

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.staticfiles import StaticFiles

from backend.routers.graph import router as graph_router


def _static_dir() -> str:
    if os.path.isdir("frontend/dist"):
        return "frontend/dist"
    return "frontend/public"


def _csp_value() -> str:
    ancestors = os.environ.get("ALLOWED_FRAME_ANCESTORS", "'self'").strip()
    return (
        "default-src 'none'; "
        "connect-src 'self'; "
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; "
        f"frame-ancestors {ancestors}; "
        "base-uri 'none'; "
        "form-action 'none';"
    )


def _allowed_referer_hosts() -> List[str]:
    env_hosts = os.environ.get("ALLOWED_REFERER_HOSTS", "").strip()
    if env_hosts:
        return [h for h in env_hosts.split() if h]
    return [
        "lookerstudio.google.com",
        "datastudio.google.com",
        "sites.google.com",
    ]


app = FastAPI(title="Éditeur Réseau API", version="0.1.0")
app.mount("/static", StaticFiles(directory=_static_dir()), name="static")
app.include_router(graph_router, prefix="/api", tags=["graph"])


@app.get("/")
def root() -> dict:
    return {"service": "editeur-reseau", "status": "ok"}


@app.get("/embed/editor", response_class=HTMLResponse)
def embed_editor(
    request: Request,
    k: str = Query(..., description="clé d'accès statique"),
    sheet_id: str = Query(...),
    mode: str = Query("ro"),
):
    expected = os.environ.get("EMBED_STATIC_KEY", "")
    if not expected or k != expected:
        raise HTTPException(status_code=403, detail="invalid key")

    referer = request.headers.get("referer", "")
    host = ""
    try:
        from urllib.parse import urlparse

        host = urlparse(referer).hostname or ""
    except Exception:
        host = ""

    if host not in _allowed_referer_hosts():
        raise HTTPException(status_code=403, detail="invalid referer")

    if mode not in {"ro"}:
        raise HTTPException(status_code=400, detail="unsupported mode")

    html = f"""
    <!doctype html>
    <html lang=\"fr\">
      <head>
        <meta charset=\"utf-8\" />
        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
        <title>Éditeur Réseau – Embed</title>
      </head>
      <body>
        <div id=\"app\" data-sheet-id=\"{sheet_id}\" data-mode=\"{mode}\"></div>
        <!-- Placeholders: servez vos bundles locaux depuis /static -->
      </body>
    </html>
    """
    headers = {"Content-Security-Policy": _csp_value()}
    return HTMLResponse(content=html, headers=headers)


@app.get("/_ah/health")
def health() -> JSONResponse:
    return JSONResponse({"ok": True})

