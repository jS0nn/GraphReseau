from typing import List
from urllib.parse import urlparse
from fastapi import HTTPException, Request

from .config import settings


def build_csp() -> str:
    ancestors = settings.allowed_frame_ancestors
    return (
        "default-src 'none'; "
        "connect-src 'self'; "
        "img-src 'self' data:; "
        "font-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; "
        f"frame-ancestors {ancestors}; "
        "base-uri 'none'; form-action 'none';"
    )


def check_embed_access(request: Request, provided_key: str) -> None:
    expected = settings.embed_static_key
    if not settings.dev_disable_embed_key:
        if not expected or provided_key != expected:
            raise HTTPException(status_code=403, detail="invalid key")

    if not settings.dev_disable_embed_referer:
        referer = request.headers.get("referer", "")
        host = urlparse(referer).hostname or ""
        if host not in settings.allowed_referer_hosts:
            raise HTTPException(status_code=403, detail="invalid referer")
