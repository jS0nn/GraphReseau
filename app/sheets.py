from __future__ import annotations

from typing import Any, Dict, List, Tuple

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
        return float(v)
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


def _row_to_node(row: Dict[str, Any], header_set: List[str]) -> Node:
    # Unified UI model
    return Node(
        id=str(row.get("id", "")).strip(),
        name=(row.get("nom") or row.get("name") or ""),
        type=((row.get("type") or "PUITS")).upper() if isinstance(row.get("type"), str) else (row.get("type") or "PUITS"),
        branch_id=(row.get("id_branche") or row.get("branch_id") or ""),
        diameter_mm=_num(row.get("diametre_mm") or row.get("diameter_mm")),
        collector_well_ids=_split_ids(row.get("puits_amont") or ""),
        well_collector_id=(row.get("well_collector_id") or ""),
        well_pos_index=_int(row.get("well_pos_index")),
        pm_collector_id=(row.get("pm_collecteur_id") or row.get("pm_collector_id") or ""),
        pm_pos_index=_int(row.get("pm_pos_index")),
        gps_lat=_num(row.get("gps_lat")),
        gps_lon=_num(row.get("gps_lon")),
        x=_num(row.get("x")),
        y=_num(row.get("y")),
    )


def _row_to_edge(row: Dict[str, Any], header_set: List[str]) -> Edge:
    from_id = row.get("source_id") or row.get("from_id")
    to_id = row.get("cible_id") or row.get("to_id")
    return Edge(
        id=(row.get("id") or None),
        from_id=str(from_id) if from_id is not None else "",
        to_id=str(to_id) if to_id is not None else "",
        active=_bool(row.get("actif") if "actif" in header_set else row.get("active"), True),
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


def read_nodes_edges(sheet_id: str, nodes_tab: str, edges_tab: str) -> Graph:
    svc = _client()
    resp = (
        svc.spreadsheets()
        .values()
        .batchGet(spreadsheetId=sheet_id, ranges=[f"{nodes_tab}!A:Z", f"{edges_tab}!A:Z"])
        .execute()
    )
    nodes_values = resp.get("valueRanges", [])[0].get("values", []) if resp.get("valueRanges") else []
    edges_values = resp.get("valueRanges", [])[1].get("values", []) if resp.get("valueRanges") else []

    nodes: List[Node] = []
    edges: List[Edge] = []

    if nodes_values:
        node_header_raw = nodes_values[0]
        node_header = _detect_header(
            node_header_raw,
            [
                NODE_HEADERS_FR_V5,
                NODE_HEADERS_FR_V4,
                NODE_HEADERS_FR_V3,
                NODE_HEADERS_FR_V2,
                NODE_HEADERS_FR_V1,
                NODE_HEADERS_EN_V1,
            ],
        )
        node_rows = _values_to_dicts(nodes_values[1:], node_header)
        for row in node_rows:
            if not row.get("id"):
                continue
            try:
                nodes.append(_row_to_node(row, node_header))
            except Exception:
                # Be permissive; skip bad row
                continue

    if edges_values:
        edge_header_raw = edges_values[0]
        edge_header = _detect_header(edge_header_raw, [EDGE_HEADERS_FR_V2, EDGE_HEADERS_FR_V1, EDGE_HEADERS_EN_V1])
        edge_rows = _values_to_dicts(edges_values[1:], edge_header)
        for row in edge_rows:
            try:
                e = _row_to_edge(row, edge_header)
                if e.from_id and e.to_id:
                    edges.append(e)
            except Exception:
                continue

    return Graph(nodes=nodes, edges=edges)


def write_nodes_edges(sheet_id: str, nodes_tab: str, edges_tab: str, graph: Graph) -> None:
    svc = _client()

    # Always write FR V5 headers on output
    node_headers = NODE_HEADERS_FR_V5
    edge_headers = EDGE_HEADERS_FR_V2

    node_values = [node_headers]
    for n in graph.nodes:
        node_values.append([
            n.id,
            n.name or "",
            (n.type or "PUITS"),
            n.branch_id or "",
            ("" if n.diameter_mm is None else n.diameter_mm),
            ";".join((n.collector_well_ids or [])) if isinstance(n.collector_well_ids, list) else "",
            n.well_collector_id or "",
            ("" if n.well_pos_index is None else n.well_pos_index),
            n.pm_collector_id or "",
            ("" if n.pm_pos_index is None else n.pm_pos_index),
            ("" if n.gps_lat is None else n.gps_lat),
            ("" if n.gps_lon is None else n.gps_lon),
            ("" if n.x is None else n.x),
            ("" if n.y is None else n.y),
        ])

    edge_values = [edge_headers]
    for e in graph.edges:
        edge_values.append([
            e.id or "",
            e.from_id,
            e.to_id,
            True if e.active is None else bool(e.active),
        ])

    data = [
        {"range": f"{nodes_tab}!A1", "values": node_values},
        {"range": f"{edges_tab}!A1", "values": edge_values},
    ]

    # Clear both tabs before writing to avoid stale trailing rows
    try:
        svc.spreadsheets().values().batchClear(
            spreadsheetId=sheet_id,
            body={"ranges": [f"{nodes_tab}!A:Z", f"{edges_tab}!A:Z"]},
        ).execute()
    except Exception:
        # Be permissive: if clear fails, continue with write (will overwrite header + data)
        pass

    svc.spreadsheets().values().batchUpdate(
        spreadsheetId=sheet_id,
        body={"valueInputOption": "RAW", "data": data},
    ).execute()
