from typing import List, Optional
from pydantic import BaseModel


class Node(BaseModel):
    id: str
    name: Optional[str] = ""
    type: Optional[str] = "PUITS"
    branch_id: Optional[str] = ""
    diameter_mm: Optional[float] = None
    collector_well_ids: List[str] = []
    well_collector_id: Optional[str] = ""
    well_pos_index: Optional[int] = None
    pm_collector_id: Optional[str] = ""
    pm_pos_index: Optional[int] = None
    gps_lat: Optional[float] = None
    gps_lon: Optional[float] = None
    x: Optional[float] = None
    y: Optional[float] = None


class Edge(BaseModel):
    id: Optional[str] = None
    from_id: str
    to_id: str
    active: Optional[bool] = True


class Graph(BaseModel):
    nodes: List[Node] = []
    edges: List[Edge] = []
