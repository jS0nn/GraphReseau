"""Shared sanitisation helpers used across services and scripts."""
from __future__ import annotations

import os
import re
import time
import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from math import radians, sin, cos, sqrt, atan2, isfinite
from collections import defaultdict, deque
from typing import Iterable, Dict, List, Tuple, Optional, Any

from fastapi import HTTPException

from ..models import Edge, Graph, Node


INLINE_ANCHORED_TYPES = {"POINT_MESURE", "VANNE"}
INLINE_BRANCH_MATCH_TYPES = {"VANNE"}
PASS_THROUGH_TYPES = {"VANNE", "POINT_MESURE", "OUVRAGE"}
SPLITTER_TYPES = {"JONCTION"}
ALLOWED_NODE_TYPES = {"GENERAL", "OUVRAGE", "JONCTION", "POINT_MESURE", "VANNE"}
NODE_TYPE_SYNONYMS = {
    "PLATEFORME": "GENERAL",
    "PLATFORM": "GENERAL",
    "GÉNÉRAL": "GENERAL",
    "PUITS": "OUVRAGE",
    "WELL": "OUVRAGE",
    "JUNCTION": "JONCTION",
    "MEASURE_POINT": "POINT_MESURE",
    "MEASUREMENT_POINT": "POINT_MESURE",
    "VALVE": "VANNE",
    "COLLECTEUR": "OUVRAGE",
    "CANALISATION": "OUVRAGE",
}
UI_PREFIXES = ("ui_",)
EPHEMERAL_KEYS = {"site_effective", "site_effective_is_fallback"}
OFFSET_TOLERANCE_M = 0.05
GRAPH_ALLOWED_TOP_LEVEL = {"version", "site_id", "generated_at", "style_meta", "nodes", "edges"}
EDGE_FORBIDDEN_FIELDS = {"ui_diameter_mm"}
ISO_8601_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")


@dataclass
class BranchChange:
    edge_id: str
    previous: str
    new: str
    reason: str


@dataclass
class JunctionDecision:
    node_id: str
    incoming_branch: str
    main_edge: Optional[str]
    rule: str
    new_branches: List[str] = field(default_factory=list)


@dataclass
class BranchDiagnostics:
    junctions: List[JunctionDecision] = field(default_factory=list)
    conflicts: List[str] = field(default_factory=list)


@dataclass
class BranchAssignmentResult:
    changes: List[BranchChange]
    diagnostics: BranchDiagnostics


def _parse_iso8601_z(value: str, *, context: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(status_code=422, detail=f"{context} created_at required")
    text = value.strip()
    try:
        if text.endswith("Z"):
            return datetime.fromisoformat(text[:-1] + "+00:00").astimezone(timezone.utc)
        return datetime.fromisoformat(text).astimezone(timezone.utc)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"{context} created_at invalid: {text}") from exc


def _new_branch_id(parent_branch: str, node_id: str, edge_id: str) -> str:
    payload = f"{parent_branch}|{node_id}|{edge_id}"
    digest = hashlib.sha1(payload.encode("utf-8")).hexdigest().upper()
    return f"E-{digest[:12]}"


def _fallback_created_at(edge_id: str) -> str:
    digest = hashlib.sha1(edge_id.encode("utf-8")).hexdigest()
    seconds = int(digest[:8], 16) % (3600 * 24 * 365)
    base = datetime(2000, 1, 1, tzinfo=timezone.utc)
    fallback = base + timedelta(seconds=seconds)
    return fallback.isoformat().replace("+00:00", "Z")


def _edge_sort_key(edge: Edge, diameter: float, created_at: datetime) -> Tuple[float, datetime, str]:
    return (-diameter, created_at, edge.id)


def _determine_rule_reason(sorted_edges: List[Tuple[Edge, float, datetime]]) -> str:
    if len(sorted_edges) <= 1:
        return "single_outlet"
    first, second = sorted_edges[0], sorted_edges[1]
    if first[1] > second[1]:
        return "diameter"
    if abs(first[1] - second[1]) < 1e-6 and first[2] < second[2]:
        return "created_at"
    return "edge_id"


