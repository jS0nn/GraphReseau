"""Shared sanitisation helpers used across services and scripts."""
from __future__ import annotations

import os
import time
from typing import Iterable

from fastapi import HTTPException

from ..models import Edge, Graph


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


def sanitize_graph(graph: Graph | None) -> Graph:
    """Normalise edge identifiers and drop invalid data prior to persistence."""
    if graph is None:
        raise HTTPException(status_code=400, detail="graph payload required")

    try:
        nodes = list(graph.nodes or [])
    except Exception:
        nodes = []

    edges_in = _iter_edges(graph)

    seen_ids: set[str] = set()
    kept: list[Edge] = []

    for edge in edges_in:
        from_id = getattr(edge, "from_id", None)
        to_id = getattr(edge, "to_id", None)
        if not from_id or not to_id:
            continue

        current_id = (getattr(edge, "id", "") or "").strip() or _gen_edge_id()
        if current_id in seen_ids:
            dup_same = any(
                existing.id == current_id
                and existing.from_id == from_id
                and existing.to_id == to_id
                for existing in kept
            )
            if dup_same:
                continue
            new_id = _gen_edge_id()
            guard = 0
            while new_id in seen_ids and guard < 5:
                new_id = _gen_edge_id()
                guard += 1
            edge = Edge(
                id=new_id,
                from_id=from_id,
                to_id=to_id,
                active=(getattr(edge, "active", True) is not False),
                commentaire=getattr(edge, "commentaire", "") or "",
                geometry=getattr(edge, "geometry", None),
                pipe_group_id=getattr(edge, "pipe_group_id", None),
            )
            seen_ids.add(new_id)
            kept.append(edge)
            continue

        seen_ids.add(current_id)
        commentaire = getattr(edge, "commentaire", "")
        active = getattr(edge, "active", True)
        kept.append(
            Edge(
                id=current_id,
                from_id=from_id,
                to_id=to_id,
                active=True if active is None else bool(active),
                commentaire=commentaire or "",
                geometry=getattr(edge, "geometry", None),
                pipe_group_id=getattr(edge, "pipe_group_id", None),
            )
        )

    return Graph(nodes=nodes, edges=kept)


__all__ = ["sanitize_graph"]
