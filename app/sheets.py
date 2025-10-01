from __future__ import annotations

from typing import Any, Dict, List, Tuple, Optional
import json
import re
import unicodedata

from fastapi import HTTPException
from pydantic import ValidationError

from .models import (
    Edge,
    Graph,
    Node,
    BranchInfo,
    CRSInfo,
    PlanOverlayConfig,
    PlanOverlayBounds,
    PlanOverlayMedia,
    PlanOverlayDefaults,
    LatLon,
    _compute_length_from_geometry,
)
from .gcp_auth import get_credentials
from googleapiclient.errors import HttpError
from .shared.graph_transform import ensure_created_at_string


def _client():
    try:
        from googleapiclient.discovery import build
        scopes = [
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive.readonly",
        ]
        creds = get_credentials(scopes)
        return build("sheets", "v4", credentials=creds, cache_discovery=False)
    except Exception as exc:
        raise HTTPException(status_code=501, detail=f"sheets_unavailable: {exc}")


def _parse_style_meta_values(values: List[List[Any]]) -> Dict[str, Any]:
    if not values:
        return {}
    first = values[0]
    if len(first) >= 2 and isinstance(first[0], str) and first[0].strip().lower() == "style_meta":
        raw = first[1] if len(first) > 1 else "{}"
        if isinstance(raw, str):
            try:
                return json.loads(raw)
            except Exception:
                return {}
        return {}

    meta: Dict[str, Any] = {}
    for row in values:
        if len(row) < 2:
            continue
        key = str(row[0]).strip()
        if not key:
            continue
        val = row[1]
        if isinstance(val, str):
            txt = val.strip()
            if txt:
                try:
                    meta[key] = json.loads(txt)
                    continue
                except Exception:
                    pass
        meta[key] = val
    return meta


def _read_style_meta_sheet(svc, sheet_id: str) -> Dict[str, Any]:
    try:
        resp = (
            svc.spreadsheets()
            .values()
            .get(spreadsheetId=sheet_id, range=f"{STYLE_META_SHEET}!A:ZZZ")
            .execute()
        )
        values = resp.get("values", [])
        return _parse_style_meta_values(values)
    except HttpError as exc:
        if exc.resp.status == 400 and "Unable to parse range" in str(exc):
            return {}
        raise
    except Exception:
        return {}


def _write_style_meta_sheet(svc, sheet_id: str, style_meta: Dict[str, Any]) -> None:
    payload = json.dumps(style_meta or {}, ensure_ascii=False, separators=(",", ":"))
    values = [["style_meta", payload]]
    body = {"values": values}
    target_range = f"{STYLE_META_SHEET}!A1:B1"
    try:
        svc.spreadsheets().values().update(
            spreadsheetId=sheet_id,
            range=target_range,
            valueInputOption="RAW",
            body=body,
        ).execute()
    except HttpError as exc:
        if exc.resp.status == 400 and "Unable to parse range" in str(exc):
            try:
                svc.spreadsheets().batchUpdate(
                    spreadsheetId=sheet_id,
                    body={
                        "requests": [
                            {
                                "addSheet": {
                                    "properties": {
                                        "title": STYLE_META_SHEET,
                                    }
                                }
                            }
                        ]
                    },
                ).execute()
            except HttpError as inner_exc:
                if inner_exc.resp.status not in {400, 409}:
                    raise
            svc.spreadsheets().values().update(
                spreadsheetId=sheet_id,
                range=target_range,
                valueInputOption="RAW",
                body=body,
            ).execute()
        else:
            raise


def _clear_sheet(svc, sheet_id: str, title: str) -> None:
    try:
        svc.spreadsheets().values().clear(
            spreadsheetId=sheet_id, range=f"{title}!A:ZZZ"
        ).execute()
    except HttpError as exc:
        if exc.resp.status == 400 and "Unable to parse range" in str(exc):
            try:
                svc.spreadsheets().batchUpdate(
                    spreadsheetId=sheet_id,
                    body={
                        "requests": [
                            {
                                "addSheet": {
                                    "properties": {
                                        "title": title,
                                    }
                                }
                            }
                        ]
                    },
                ).execute()
            except HttpError as inner_exc:
                if inner_exc.resp.status not in {400, 409}:
                    raise
        else:
            raise


def _read_branches_sheet(svc, sheet_id: str) -> List[BranchInfo]:
    try:
        resp = (
            svc.spreadsheets()
            .values()
            .get(spreadsheetId=sheet_id, range=f"{BRANCHES_SHEET}!A:ZZZ")
            .execute()
        )
    except HttpError as exc:
        if exc.resp.status == 400 and "Unable to parse range" in str(exc):
            return []
        raise
    rows = resp.get('values', [])
    if not rows:
        return []
    header = rows[0]
    entries = _values_to_dicts(rows[1:], header)
    branches: Dict[str, BranchInfo] = {}
    for entry in entries:
        raw_id = entry.get('id')
        branch_id = str(raw_id).strip() if raw_id not in (None, '') else ''
        if not branch_id or branch_id in branches:
            continue
        raw_name = entry.get('name') or entry.get('nom') or ''
        name = str(raw_name).strip() or branch_id
        raw_parent = entry.get('parent_id') or entry.get('parentId')
        parent_id = str(raw_parent).strip() if raw_parent not in (None, '') else None
        is_trunk = _bool(entry.get('is_trunk'), default=False)
        branches[branch_id] = BranchInfo(
            id=branch_id,
            name=name,
            parent_id=parent_id,
            is_trunk=is_trunk,
        )
    return list(branches.values())


