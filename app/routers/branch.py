from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models import Graph
from ..shared.graph_transform import sanitize_graph

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.post("/branch-recalc")
async def branch_recalc(graph: Graph | None):
    if graph is None:
        raise HTTPException(status_code=400, detail="graph payload required")
    cleaned = sanitize_graph(graph, strict=False)
    return {
        "nodes": [node.model_dump(mode="json") for node in cleaned.nodes],
        "edges": [edge.model_dump(mode="json") for edge in cleaned.edges],
        "branch_changes": getattr(cleaned, "branch_changes", []),
        "branch_diagnostics": getattr(cleaned, "branch_diagnostics", []),
        "branch_conflicts": getattr(cleaned, "branch_conflicts", []),
    }
