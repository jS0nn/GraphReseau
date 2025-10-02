"""Helpers for interacting with the Google Drive API."""
from __future__ import annotations

from typing import Iterable, Optional

from fastapi import HTTPException

from ..gcp_auth import get_credentials

try:
    from googleapiclient.discovery import build
except Exception:  # pragma: no cover - dependency loaded at runtime
    build = None


_READONLY_SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
_WRITE_SCOPES = ["https://www.googleapis.com/auth/drive"]


def _ensure_client(scopes: Iterable[str]):
    if not build:  # pragma: no cover - ensures meaningful error if dependency missing
        raise HTTPException(status_code=500, detail="drive_client_unavailable")
    creds = get_credentials(list(scopes))
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def get_drive_service(*, writable: bool = False):
    """Return a Drive API client with the appropriate scope."""

    scopes = _WRITE_SCOPES if writable else _READONLY_SCOPES
    return _ensure_client(scopes)

