"""Backward-compatible wrapper around shared graph sanitisation helpers."""
from __future__ import annotations

from ..models import Graph
from ..shared import sanitize_graph


def sanitize_graph_for_write(graph: Graph | None) -> Graph:
    """Alias kept for routers relying on the historical module name."""
    return sanitize_graph(graph)


__all__ = ["sanitize_graph_for_write"]
