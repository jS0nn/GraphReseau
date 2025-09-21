from typing import List, Optional, Dict, Any
from math import radians, sin, cos, sqrt, atan2
from pydantic import BaseModel, Field, model_validator, ConfigDict


def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    radius = 6371000.0
    phi1, phi2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlmb = radians(lon2 - lon1)
    a = sin(dphi / 2.0) ** 2 + cos(phi1) * cos(phi2) * sin(dlmb / 2.0) ** 2
    c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a))
    return radius * c


def _compute_length_from_geometry(geometry: List[List[float]] | None) -> Optional[float]:
    if not isinstance(geometry, list) or len(geometry) < 2:
        return None
    total = 0.0
    previous = None
    for point in geometry:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        try:
            lon, lat = float(point[0]), float(point[1])
        except (TypeError, ValueError):
            continue
        if previous is not None:
            total += _haversine_m(previous[0], previous[1], lon, lat)
        previous = (lon, lat)
    return round(total, 2) if total > 0 else None



class CRSInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")
    code: str = "EPSG:4326"
    projected_for_lengths: Optional[str] = "EPSG:2154"


class BranchInfo(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: Optional[str] = None
    parent_id: Optional[str] = None
    is_trunk: bool = False

    @model_validator(mode="after")
    def _ensure_name(self) -> "BranchInfo":
        try:
            name = (self.name or "").strip()
        except Exception:
            name = ""
        if not name:
            self.name = self.id
        return self


class Node(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: Optional[str] = ""
    type: Optional[str] = "OUVRAGE"
    # NOTE: legacy - sera recalculé au sanitize depuis l'arête entrante
    branch_id: Optional[str] = ""
    site_id: Optional[str] = None

    diameter_mm: Optional[float] = None
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
    x: Optional[float] = None
    y: Optional[float] = None
    x_ui: Optional[float] = None
    y_ui: Optional[float] = None

    extras: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _reject_legacy_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            for key in ("lat", "lon", "sdr_ouvrage"):
                if key in data:
                    raise ValueError(f"{key} field is not supported")
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
    created_at: Optional[str] = None

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
            created = data.get("created_at")
            if not created:
                raise ValueError("created_at required")
            data["created_at"] = str(created).strip()
        except Exception:
            return data
        return data

    @model_validator(mode="after")
    def _ensure_length_from_geometry(cls, edge: "Edge") -> "Edge":
        try:
            if edge.length_m in (None, "", 0):
                computed = _compute_length_from_geometry(edge.geometry)
                if computed is not None:
                    edge.length_m = computed
        except Exception:
            pass
        return edge


class Graph(BaseModel):
    model_config = ConfigDict(extra="allow")
    # Métadonnées v1.5
    version: str = "1.5"
    site_id: Optional[str] = None
    generated_at: Optional[str] = None
    style_meta: Dict[str, Any] = Field(default_factory=dict)
    crs: CRSInfo = Field(default_factory=CRSInfo)
    branches: List[BranchInfo] = Field(default_factory=list)

    nodes: List[Node] = Field(default_factory=list)
    edges: List[Edge] = Field(default_factory=list)
