"""Standard data model for the Visualisation & Interprétation module."""
from __future__ import annotations

from enum import Enum
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class Status(str, Enum):
    ok = "ok"
    alert = "alert"
    maintenance = "maintenance"
    unknown = "unknown"


class GlyphState(BaseModel):
    color: Optional[str] = Field(default=None, description="Design token for the point color")
    size: Optional[float] = Field(default=None, description="Relative glyph size (e.g. radius in px)")
    status: Optional[Status] = Field(default=None, description="Operational status")


class GeoLocation(BaseModel):
    lat: float
    lon: float


class SiteKpi(BaseModel):
    label: str
    value: float
    unit: Optional[str] = None


class Site(BaseModel):
    site_id: str = Field(..., alias="siteId")
    name: str
    location: GeoLocation
    status: Status = Status.unknown
    kpis: List[SiteKpi] = Field(default_factory=list)
    metadata: Dict[str, str] = Field(default_factory=dict)

    class Config:
        allow_population_by_field_name = True


class Branch(BaseModel):
    branch_id: str = Field(..., alias="branchId")
    site_id: str = Field(..., alias="siteId")
    name: Optional[str] = None
    path: List[GeoLocation] = Field(default_factory=list)
    metrics: Dict[str, float] = Field(default_factory=dict)

    class Config:
        allow_population_by_field_name = True


class PointType(str, Enum):
    well = "well"
    valve = "valve"
    junction = "junction"
    drain = "drain"
    collector = "collector"
    sensor = "sensor"


class NetworkPoint(BaseModel):
    point_id: str = Field(..., alias="pointId")
    site_id: str = Field(..., alias="siteId")
    branch_id: Optional[str] = Field(default=None, alias="branchId")
    name: Optional[str] = None
    type: PointType
    location: GeoLocation
    glyph: GlyphState = Field(default_factory=GlyphState)
    metrics: Dict[str, float] = Field(default_factory=dict)
    metadata: Dict[str, str] = Field(default_factory=dict)

    class Config:
        allow_population_by_field_name = True


class SeriesPoint(BaseModel):
    ts: str
    value: Optional[float] = None
    quality: Optional[str] = None


class AxisDescriptor(BaseModel):
    axis_id: str = Field(..., alias="axisId")
    label: str
    unit: str
    side: Literal["left", "right"] = "left"
    range: Optional[List[float]] = None

    class Config:
        allow_population_by_field_name = True


class MetricSeries(BaseModel):
    metric: str
    display_name: Optional[str] = Field(default=None, alias="displayName")
    unit: str
    unit_display_default: Optional[str] = Field(default=None, alias="unitDisplayDefault")
    axis: Optional[str] = None
    points: List[SeriesPoint] = Field(default_factory=list)

    class Config:
        allow_population_by_field_name = True


class TimeSeriesBundle(BaseModel):
    site_id: str = Field(..., alias="siteId")
    point_id: Optional[str] = Field(default=None, alias="pointId")
    branch_id: Optional[str] = Field(default=None, alias="branchId")
    tz: Optional[str] = None
    unit_preference: Optional[str] = Field(default=None, alias="unitPreference")
    period_from: Optional[str] = Field(default=None, alias="from")
    period_to: Optional[str] = Field(default=None, alias="to")
    axes: List[AxisDescriptor] = Field(default_factory=list)
    series: List[MetricSeries] = Field(default_factory=list)

    class Config:
        allow_population_by_field_name = True


class Event(BaseModel):
    event_id: str = Field(..., alias="eventId")
    type: str
    ts: str
    site_id: str = Field(..., alias="siteId")
    point_id: Optional[str] = Field(default=None, alias="pointId")
    branch_id: Optional[str] = Field(default=None, alias="branchId")
    metadata: Dict[str, str] = Field(default_factory=dict)

    class Config:
        allow_population_by_field_name = True


class QualityFlag(BaseModel):
    flag_id: str = Field(..., alias="flagId")
    site_id: str = Field(..., alias="siteId")
    point_id: str = Field(..., alias="pointId")
    rule_id: str
    evidence: Optional[str] = None
    confidence: Optional[float] = None

    class Config:
        allow_population_by_field_name = True


class VisualisationDataset(BaseModel):
    sites: List[Site] = Field(default_factory=list)
    branches: List[Branch] = Field(default_factory=list)
    points: List[NetworkPoint] = Field(default_factory=list)
    timeseries: List[TimeSeriesBundle] = Field(default_factory=list)
    events: List[Event] = Field(default_factory=list)
    quality_flags: List[QualityFlag] = Field(default_factory=list, alias="qualityFlags")

    class Config:
        allow_population_by_field_name = True
