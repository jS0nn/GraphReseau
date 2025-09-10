from typing import List, Optional, Dict, Any
from pydantic import BaseModel


class Node(BaseModel):
    id: str
    name: Optional[str] = ""
    type: Optional[str] = "OUVRAGE"
    branch_id: Optional[str] = ""
    diameter_mm: Optional[float] = None
    sdr_ouvrage: Optional[str] = ""
    commentaire: Optional[str] = ""
    collector_well_ids: List[str] = []
    well_collector_id: Optional[str] = ""
    well_pos_index: Optional[int] = None
    pm_collector_id: Optional[str] = ""
    pm_pos_index: Optional[int] = None
    gps_lat: Optional[float] = None
    gps_lon: Optional[float] = None
    x: Optional[float] = None
    y: Optional[float] = None
    x_ui: Optional[float] = None
    y_ui: Optional[float] = None
    extras: Optional[Dict[str, Any]] = None


class Edge(BaseModel):
    id: Optional[str] = None
    from_id: str
    to_id: str
    active: Optional[bool] = True


class Graph(BaseModel):
    nodes: List[Node] = []
    edges: List[Edge] = []