def _assign_branch_ids(
    nodes: List[Node],
    edges: List[Edge],
) -> BranchAssignmentResult:
    node_by_id: Dict[str, Node] = {n.id: n for n in nodes if getattr(n, "id", None)}
    edge_by_id: Dict[str, Edge] = {e.id: e for e in edges if getattr(e, "id", None)}

    diameter_cache: Dict[str, float] = {}
    created_cache: Dict[str, datetime] = {}

    for edge in edges:
        if edge.id is None:
            raise HTTPException(status_code=422, detail="edge id required for branch assignment")
        if edge.diameter_mm is None:
            raise HTTPException(status_code=422, detail=f"edge {edge.id} requires diameter_mm")
        if edge.length_m is None or edge.length_m <= 0:
            raise HTTPException(status_code=422, detail=f"edge {edge.id} requires positive length_m")
        created_raw = getattr(edge, "created_at", None)
        if created_raw in (None, ""):
            edge.created_at = _fallback_created_at(edge.id)
            created_raw = edge.created_at
        created_cache[edge.id] = _parse_iso8601_z(created_raw, context=f"edge {edge.id}")
        diameter_cache[edge.id] = float(edge.diameter_mm or 0.0)

    out_edges: Dict[str, List[Edge]] = defaultdict(list)
    in_edges: Dict[str, List[Edge]] = defaultdict(list)
    edge_lookup: Dict[str, Edge] = {}
    for edge in edges:
        out_edges[edge.from_id].append(edge)
        in_edges[edge.to_id].append(edge)
        edge_lookup[edge.id] = edge

    pending_incoming: Dict[str, int] = {}
    for node_id in node_by_id:
        pending_incoming[node_id] = len(out_edges.get(node_id, []))

    node_branch: Dict[str, str] = {}
    edge_branch: Dict[str, str] = {}
    changes: List[BranchChange] = []
    diagnostics = BranchDiagnostics()

    def set_edge_branch(edge: Edge, branch: str, reason: str) -> None:
        branch = branch or edge.id
        previous = edge_branch.get(edge.id, edge.branch_id or "")
        if previous != branch:
            changes.append(BranchChange(edge_id=edge.id, previous=previous, new=branch, reason=reason))
        edge_branch[edge.id] = branch
        edge.branch_id = branch

    def set_node_branch(node_id: str, branch: str) -> None:
        branch = branch or node_id
        node_branch[node_id] = branch
        node = node_by_id.get(node_id)
        if node is not None:
            node.branch_id = branch

    def branch_for_edge(edge: Edge) -> str:
        return edge_branch.get(edge.id, edge.branch_id or "")

    def select_primary(candidates: List[Edge]) -> Tuple[Optional[Edge], str]:
        if not candidates:
            return None, "no_candidate"
        decorated = [
            (edge, diameter_cache[edge.id], created_cache[edge.id])
            for edge in candidates
        ]
        decorated.sort(key=lambda item: _edge_sort_key(item[0], item[1], item[2]))
        reason = _determine_rule_reason(decorated)
        return decorated[0][0], reason

    queue: deque[str] = deque()
    scheduled: set[str] = set()

    def try_schedule(node_id: Optional[str]) -> None:
        if not node_id or node_id not in node_by_id:
            return
        if pending_incoming.get(node_id, 0) <= 0 and node_id not in scheduled:
            queue.append(node_id)
            scheduled.add(node_id)

    for node in nodes:
        ntype = (node.type or "").upper()
        if ntype == "GENERAL":
            try_schedule(node.id)

    for node_id, count in pending_incoming.items():
        if count == 0:
            try_schedule(node_id)

    visited_nodes: set[str] = set()

    def process_node(node_id: str) -> None:
        node = node_by_id.get(node_id)
        parent_edges = out_edges.get(node_id, [])
        child_edges = in_edges.get(node_id, [])
        node_type = (node.type or "").upper() if node else ""

        parent_branches: List[str] = []
        for edge in parent_edges:
            branch = branch_for_edge(edge)
            if branch:
                parent_branches.append(branch)

        branch_at_node = None
        if parent_branches:
            branch_at_node = parent_branches[0]
            if len({*parent_branches}) > 1:
                diagnostics.conflicts.append(
                    f"node {node_id} received multiple parent branches"
                )
        elif node and node.branch_id:
            branch_at_node = node.branch_id
        else:
            child_branch_candidates = [branch_for_edge(edge) for edge in child_edges if branch_for_edge(edge)]
            if child_branch_candidates:
                branch_at_node = child_branch_candidates[0]

        branch_at_node = branch_at_node or node_id
        set_node_branch(node_id, branch_at_node)

        if node_type in PASS_THROUGH_TYPES or node_type == "GENERAL" or not child_edges:
            for edge in child_edges:
                set_edge_branch(edge, branch_at_node, "pass_through")
                target = edge.to_id
                pending_incoming[target] = pending_incoming.get(target, 0) - 1
                if pending_incoming[target] <= 0:
                    try_schedule(target)
            return

        if node_type in SPLITTER_TYPES:
            parent_branch_values = parent_branches or [branch_at_node]
            available: Dict[str, Edge] = {edge.id: edge for edge in child_edges}
            for incoming_branch in sorted(set(parent_branch_values)):
                candidate_values = list(available.values()) if available else list(child_edges)
                main_edge, rule = select_primary(candidate_values)
                if main_edge is None:
                    diagnostics.conflicts.append(
                        f"junction {node_id}: no available outgoing edge for branch {incoming_branch}"
                    )
                    continue
                available.pop(main_edge.id, None)
                set_edge_branch(main_edge, incoming_branch or branch_at_node, rule)
                diagnostics.junctions.append(
                    JunctionDecision(
                        node_id=node_id,
                        incoming_branch=incoming_branch or branch_at_node,
                        main_edge=main_edge.id,
                        rule=rule,
                        new_branches=[],
                    )
                )
                target = main_edge.to_id
                pending_incoming[target] = pending_incoming.get(target, 0) - 1
                if pending_incoming[target] <= 0:
                    try_schedule(target)

            remaining = [edge_lookup[eid] for eid in available.keys()]
            if remaining:
                base_branch = branch_at_node
                for edge in remaining:
                    new_branch = _new_branch_id(base_branch, node_id, edge.id)
                    set_edge_branch(edge, new_branch, "split_new_branch")
                    diagnostics.junctions.append(
                        JunctionDecision(
                            node_id=node_id,
                            incoming_branch=base_branch,
                            main_edge=None,
                            rule="split_new_branch",
                            new_branches=[new_branch],
                        )
                    )
                    target = edge.to_id
                    pending_incoming[target] = pending_incoming.get(target, 0) - 1
                    if pending_incoming[target] <= 0:
                        try_schedule(target)
            return

        # Default behaviour for unknown types: propagate current branch
        for edge in child_edges:
            set_edge_branch(edge, branch_at_node, "default_propagation")
            target = edge.to_id
            pending_incoming[target] = pending_incoming.get(target, 0) - 1
            if pending_incoming[target] <= 0:
                try_schedule(target)

    while queue:
        node_id = queue.popleft()
        if node_id in visited_nodes:
            continue
        scheduled.discard(node_id)
        visited_nodes.add(node_id)
        process_node(node_id)

    remaining_nodes = [nid for nid in node_by_id if nid not in visited_nodes]
    for node_id in sorted(remaining_nodes):
        process_node(node_id)

    return BranchAssignmentResult(changes=changes, diagnostics=diagnostics)