def _read_config_sheet(svc, sheet_id: str) -> Dict[str, Any]:
    try:
        resp = (
            svc.spreadsheets()
            .values()
            .get(spreadsheetId=sheet_id, range=f"{CONFIG_SHEET}!A:B")
            .execute()
        )
    except HttpError as exc:
        if exc.resp.status == 400 and "Unable to parse range" in str(exc):
            return {}
        raise
    rows = resp.get('values', [])
    config: Dict[str, Any] = {}
    for row in rows:
        if not row:
            continue
        key = str(row[0]).strip().lower() if row[0] not in (None, '') else ''
        if not key:
            continue
        value = row[1] if len(row) > 1 else ''
        config[key] = value
    return config


def _normalise_crs_from_config(config: Dict[str, Any]) -> CRSInfo:
    code_raw = config.get('crs_code') or config.get('crs') or 'EPSG:4326'
    code = str(code_raw).strip() or 'EPSG:4326'
    proj_raw = config.get('projected_for_lengths') or config.get('projected')
    if proj_raw in (None, ''):
        projected = 'EPSG:2154'
    else:
        projected = str(proj_raw).strip() or 'EPSG:2154'
    return CRSInfo(code=code, projected_for_lengths=projected)


# Header sets identical to Apps Script

EDGE_HEADERS_FR_V6 = ['id','from_id','to_id','branch_id','geometry_json','diameter_mm','material','sdr','length_m','active','commentaire','Geometry']

NODE_HEADERS_FR_V11 = [
    'id','nom','type','id_branche','gps_locked','pm_offset_m','diametre_exterieur_mm',
    'materiau','commentaire','pm_collector_edge_id','pm_pos_index','gps_lat','gps_lon',
    'x','y','x_UI','y_UI'
]

BRANCH_HEADERS = ['id','name','parent_id','is_trunk']
BRANCHES_SHEET = 'BRANCHES'
CONFIG_SHEET = 'CONFIG'

EXTRA_SHEET_HEADERS = [
    'idSite1','site','Regroupement','Canalisation','Casier','emplacement',
    'typeDePointDeMesure','diametreInterieur','sdrOuvrage','actif','dateAjoutligne'
]

STYLE_META_SHEET = "STYLE_META"
PLAN_OVERLAY_SHEET = "PlanOverlay"
_DRIVE_URL_RE = re.compile(r"/(?:d|folders)/([A-Za-z0-9_-]{10,})")


def _extract_drive_file_id(raw: Any) -> Optional[str]:
    if raw in (None, ""):
        return None
    text = str(raw).strip()
    if not text:
        return None
    if "drive.google." in text:
        match = _DRIVE_URL_RE.search(text)
        if match:
            return match.group(1)
        if "id=" in text:
            try:
                from urllib.parse import parse_qs, urlparse

                query = urlparse(text).query
                params = parse_qs(query)
                candidates = params.get("id") or params.get("file_id")
                if candidates:
                    return candidates[0]
            except Exception:
                pass
    return text


def _first_nonempty(mapping: Dict[str, Any], keys: List[str]) -> Any:
    for key in keys:
        if key in mapping:
            value = mapping[key]
            if value not in (None, ""):
                return value
    return None


def _normalise_site_token(value: Any) -> str:
    if value in (None, ""):
        return ""
    return str(value).strip().lower()


def _normalise_plan_row(row: Dict[str, Any]) -> Dict[str, Any]:
    normalised: Dict[str, Any] = {}
    for key, value in row.items():
        if key in (None, ""):
            continue
        try:
            label = str(key).strip().lower()
        except Exception:
            continue
        if not label:
            continue
        normalised[label] = value
    return normalised


def _corner_from_row(row: Dict[str, Any], prefix: str) -> Optional[LatLon]:
    lat_value = _first_nonempty(
        row,
        [
            f"corner_{prefix}_lat",
            f"{prefix}_lat",
            f"{prefix}lat",
            f"{prefix}_latitude",
            f"{prefix}latitude",
        ],
    )
    lon_value = _first_nonempty(
        row,
        [
            f"corner_{prefix}_lon",
            f"{prefix}_lon",
            f"{prefix}lon",
            f"{prefix}_longitude",
            f"{prefix}longitude",
        ],
    )
    lat = _num(lat_value)
    lon = _num(lon_value)
    if lat is None or lon is None:
        return None
    try:
        return LatLon(lat=lat, lon=lon)
    except ValueError:
        return None


