from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, model_validator, ConfigDict


class Node(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: Optional[str] = ""
    type: Optional[str] = "OUVRAGE"
    # NOTE: legacy - sera recalculé au sanitize depuis l'arête entrante
    branch_id: Optional[str] = ""
    site_id: Optional[str] = None

    diameter_mm: Optional[float] = None
    sdr_ouvrage: Optional[str] = ""
    material: Optional[str] = ""

    gps_locked: Optional[bool] = True
    pm_offset_m: Optional[float] = None

    commentaire: Optional[str] = ""

    collector_well_ids: List[str] = Field(default_factory=list)
    well_collector_id: Optional[str] = ""
    well_pos_index: Optional[int] = None
    pm_collector_id: Optional[str] = ""

    # Ancrage linéaire (canonique) + alias legacy
    attach_edge_id: Optional[str] = ""
    pm_collector_edge_id: Optional[str] = ""

    pm_pos_index: Optional[int] = None

    gps_lat: Optional[float] = None
    gps_lon: Optional[float] = None
    # Aliases pour compat
    lat: Optional[float] = None
    lon: Optional[float] = None

    x: Optional[float] = None
    y: Optional[float] = None
    x_ui: Optional[float] = None
    y_ui: Optional[float] = None

    extras: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _sync_lon_lat(cls, data: Any) -> Any:
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

    @model_validator(mode="before")
    @classmethod
    def _sync_attach_edge_ids(cls, data: Any) -> Any:
        # Harmonise attach_edge_id <-> pm_collector_edge_id
        try:
            if not isinstance(data, dict):
                return data
            a = data.get("attach_edge_id")
            p = data.get("pm_collector_edge_id")
            if (not a) and p:
                data["attach_edge_id"] = p
            elif (not p) and a:
                data["pm_collector_edge_id"] = a
        except Exception:
            return data
        return data


class Edge(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: Optional[str] = None
    from_id: str
    to_id: str
    active: Optional[bool] = True
    commentaire: Optional[str] = ""

    # V2 geometry: optional LineString coordinates [[lon,lat], ...]
    geometry: Optional[List[List[float]]] = None

    # Branche canonique obligatoire
    branch_id: str

    # Nouveaux champs v1.5
    diameter_mm: Optional[float] = None  # OBLIGATOIRE (>=0)
    length_m: Optional[float] = None
    material: Optional[str] = None
    sdr: Optional[str] = None
    slope_pct: Optional[float] = None
    site_id: Optional[str] = None
    extras: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _pre_normalise(cls, data: Any) -> Any:
        try:
            if not isinstance(data, dict):
                return data
            b = data.get("branch_id") or data.get("branchId")
            if not b:
                legacy = data.get("pipe_group_id") or data.get("PipeGroupId")
                if legacy:
                    b = legacy
            if not b:
                raise ValueError("branch_id required")
            data["branch_id"] = str(b).strip()
            # diameter: normaliser vide -> 0
            if "diameter_mm" in data:
                raw = data.get("diameter_mm")
                if raw in ("", None):
                    data["diameter_mm"] = None
                else:
                    data["diameter_mm"] = raw
        except Exception:
            return data
        return data


class Graph(BaseModel):
    model_config = ConfigDict(extra="allow")
    # Métadonnées v1.5
    version: str = "1.5"
    site_id: Optional[str] = None
    generated_at: Optional[str] = None
    style_meta: Dict[str, Any] = Field(default_factory=dict)

    nodes: List[Node] = Field(default_factory=list)
    edges: List[Edge] = Field(default_factory=list)
