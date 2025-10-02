"""Utilities for listing Drive media and importing plan overlays."""
from __future__ import annotations

import io
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import json
from typing import List, Optional

from fastapi import HTTPException

from .drive_client import get_drive_service
from .plan_overlay import _pdf_first_page_to_png, _transparentize_image
from ..models import DriveFileItem

try:  # pragma: no cover - optional dependency loaded at runtime
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload
except Exception:  # pragma: no cover - handled at runtime with HTTP errors
    HttpError = None
    MediaIoBaseDownload = None
    MediaIoBaseUpload = None


_ALLOWED_MEDIA_MIME_TYPES = {"application/pdf", "image/png"}
_FOLDER_MIME = "application/vnd.google-apps.folder"
_MAX_MEDIA_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB safety limit


@dataclass
class DriveFilesPage:
    files: List[DriveFileItem]
    next_page_token: Optional[str]


@dataclass
class StoredPlanMedia:
    source_drive_file_id: str
    png_original_id: str
    png_transparent_id: Optional[str]
    display_name: str


def _normalize_mime_type(mime: Optional[str], filename: str) -> str:
    if mime:
        lowered = mime.split(';', 1)[0].strip().lower()
        if lowered in _ALLOWED_MEDIA_MIME_TYPES:
            return lowered
    ext = Path(filename or '').suffix.lower()
    if ext == '.pdf':
        return 'application/pdf'
    if ext == '.png':
        return 'image/png'
    return 'application/octet-stream'


def _display_name_from_filename(name: str) -> str:
    base = Path(name or '').stem
    cleaned = base.replace('_', ' ').replace('-', ' ').strip()
    return cleaned or 'Plan importé'


def _prepare_png_variants(data: bytes, mime_type: str) -> tuple[bytes, Optional[bytes]]:
    if mime_type == 'application/pdf':
        return (
            _pdf_first_page_to_png(data, transparent=False),
            _pdf_first_page_to_png(data, transparent=True),
        )
    if mime_type == 'image/png':
        try:
            transparent_data, _ = _transparentize_image(data, 'image/png')
        except Exception:
            transparent_data = None
        return data, transparent_data
    raise HTTPException(status_code=400, detail="unsupported_media_type")


def _store_png_variants(
    service,
    folder_id: str,
    base_name: str,
    data: bytes,
    mime_type: str,
) -> tuple[str, Optional[str], str, str]:
    slug = _slugify_filename(base_name)
    timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
    png_original, png_transparent = _prepare_png_variants(data, mime_type)
    original_name = f"{slug}-{timestamp}.png"
    png_original_id = _upload_png(service, folder_id, original_name, png_original)
    png_transparent_id = None
    if png_transparent:
        transparent_name = f"{slug}-{timestamp}-transparent.png"
        png_transparent_id = _upload_png(service, folder_id, transparent_name, png_transparent)
    return png_original_id, png_transparent_id, slug, timestamp


def _upload_binary_file(service, parent_id: str, name: str, payload: bytes, mime_type: str) -> str:
    media = MediaIoBaseUpload(io.BytesIO(payload), mimetype=mime_type, resumable=False)
    body = {
        "name": name,
        "mimeType": mime_type,
        "parents": [parent_id],
    }
    try:
        created = (
            service.files()
            .create(body=body, media_body=media, fields="id", supportsAllDrives=True)
            .execute()
        )
    except HttpError as exc:  # pragma: no cover - network error path
        _wrap_drive_error('drive_upload', exc)
        raise
    return created.get("id")


