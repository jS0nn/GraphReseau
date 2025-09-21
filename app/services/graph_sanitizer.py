"""Backward-compatible wrapper around shared graph sanitisation helpers."""
from __future__ import annotations

from ..models import Graph, _compute_length_from_geometry, CRSInfo, BranchInfo
from typing import Any, Dict, List

from ..shared import sanitize_graph
from ..shared.graph_transform import ensure_created_at_string


def sanitize_graph_for_write(graph: Graph | None, *, strict: bool = True) -> Graph:
    """Alias kept for routers relying on the historical module name."""
    return sanitize_graph(graph, strict=strict)


def graph_to_persistable_payload(graph: Graph) -> dict[str, Any]:
    """Apply backend whitelist before persistence on JSON-compatible stores."""

    crs_value = getattr(graph, "crs", None)
    if crs_value and hasattr(crs_value, "model_dump"):
        crs_payload: Dict[str, Any] = crs_value.model_dump(mode="python")
    elif isinstance(crs_value, dict):
        crs_payload = {k: v for k, v in crs_value.items()}
    else:
        crs_payload = CRSInfo().model_dump(mode="python")

    branches_payload: List[Dict[str, Any]] = []
    seen_branch_ids: set[str] = set()
    raw_branches = getattr(graph, "branches", []) or []
    for entry in raw_branches:
        branch_obj = None
        if isinstance(entry, BranchInfo):
            branch_obj = entry
        elif isinstance(entry, str) and entry.strip():
            branch_obj = BranchInfo(id=entry.strip(), name=entry.strip())
        elif hasattr(BranchInfo, "model_validate"):
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
        branch_name = (branch_obj.name or "").strip() or branch_id
        parent_id = branch_obj.parent_id
        if parent_id is not None:
            parent_id = str(parent_id).strip() or None
        branches_payload.append(
            {
                "id": branch_id,
                "name": branch_name,
                "parent_id": parent_id,
                "is_trunk": bool(branch_obj.is_trunk),
            }
        )

    nodes_payload: List[Dict[str, Any]] = []
    for node in graph.nodes or []:
        data = node.model_dump(mode="python")
        extras = data.get("extras")
        if isinstance(extras, dict):
            cleaned_extras = {k: v for k, v in extras.items() if v not in (None, "")}
            if cleaned_extras:
                data["extras"] = cleaned_extras
            else:
                data.pop("extras", None)
        nodes_payload.append(data)

    edges_payload: List[Dict[str, Any]] = []
    for edge in graph.edges or []:
        geometry = edge.geometry if edge.geometry else None
        length = edge.length_m if edge.length_m not in ("", None) else None
        if length is not None:
            try:
                length = round(float(length), 2)
            except (TypeError, ValueError):
                length = None
        if length is None and geometry is not None:
            length = _compute_length_from_geometry(geometry)
        diameter = edge.diameter_mm if edge.diameter_mm not in ("", None) else None
        if diameter is not None:
            try:
                diameter = float(diameter)
            except (TypeError, ValueError):
                diameter = None
        created_at = edge.created_at
        if created_at in (None, ""):
            fallback_seed = f"{edge.from_id}->{edge.to_id}"
            created_at = ensure_created_at_string(edge.id or "", None, fallback_seed=fallback_seed)

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
            "created_at": created_at,
        }
        edges_payload.append(payload_edge)

    return {
        "version": graph.version or "1.5",
        "site_id": graph.site_id,
        "generated_at": graph.generated_at,
        "style_meta": graph.style_meta or {},
        "crs": crs_payload,
        "branches": branches_payload,
        "nodes": nodes_payload,
        "edges": edges_payload,
    }


__all__ = ["sanitize_graph_for_write", "graph_to_persistable_payload"]
