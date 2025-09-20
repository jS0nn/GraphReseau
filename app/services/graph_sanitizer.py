"""Backward-compatible wrapper around shared graph sanitisation helpers."""
from __future__ import annotations

from ..models import Graph
from typing import Any

from ..shared import sanitize_graph


def sanitize_graph_for_write(graph: Graph | None, *, strict: bool = True) -> Graph:
    """Alias kept for routers relying on the historical module name."""
    return sanitize_graph(graph, strict=strict)


def graph_to_persistable_payload(graph: Graph) -> dict[str, Any]:
    """Apply backend whitelist before persistence on JSON-compatible stores."""

    nodes_payload = []
    for node in graph.nodes or []:
        data = node.model_dump(mode="python")
        # Ensure extras cleaned up but preserved when meaningful
        extras = data.get("extras")
        if isinstance(extras, dict):
            cleaned_extras = {k: v for k, v in extras.items() if v not in (None, "")}
            if cleaned_extras:
                data["extras"] = cleaned_extras
            else:
                data.pop("extras", None)
        nodes_payload.append(data)

    edges_payload = []
    for edge in graph.edges or []:
        geometry = edge.geometry if edge.geometry else None
        length = edge.length_m if edge.length_m not in ("", None) else None
        if length is not None:
            try:
                length = round(float(length), 2)
            except (TypeError, ValueError):
                length = None
        diameter = edge.diameter_mm if edge.diameter_mm not in ("", None) else None
        if diameter is not None:
            try:
                diameter = float(diameter)
            except (TypeError, ValueError):
                diameter = None
        payload_edge: dict[str, Any] = {
            "id": edge.id,
            "from_id": edge.from_id,
            "to_id": edge.to_id,
            "active": True if edge.active is None else bool(edge.active),
            "commentaire": edge.commentaire or "",
            "geometry": geometry,
            "branch_id": edge.branch_id,
            "diameter_mm": diameter,
            "sdr": edge.sdr if edge.sdr not in ("", None) else None,
            "material": edge.material if edge.material not in ("", None) else None,
            "length_m": length,
        }
        edges_payload.append(payload_edge)

    return {
        "version": graph.version or "1.5",
        "site_id": graph.site_id,
        "generated_at": graph.generated_at,
        "style_meta": graph.style_meta or {},
        "nodes": nodes_payload,
        "edges": edges_payload,
    }


__all__ = ["sanitize_graph_for_write", "graph_to_persistable_payload"]
