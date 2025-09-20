"""Shared sanitisation helpers used across services and scripts."""
from __future__ import annotations

import os
import re
import time
from math import radians, sin, cos, sqrt, atan2, isfinite
from collections import defaultdict
from typing import Iterable, Dict, List, Tuple, Optional, Any

from fastapi import HTTPException

from ..models import Edge, Graph, Node


INLINE_ANCHORED_TYPES = {"POINT_MESURE", "VANNE"}
UI_PREFIXES = ("ui_",)
EPHEMERAL_KEYS = {"site_effective", "site_effective_is_fallback"}
OFFSET_TOLERANCE_M = 0.5
GRAPH_ALLOWED_TOP_LEVEL = {"version", "site_id", "generated_at", "style_meta", "nodes", "edges"}
EDGE_FORBIDDEN_FIELDS = {"ui_diameter_mm"}


def _is_forbidden_field_name(name: str) -> bool:
    if not name:
        return False
    if name in EPHEMERAL_KEYS:
        return True
    if name in EDGE_FORBIDDEN_FIELDS:
        return True
    return any(name.startswith(prefix) for prefix in UI_PREFIXES)


def _purge_model_extras(obj: Any, *, allow: set[str] | None = None) -> None:
    extra = getattr(obj, "model_extra", None)
    if isinstance(extra, dict):
        keys = list(extra.keys())
        for key in keys:
            if allow and key in allow:
                continue
            if not allow and not _is_forbidden_field_name(key):
                continue
            extra.pop(key, None)
            if hasattr(obj, key):
                try:
                    delattr(obj, key)
                except AttributeError:
                    pass
    extras_map = getattr(obj, "extras", None)
    if isinstance(extras_map, dict):
        for key in list(extras_map.keys()):
            if _is_forbidden_field_name(key):
                extras_map.pop(key, None)


def _collect_forbidden_fields(graph: Graph | None) -> list[str]:
    if graph is None:
        return []
    offenders: list[str] = []
    top_extra = getattr(graph, "model_extra", None)
    if isinstance(top_extra, dict):
        offenders.extend([
            key for key in top_extra.keys() if key not in GRAPH_ALLOWED_TOP_LEVEL
        ])
    try:
        nodes_iter = list(graph.nodes or [])
    except Exception:
        nodes_iter = []
    for idx, node in enumerate(nodes_iter):
        extra = getattr(node, "model_extra", None)
        if not isinstance(extra, dict):
            continue
        for key in extra.keys():
            if _is_forbidden_field_name(key):
                offenders.append(f"nodes[{idx}].{key}")
        extras_map = getattr(node, "extras", None)
        if isinstance(extras_map, dict):
            for key in extras_map.keys():
                if _is_forbidden_field_name(key):
                    offenders.append(f"nodes[{idx}].extras.{key}")
    for idx, edge in enumerate(_iter_edges(graph)):
        extra = getattr(edge, "model_extra", None)
        if not isinstance(extra, dict):
            continue
        for key in extra.keys():
            if _is_forbidden_field_name(key):
                offenders.append(f"edges[{idx}].{key}")
        extras_map = getattr(edge, "extras", None)
        if isinstance(extras_map, dict):
            for key in extras_map.keys():
                if _is_forbidden_field_name(key):
                    offenders.append(f"edges[{idx}].extras.{key}")
    return offenders


def _purge_forbidden_fields(graph: Graph | None) -> None:
    if graph is None:
        return
    top_extra = getattr(graph, "model_extra", None)
    if isinstance(top_extra, dict):
        for key in list(top_extra.keys()):
            if key not in GRAPH_ALLOWED_TOP_LEVEL:
                top_extra.pop(key, None)
    try:
        nodes_iter = list(graph.nodes or [])
    except Exception:
        nodes_iter = []
    for node in nodes_iter:
        _purge_model_extras(node)
    for edge in _iter_edges(graph):
        _purge_model_extras(edge)


def _gen_edge_id() -> str:
    """Generate a short edge identifier suitable for JSON payloads."""
    t = int(time.time() * 1000)
    t36 = format(t, "x").upper()
    r = format(int.from_bytes(os.urandom(3), "big"), "x").upper()
    return f"E-{t36}{r}"


