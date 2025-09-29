"""Analyse relationships between Sheets tabs for Lot 0 data modelling.

Example:
    python scripts/lot0/analyze_sheet_links.py \
        --survey-sheet-id 1Nf5zPrzV6nlYrWI8tqFCmBG3RX8w8rReQxZH8_sncyE \
        --primary-tab "R&T BIOGAZ || 965523" \
        --secondary-tab "releve_biogaz" \
        --network-sheet-id 10y5y_3H-3qKzQmY8lx9wevIXXbkWfIU-Qx2uyaaw6Bg \
        --out docs/samples/sheets_link_analysis.json

Requires Sheets API credentials (ADC).
"""
from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyse Google Sheets tabs relationships")
    parser.add_argument("--survey-sheet-id", required=True, help="Sheet ID containing survey data")
    parser.add_argument("--primary-tab", required=True, help="Primary tab title (master responses)")
    parser.add_argument("--secondary-tab", required=True, help="Secondary tab referencing primary rows")
    parser.add_argument(
        "--primary-key-column",
        default=None,
        help="Header name used as key in primary tab (auto-detected if omitted)",
    )
    parser.add_argument(
        "--secondary-link-column",
        default=None,
        help="Header name in secondary tab referencing the primary key",
    )
    parser.add_argument(
        "--network-sheet-id",
        default=None,
        help="Optional sheet ID with network/GPS information",
    )
    parser.add_argument(
        "--out",
        type=Path,
        help="Optional output path for JSON report",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional row limit when sampling each tab (after header)",
    )
    return parser.parse_args()


def get_service():
    return build("sheets", "v4", cache_discovery=False)


def fetch_tab_values(service, sheet_id: str, tab: str, limit: int | None) -> list[list[Any]]:
    range_ref = f"{tab}!A:ZZ"
    try:
        result = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=sheet_id, range=range_ref, majorDimension="ROWS")
            .execute()
        )
    except HttpError as exc:  # pragma: no cover - surface useful message
        raise SystemExit(
            "Google Sheets API error. Vérifie que la feuille est partagée avec le compte ADC / service account utilisé et que `gcloud auth application-default login` a bien été exécuté."
        ) from exc
    values: list[list[Any]] = result.get("values", [])
    if not values:
        return []
    if limit is None:
        return values
    header, *rows = values
    return [header, *rows[:limit]]


def rows_to_dicts(rows: list[list[Any]]) -> tuple[list[str], list[dict[str, Any]]]:
    if not rows:
        return [], []
    header = [str(col).strip() for col in rows[0]]
    records: list[dict[str, Any]] = []
    for raw in rows[1:]:
        record = {}
        for idx, key in enumerate(header):
            if not key:
                continue
            record[key] = raw[idx] if idx < len(raw) else None
        records.append(record)
    return header, records


def detect_key(header: Iterable[str], preferred: str | None = None) -> str | None:
    if preferred and preferred in header:
        return preferred
    lowered = [h.lower() for h in header]
    candidates = [h for h, low in zip(header, lowered) if "id" in low]
    return candidates[0] if candidates else None


def analyse_join(primary: list[dict[str, Any]], secondary: list[dict[str, Any]], primary_key: str, secondary_key: str) -> dict[str, Any]:
    primary_index = {row.get(primary_key): row for row in primary if row.get(primary_key)}
    match_count = 0
    missing = []
    for row in secondary:
        key = row.get(secondary_key)
        if key in primary_index:
            match_count += 1
        else:
            missing.append(key)
    return {
        "primaryRowCount": len(primary),
        "secondaryRowCount": len(secondary),
        "joinFieldPrimary": primary_key,
        "joinFieldSecondary": secondary_key,
        "matches": match_count,
        "missingInPrimary": missing,
    }


def summarise_fields(records: list[dict[str, Any]]) -> dict[str, Any]:
    summary = {}
    for field in set().union(*(r.keys() for r in records)):
        values = [r.get(field) for r in records if r.get(field) not in (None, "")]
        summary[field] = {
            "unique": len(set(values)),
            "sample": values[:5],
        }
    return summary


def analyse_network_sheet(service, sheet_id: str, limit: int | None) -> dict[str, Any]:
    metadata = (
        service.spreadsheets()
        .get(spreadsheetId=sheet_id, includeGridData=False)
        .execute()
    )
    sheets = metadata.get("sheets", [])
    analysis = {"spreadsheetId": sheet_id, "title": metadata.get("properties", {}).get("title"), "tabs": []}
    geo_fields = {"lat", "latitude", "lon", "long", "longitude"}
    for sheet in sheets:
        title = sheet.get("properties", {}).get("title")
        rows = fetch_tab_values(service, sheet_id, title, limit)
        header, records = rows_to_dicts(rows)
        geo_columns = [h for h in header if any(token in h.lower() for token in geo_fields)]
        analysis["tabs"].append(
            {
                "title": title,
                "rowCount": len(records),
                "columns": header,
                "geoColumns": geo_columns,
            }
        )
    return analysis


def main() -> None:
    args = parse_args()
    service = get_service()
    try:
        service.spreadsheets().get(spreadsheetId=args.survey_sheet_id, includeGridData=False).execute()
    except HttpError as exc:  # pragma: no cover
        raise SystemExit(
            "Accès refusé au classeur survey. Partage-le avec le compte utilisé par les ADC ou fournis les autorisations nécessaires."
        ) from exc

    # Validation rapide du droit d'accès à la feuille réseau (si fournie)
    if args.network_sheet_id:
        try:
            service.spreadsheets().get(spreadsheetId=args.network_sheet_id, includeGridData=False).execute()
        except HttpError as exc:  # pragma: no cover
            raise SystemExit(
                "Accès refusé au classeur réseau. Partage-le avec le compte utilisé par les ADC."
            ) from exc

    primary_rows = fetch_tab_values(service, args.survey_sheet_id, args.primary_tab, args.limit)
    secondary_rows = fetch_tab_values(service, args.survey_sheet_id, args.secondary_tab, args.limit)

    primary_header, primary_records = rows_to_dicts(primary_rows)
    secondary_header, secondary_records = rows_to_dicts(secondary_rows)

    primary_key = detect_key(primary_header, args.primary_key_column)
    if not primary_key:
        raise SystemExit("Unable to detect primary key column; provide --primary-key-column")
    secondary_key = detect_key(secondary_header, args.secondary_link_column)
    if not secondary_key:
        raise SystemExit("Unable to detect secondary link column; provide --secondary-link-column")

    join_summary = analyse_join(primary_records, secondary_records, primary_key, secondary_key)

    field_summary = {
        args.primary_tab: summarise_fields(primary_records[:1000]),
        args.secondary_tab: summarise_fields(secondary_records[:1000]),
    }

    report = {
        "surveySheetId": args.survey_sheet_id,
        "primaryTab": args.primary_tab,
        "secondaryTab": args.secondary_tab,
        "primaryColumns": primary_header,
        "secondaryColumns": secondary_header,
        "join": join_summary,
        "fieldSummary": field_summary,
    }

    if args.network_sheet_id:
        report["networkSheet"] = analyse_network_sheet(service, args.network_sheet_id, args.limit)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Report written to {args.out}")
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
