from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..config import settings
from ..models import Graph
from ..datasources import load_graph, save_graph
from ..services.graph_sanitizer import sanitize_graph_for_write

router = APIRouter()

@router.get("/graph", response_model=Graph)
def get_graph(
    source: Optional[str] = Query(None, description="sheet | gcs_json | bigquery"),
    sheet_id: Optional[str] = Query(None),
    nodes_tab: Optional[str] = Query(None),
    edges_tab: Optional[str] = Query(None),
    gcs_uri: Optional[str] = Query(None, description="gs://bucket/path.json or file://path for dev"),
    bq_project: Optional[str] = Query(None),
    bq_dataset: Optional[str] = Query(None),
    bq_nodes: Optional[str] = Query(None),
    bq_edges: Optional[str] = Query(None),
    site_id: Optional[str] = Query(None, description="Optional site filter (matches column idSite1 when present in Sheets)"),
    normalize: Optional[bool] = Query(False, description="If true, returns v1.5 normalized graph (branch_id on edges, diameters filled, lengths computed)")
):
    g = load_graph(
        source=source,
        sheet_id=sheet_id,
        nodes_tab=nodes_tab,
        edges_tab=edges_tab,
        gcs_uri=gcs_uri,
        bq_project=bq_project,
        bq_dataset=bq_dataset,
        bq_nodes=bq_nodes,
        bq_edges=bq_edges,
        site_id=site_id,
    )
    return sanitize_graph_for_write(g) if normalize else g


@router.post("/graph")
def post_graph(
    graph: Graph,
    source: Optional[str] = Query(None, description="sheet | gcs_json | bigquery"),
    sheet_id: Optional[str] = Query(None),
    nodes_tab: Optional[str] = Query(None),
    edges_tab: Optional[str] = Query(None),
    gcs_uri: Optional[str] = Query(None),
    bq_project: Optional[str] = Query(None),
    bq_dataset: Optional[str] = Query(None),
    bq_nodes: Optional[str] = Query(None),
    bq_edges: Optional[str] = Query(None),
    site_id: Optional[str] = Query(None, description="Optional site filter (matches column idSite1 when present in Sheets)"),
):
    save_graph(
        source=source,
        graph=graph,
        sheet_id=sheet_id,
        nodes_tab=nodes_tab,
        edges_tab=edges_tab,
        gcs_uri=gcs_uri,
        bq_project=bq_project,
        bq_dataset=bq_dataset,
        bq_nodes=bq_nodes,
        bq_edges=bq_edges,
        site_id=site_id,
    )
    return {"ok": True}
