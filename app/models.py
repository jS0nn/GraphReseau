from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, model_validator


class Node(BaseModel):
    id: str
    name: Optional[str] = ""
    type: Optional[str] = "OUVRAGE"
    branch_id: Optional[str] = ""
    diameter_mm: Optional[float] = None
    sdr_ouvrage: Optional[str] = ""
    commentaire: Optional[str] = ""
    collector_well_ids: List[str] = Field(default_factory=list)
    well_collector_id: Optional[str] = ""
    well_pos_index: Optional[int] = None
    pm_collector_id: Optional[str] = ""
    # New: anchor inline devices directly to an edge (pipeline as edge model)
    pm_collector_edge_id: Optional[str] = ""
    pm_pos_index: Optional[int] = None
    gps_lat: Optional[float] = None
    gps_lon: Optional[float] = None
    # Aliases for GPS in V2 (WGS84). Keep both for compatibility.
    lat: Optional[float] = None
    lon: Optional[float] = None
    x: Optional[float] = None
    y: Optional[float] = None
    x_ui: Optional[float] = None
    y_ui: Optional[float] = None
    extras: Optional[Dict[str, Any]] = None

    @model_validator(mode="before")
    @classmethod
    def _sync_lon_lat(cls, data: Any) -> Any:
        """Accept both gps_lat/gps_lon and lat/lon; keep them in sync.

        - If only lat/lon provided, mirror them to gps_lat/gps_lon.
        - If only gps_lat/gps_lon provided, mirror them to lat/lon.
        - If both provided, keep provided values (no override).
        """
        try:
            if not isinstance(data, dict):
                return data
            has_lat = data.get("lat") is not None
            has_lon = data.get("lon") is not None
            has_gps_lat = data.get("gps_lat") is not None
            has_gps_lon = data.get("gps_lon") is not None
            # lat/lon -> gps_*
            if has_lat and not has_gps_lat:
                data["gps_lat"] = data.get("lat")
            if has_lon and not has_gps_lon:
                data["gps_lon"] = data.get("lon")
            # gps_* -> lat/lon
            if has_gps_lat and not has_lat:
                data["lat"] = data.get("gps_lat")
            if has_gps_lon and not has_lon:
                data["lon"] = data.get("gps_lon")
        except Exception:
            return data
        return data


class Edge(BaseModel):
    id: Optional[str] = None
    from_id: str
    to_id: str
    active: Optional[bool] = True
    commentaire: Optional[str] = ""
    # V2 geometry: optional LineString coordinates [[lon,lat], ...]
    geometry: Optional[List[List[float]]] = None
    pipe_group_id: Optional[str] = None


class Graph(BaseModel):
    nodes: List[Node] = Field(default_factory=list)
    edges: List[Edge] = Field(default_factory=list)
