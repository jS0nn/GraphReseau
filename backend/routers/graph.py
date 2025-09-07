import os
from typing import Any, Dict

from fastapi import APIRouter, HTTPException


router = APIRouter()


def _sheets_client():
    try:
        import google.auth
        from googleapiclient.discovery import build

        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
        return build("sheets", "v4", credentials=creds, cache_discovery=False)
    except Exception as exc:
        raise HTTPException(status_code=501, detail=f"sheets_unavailable: {exc}")


@router.get("/graph")
def get_graph() -> Dict[str, Any]:
    sheet_id = os.environ.get("SHEET_ID")
    sheet_range = os.environ.get("SHEET_RANGE", "Sheet1!A:Z")
    if not sheet_id:
        raise HTTPException(status_code=501, detail="missing SHEET_ID")

    service = _sheets_client()
    values = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=sheet_id, range=sheet_range)
        .execute()
        .get("values", [])
    )

    return {"source": "sheets", "sheet_id": sheet_id, "range": sheet_range, "values": values}


@router.post("/graph")
def post_graph(body: Dict[str, Any]) -> Dict[str, Any]:
    raise HTTPException(status_code=501, detail="write not implemented for V1")