def list_drive_media_files(
    *,
    query: Optional[str] = None,
    page_size: int = 50,
    page_token: Optional[str] = None,
    drive_id: Optional[str] = None,
    parent_id: Optional[str] = None,
) -> DriveFilesPage:
    if not MediaIoBaseDownload:
        raise HTTPException(status_code=500, detail="drive_client_unavailable")

    service = get_drive_service(writable=False)
    name_filter = query or ""
    if page_size < 1:
        page_size = 1
    if page_size > 100:
        page_size = 100

    q_parts = ["trashed = false"]
    parent_ref = parent_id or 'root'
    q_parts.append(f"'{parent_ref}' in parents")
    mime_tokens = list(sorted(_ALLOWED_MEDIA_MIME_TYPES)) + [_FOLDER_MIME]
    mime_q = " or ".join([f"mimeType='{mime}'" for mime in mime_tokens])
    q_parts.append(f"({mime_q})")
    if name_filter.strip():
        sanitized = name_filter.replace("'", "\'")
        q_parts.append(f"name contains '{sanitized}'")
    query_string = " and ".join(q_parts)

    list_kwargs = {
        "pageSize": page_size,
        "pageToken": page_token,
        "q": query_string,
        "fields": "nextPageToken, files(id,name,mimeType,modifiedTime,size,iconLink,parents)",
        "supportsAllDrives": True,
        "includeItemsFromAllDrives": True,
        "orderBy": "folder,name",
    }
    if drive_id:
        list_kwargs["corpora"] = "drive"
        list_kwargs["driveId"] = drive_id
    else:
        list_kwargs["corpora"] = "allDrives"

    try:
        resp = service.files().list(**list_kwargs).execute()
    except HttpError as exc:  # pragma: no cover - network error path
        _wrap_drive_error('drive_list', exc)

    raw_files = resp.get("files", [])
    files = [DriveFileItem.model_validate(item) for item in raw_files]
    return DriveFilesPage(files=files, next_page_token=resp.get("nextPageToken"))


def store_plan_media_from_drive(
    *,
    sheet_id: str,
    site_id: str,
    drive_file_id: str,
    display_name: Optional[str] = None,
) -> StoredPlanMedia:
    if not MediaIoBaseDownload or not MediaIoBaseUpload:
        raise HTTPException(status_code=500, detail="drive_client_unavailable")
    if not site_id:
        raise HTTPException(status_code=400, detail="site_id required for plan import")

    service = get_drive_service(writable=True)

    sheet_meta = _get_file_metadata(service, sheet_id, fields="id,name,parents")
    parents = sheet_meta.get("parents") or []
    if not parents:
        raise HTTPException(
            status_code=403,
            detail="plan_overlay_parent_missing (déplace le Sheet dans un dossier partagé avec le service account)",
        )
    parent_id = parents[0]

    plans_folder_id = _ensure_child_folder(service, parent_id, "plans")
    site_folder_id = _ensure_child_folder(service, plans_folder_id, site_id)

    source_meta = _get_file_metadata(service, drive_file_id, fields="id,name,mimeType,size")
    mime_type = source_meta.get("mimeType")
    if mime_type not in _ALLOWED_MEDIA_MIME_TYPES:
        raise HTTPException(status_code=400, detail="unsupported_media_type")

    payload = _download_drive_file(service, drive_file_id)

    display_final = display_name or _display_name_from_filename(source_meta.get("name") or drive_file_id)
    png_original_id, png_transparent_id, _, _ = _store_png_variants(
        service,
        site_folder_id,
        display_final,
        payload,
        mime_type,
    )

    return StoredPlanMedia(
        source_drive_file_id=source_meta.get("id", drive_file_id),
        png_original_id=png_original_id,
        png_transparent_id=png_transparent_id,
        display_name=display_final,
    )


def store_plan_media_from_upload(
    *,
    sheet_id: str,
    site_id: str,
    filename: str,
    content: bytes,
    content_type: Optional[str] = None,
    display_name: Optional[str] = None,
) -> StoredPlanMedia:
    if not MediaIoBaseUpload:
        raise HTTPException(status_code=500, detail="drive_client_unavailable")
    if not site_id:
        raise HTTPException(status_code=400, detail="site_id required for plan import")
    if not content:
        raise HTTPException(status_code=400, detail="empty_file")
    if len(content) > _MAX_MEDIA_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="plan_overlay_media_too_large")

    mime_type = _normalize_mime_type(content_type, filename)
    if mime_type not in _ALLOWED_MEDIA_MIME_TYPES:
        raise HTTPException(status_code=400, detail="unsupported_media_type")

    service = get_drive_service(writable=True)
    sheet_meta = _get_file_metadata(service, sheet_id, fields="id,name,parents")
    parents = sheet_meta.get("parents") or []
    if not parents:
        raise HTTPException(
            status_code=403,
            detail="plan_overlay_parent_missing (déplace le Sheet dans un dossier partagé avec le service account)",
        )
    parent_id = parents[0]
    plans_folder_id = _ensure_child_folder(service, parent_id, "plans")
    site_folder_id = _ensure_child_folder(service, plans_folder_id, site_id)

    display_final = display_name or _display_name_from_filename(filename)
    png_original_id, png_transparent_id, slug, timestamp = _store_png_variants(
        service,
        site_folder_id,
        display_final,
        content,
        mime_type,
    )

    ext = '.pdf' if mime_type == 'application/pdf' else '.png'
    source_name = f"{slug}-{timestamp}{ext}"
    source_drive_id = _upload_binary_file(service, site_folder_id, source_name, content, mime_type)

    return StoredPlanMedia(
        source_drive_file_id=source_drive_id,
        png_original_id=png_original_id,
        png_transparent_id=png_transparent_id,
        display_name=display_final,
    )