def _normalise_header_value(value: Any) -> str:
    if value in (None, ""):
        return ""
    try:
        return str(value).strip().lower()
    except Exception:
        return ""


def _find_column_index(header: List[Any], candidates: List[str]) -> Optional[int]:
    if not header:
        return None
    lookup = { idx: _normalise_header_value(col) for idx, col in enumerate(header) }
    for candidate in candidates:
        key = candidate.strip().lower()
        for idx, label in lookup.items():
            if label == key:
                return idx
    return None


def _format_coord(value: float) -> str:
    return f"{float(value):.8f}"


def _read_plan_overlay_sheet(
    svc,
    sheet_id: str,
    site_id: Optional[str],
) -> Optional[PlanOverlayConfig]:
    try:
        resp = (
            svc.spreadsheets()
            .values()
            .get(spreadsheetId=sheet_id, range=f"{PLAN_OVERLAY_SHEET}!A:ZZZ")
            .execute()
        )
    except HttpError as exc:
        if exc.resp.status == 400 and "Unable to parse range" in str(exc):
            return None
        return None
    except Exception:
        return None

    values = resp.get("values", [])
    if not values:
        return None
    header_raw = values[0]
    if not header_raw:
        return None
    rows_raw = _values_to_dicts(values[1:], header_raw)
    if not rows_raw:
        return None

    target_site = _normalise_site_token(site_id)
    selected_row: Optional[Dict[str, Any]] = None

    for row in rows_raw:
        normalised = _normalise_plan_row(row)
        if not normalised:
            continue
        row_site = _first_nonempty(
            normalised,
            ["site_id", "site", "id_site", "siteid", "idsite1", "site_id1"],
        )
        if target_site:
            if _normalise_site_token(row_site) == target_site:
                selected_row = normalised
                break
            if selected_row is None:
                selected_row = normalised
        else:
            selected_row = normalised
            break

    if not selected_row:
        return None

    sw = _corner_from_row(selected_row, "sw")
    se = _corner_from_row(selected_row, "se")
    nw = _corner_from_row(selected_row, "nw")
    ne = _corner_from_row(selected_row, "ne")
    if not (sw and se and nw and ne):
        return None

    drive_file_id = _extract_drive_file_id(
        _first_nonempty(
            selected_row,
            [
                "drive_file_id",
                "file_id",
                "drive_id",
                "media_id",
                "resource_id",
            ],
        )
    )
    media_url_raw = _first_nonempty(
        selected_row,
        ["url", "media_url", "public_url", "signed_url", "uri", "gcs_uri"],
    )
    media_type_raw = _first_nonempty(
        selected_row,
        ["media_type", "mime_type", "content_type"],
    )
    media_source_raw = _first_nonempty(
        selected_row,
        ["media_source", "source"],
    )

    opacity_raw = _first_nonempty(
        selected_row,
        ["opacity", "default_opacity", "opacity_default"],
    )
    bearing_raw = _first_nonempty(
        selected_row,
        ["bearing_deg", "rotation_deg", "bearing", "rotation"],
    )
    cache_ttl_raw = _first_nonempty(
        selected_row,
        ["cache_max_age_s", "cache_ttl_s", "cache_ttl"],
    )

    if not drive_file_id and media_url_raw in (None, ""):
        return None

    try:
        opacity_value = _num(opacity_raw)
    except Exception:
        opacity_value = None
    if opacity_value is not None and opacity_value > 1.0:
        opacity_value = opacity_value / 100.0 if opacity_value <= 100.0 else opacity_value

    bearing_value = None
    try:
        bearing_value = _num(bearing_raw)
    except Exception:
        bearing_value = None

    defaults = PlanOverlayDefaults(
        opacity=opacity_value if opacity_value is not None else 0.7,
        bearing_deg=bearing_value if bearing_value is not None else 0.0,
    )

    media = PlanOverlayMedia(
        type=(str(media_type_raw).strip() if media_type_raw not in (None, "") else "image/png"),
        source=(str(media_source_raw).strip() if media_source_raw not in (None, "") else "drive"),
        drive_file_id=drive_file_id,
        url=(str(media_url_raw).strip() if media_url_raw not in (None, "") else None),
        cache_max_age_s=_int(cache_ttl_raw),
    )

    display_name_raw = _first_nonempty(
        selected_row,
        ["display_name", "label", "name", "title"],
    )

    site_value = _first_nonempty(
        selected_row,
        ["site_id", "site", "id_site", "siteid", "idsite1", "site_id1"],
    )

    enabled_value = _first_nonempty(selected_row, ["enabled", "active", "is_enabled"])

    bounds = PlanOverlayBounds(sw=sw, se=se, nw=nw, ne=ne)

    return PlanOverlayConfig(
        enabled=_bool(enabled_value, default=True),
        display_name=display_name_raw,
        media=media,
        bounds=bounds,
        defaults=defaults,
        site_id=str(site_value).strip() if site_value not in (None, "") else site_id,
    )


