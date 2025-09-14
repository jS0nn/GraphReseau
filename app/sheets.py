from __future__ import annotations

from typing import Any, Dict, List, Tuple
import re
import unicodedata

from fastapi import HTTPException

from .models import Edge, Graph, Node
from .gcp_auth import get_credentials


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


# Header sets identical to Apps Script
# V8 adds pm_collector_edge_id after pm_pos_index
NODE_HEADERS_FR_V8 = [
    'id','nom','type','id_branche','diametre_exterieur_mm','sdr_ouvrage','commentaire',
    'puits_amont','well_collector_id','well_pos_index','pm_collecteur_id','pm_pos_index','pm_collector_edge_id','gps_lat','gps_lon','x','y','x_UI','y_UI'
]
NODE_HEADERS_FR_V7 = [
    'id','nom','type','id_branche','diametre_exterieur_mm','sdr_ouvrage','commentaire',
    'puits_amont','well_collector_id','well_pos_index','pm_collecteur_id','pm_pos_index','gps_lat','gps_lon','x','y','x_UI','y_UI'
]
NODE_HEADERS_FR_V6 = [
    'id','nom','type','id_branche','diametre_exterieur_mm','sdr_ouvrage','commentaire',
    'puits_amont','well_collector_id','well_pos_index','pm_collecteur_id','pm_pos_index','gps_lat','gps_lon','x','y'
]
NODE_HEADERS_FR_V5 = [
    'id','nom','type','id_branche','diametre_mm',
    'puits_amont','well_collector_id','well_pos_index','pm_collecteur_id','pm_pos_index','gps_lat','gps_lon','x','y'
]
NODE_HEADERS_FR_V4 = [
    'id','nom','type','id_branche','diametre_mm',
    'puits_amont','pm_collecteur_id','pm_pos_index','gps_lat','gps_lon','x','y'
]
NODE_HEADERS_FR_V3 = [
    'id','nom','type','id_branche','diametre_mm',
    'puits_amont','vanne_ouverture_pct','gps_lat','gps_lon','x','y'
]
NODE_HEADERS_FR_V2 = [
    'id','nom','type','id_branche','diametre_mm',
    'vanne_ouverture_pct','gps_lat','gps_lon','x','y'
]
NODE_HEADERS_FR_V1 = [
    'id','nom','type','id_branche','ordre_branche','diametre_mm',
    'vanne_ouverture_pct','gps_lat','gps_lon','x','y'
]
NODE_HEADERS_EN_V1 = [
    'id','name','type','branch_id','order_index','diameter_mm',
    'valve_status','gps_lat','gps_lon','x','y'
]

EDGE_HEADERS_FR_V2 = ['id','source_id','cible_id','actif']
EDGE_HEADERS_FR_V1 = ['id','source_id','cible_id','diametre_mm','longueur_m','actif']
EDGE_HEADERS_EN_V1 = ['id','from_id','to_id','diameter_mm','length_m','active']

EXTRA_SHEET_HEADERS = [
    'idSite1','site','Regroupement','Canalisation','Casier','emplacement',
    'typeDePointDeMesure','diametreInterieur','sdrOuvrage','actif','dateAjoutligne'
]


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
    # Also build an accent-less uppercase form for robust matching
    s_noacc = unicodedata.normalize('NFKD', s)
    s_noacc = ''.join(ch for ch in s_noacc if not unicodedata.combining(ch))
    # Normalize legacy/aliases to new canonical types
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
    # Unified UI model
    extras: Dict[str, Any] | None = None
    if isinstance(full_row, dict):
        extras = { k: full_row.get(k) for k in EXTRA_SHEET_HEADERS }

    # Keep GENERAL as GENERAL in UI; do not coerce to POINT_MESURE here.
    raw_t = row.get("type")
    node_type = _map_type(raw_t or 'OUVRAGE')

    return Node(
        id=str(row.get("id", "")).strip(),
        name=(row.get("nom") or row.get("name") or ""),
        type=node_type,
        branch_id=(row.get("id_branche") or row.get("branch_id") or ""),
        diameter_mm=_num(row.get("diametre_exterieur_mm") or row.get("diametre_mm") or row.get("diameter_mm") or row.get("diametre_exterieur") or row.get("diametreExterieur")),
        sdr_ouvrage=(row.get("sdr_ouvrage") or row.get("sdrOuvrage") or ""),
        commentaire=(row.get("commentaire") or ""),
        collector_well_ids=_split_ids(row.get("puits_amont") or ""),
        well_collector_id=(row.get("well_collector_id") or ""),
        well_pos_index=_int(row.get("well_pos_index")),
        pm_collector_id=(row.get("pm_collecteur_id") or row.get("pm_collector_id") or ""),
        pm_collector_edge_id=(row.get("pm_collector_edge_id") or row.get("pm_edge_id") or ""),
        pm_pos_index=_int(row.get("pm_pos_index")),
        gps_lat=_num(row.get("gps_lat")),
        gps_lon=_num(row.get("gps_lon")),
        x=_num(row.get("x")),
        y=_num(row.get("y")),
        x_ui=_num(row.get("x_UI")),
        y_ui=_num(row.get("y_UI")),
        extras=extras,
    )