def _download_drive_file(service, file_id: str) -> bytes:
    try:
        request = service.files().get_media(fileId=file_id, supportsAllDrives=True)
        fh = io.BytesIO()
        downloader = MediaIoBaseDownload(fh, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return fh.getvalue()
    except HttpError as exc:  # pragma: no cover - network error path
        _wrap_drive_error('drive_download', exc)
        raise  # unreachable


def _upload_png(service, parent_id: str, name: str, payload: bytes) -> str:
    media = MediaIoBaseUpload(io.BytesIO(payload), mimetype="image/png", resumable=False)
    body = {
        "name": name,
        "mimeType": "image/png",
        "parents": [parent_id],
    }
    try:
        created = (
            service.files()
            .create(body=body, media_body=media, fields="id", supportsAllDrives=True)
            .execute()
        )
    except HttpError as exc:  # pragma: no cover - network error path
        _wrap_drive_error('drive_upload_png', exc)
        raise
    return created.get("id")


def _ensure_child_folder(service, parent_id: str, name: str) -> str:
    name = name.strip() or "plans"
    escaped_name = name.replace("'", "\'")
    query = (
        f"name = '{escaped_name}' and '{parent_id}' in parents and "
        "mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    list_kwargs = {
        "q": query,
        "fields": "files(id)",
        "pageSize": 1,
        "supportsAllDrives": True,
        "includeItemsFromAllDrives": True,
        "corpora": "allDrives",
    }
    try:
        existing = service.files().list(**list_kwargs).execute()
    except HttpError as exc:  # pragma: no cover - network error path
        _wrap_drive_error('drive_folder_lookup', exc)
        raise
    files = existing.get("files", [])
    if files:
        return files[0].get("id")

    metadata = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    try:
        created = (
            service.files()
            .create(body=metadata, fields="id", supportsAllDrives=True)
            .execute()
        )
    except HttpError as exc:  # pragma: no cover - network error path
        _wrap_drive_error('drive_folder_create', exc)
        raise
    return created.get("id")


def _get_file_metadata(service, file_id: str, *, fields: str) -> dict:
    try:
        return (
            service.files()
            .get(fileId=file_id, fields=fields, supportsAllDrives=True)
            .execute()
        )
    except HttpError as exc:  # pragma: no cover - network error path
        _wrap_drive_error('drive_metadata', exc)
        raise


_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _slugify_filename(value: str) -> str:
    text = value.strip()
    if not text:
        return "plan"
    slug = _FILENAME_SAFE_RE.sub("_", text)
    slug = slug.strip("._")
    return slug or "plan"
def _wrap_drive_error(tag: str, exc: Exception) -> None:
    status = getattr(getattr(exc, 'resp', None), 'status', None)
    message = None
    try:
        content = getattr(exc, 'content', b'')
        if isinstance(content, bytes):
            content = content.decode('utf-8', errors='ignore')
        data = json.loads(content or '{}')
        message = data.get('error', {}).get('message')
    except Exception:
        message = str(exc)
    suffix = f": {message}" if message else ''
    if status in {401, 403}:
        raise HTTPException(
            status_code=403,
            detail=f"{tag}_permission_denied (share the parent Drive dossier avec le service account){suffix}",
        ) from exc
    raise HTTPException(status_code=502, detail=f"{tag}_error{suffix}") from exc