def _detect_header(header: List[str], candidates: List[List[str]]) -> List[str]:
    # Exact prefix match on length of candidate
    for cand in candidates:
        if len(header) >= len(cand) and all((header[i] == cand[i] for i in range(len(cand)))):
            return cand
    # Fallback: exact equality on same length
    for cand in candidates:
        if header[: len(cand)] == cand:
            return cand
    return candidates[0]


def _num(v):
    try:
        if v is None or v == "":
            return None
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            s = v.strip()
            if not s:
                return None
            # Keep digits, sign and decimal separators; normalize comma to dot
            s2 = re.sub(r"[^0-9,\.\-]", "", s)
            s2 = s2.replace(",", ".")
            # Guard against strings like '-' or '.'
            if s2 in {"-", ".", "-.", ".-"}:
                return None
            return float(s2)
        return None
    except Exception:
        return None


def _int(v):
    try:
        if v is None or v == "":
            return None
        return int(v)
    except Exception:
        return None


def _bool(v, default=True):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    if isinstance(v, str):
        s = v.strip().lower()
        if s in {"true", "vrai", "1", "yes"}:
            return True
        if s in {"false", "faux", "0", "no"}:
            return False
    return default


def _split_ids(v) -> List[str]:
    if not v or not isinstance(v, str):
        return []
    parts = [p.strip() for p in v.replace(",", ";").split(";")]
    return [p for p in parts if p]


def _map_type(t: Any) -> str:
    if not isinstance(t, str):
        return 'OUVRAGE'
    s = t.strip().upper()
    s_noacc = unicodedata.normalize('NFKD', s)
    s_noacc = ''.join(ch for ch in s_noacc if not unicodedata.combining(ch))
    if s == 'COLLECTEUR':
        return 'CANALISATION'
    if s == 'PLATEFORME' or s_noacc == 'GENERAL':
        return 'GENERAL'
    if s == 'PUITS':
        return 'OUVRAGE'
    if s in {'GENERAL','CANALISATION','OUVRAGE','POINT_MESURE','VANNE'} or s_noacc in {'GENERAL','CANALISATION','OUVRAGE'}:
        return s
    return s or 'OUVRAGE'


def _row_to_node(row: Dict[str, Any], header_set: List[str], full_row: Dict[str, Any] | None = None) -> Node:
    extras: Dict[str, Any] | None = None
    if isinstance(full_row, dict):
        extras = { k: full_row.get(k) for k in EXTRA_SHEET_HEADERS }

    raw_t = row.get("type")
    node_type = _map_type(raw_t or 'OUVRAGE')

    diameter_mm = _num(
        row.get("diametre_exterieur_mm")
        or row.get("diametre_mm")
        or row.get("diameter_mm")
        or row.get("diametre_exterieur")
        or row.get("diametreExterieur")
    )
    material = row.get("materiau") or row.get("material") or row.get("matériau") or ""

    gps_locked = _bool(row.get("gps_locked"), True)
    pm_offset_m = _num(row.get("pm_offset_m") or row.get("pm_offset"))

    if node_type != 'CANALISATION':
        diameter_mm = None
        material = ""

    site_id = None
    try:
        if extras and extras.get("idSite1"):
            site_id = str(extras.get("idSite1"))
    except Exception:
        pass

    return Node(
        id=str(row.get("id", "")).strip(),
        name=(row.get("nom") or row.get("name") or ""),
        type=node_type,
        branch_id=(row.get("id_branche") or row.get("branch_id") or ""),
        site_id=site_id,
        diameter_mm=diameter_mm,
        material=material,
        gps_locked=gps_locked,
        pm_offset_m=pm_offset_m,
        commentaire=(row.get("commentaire") or ""),
        well_pos_index=_int(row.get("well_pos_index")),
        # attach canonical + legacy kept in sync by model validator
        attach_edge_id=(row.get("pm_collector_edge_id") or row.get("pm_edge_id") or ""),
        pm_collector_edge_id=(row.get("pm_collector_edge_id") or row.get("pm_edge_id") or ""),
        gps_lat=_num(row.get("gps_lat")),
        gps_lon=_num(row.get("gps_lon")),
        x=_num(row.get("x")),
        y=_num(row.get("y")),
        x_ui=_num(row.get("x_UI")),
        y_ui=_num(row.get("y_UI")),
        extras=extras or {},
    )

_EDGE_CREATED_AT_KEYS = {
    "created_at",
    "createdat",
    "date_creation",
    "datecreation",
    "date_created",
    "datecreated",
    "created",
    "creation_date",
    "creationdate",
}