def apply_branch_change(graph: Graph | None, event: Optional[Dict[str, Any]] = None) -> BranchAssignmentResult:
    """Re-evaluate branch identifiers after a mutation event."""
    if graph is None:
        raise HTTPException(status_code=400, detail="graph payload required")
    nodes = list(graph.nodes or [])
    edges = list(graph.edges or [])
    result = _assign_branch_ids(nodes, edges)
    graph.nodes = nodes
    graph.edges = edges
    setattr(graph, "branch_diagnostics", [
        {
            "node_id": decision.node_id,
            "incoming_branch": decision.incoming_branch,
            "main_edge": decision.main_edge,
            "rule": decision.rule,
            "new_branches": decision.new_branches,
        }
        for decision in result.diagnostics.junctions
    ])
    setattr(graph, "branch_conflicts", list(result.diagnostics.conflicts))
    setattr(graph, "branch_changes", [change.__dict__ for change in result.changes])
    return result


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


def _canonical_node_type(raw: Any) -> str:
    if raw is None:
        return ""
    text = str(raw).strip()
    if not text:
        return ""
    upper = text.upper()
    preferred = NODE_TYPE_SYNONYMS.get(upper, upper)
    return preferred


def _ensure_node_type(raw: Any, *, node_id: str) -> str:
    value = _canonical_node_type(raw)
    if value in ALLOWED_NODE_TYPES:
        return value
    raise HTTPException(status_code=422, detail=f"node {node_id or '<unknown>'} uses unsupported type: {raw}")


