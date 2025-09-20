"""Shared sanitisation helpers used across services and scripts."""
from __future__ import annotations

import os
import time
from math import radians, sin, cos, sqrt, atan2
from collections import defaultdict, deque
from typing import Iterable, Dict, List, Tuple, Optional

from fastapi import HTTPException

from ..models import Edge, Graph, Node


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
            total = 0.0
            for i in range(len(coords) - 1):
                lon1, lat1 = float(coords[i][0]), float(coords[i][1])
                lon2, lat2 = float(coords[i + 1][0]), float(coords[i + 1][1])
                total += _haversine_m(lon1, lat1, lon2, lat2)
            return total if total > 0 else None
        # fallback: distance entre nœuds
        a = node_by_id.get(e.from_id)
        b = node_by_id.get(e.to_id)
        if a and b and a.gps_lat is not None and a.gps_lon is not None and b.gps_lat is not None and b.gps_lon is not None:
            return _haversine_m(a.gps_lon, a.gps_lat, b.gps_lon, b.gps_lat)
    except Exception:
        return None
    return None


def sanitize_graph(graph: Graph | None) -> Graph:
    """Normalise edges, branche, diamètres, longueurs; synchronise champs legacy."""
    if graph is None:
        raise HTTPException(status_code=400, detail="graph payload required")

    # --- collect nodes
    try:
        nodes: List[Node] = list(graph.nodes or [])
    except Exception:
        nodes = []
    node_by_id: Dict[str, Node] = {n.id: n for n in nodes if getattr(n, "id", None)}
    enforce_node_lookup = bool(node_by_id)

    # --- collect edges (raw) & basic filtering
    edges_in = _iter_edges(graph)
    seen_ids: set[str] = set()
    kept: list[Edge] = []

    for edge in edges_in:
        from_id = getattr(edge, "from_id", None)
        to_id = getattr(edge, "to_id", None)
        if not from_id or not to_id:
            continue
        if enforce_node_lookup and ((from_id not in node_by_id) or (to_id not in node_by_id)):
            # ignore edges referencing unknown nodes when node list is provided
            continue

        eid = (getattr(edge, "id", "") or "").strip() or _gen_edge_id()
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

        # Canonical branch id (accept legacy)
        pipe_group_id = getattr(edge, "pipe_group_id", None)
        branch_id = (getattr(edge, "branch_id", None) or "") or (pipe_group_id or "")

        # Diamètre (>=0)
        dmm = getattr(edge, "diameter_mm", None)
        try:
            diameter_mm = float(dmm) if dmm is not None and dmm != "" else 0.0
        except Exception:
            diameter_mm = 0.0

        # Build sanitized edge (length computed later)
        e = Edge(
            id=eid,
            from_id=from_id,
            to_id=to_id,
            active=True if getattr(edge, "active", True) is None else bool(getattr(edge, "active", True)),
            commentaire=(getattr(edge, "commentaire", "") or ""),
            geometry=getattr(edge, "geometry", None),
            branch_id=branch_id or "",
            pipe_group_id=(pipe_group_id or None),
            diameter_mm=diameter_mm,
            length_m=getattr(edge, "length_m", None),
            material=getattr(edge, "material", None),
            sdr=getattr(edge, "sdr", None) or getattr(edge, "sdr_ouvrage", None),
            slope_pct=getattr(edge, "slope_pct", None),
            site_id=getattr(edge, "site_id", None),
            extras=getattr(edge, "extras", {}) or {},
        )
        kept.append(e)
        seen_ids.add(eid)

    # --- Validate and align branch_id vs pipe_group_id
    for e in kept:
        b = (e.branch_id or "").strip()
        p = (e.pipe_group_id or "").strip()
        if b and p and b != p:
            # Harmonise sur branch_id, priorité au champ canonique
            e.pipe_group_id = b
        elif (not b) and p:
            e.branch_id = p
        elif b and (not p):
            e.pipe_group_id = b

    # --- Build adjacency maps
    in_edges: Dict[str, List[Edge]] = defaultdict(list)
    out_edges: Dict[str, List[Edge]] = defaultdict(list)
    for e in kept:
        in_edges[e.to_id].append(e)
        out_edges[e.from_id].append(e)

    # --- Diameter inheritance: child edges inherit parent diameter if == 0
    roots: List[str] = [n.id for n in nodes if len(in_edges.get(n.id, [])) == 0]
    q: deque[str] = deque(roots)
    visited: set[str] = set()
    while q:
        nid = q.popleft()
        if nid in visited:
            continue
        visited.add(nid)
        parent_diam = None
        ins = in_edges.get(nid, [])
        if len(ins) == 1:
            parent_diam = ins[0].diameter_mm
        for e in out_edges.get(nid, []):
            if (e.diameter_mm or 0.0) == 0.0 and (parent_diam or 0.0) > 0.0:
                e.diameter_mm = parent_diam
            q.append(e.to_id)

    # --- Compute length_m if missing
    for e in kept:
        if e.length_m is None or e.length_m == 0:
            e.length_m = _edge_length_m(e, node_by_id)

    # --- Compute node.branch_id from primary incoming edge (tree assumption)
    for n in nodes:
        ins = in_edges.get(n.id, [])
        if len(ins) == 1:
            n.branch_id = ins[0].branch_id or n.branch_id or ""
        if str(getattr(n, "type", "")).upper() != "CANALISATION":
            n.diameter_mm = None
            n.sdr_ouvrage = ""
            n.material = ""

    # --- Propagate site_id from Graph if set
    g_site = getattr(graph, "site_id", None)
    if g_site:
        for n in nodes:
            if not getattr(n, "site_id", None):
                n.site_id = g_site
        for e in kept:
            if not getattr(e, "site_id", None):
                e.site_id = g_site

    # --- Return normalized graph (v1.5)
    return Graph(
        version="1.5",
        site_id=getattr(graph, "site_id", None),
        generated_at=getattr(graph, "generated_at", None),
        nodes=nodes,
        edges=kept,
        # style_meta etc. si présent dans graph.model_dump(...), FastAPI conservera
    )