def _row_to_edge(row: Dict[str, Any], header_set: List[str]) -> Edge:
    from_id = row.get("source_id") or row.get("from_id")
    to_id = row.get("cible_id") or row.get("to_id")
    geometry_coords = None
    if row.get('geometry_json') not in (None, ''):
        geometry_coords = _parse_geometry_field(row.get('geometry_json'))
    if geometry_coords is None:
        geometry_coords = _parse_geometry_field(row.get('Geometry') or row.get('geometry'))
    branch_raw = row.get("BranchId") or row.get("branch_id")
    branch_id = str(branch_raw).strip() if branch_raw is not None else ""
    if not branch_id:
        raise ValueError("branch_id required for edge")
    diameter_mm = _num(row.get("diametre_mm") or row.get("diameter_mm"))
    sdr = row.get("sdr")
    material = row.get("materiau") or row.get("matériau") or row.get("material")
    length_m = _num(row.get("longueur_m") or row.get("length_m"))

    edge_id_raw = row.get("id")
    edge_id = str(edge_id_raw).strip() if edge_id_raw not in (None, "") else ""
    created_source = None
    for key, value in row.items():
        if value in (None, ""):
            continue
        key_norm = str(key or "").strip().lower()
        if key_norm in _EDGE_CREATED_AT_KEYS:
            created_source = value
            break
    if created_source in (None, ""):
        created_source = row.get("created_at") or row.get("createdAt")
    from_id_str = str(from_id) if from_id is not None else ""
    to_id_str = str(to_id) if to_id is not None else ""
    created_at = None
    if created_source not in (None, ""):
        created_at = ensure_created_at_string(edge_id or f"{from_id_str}->{to_id_str}", created_source)

    if length_m in (None, "") and geometry_coords:
        computed_length = _compute_length_from_geometry(geometry_coords)
        if computed_length is not None:
            length_m = computed_length

    return Edge(
        id=edge_id or None,
        from_id=from_id_str,
        to_id=to_id_str,
        active=_bool(row.get("actif") if "actif" in header_set else row.get("active"), True),
        commentaire=(row.get("commentaire") or row.get("comment") or ""),
        geometry=(geometry_coords if geometry_coords else None),
        branch_id=branch_id,
        diameter_mm=diameter_mm,
        sdr=(sdr or None),
        material=(material or None),
        length_m=length_m,
        created_at=created_at,
    )

def _values_to_dicts(values: List[List[Any]], header: List[str]) -> List[Dict[str, Any]]:
    rows = []
    for r in values:
        d: Dict[str, Any] = {}
        for i, key in enumerate(header):
            if i < len(r):
                d[key] = r[i]
        rows.append(d)
    return rows


def _parse_geometry_lonlat_semicolon(s: str) -> List[List[float]]:
    coords: List[List[float]] = []
    parts = [p for p in s.split(";") if p is not None]
    for p in parts:
        t = str(p).strip()
        if not t:
            continue
        seg = [x for x in re.split(r"[\s,]+", t) if x]
        if len(seg) >= 2:
            try:
                lon = float(seg[0].replace(',', '.'))
                lat = float(seg[1].replace(',', '.'))
                coords.append([lon, lat])
            except Exception:
                continue
    return coords


def _parse_geometry_wkt(s: str) -> List[List[float]]:
    m = re.search(r"LINESTRING\s*\(([^)]*)\)", s, flags=re.IGNORECASE)
    coords: List[List[float]] = []
    if not m:
        return coords
    body = m.group(1)
    pairs = [p.strip() for p in body.split(',') if p.strip()]
    for p in pairs:
        seg = [x for x in re.split(r"[\s]+", p) if x]
        if len(seg) >= 2:
            try:
                lon = float(seg[0].replace(',', '.'))
                lat = float(seg[1].replace(',', '.'))
                coords.append([lon, lat])
            except Exception:
                continue
    return coords


def _parse_geometry_field(v: Any) -> List[List[float]]:
    # Accept: "lon lat; lon lat; ..." > GeoJSON stringified > WKT LINESTRING
    if v is None:
        return []
    if isinstance(v, list):
        try:
            coords: List[List[float]] = []
            for item in v:
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    lon = float(item[0])
                    lat = float(item[1])
                    coords.append([lon, lat])
            return coords
        except Exception:
            return []
    if not isinstance(v, str):
        return []
    s = v.strip()
    if not s:
        return []
    coords = _parse_geometry_lonlat_semicolon(s)
    if coords:
        return coords
    if s.startswith('{') or s.startswith('['):
        try:
            import json as _json
            data = _json.loads(s)
            if isinstance(data, dict) and 'coordinates' in data:
                return _parse_geometry_field(data.get('coordinates'))
            if isinstance(data, list):
                return _parse_geometry_field(data)
        except Exception:
            pass
    coords = _parse_geometry_wkt(s)
    return coords


