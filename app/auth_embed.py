from typing import List
from urllib.parse import urlparse
from fastapi import HTTPException, Request

from .config import settings


def build_csp() -> str:
    ancestors = settings.allowed_frame_ancestors
    # Allow map tile host if configured (for orthophoto)
    img_src = ["'self'", "data:", "blob:"]
    connect_src = ["'self'"]
    try:
        tiles_url = (settings.map_tiles_url or "").strip()
        if tiles_url:
            u = urlparse(tiles_url)
            if u.scheme and u.hostname:
                origin = f"{u.scheme}://{u.hostname}"
                if origin not in img_src:
                    img_src.append(origin)
                if origin not in connect_src:
                    connect_src.append(origin)
    except Exception:
        pass
    img_src_str = " ".join(img_src)
    connect_src_str = " ".join(connect_src)
    return (
        "default-src 'none'; "
        f"connect-src {connect_src_str}; "
        f"img-src {img_src_str}; "
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
