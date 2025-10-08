#!/usr/bin/env python3
"""
Migration: import nodes from an existing Google Sheet into the project's Nodes tab.

Source sheet headers expected (superset):
  idOuvragReseauBiogaz, siteRaphael, idSite1, site, Regroupement, Canalisation, Casier, branche, ordreLooker,
  emplacement, designationOuvrage1, designationOuvrage2, typeDePointDeMesure, commentaire, diametreExterieur,
  diametreInterieur, sdrOuvrage, Lat, Long, x, y, actif, lat, long, dateAjoutligne, ...

Destination format:
  - First columns match app.sheets.NODE_HEADERS_FR_V11 (alignées avec l'application)
  - Extra metadata columns correspond to app.sheets.EXTRA_SHEET_HEADERS (kept for filtering/audit).

Usage:
  python scripts/migrate_nodes_from_sheet.py \
    --source-sheet-id 1gDB6Y8NbaNl_ZWgAlrdMlAQ41AekYdIca6eexkzxQkw \
    --dest-sheet-id   $SHEET_ID_DEFAULT \
    [--source-tab TABNAME] [--dest-nodes-tab Nodes] [--site-id-filter 356c469e]

Authentication:
  Uses app.gcp_auth.get_credentials (ADC; supports impersonation). Run:
    gcloud auth application-default login [--impersonate-service-account=...]
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import unicodedata
from typing import Any, Dict, List, Optional

# Ensure project root is on sys.path when running as a script
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from app.gcp_auth import get_credentials
from app.sheets import NODE_HEADERS_FR_V11, EXTRA_SHEET_HEADERS


def _sheets_client():
    from googleapiclient.discovery import build
    scopes = [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.readonly",
    ]
    creds = get_credentials(scopes)
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def _values_to_dicts(values: List[List[Any]], header: List[str]) -> List[Dict[str, Any]]:
    rows = []
    for r in values:
        d: Dict[str, Any] = {}
        for i, key in enumerate(header):
            if i < len(r):
                d[key] = r[i]
        rows.append(d)
    return rows


def _num(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        # Keep digits/decimal separator only
        s2 = re.sub(r"[^0-9.,-]", "", s).replace(",", ".")
        try:
            return float(s2)
        except Exception:
            return None
    return None


def detect_source_tab(svc, sheet_id: str, forced_tab: Optional[str]) -> str:
    if forced_tab:
        return forced_tab
    meta = svc.spreadsheets().get(spreadsheetId=sheet_id).execute()
    sheets = meta.get('sheets', [])
    for sh in sheets:
        title = sh.get('properties', {}).get('title')
        rng = f"{title}!A1:AZ1"
        vals = svc.spreadsheets().values().get(spreadsheetId=sheet_id, range=rng).execute().get('values', [])
        header = vals[0] if vals else []
        if any(h in header for h in ("idOuvragReseauBiogaz", "idSite1", "designationOuvrage1")):
            return title
    # fallback: first sheet title
    return sheets[0].get('properties', {}).get('title') if sheets else 'Feuille 1'


def build_output_rows(src_header: List[str], src_rows: List[Dict[str, Any]], site_filter: Optional[str]) -> List[List[Any]]:
    header = NODE_HEADERS_FR_V11 + EXTRA_SHEET_HEADERS
    out: List[List[Any]] = [header]

    def val(d: Dict[str, Any], key: str) -> Any:
        return d.get(key)

    def norm(s: Any) -> str:
        if s is None:
            return ''
        s = str(s).strip()
        # remove accents/diacritics and lowercase
        s = unicodedata.normalize('NFKD', s)
        s = ''.join(ch for ch in s if not unicodedata.combining(ch))
        return s.lower()

    def _boolish(value: Any) -> Any:
        if value in (None, ""):
            return ''
        if isinstance(value, bool):
            return value
        txt = str(value).strip().lower()
        if not txt:
            return ''
        if txt in {'true', '1', 'oui', 'yes', 'y'}:
            return True
        if txt in {'false', '0', 'non', 'no', 'n'}:
            return False
        return ''

    for d in src_rows:
        # Optional filter by site id (idSite1 exact match)
        if site_filter and str(val(d, 'idSite1') or '').strip() != str(site_filter).strip():
            continue

        # Best-effort mappings to app Node schema
        nid = (val(d, 'idOuvragReseauBiogaz') or val(d, 'codeKidOuvragedesignationOuvrage') or val(d, 'designationOuvrage1') or "").strip()
        name = (val(d, 'designationOuvrage1') or val(d, 'designationOuvrage2') or val(d, 'emplacement') or val(d, 'site') or "").strip()
        raw_t = (val(d, 'typeDePointDeMesure') or '')
        sraw = norm(raw_t)
        # Map métier → types UI canoniques
        #  - general => GENERAL (anciennement PLATEFORME)
        #  - collecteur => CANALISATION
        #  - ouvrage => OUVRAGE (anciennement PUITS)
        #  - puit => OUVRAGE (normalisation)
        if sraw in {'general', 'plateforme', 'plateform'}: ntype = 'GENERAL'
        elif sraw == 'collecteur': ntype = 'CANALISATION'
        elif sraw == 'ouvrage' or sraw == 'puit' or sraw == 'puits': ntype = 'OUVRAGE'
        else: ntype = 'OUVRAGE'
        branch = (val(d, 'branche') or val(d, 'Canalisation') or val(d, 'Casier') or val(d, 'Regroupement') or "").strip()
        # Diamètre = diamètre EXTERIEUR
        diam_mm = _num(val(d, 'diametreExterieur')) or _num(val(d, 'diametreInterieur'))
        lat = _num(val(d, 'gps_lat')) or _num(val(d, 'lat'))
        lon = _num(val(d, 'gps_lon')) or _num(val(d, 'long'))
        if (lat is None or lon is None) and isinstance(val(d, 'Lat, Long'), str):
            try:
                latlon = [p.strip() for p in str(val(d, 'Lat, Long')).split(',')]
                if len(latlon) >= 2:
                    lat = _num(latlon[0])
                    lon = _num(latlon[1])
            except Exception:
                pass
        # Importer x/y depuis la base métier et les conserver côté sheet
        x = _num(val(d, 'x'))
        y = _num(val(d, 'y'))

        mat = (val(d, 'materiau') or val(d, 'material') or '')

        gps_locked = _boolish(val(d, 'gps_locked') or val(d, 'gpsLocked'))
        pm_offset = _num(val(d, 'pm_offset_m') or val(d, 'pm_offset'))

        # Core FR V11 columns
        core = [
            nid,
            name,
            (ntype if isinstance(ntype, str) else 'OUVRAGE'),
            branch,
            gps_locked,
            ("" if pm_offset is None else pm_offset),
            ("" if diam_mm is None else diam_mm),
            mat,
            (val(d, 'commentaire') or ''),
            '',  # pm_collector_edge_id
            '',  # pm_pos_index
            ("" if lat is None else lat),
            ("" if lon is None else lon),
            ("" if x is None else x),
            ("" if y is None else y),
            ("" if x is None else x),
            ("" if y is None else y),
        ]

        extra = [val(d, key) for key in EXTRA_SHEET_HEADERS]

        out.append(core + extra)

    return out


def main():
    ap = argparse.ArgumentParser(description="Migrate nodes from an existing Sheet to project Nodes tab with extra metadata appended.")
    ap.add_argument('--source-sheet-id', required=True, help='Spreadsheet ID of the source data')
    ap.add_argument('--dest-sheet-id', required=True, help='Spreadsheet ID of the destination project sheet (Nodes tab will be overwritten)')
    ap.add_argument('--source-tab', help='Optional explicit tab name in the source sheet')
    ap.add_argument('--dest-nodes-tab', default='Nodes', help='Destination tab name (default: Nodes)')
    ap.add_argument('--site-id-filter', help='Optional site id filter (matches idSite1)')
    args = ap.parse_args()

    svc = _sheets_client()

    # Locate source tab by headers if not provided
    src_tab = detect_source_tab(svc, args.source_sheet_id, args.source_tab)

    # Read source values
    src_values = (
        svc.spreadsheets().values().get(spreadsheetId=args.source_sheet_id, range=f"{src_tab}!A:AZ").execute().get('values', [])
    )
    if not src_values:
        raise SystemExit("No data found in source sheet")
    src_header = src_values[0]
    src_rows = _values_to_dicts(src_values[1:], src_header)

    # Build destination rows
    out_values = build_output_rows(src_header, src_rows, args.site_id_filter)
    if len(out_values) <= 1:
        raise SystemExit("No rows matched the filter; nothing to write.")

    # Write to destination Nodes tab: clear and update
    try:
        svc.spreadsheets().values().clear(
            spreadsheetId=args.dest_sheet_id, range=f"{args.dest_nodes_tab}!A:AZ"
        ).execute()
    except Exception:
        pass
    svc.spreadsheets().values().update(
        spreadsheetId=args.dest_sheet_id,
        range=f"{args.dest_nodes_tab}!A1",
        valueInputOption="RAW",
        body={"values": out_values},
    ).execute()

    print(f"Wrote {len(out_values)-1} nodes to {args.dest_sheet_id} / {args.dest_nodes_tab}")


if __name__ == '__main__':
    main()