def read_nodes_edges(sheet_id: str, nodes_tab: str, edges_tab: str, *, site_id: str | None = None) -> Graph:
    svc = _client()
    # Read nodes independently from edges (Edges may be absent)
    try:
        resp_nodes = (
            svc.spreadsheets().values().get(
                spreadsheetId=sheet_id, range=f"{nodes_tab}!A:ZZZ"
            ).execute()
        )
        nodes_values = resp_nodes.get("values", [])
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"read_nodes_failed: {exc}")

    try:
        resp_edges = (
            svc.spreadsheets().values().get(
                spreadsheetId=sheet_id, range=f"{edges_tab}!A:ZZZ"
            ).execute()
        )
        edges_values = resp_edges.get("values", [])
    except Exception:
        edges_values = []

    nodes: List[Node] = []
    edges: List[Edge] = []

    if nodes_values:
        node_header_raw = nodes_values[0]
        node_header = _detect_header(
            node_header_raw,
            [
                NODE_HEADERS_FR_V11,
            ],
        )
        # Build rows using the full header actually present
        node_rows_full = _values_to_dicts(nodes_values[1:], node_header_raw)

        # Optional filter by site_id when an extra column like 'idSite1' exists
        site_col_keys = ["idSite1", "idSite"]

        def row_matches_site(full_row: Dict[str, Any]) -> bool:
            if not site_id:
                return True
            target = str(site_id).strip().lower()
            for k in site_col_keys:
                v = full_row.get(k)
                if v is None:
                    continue
                txt = str(v).strip().lower()
                if txt == target:
                    return True
            return False

        matched_any = False
        buffered: List[Node] = []
        for row_full in node_rows_full:
            if not row_full.get("id"):
                continue
            try:
                if row_matches_site(row_full):
                    nodes.append(_row_to_node(row_full, node_header, row_full))
                    matched_any = True
                else:
                    buffered.append(_row_to_node(row_full, node_header, row_full))
            except Exception:
                continue

        # Dev fallback: if a site filter is provided but nothing matched, return all nodes
        if site_id and not matched_any and buffered:
            nodes = buffered

    if edges_values:
        edge_header_raw = edges_values[0]
        edge_header = _detect_header(
            edge_header_raw,
            [
                EDGE_HEADERS_FR_V6,
            ],
        )
        # Use the full raw header to capture extra columns like Geometry/PipeGroupId
        edge_rows = _values_to_dicts(edges_values[1:], edge_header_raw)
        allowed_ids = {n.id for n in nodes}
        for row in edge_rows:
            if not row:
                continue
            try:
                e = _row_to_edge(row, edge_header)
            except ValidationError as exc:
                raise HTTPException(status_code=422, detail=f"edge validation failed: {exc}") from exc
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            except Exception as exc:
                raise HTTPException(status_code=422, detail=f"edge parse failed: {exc}") from exc
            if e.from_id and e.to_id:
                if site_id and (e.from_id not in allowed_ids or e.to_id not in allowed_ids):
                    continue
                edges.append(e)

    style_meta = _read_style_meta_sheet(svc, sheet_id)
    branches = _read_branches_sheet(svc, sheet_id)
    config_map = _read_config_sheet(svc, sheet_id)
    plan_overlay = _read_plan_overlay_sheet(svc, sheet_id, site_id)
    crs = _normalise_crs_from_config(config_map)
    if not branches:
        fallback: Dict[str, BranchInfo] = {}
        for edge in edges:
            branch_id = (edge.branch_id or '').strip()
            if not branch_id or branch_id in fallback:
                continue
            fallback[branch_id] = BranchInfo(
                id=branch_id,
                name=branch_id,
                parent_id=None,
                is_trunk=branch_id.startswith('GENERAL-'),
            )
        branches = list(fallback.values())

    return Graph(
        site_id=site_id,
        nodes=nodes,
        edges=edges,
        style_meta=style_meta,
        crs=crs,
        branches=branches,
        plan_overlay=plan_overlay,
    )


