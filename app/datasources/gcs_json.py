"""Google Cloud Storage JSON data source helpers."""
from __future__ import annotations

import json
import os
from typing import Optional, Tuple

from fastapi import HTTPException

from ..config import settings
from ..models import Graph
from ..gcp_auth import get_credentials


def _parse_gs_uri(uri: str) -> Tuple[str, str]:
    if not uri.startswith("gs://"):
        raise HTTPException(status_code=400, detail="gcs_uri must start with gs://")
    path = uri[len("gs://") :]
    parts = path.split("/", 1)
    if len(parts) != 2:
        raise HTTPException(status_code=400, detail="gcs_uri must be gs://bucket/path")
    return parts[0], parts[1]


def load_json(gcs_uri: Optional[str] = None) -> Graph:
    uri = gcs_uri or settings.gcs_json_uri_default
    if not uri:
        raise HTTPException(status_code=400, detail="gcs_uri required")

    if uri.startswith("file://") or os.path.isabs(uri):
        path = uri.replace("file://", "")
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except Exception as exc:  # pragma: no cover - IO errors
            raise HTTPException(status_code=500, detail=f"read_local_json_failed: {exc}")
        return Graph.model_validate(data)

    bucket_name, blob_path = _parse_gs_uri(uri)
    try:
        from google.cloud import storage

        creds = get_credentials(["https://www.googleapis.com/auth/devstorage.read_only"])
        client = storage.Client(project=settings.gcp_project_id or None, credentials=creds)
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        text = blob.download_as_text()
        data = json.loads(text)
        return Graph.model_validate(data)
    except Exception as exc:  # pragma: no cover - requires GCS
        raise HTTPException(status_code=501, detail=f"gcs_json_unavailable: {exc}")


def save_json(graph: Graph, gcs_uri: Optional[str] = None) -> None:
    uri = gcs_uri or settings.gcs_json_uri_default
    if not uri:
        raise HTTPException(status_code=400, detail="gcs_uri required")

    try:
        existing: Graph | None = None
        if uri.startswith("file://") or os.path.isabs(uri):
            path = uri.replace("file://", "")
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as handle:
                    existing = Graph.model_validate(json.load(handle))
        else:
            from google.cloud import storage

            creds_ro = get_credentials(["https://www.googleapis.com/auth/devstorage.read_only"])
            client_ro = storage.Client(project=settings.gcp_project_id or None, credentials=creds_ro)
            bucket_name, blob_path = _parse_gs_uri(uri)
            bucket = client_ro.bucket(bucket_name)
            blob = bucket.blob(blob_path)
            if blob.exists(client_ro):
                text = blob.download_as_text()
                existing = Graph.model_validate(json.loads(text))
        if existing is not None:
            by_id = {node.id: node for node in (existing.nodes or [])}
            for node in graph.nodes or []:
                previous = by_id.get(node.id)
                if previous is not None:
                    node.x = previous.x
                    node.y = previous.y
    except Exception:  # pragma: no cover - merge failures are non fatal
        pass

    payload = json.dumps(graph.model_dump(), ensure_ascii=False)

    if uri.startswith("file://") or os.path.isabs(uri):
        path = uri.replace("file://", "")
        try:
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(payload)
            return
        except Exception as exc:  # pragma: no cover - IO errors
            raise HTTPException(status_code=500, detail=f"write_local_json_failed: {exc}")

    try:
        from google.cloud import storage

        creds = get_credentials(["https://www.googleapis.com/auth/devstorage.read_write"])
        client = storage.Client(project=settings.gcp_project_id or None, credentials=creds)
        bucket_name, blob_path = _parse_gs_uri(uri)
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        blob.upload_from_string(payload, content_type="application/json; charset=utf-8")
    except Exception as exc:  # pragma: no cover - requires GCS
        raise HTTPException(status_code=501, detail=f"gcs_write_unavailable: {exc}")


__all__ = ["load_json", "save_json"]
