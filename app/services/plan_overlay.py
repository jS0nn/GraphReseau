"""Plan overlay configuration and media helpers."""
from __future__ import annotations

import io
import time
import urllib.request
from dataclasses import dataclass
from threading import Lock
from typing import Dict, Optional, Tuple

from fastapi import HTTPException

from ..gcp_auth import get_credentials
from ..models import PlanOverlayConfig, PlanOverlayMedia
from PIL import Image
import pypdfium2 as pdfium

try:
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
except Exception:  # pragma: no cover - optional dependency, handled at runtime
    build = None
    MediaIoBaseDownload = None


_DEFAULT_CACHE_TTL = 300  # seconds
_MAX_MEDIA_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB safety limit


@dataclass
class _CacheEntry:
    payload: bytes
    mime_type: str
    expires_at: float


class PlanOverlayMediaService:
    def __init__(self) -> None:
        self._cache: Dict[str, _CacheEntry] = {}
        self._lock = Lock()

    def _cache_key(self, media: PlanOverlayMedia, transparent: bool) -> str:
        suffix = ':transparent' if transparent else ':raw'
        if media.drive_file_id:
            return f"drive:{media.drive_file_id}{suffix}"
        if media.url:
            return f"url:{media.url}{suffix}"
        return f"unknown{suffix}"

    def _compute_ttl(self, media: PlanOverlayMedia) -> int:
        if media.cache_max_age_s is not None and media.cache_max_age_s > 0:
            return int(media.cache_max_age_s)
        return _DEFAULT_CACHE_TTL

    def _download_drive(self, file_id: str, *, transparent: bool) -> Tuple[bytes, str]:
        if not build or not MediaIoBaseDownload:
            raise HTTPException(status_code=500, detail="drive_client_unavailable")
        try:
            scopes = ["https://www.googleapis.com/auth/drive.readonly"]
            creds = get_credentials(scopes)
            service = build("drive", "v3", credentials=creds, cache_discovery=False)
            metadata = service.files().get(fileId=file_id, fields="mimeType, size").execute()
            size_text = metadata.get("size")
            if size_text:
                try:
                    size_val = int(size_text)
                    if size_val > _MAX_MEDIA_SIZE_BYTES:
                        raise HTTPException(status_code=413, detail="plan_overlay_media_too_large")
                except ValueError:
                    pass
            mime_type = metadata.get("mimeType") or "application/octet-stream"
            request = service.files().get_media(fileId=file_id)
            fh = io.BytesIO()
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = downloader.next_chunk()
            content = fh.getvalue()
            if len(content) > _MAX_MEDIA_SIZE_BYTES:
                raise HTTPException(status_code=413, detail="plan_overlay_media_too_large")
            if mime_type == "application/pdf":
                try:
                    content = _pdf_first_page_to_png(content, transparent=transparent)
                    mime_type = "image/png"
                except Exception as exc:
                    raise HTTPException(status_code=502, detail=f"plan_overlay_pdf_convert_error: {exc}") from exc
            else:
                try:
                    if transparent:
                        content, mime_type = _transparentize_image(content, mime_type)
                except Exception:
                    pass
            return content, mime_type
        except HTTPException:
            raise
        except Exception as exc:  # pragma: no cover - network errors
            raise HTTPException(status_code=502, detail=f"plan_overlay_drive_error: {exc}") from exc

    def _download_url(self, url: str, fallback_mime: str, *, transparent: bool) -> Tuple[bytes, str]:
        try:
            with urllib.request.urlopen(url) as resp:  # nosec: trusted admin-provided URLs
                content = resp.read()
                if len(content) > _MAX_MEDIA_SIZE_BYTES:
                    raise HTTPException(status_code=413, detail="plan_overlay_media_too_large")
                mime_type = resp.headers.get("Content-Type") or fallback_mime or "application/octet-stream"
                if transparent:
                    try:
                        content, mime_type = _transparentize_image(content, mime_type)
                    except Exception:
                        pass
                return content, mime_type
        except HTTPException:
            raise
        except Exception as exc:  # pragma: no cover - network errors
            raise HTTPException(status_code=502, detail=f"plan_overlay_fetch_error: {exc}") from exc

    def fetch_media(self, media: PlanOverlayMedia, *, transparent: bool) -> Tuple[bytes, str, int]:
        key = self._cache_key(media, transparent)
        ttl = self._compute_ttl(media)
        now = time.time()
        if key != "unknown":
            with self._lock:
                entry = self._cache.get(key)
                if entry and entry.expires_at > now:
                    return entry.payload, entry.mime_type, ttl

        if media.drive_file_id:
            payload, mime_type = self._download_drive(media.drive_file_id, transparent=transparent)
        elif media.url:
            payload, mime_type = self._download_url(media.url, media.type, transparent=transparent)
        else:
            raise HTTPException(status_code=404, detail="plan_overlay_media_missing")

        if key != "unknown":
            with self._lock:
                self._cache[key] = _CacheEntry(payload=payload, mime_type=mime_type, expires_at=now + ttl)
        return payload, mime_type, ttl


media_service = PlanOverlayMediaService()


def ensure_plan_media(config: Optional[PlanOverlayConfig]) -> PlanOverlayConfig:
    if config is None:
        raise HTTPException(status_code=404, detail="plan_overlay_not_found")
    if not config.media:
        raise HTTPException(status_code=404, detail="plan_overlay_media_missing")
    if not (config.media.drive_file_id or config.media.url):
        raise HTTPException(status_code=404, detail="plan_overlay_media_missing")
    return config


def _pdf_first_page_to_png(data: bytes, *, transparent: bool) -> bytes:
    if not data:
        raise ValueError("empty pdf payload")
    doc = pdfium.PdfDocument(io.BytesIO(data))
    if len(doc) == 0:
        raise ValueError("pdf has no pages")
    page = doc[0]
    bitmap = page.render(scale=2.0)
    image = bitmap.to_pil()
    output = io.BytesIO()
    image.save(output, format="PNG")
    png_data = output.getvalue()
    if transparent:
        return _transparentize_image(png_data, "image/png")[0]
    return png_data


def _transparentize_image(data: bytes, mime_type: str, *, threshold: int = 250) -> Tuple[bytes, str]:
    img = Image.open(io.BytesIO(data))
    img = img.convert('RGBA')
    pixels = img.getdata()
    new_pixels = []
    for pixel in pixels:
        r, g, b, a = pixel
        if r >= threshold and g >= threshold and b >= threshold:
            new_pixels.append((r, g, b, 0))
        else:
            new_pixels.append((r, g, b, a))
    img.putdata(new_pixels)
    output = io.BytesIO()
    img.save(output, format='PNG')
    return output.getvalue(), 'image/png'
