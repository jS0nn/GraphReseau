import os
from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.staticfiles import StaticFiles

from .auth_embed import build_csp
from .config import settings
from .routers.api import router as api_router
from .routers.embed import router as embed_router


class CSPMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        # Ensure CSP header is present and X-Frame-Options is not set
        response.headers["Content-Security-Policy"] = build_csp()
        if "x-frame-options" in (k.lower() for k in response.headers.keys()):
            response.headers.pop("x-frame-options", None)
            response.headers.pop("X-Frame-Options", None)
        return response


app = FastAPI(title="Éditeur Réseau API", version="0.1.0")
app.add_middleware(CSPMiddleware)

static_dir = settings.static_root
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/healthz")
def healthz():
    return {"ok": True}


app.include_router(api_router, prefix="/api", tags=["graph"])
app.include_router(embed_router, prefix="/embed", tags=["embed"])