def write_nodes_edges(sheet_id: str, nodes_tab: str, edges_tab: str, graph: Graph, *, site_id: str | None = None) -> None:
    svc = _client()

    node_headers = NODE_HEADERS_FR_V11 + EXTRA_SHEET_HEADERS
    edge_headers = EDGE_HEADERS_FR_V6

    # Preserve existing canonical positions (x, y) when saving from UI.
    try:
        resp_nodes = (
            svc.spreadsheets().values().get(
                spreadsheetId=sheet_id, range=f"{nodes_tab}!A:ZZZ"
            ).execute()
        )
        cur_values = resp_nodes.get("values", [])
    except Exception:
        cur_values = []

    existing_xy_by_id: Dict[str, Dict[str, Any]] = {}
    if cur_values:
        cur_header = cur_values[0]
        cur_rows = _values_to_dicts(cur_values[1:], cur_header)
        for r in cur_rows:
            rid = r.get("id")
            if not rid:
                continue
            key = str(rid).strip()
            existing_x = _num(r.get("x"))
            existing_y = _num(r.get("y"))
            if existing_x is None:
                existing_x = _num(r.get("x_UI"))
            if existing_y is None:
                existing_y = _num(r.get("y_UI"))
            existing_xy_by_id[key] = {"x": existing_x, "y": existing_y}

    node_values = [node_headers]
    for n in graph.nodes or []:
        key = str(n.id).strip() if getattr(n, 'id', None) is not None else ''
        ex = existing_xy_by_id.get(key, {})
        x_preserved = ex.get("x")
        y_preserved = ex.get("y")
        extras_map = dict(n.extras or {}) if isinstance(n.extras, dict) else {}
        if site_id and not extras_map.get('idSite1'):
            extras_map['idSite1'] = site_id
        is_canal = str(n.type or "").upper() == 'CANALISATION'
        row_core = [
            n.id,
            n.name or "",
            (n.type or "OUVRAGE"),
            n.branch_id or "",
            True if getattr(n, 'gps_locked', None) is not False else False,
            ("" if getattr(n, 'pm_offset_m', None) is None else n.pm_offset_m),
            ("" if not is_canal else ("" if n.diameter_mm is None else n.diameter_mm)),
            ("" if not is_canal else (n.material or "")),
            n.commentaire or "",
            n.pm_collector_edge_id or n.attach_edge_id or "",
            ("" if n.pm_pos_index is None else n.pm_pos_index),
            ("" if n.gps_lat is None else n.gps_lat),
            ("" if n.gps_lon is None else n.gps_lon),
            ("" if x_preserved is None else x_preserved),
            ("" if y_preserved is None else y_preserved),
            ("" if getattr(n, 'x_ui', None) is None else n.x_ui),
            ("" if getattr(n, 'y_ui', None) is None else n.y_ui),
        ]
        extras = []
        for key in EXTRA_SHEET_HEADERS:
            val = extras_map.get(key)
            extras.append(val if val is not None else "")
        node_values.append(row_core + extras)

    def _format_geometry_json(geom) -> str:
        try:
            if not isinstance(geom, list):
                return ""
            return json.dumps(geom, ensure_ascii=False, separators=(",", ":"))
        except Exception:
            return ""

    def _format_geometry_lonlat_semicolon(geom) -> str:
        try:
            if not isinstance(geom, list):
                return ""
            parts = []
            for pt in geom:
                if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                    parts.append(f"{float(pt[0])} {float(pt[1])}")
            return "; ".join(parts)
        except Exception:
            return ""

    edge_values = [edge_headers]
    for e in graph.edges or []:
        geometry = getattr(e, 'geometry', None)
        geom_json = _format_geometry_json(geometry)
        geom_txt = _format_geometry_lonlat_semicolon(geometry)
        diameter = None if getattr(e, 'diameter_mm', None) in (None, "") else float(e.diameter_mm)
        length = None if getattr(e, 'length_m', None) in (None, "") else float(e.length_m)
        edge_values.append([
            e.id or "",
            e.from_id,
            e.to_id,
            getattr(e, 'branch_id', "") or "",
            geom_json,
            "" if diameter is None else diameter,
            getattr(e, 'material', None) or "",
            getattr(e, 'sdr', None) or "",
            "" if length is None else round(length, 2),
            True if e.active is None else bool(e.active),
            getattr(e, 'commentaire', "") or "",
            geom_txt,
        ])

    branches_rows = [BRANCH_HEADERS]
    seen_branch_ids: set[str] = set()
    for entry in (graph.branches or []):
        branch_obj = None
        if isinstance(entry, BranchInfo):
            branch_obj = entry
        else:
            try:
                branch_obj = BranchInfo.model_validate(entry)
            except Exception:
                branch_obj = None
        if branch_obj is None:
            continue
        branch_id = (branch_obj.id or "").strip()
        if not branch_id or branch_id in seen_branch_ids:
            continue
        seen_branch_ids.add(branch_id)
        name = (branch_obj.name or "").strip() or branch_id
        parent = branch_obj.parent_id
        if parent not in (None, ""):
            parent = str(parent).strip() or None
        else:
            parent = None
        branches_rows.append([
            branch_id,
            name,
            parent or "",
            "TRUE" if branch_obj.is_trunk else "FALSE",
        ])

    if len(branches_rows) == 1:
        for edge in graph.edges or []:
            branch_id = getattr(edge, 'branch_id', '') or ''
            bid = str(branch_id).strip()
            if not bid or bid in seen_branch_ids:
                continue
            seen_branch_ids.add(bid)
            branches_rows.append([
                bid,
                bid,
                "",
                "TRUE" if bid.startswith('GENERAL-') else "FALSE",
            ])

    crs_obj = getattr(graph, 'crs', None)
    if not isinstance(crs_obj, CRSInfo):
        try:
            crs_obj = CRSInfo.model_validate(crs_obj)
        except Exception:
            crs_obj = CRSInfo()
    config_values = [
        ["crs_code", crs_obj.code or "EPSG:4326"],
        ["projected_for_lengths", crs_obj.projected_for_lengths or ""],
    ]

    data = [
        {"range": f"{nodes_tab}!A1", "values": node_values},
        {"range": f"{edges_tab}!A1", "values": edge_values},
        {"range": f"{BRANCHES_SHEET}!A1", "values": branches_rows},
        {"range": f"{CONFIG_SHEET}!A1", "values": config_values},
    ]

    for title in (nodes_tab, edges_tab, BRANCHES_SHEET, CONFIG_SHEET):
        _clear_sheet(svc, sheet_id, title)

    svc.spreadsheets().values().batchUpdate(
        spreadsheetId=sheet_id,
        body={"valueInputOption": "RAW", "data": data},
    ).execute()

    _write_style_meta_sheet(svc, sheet_id, graph.style_meta or {})