def _row_to_edge(row: Dict[str, Any], header_set: List[str]) -> Edge:
    from_id = row.get("source_id") or row.get("from_id")
    to_id = row.get("cible_id") or row.get("to_id")
    geometry_coords = _parse_geometry_field(row.get("Geometry") or row.get("geometry"))
    pipe_group_id = row.get("PipeGroupId") or row.get("pipe_group_id") or None
    return Edge(
        id=(row.get("id") or None),
        from_id=str(from_id) if from_id is not None else "",
        to_id=str(to_id) if to_id is not None else "",
        active=_bool(row.get("actif") if "actif" in header_set else row.get("active"), True),
        commentaire=(row.get("commentaire") or ""),
        geometry=(geometry_coords if geometry_coords else None),
        pipe_group_id=(pipe_group_id or None),
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
                NODE_HEADERS_FR_V8,
                NODE_HEADERS_FR_V7,
                NODE_HEADERS_FR_V6,
                NODE_HEADERS_FR_V5,
                NODE_HEADERS_FR_V4,
                NODE_HEADERS_FR_V3,
                NODE_HEADERS_FR_V2,
                NODE_HEADERS_FR_V1,
                NODE_HEADERS_EN_V1,
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
            edge_header_raw, [EDGE_HEADERS_FR_V2, EDGE_HEADERS_FR_V1, EDGE_HEADERS_EN_V1]
        )
        # Use the full raw header to capture extra columns like Geometry/PipeGroupId
        edge_rows = _values_to_dicts(edges_values[1:], edge_header_raw)
        allowed_ids = {n.id for n in nodes}
        for row in edge_rows:
            try:
                e = _row_to_edge(row, edge_header)
                if e.from_id and e.to_id:
                    if site_id and (e.from_id not in allowed_ids or e.to_id not in allowed_ids):
                        continue
                    edges.append(e)
            except Exception:
                continue

    return Graph(nodes=nodes, edges=edges)


def write_nodes_edges(sheet_id: str, nodes_tab: str, edges_tab: str, graph: Graph, *, site_id: str | None = None) -> None:
    svc = _client()

    # Always write FR V8 headers + extra business headers on output
    node_headers = NODE_HEADERS_FR_V8 + EXTRA_SHEET_HEADERS
    # Extend edge headers with optional 'commentaire' + geometry + pipe group
    edge_headers = EDGE_HEADERS_FR_V2 + ['commentaire','Geometry','PipeGroupId']

    # Preserve existing canonical positions (x, y) when saving from UI.
    # We fetch the current sheet to map node id -> (x, y) and re-inject
    # those values in the write payload, so only x_UI/y_UI are updated.
    try:
        resp_nodes = (
            svc.spreadsheets().values().get(
                spreadsheetId=sheet_id, range=f"{nodes_tab}!A:ZZZ"
            ).execute()
        )
        cur_values = resp_nodes.get("values", [])
    except Exception:
        cur_values = []

    existing_xy_by_id = {}
    if cur_values:
        cur_header = cur_values[0]
        # Build dict rows using whatever header is present in the sheet
        cur_rows = _values_to_dicts(cur_values[1:], cur_header)
        for r in cur_rows:
            rid = r.get("id")
            if not rid:
                continue
            # Keep raw values as-is to avoid unwanted coercion
            existing_xy_by_id[str(rid)] = (r.get("x"), r.get("y"))

    node_values = [node_headers]
    for n in graph.nodes:
        # Reuse existing x/y if present in the sheet; leave blank for new ids
        ex = existing_xy_by_id.get(n.id, (None, None))
        x_preserved, y_preserved = ex[0], ex[1]
        # Prepare extras with optional site tagging for new/blank values
        extras_map = dict(n.extras or {}) if isinstance(n.extras, dict) else {}
        if site_id:
            try:
                if not extras_map.get('idSite1'):
                    extras_map['idSite1'] = site_id
            except Exception:
                pass
        row_core = [
            n.id,
            n.name or "",
            (n.type or "OUVRAGE"),
            n.branch_id or "",
            ("" if n.diameter_mm is None else n.diameter_mm),
            n.sdr_ouvrage or "",
            n.commentaire or "",
            ";".join((n.collector_well_ids or [])) if isinstance(n.collector_well_ids, list) else "",
            n.well_collector_id or "",
            ("" if n.well_pos_index is None else n.well_pos_index),
            n.pm_collector_id or "",
            ("" if n.pm_pos_index is None else n.pm_pos_index),
            (getattr(n, 'pm_collector_edge_id', "") or ""),
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
    for e in graph.edges:
        geom_txt = _format_geometry_lonlat_semicolon(getattr(e, 'geometry', None))
        pgid = getattr(e, 'pipe_group_id', None) or ''
        edge_values.append([
            e.id or "",
            e.from_id,
            e.to_id,
            True if e.active is None else bool(e.active),
            getattr(e, 'commentaire', "") or "",
            geom_txt,
            pgid,
        ])

    data = [
        {"range": f"{nodes_tab}!A1", "values": node_values},
        {"range": f"{edges_tab}!A1", "values": edge_values},
    ]

    # Clear previous content to avoid leftover rows when shrinking data.
    try:
        svc.spreadsheets().values().clear(
            spreadsheetId=sheet_id, range=f"{nodes_tab}!A:ZZZ"
        ).execute()
    except Exception:
        # Non-fatal: proceed with overwrite even if clear fails
        pass
    try:
        svc.spreadsheets().values().clear(
            spreadsheetId=sheet_id, range=f"{edges_tab}!A:ZZZ"
        ).execute()
    except Exception:
        pass

    svc.spreadsheets().values().batchUpdate(
        spreadsheetId=sheet_id,
        body={"valueInputOption": "RAW", "data": data},
    ).execute()
