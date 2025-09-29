"""Lists tabs and header rows from a Google Sheet used by the legacy editor.

Example:
    python scripts/lot0/fetch_sheets_inventory.py \
        --sheet-id $SHEET_ID_DEFAULT \
        --out docs/samples/sheet_inventory.json

ADC must be configured (`gcloud auth application-default login`).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect Google Sheet metadata")
    parser.add_argument("--sheet-id", required=True, help="Spreadsheet ID to inspect")
    parser.add_argument(
        "--headers-range",
        default="A1:Z1",
        help="Range to sample for header detection (default: A1:Z1)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Optional JSON output path for the inventory",
    )
    return parser.parse_args()


def get_service():
    return build("sheets", "v4", cache_discovery=False)


def fetch_inventory(sheet_id: str, headers_range: str) -> dict[str, Any]:
    service = get_service()
    try:
        metadata = (
            service.spreadsheets()
            .get(spreadsheetId=sheet_id, includeGridData=False)
            .execute()
        )
    except HttpError as exc:  # pragma: no cover - network error handling
        raise SystemExit(f"Failed to fetch spreadsheet metadata: {exc}") from exc

    sheet_entries: list[dict[str, Any]] = []
    for sheet in metadata.get("sheets", []):
        properties = sheet.get("properties", {})
        title = properties.get("title")
        grid = properties.get("gridProperties", {})
        sample_range = f"{title}!{headers_range}" if title else headers_range
        headers = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=sheet_id, range=sample_range)
            .execute()
        )
        header_row = headers.get("values", [[]])[0] if headers.get("values") else []
        sheet_entries.append(
            {
                "title": title,
                "index": properties.get("index"),
                "rowCount": grid.get("rowCount"),
                "columnCount": grid.get("columnCount"),
                "sampledHeaders": header_row,
            }
        )

    return {
        "spreadsheetId": sheet_id,
        "title": metadata.get("properties", {}).get("title"),
        "sheets": sheet_entries,
    }


def main() -> None:
    args = parse_args()
    inventory = fetch_inventory(args.sheet_id, args.headers_range)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Inventory written to {args.out}")
    else:
        print(json.dumps(inventory, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