def read_plan_overlay_config(sheet_id: str, *, site_id: str | None = None) -> Optional[PlanOverlayConfig]:
    svc = _client()
    return _read_plan_overlay_sheet(svc, sheet_id, site_id)


def write_plan_overlay_bounds(
    sheet_id: str,
    *,
    bounds: PlanOverlayBounds,
    rotation_deg: float | None = None,
    opacity: float | None = None,
    site_id: str | None = None,
) -> PlanOverlayConfig:
    svc = _client()
    try:
        resp = (
            svc.spreadsheets()
            .values()
            .get(spreadsheetId=sheet_id, range=f"{PLAN_OVERLAY_SHEET}!A:ZZZ")
            .execute()
        )
    except HttpError as exc:
        if exc.resp.status == 400 and "Unable to parse range" in str(exc):
            raise HTTPException(status_code=404, detail="plan_overlay_not_found") from exc
        raise HTTPException(status_code=502, detail=f"plan_overlay_sheet_error: {exc}") from exc
    except Exception as exc:  # pragma: no cover - network/auth errors
        raise HTTPException(status_code=502, detail=f"plan_overlay_sheet_error: {exc}") from exc

    values = resp.get("values", [])
    if not values:
        raise HTTPException(status_code=404, detail="plan_overlay_not_found")
    header_row = values[0]
    data_rows = values[1:]
    if not header_row or not data_rows:
        raise HTTPException(status_code=404, detail="plan_overlay_not_found")

    rows_dicts = _values_to_dicts(data_rows, header_row)
    target_site = _normalise_site_token(site_id)
    target_index: Optional[int] = None
    fallback_index: Optional[int] = None

    for idx, row_dict in enumerate(rows_dicts):
        normalised = _normalise_plan_row(row_dict)
        if not normalised:
            continue
        row_site = _first_nonempty(
            normalised,
            ["site_id", "site", "id_site", "siteid", "idsite1", "site_id1"],
        )
        if target_site:
            if _normalise_site_token(row_site) == target_site:
                target_index = idx
                break
            if fallback_index is None:
                fallback_index = idx
        else:
            target_index = idx
            break

    if target_index is None:
        target_index = fallback_index
    if target_index is None or target_index >= len(data_rows):
        raise HTTPException(status_code=404, detail="plan_overlay_not_found")

    row_values = data_rows[target_index]
    while len(row_values) < len(header_row):
        row_values.append("")

    corner_candidates = {
        "sw": {
            "lat": ["corner_sw_lat", "sw_lat", "swlat", "sw_latitude", "swlatitude"],
            "lon": ["corner_sw_lon", "sw_lon", "swlon", "sw_longitude", "swlongitude"],
        },
        "se": {
            "lat": ["corner_se_lat", "se_lat", "selat", "se_latitude", "selatitude"],
            "lon": ["corner_se_lon", "se_lon", "selon", "se_longitude", "selongitude"],
        },
        "nw": {
            "lat": ["corner_nw_lat", "nw_lat", "nwlat", "nw_latitude", "nwlatitude"],
            "lon": ["corner_nw_lon", "nw_lon", "nwlon", "nw_longitude", "nwlongitude"],
        },
        "ne": {
            "lat": ["corner_ne_lat", "ne_lat", "nelat", "ne_latitude", "nelatitude"],
            "lon": ["corner_ne_lon", "ne_lon", "nelon", "ne_longitude", "nelongitude"],
        },
    }

    corner_values = {
        "sw": bounds.sw,
        "se": bounds.se,
        "nw": bounds.nw,
        "ne": bounds.ne,
    }

    for key, coord in corner_values.items():
        lat_idx = _find_column_index(header_row, corner_candidates[key]["lat"])
        lon_idx = _find_column_index(header_row, corner_candidates[key]["lon"])
        if lat_idx is None or lon_idx is None:
            raise HTTPException(status_code=400, detail="plan_overlay_sheet_missing_corner_columns")
        row_values[lat_idx] = _format_coord(coord.lat)
        row_values[lon_idx] = _format_coord(coord.lon)

    if rotation_deg is not None:
        rot_idx = _find_column_index(header_row, ["bearing_deg", "rotation_deg", "bearing", "rotation"])
        if rot_idx is not None:
            row_values[rot_idx] = f"{float(rotation_deg):.6f}"

    if opacity is not None:
        op_idx = _find_column_index(header_row, ["opacity", "default_opacity", "opacity_default"])
        if op_idx is not None:
            row_values[op_idx] = f"{float(opacity):.4f}"

    row_number = target_index + 2  # header is row 1
    update_range = f"{PLAN_OVERLAY_SHEET}!A{row_number}"
    svc.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range=update_range,
        valueInputOption="RAW",
        body={"values": [row_values]},
    ).execute()

    updated = _read_plan_overlay_sheet(svc, sheet_id, site_id)
    if updated is None:
        raise HTTPException(status_code=500, detail="plan_overlay_refresh_failed")
    return updated