def _normalise_branch_id(raw: Any) -> str:
    if raw is None:
        return ""
    text = str(raw).strip()
    return text


def _require_iso8601_utc(raw: Any) -> str:
    if raw is None:
        raise HTTPException(status_code=422, detail="generated_at required (ISO-8601 UTC)")
    if isinstance(raw, str):
        text = raw.strip()
    else:
        text = str(raw).strip()
    if not text:
        raise HTTPException(status_code=422, detail="generated_at required (ISO-8601 UTC)")
    if not ISO_8601_UTC_RE.match(text):
        raise HTTPException(status_code=422, detail=f"generated_at must be ISO-8601 UTC (got {text})")
    return text


def _require_float(raw: Any, *, field: str, context: str) -> float:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{context} {field} must be a finite number")
    if not isfinite(value):
        raise HTTPException(status_code=422, detail=f"{context} {field} must be a finite number")
    return value


def _optional_float(raw: Any, *, allow_negative: bool = True) -> Optional[float]:
    if raw in (None, ""):
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if not isfinite(value):
        return None
    if not allow_negative and value < 0:
        return None
    return value


def _optional_int(raw: Any) -> Optional[int]:
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _coerce_boolean(raw: Any, *, default: bool = False) -> bool:
    if raw in (None, ""):
        return default
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, (int, float)):
        return bool(raw)
    text = str(raw).strip().lower()
    if text in {"true", "1", "yes", "y"}:
        return True
    if text in {"false", "0", "no", "n"}:
        return False
    return default


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

    version_raw = getattr(graph, "version", None)
    version = "1.5"
    if version_raw not in (None, ""):
        version = str(version_raw).strip() or "1.5"
    if version != "1.5":
        raise HTTPException(status_code=422, detail=f"version must be '1.5' (got {version_raw})")

    site_id_raw = getattr(graph, "site_id", None)
    site_id = str(site_id_raw).strip() if site_id_raw not in (None, "") else ""
    if not site_id:
        raise HTTPException(status_code=422, detail="site_id required")

    generated_at_raw = getattr(graph, "generated_at", None)
    if generated_at_raw in (None, ""):
        generated_at: Optional[str] = None
    else:
        generated_at = _require_iso8601_utc(generated_at_raw)

    style_meta_raw = getattr(graph, "style_meta", {}) or {}
    if not isinstance(style_meta_raw, dict):
        raise HTTPException(status_code=422, detail="style_meta must be an object when provided")
    style_meta = dict(style_meta_raw)

    # --- collect nodes
    try:
        nodes: List[Node] = list(graph.nodes or [])
    except Exception:
        nodes = []

    for node in nodes:
        node_id_raw = getattr(node, "id", None)
        node_id = str(node_id_raw).strip() if node_id_raw not in (None, "") else ""
        if not node_id:
            raise HTTPException(status_code=422, detail="node id required")
        node.id = node_id
        node.type = _ensure_node_type(getattr(node, "type", None), node_id=node_id)
        node.name = "" if getattr(node, "name", None) is None else str(getattr(node, "name", ""))
        node.branch_id = _normalise_branch_id(getattr(node, "branch_id", ""))
        node.site_id = site_id
        raw_comment = getattr(node, "commentaire", "")
        node.commentaire = "" if raw_comment is None else str(raw_comment)
        raw_material = getattr(node, "material", None)
        node.material = (str(raw_material).strip() or None) if raw_material not in (None, "") else None
        raw_sdr = getattr(node, "sdr_ouvrage", None)
        node.sdr_ouvrage = (str(raw_sdr).strip() or None) if raw_sdr not in (None, "") else None
        if getattr(node, "diameter_mm", None) not in (None, ""):
            diameter_value = _optional_float(getattr(node, "diameter_mm"), allow_negative=False)
            if diameter_value is None:
                raise HTTPException(status_code=422, detail=f"node {node_id} diameter_mm must be >= 0")
            node.diameter_mm = round(diameter_value, 3)
        else:
            node.diameter_mm = None
        node.gps_lat = _require_float(getattr(node, "gps_lat", None), field="gps_lat", context=f"node {node_id}")
        node.gps_lon = _require_float(getattr(node, "gps_lon", None), field="gps_lon", context=f"node {node_id}")
        node.lat = _optional_float(getattr(node, "lat", None))
        node.lon = _optional_float(getattr(node, "lon", None))
        node.x = _optional_float(getattr(node, "x", None))
        node.y = _optional_float(getattr(node, "y", None))
        node.x_ui = _optional_float(getattr(node, "x_ui", None))
        node.y_ui = _optional_float(getattr(node, "y_ui", None))
        node.pm_pos_index = _optional_int(getattr(node, "pm_pos_index", None))
        node.well_pos_index = _optional_int(getattr(node, "well_pos_index", None))
        node.gps_locked = _coerce_boolean(getattr(node, "gps_locked", None), default=True)
        extras = getattr(node, "extras", {}) or {}
        node.extras = _clean_extras(extras)

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

        if not eid.startswith("E-"):
            regenerated = _gen_edge_id()
            guard = 0
            while regenerated in seen_ids and guard < 5:
                regenerated = _gen_edge_id()
                guard += 1
            if original_id and original_id != regenerated:
                edge_id_changes[original_id] = regenerated
            eid = regenerated

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
        if geometry is None:
            raise HTTPException(status_code=422, detail=f"edge geometry invalid or missing: {eid}")
        active_flag = _coerce_boolean(getattr(edge, "active", True), default=True)
        commentaire = getattr(edge, "commentaire", "") or ""
        created_at_raw = getattr(edge, "created_at", None) or getattr(edge, "createdAt", None)
        if created_at_raw in (None, ""):
            created_at = _fallback_created_at(eid)
        else:
            created_at = str(created_at_raw).strip()
            if not ISO_8601_UTC_RE.match(created_at):
                raise HTTPException(status_code=422, detail=f"edge {eid} created_at invalid: {created_at}")

        # Build sanitized edge (length computed later)
        e = Edge(
            id=eid,
            from_id=from_id,
            to_id=to_id,
            active=active_flag,
            commentaire=str(commentaire),
            geometry=geometry,
            branch_id=branch_id,
            diameter_mm=round(diameter_mm, 3),
            length_m=getattr(edge, "length_m", None),
            material=material,
            sdr=sdr,
            slope_pct=None,
            site_id=None,
            extras={},
            created_at=created_at,
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
        if e.length_m is None or e.length_m <= 0:
            raise HTTPException(status_code=422, detail=f"edge length_m missing or non-positive: {e.id}")

    branch_assignment = _assign_branch_ids(nodes, kept)
    branch_diagnostics = branch_assignment.diagnostics
    branch_changes = branch_assignment.changes

    for n in nodes:
        pm_edge = (getattr(n, "pm_collector_edge_id", "") or getattr(n, "attach_edge_id", "") or "").strip()
        if pm_edge and pm_edge in edge_id_changes:
            pm_edge = edge_id_changes[pm_edge]
        if pm_edge:
            n.pm_collector_edge_id = pm_edge
            n.attach_edge_id = pm_edge
        else:
            n.pm_collector_edge_id = ""
            n.attach_edge_id = ""

        offset_raw = getattr(n, "pm_offset_m", None)
        if offset_raw in (None, ""):
            n.pm_offset_m = None
        else:
            offset_val = _optional_float(offset_raw, allow_negative=False)
            if offset_val is None:
                raise HTTPException(status_code=422, detail=f"node {n.id} pm_offset_m must be a non-negative number")
            n.pm_offset_m = round(offset_val, 2)

    edge_by_id: Dict[str, Edge] = {e.id: e for e in kept}

    # --- Validate inline anchors (POINT_MESURE / VANNE)
    for n in nodes:
        nodetype = str(getattr(n, "type", "")).upper()
        if nodetype not in INLINE_ANCHORED_TYPES:
            continue
        anchor_id = (getattr(n, "pm_collector_edge_id", "") or "").strip()
        if not anchor_id:
            raise HTTPException(status_code=422, detail=f"node {n.id} requires attach_edge_id")
        edge = edge_by_id.get(anchor_id)
        if edge is None:
            raise HTTPException(status_code=422, detail=f"anchor edge missing for node {n.id}: {anchor_id}")
        if edge.to_id != n.id:
            raise HTTPException(status_code=422, detail=f"anchor edge invalid for node {n.id}: {anchor_id}")
        if n.branch_id and edge.branch_id and n.branch_id != edge.branch_id:
            raise HTTPException(status_code=422, detail=f"node {n.id} branch_id must match anchor edge {anchor_id}")
        offset = getattr(n, "pm_offset_m", None)
        if nodetype == "POINT_MESURE" and offset is None:
            raise HTTPException(status_code=422, detail=f"node {n.id} pm_offset_m required")
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

    if rename_map:
        for e in kept:
            if e.from_id in rename_map:
                e.from_id = rename_map[e.from_id]
            if e.to_id in rename_map:
                e.to_id = rename_map[e.to_id]

    node_ids = {n.id for n in nodes}
    if len(node_ids) != len(nodes):
        raise HTTPException(status_code=422, detail="duplicate node ids detected")
    edge_ids = {e.id for e in kept}
    if len(edge_ids) != len(kept):
        raise HTTPException(status_code=422, detail="duplicate edge ids detected")
    intersection = node_ids.intersection(edge_ids)
    if intersection:
        raise HTTPException(status_code=422, detail=f"node and edge ids must be unique across the document: {sorted(intersection)[0]}")

    # --- Return normalized graph (v1.5)
    return Graph(
        version=version,
        site_id=site_id,
        generated_at=generated_at,
        style_meta=style_meta,
        nodes=nodes,
        edges=kept,
        branch_diagnostics=[
            {
                "node_id": decision.node_id,
                "incoming_branch": decision.incoming_branch,
                "main_edge": decision.main_edge,
                "rule": decision.rule,
                "new_branches": decision.new_branches,
            }
            for decision in branch_diagnostics.junctions
        ],
        branch_conflicts=list(branch_diagnostics.conflicts),
        branch_changes=[change.__dict__ for change in branch_changes],
        # style_meta etc. si présent dans graph.model_dump(...), FastAPI conservera
    )