def _iter_edges(graph: Graph | None) -> Iterable[Edge | dict]:
    if graph is None:
        return []
    try:
        return list(graph.edges or [])
    except Exception:
        return []


def _strip_ui_fields(mapping: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(mapping, dict):
        return {}
    cleaned = {}
    for key, value in mapping.items():
        if _is_forbidden_field_name(key):
            continue
        cleaned[key] = value
    return cleaned


def _normalise_material(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text.upper()


def _normalise_sdr(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text.upper()


def _clean_extras(payload: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    return _strip_ui_fields(dict(payload))


def _canonical_type_prefix(node_type: str | None) -> str:
    if not node_type:
        return ""
    txt = str(node_type).strip()
    if not txt:
        return ""
    slug = txt.upper()
    slug = slug.replace(" ", "_").replace("-", "_")
    slug = re.sub(r"[^A-Z0-9_]+", "", slug)
    return slug


def _align_node_ids(nodes: List[Node]) -> Dict[str, str]:
    rename_map: Dict[str, str] = {}
    existing: set[str] = {n.id for n in nodes if getattr(n, "id", None)}
    for node in nodes:
        nid = getattr(node, "id", None)
        if not nid:
            continue
        expected_prefix = _canonical_type_prefix(getattr(node, "type", None))
        if not expected_prefix:
            continue
        current_prefix = str(nid).split("-", 1)[0]
        if current_prefix == expected_prefix:
            continue
        suffix = ""
        if "-" in str(nid):
            suffix = str(nid).split("-", 1)[1]
        else:
            suffix = str(nid)
        base = f"{expected_prefix}-{suffix}" if suffix else expected_prefix
        candidate = base
        guard = 0
        while candidate in existing:
            guard += 1
            candidate = f"{base}_{guard}"
            if guard > 50:
                break
        if candidate == nid:
            continue
        rename_map[nid] = candidate
        existing.discard(nid)
        existing.add(candidate)
        node.id = candidate
    return rename_map


def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    # metres
    R = 6371000.0
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlmb = radians(lon2 - lon1)
    a = sin(dphi / 2.0) ** 2 + cos(phi1) * cos(phi2) * sin(dlmb / 2.0) ** 2
    c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a))
    return R * c


def _edge_length_m(e: Edge, node_by_id: Dict[str, Node]) -> Optional[float]:
    try:
        if e.length_m is not None and e.length_m > 0:
            return e.length_m
        coords = getattr(e, "geometry", None)
        if isinstance(coords, list) and len(coords) >= 2:
            cleaned: list[tuple[float, float]] = []
            for pt in coords:
                if not isinstance(pt, (list, tuple)) or len(pt) < 2:
                    continue
                try:
                    lon = float(pt[0])
                    lat = float(pt[1])
                except (TypeError, ValueError):
                    continue
                if not (isfinite(lon) and isfinite(lat)):
                    continue
                cleaned.append((lon, lat))
            if len(cleaned) >= 2:
                total = 0.0
                for i in range(len(cleaned) - 1):
                    lon1, lat1 = cleaned[i]
                    lon2, lat2 = cleaned[i + 1]
                    total += _haversine_m(lon1, lat1, lon2, lat2)
                return total if total > 0 else None
    except Exception:
        return None
    return None


def _sanitize_geometry(raw: Any) -> Optional[List[List[float]]]:
    if not isinstance(raw, list) or len(raw) < 2:
        return None
    cleaned: List[List[float]] = []
    for pt in raw:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            continue
        try:
            lon = float(pt[0])
            lat = float(pt[1])
        except (TypeError, ValueError):
            continue
        if not (isfinite(lon) and isfinite(lat)):
            continue
        cleaned.append([lon, lat])
    return cleaned if len(cleaned) >= 2 else None


def sanitize_graph(graph: Graph | None, *, strict: bool = False) -> Graph:
    """Normalise edges, branche, diamètres, longueurs; synchronise champs legacy."""
    if graph is None:
        raise HTTPException(status_code=400, detail="graph payload required")

    forbidden = _collect_forbidden_fields(graph)
    if forbidden and strict:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "forbidden_fields",
                "fields": forbidden,
                "message": "UI payload contains transient fields that must be removed",
            },
        )

    _purge_forbidden_fields(graph)

    # --- collect nodes
    try:
        nodes: List[Node] = list(graph.nodes or [])
    except Exception:
        nodes = []

    rename_map = _align_node_ids(nodes)
    node_by_id: Dict[str, Node] = {n.id: n for n in nodes if getattr(n, "id", None)}
    node_lookup_for_edges: Dict[str, Node] = dict(node_by_id)
    for old_id, new_id in rename_map.items():
        node = node_by_id.get(new_id)
        if node is not None:
            node_lookup_for_edges[old_id] = node
    enforce_node_lookup = bool(node_lookup_for_edges)

    # --- collect edges (raw) & basic filtering
    edges_in = _iter_edges(graph)
    seen_ids: set[str] = set()
    kept: list[Edge] = []
    edge_id_changes: Dict[str, str] = {}

    for edge in edges_in:
        raw_from = getattr(edge, "from_id", None)
        raw_to = getattr(edge, "to_id", None)
        if not raw_from or not raw_to:
            raise HTTPException(
                status_code=422,
                detail=f"edge missing endpoints: {getattr(edge, 'id', '')}",
            )
        from_id = rename_map.get(raw_from, raw_from)
        to_id = rename_map.get(raw_to, raw_to)
        if enforce_node_lookup and ((from_id not in node_lookup_for_edges) or (to_id not in node_lookup_for_edges)):
            raise HTTPException(status_code=422, detail=f"edge endpoint missing: {getattr(edge, 'id', '')}")

        original_id = (getattr(edge, "id", "") or "").strip()
        eid = original_id or _gen_edge_id()
        # Dedup on id — if same id/from/to already kept, skip; else re-id
        if eid in seen_ids:
            dup_same = any((e.id == eid and e.from_id == from_id and e.to_id == to_id) for e in kept)
            if dup_same:
                continue
            # regenerate id
            guard = 0
            new_id = _gen_edge_id()
            while new_id in seen_ids and guard < 5:
                new_id = _gen_edge_id()
                guard += 1
            eid = new_id
        if original_id and eid != original_id:
            edge_id_changes[original_id] = eid

        # Canonical branch id (accept legacy)
        branch_candidate = getattr(edge, "branch_id", None)
        if not branch_candidate:
            legacy_branch = None
            if isinstance(edge, dict):
                legacy_branch = edge.get("pipe_group_id") or edge.get("PipeGroupId")
            elif hasattr(edge, "pipe_group_id"):
                legacy_branch = getattr(edge, "pipe_group_id", None)
            branch_candidate = legacy_branch
        branch_id = str(branch_candidate).strip() if branch_candidate else ""
        if not branch_id:
            raise HTTPException(status_code=422, detail=f"edge missing branch_id: {eid}")

        # Diamètre (>=0)
        dmm = getattr(edge, "diameter_mm", None)
        if dmm is None or dmm == "":
            raise HTTPException(status_code=422, detail=f"edge missing diameter_mm: {eid}")
        try:
            diameter_mm = float(dmm)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail=f"edge diameter_mm invalid: {eid}")
        if not isfinite(diameter_mm) or diameter_mm < 0:
            raise HTTPException(status_code=422, detail=f"edge diameter_mm out of range: {eid}")

        material = _normalise_material(getattr(edge, "material", None))
        sdr = _normalise_sdr(getattr(edge, "sdr", None) or getattr(edge, "sdr_ouvrage", None))
        geometry = _sanitize_geometry(getattr(edge, "geometry", None))
        extras = _clean_extras(getattr(edge, "extras", {}) or {})
        site_id_raw = getattr(edge, "site_id", None)
        if isinstance(site_id_raw, str):
            site_id_clean = site_id_raw.strip() or None
        elif site_id_raw is None:
            site_id_clean = None
        else:
            site_id_clean = str(site_id_raw).strip() or None

        # Build sanitized edge (length computed later)
        e = Edge(
            id=eid,
            from_id=from_id,
            to_id=to_id,
            active=True if getattr(edge, "active", True) is None else bool(getattr(edge, "active", True)),
            commentaire=(getattr(edge, "commentaire", "") or ""),
            geometry=geometry,
            branch_id=branch_id,
            diameter_mm=diameter_mm,
            length_m=getattr(edge, "length_m", None),
            material=material,
            sdr=sdr,
            slope_pct=getattr(edge, "slope_pct", None),
            site_id=site_id_clean,
            extras=extras,
        )
        kept.append(e)
        seen_ids.add(eid)

    # --- Build adjacency maps
    in_edges: Dict[str, List[Edge]] = defaultdict(list)
    out_edges: Dict[str, List[Edge]] = defaultdict(list)
    for e in kept:
        in_edges[e.to_id].append(e)
        out_edges[e.from_id].append(e)

    # --- Compute length_m if missing
    for e in kept:
        if e.length_m is None or e.length_m == 0:
            e.length_m = _edge_length_m(e, node_lookup_for_edges)
        if e.length_m is not None:
            try:
                e.length_m = round(float(e.length_m), 2)
            except (TypeError, ValueError):
                e.length_m = None

    edge_by_id: Dict[str, Edge] = {e.id: e for e in kept}

    # --- Normalise nodes and anchors
    for n in nodes:
        extras = getattr(n, "extras", {}) or {}
        n.extras = _clean_extras(extras)
        pm_edge = (getattr(n, "pm_collector_edge_id", "") or getattr(n, "attach_edge_id", "") or "").strip()
        if pm_edge and pm_edge in edge_id_changes:
            pm_edge = edge_id_changes[pm_edge]
        if pm_edge:
            n.pm_collector_edge_id = pm_edge
            n.attach_edge_id = pm_edge
        else:
            n.pm_collector_edge_id = ""
            n.attach_edge_id = ""
        offset_value = getattr(n, "pm_offset_m", None)
        if offset_value in ("", None):
            n.pm_offset_m = None
        else:
            try:
                offset_num = float(offset_value)
            except (TypeError, ValueError):
                offset_num = None
            if offset_num is None or not isfinite(offset_num):
                n.pm_offset_m = None
            else:
                n.pm_offset_m = round(offset_num, 2)
        if str(getattr(n, "type", "")).upper() != "CANALISATION":
            n.diameter_mm = None
            n.sdr_ouvrage = ""
            n.material = ""
        if getattr(n, "gps_locked", None) is None:
            n.gps_locked = True

    # --- Validate inline anchors (PM / VANNE)
    for n in nodes:
        nodetype = str(getattr(n, "type", "")).upper()
        if nodetype not in INLINE_ANCHORED_TYPES:
            continue
        anchor_id = (getattr(n, "pm_collector_edge_id", "") or "").strip()
        if not anchor_id:
            continue
        edge = edge_by_id.get(anchor_id)
        if edge is None:
            raise HTTPException(status_code=422, detail=f"anchor edge missing for node {n.id}: {anchor_id}")
        if edge.to_id != n.id:
            raise HTTPException(status_code=422, detail=f"anchor edge invalid for node {n.id}: {anchor_id}")
        offset = getattr(n, "pm_offset_m", None)
        if offset is not None:
            if offset < 0:
                raise HTTPException(status_code=422, detail=f"pm_offset_m negative for node {n.id}")
            edge_length = edge.length_m if edge.length_m is not None else _edge_length_m(edge, node_lookup_for_edges)
            if edge_length is not None:
                max_allowed = edge_length + OFFSET_TOLERANCE_M
                if offset > max_allowed:
                    raise HTTPException(status_code=422, detail=f"pm_offset_m exceeds edge length for node {n.id}")
                if offset > edge_length:
                    n.pm_offset_m = round(edge_length, 2)
                    offset = n.pm_offset_m

    if rename_map:
        for e in kept:
            if e.from_id in rename_map:
                e.from_id = rename_map[e.from_id]
            if e.to_id in rename_map:
                e.to_id = rename_map[e.to_id]

    # --- Return normalized graph (v1.5)
    return Graph(
        version=getattr(graph, "version", "1.5") or "1.5",
        site_id=getattr(graph, "site_id", None),
        generated_at=getattr(graph, "generated_at", None),
        style_meta=getattr(graph, "style_meta", {}) or {},
        nodes=nodes,
        edges=kept,
        # style_meta etc. si présent dans graph.model_dump(...), FastAPI conservera
    )
