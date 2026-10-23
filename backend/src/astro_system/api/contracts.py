"""Versioned HTTP contracts for the native scientific service."""
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, BeforeValidator, ConfigDict, Field, StrictBool, StrictInt, field_validator, model_validator


def _schema_version_one(value: object) -> int:
    # Literal[1] alone accepts True/1.0 by equality; wire JSON must be an integer.
    if type(value) is not int or value != 1:
        raise ValueError("schema_version must be the integer 1")
    return value


SchemaVersionOne = Annotated[Literal[1], BeforeValidator(_schema_version_one)]


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ScienceResponseMeta(BaseModel):
    request_id: str
    generated_at_utc: str
    service: Literal["native", "edge"]
    software_version: str
    capability: str


class ObserverInput(StrictInput):
    latitude_deg: float = Field(ge=-90, le=90)
    longitude_deg: float = Field(ge=-180, le=180)
    elevation_m: float = Field(default=0, ge=-500, le=10_000)
    utc: str = Field(min_length=1, max_length=64)


class EclipseInput(ObserverInput):
    search_hours: float = Field(default=18.0, ge=1, le=36)


class ConstellationObserverInput(ObserverInput):
    constellation: str = Field(min_length=3, max_length=3)
    max_g_magnitude: float = Field(default=5.5, ge=-2, le=6.5)


class SimulationInput(StrictInput):
    utc: str = Field(default="2026-08-05T00:00:00Z", min_length=1, max_length=64)
    bodies: list[str] = Field(default_factory=lambda: ["Sun", "Earth"], min_length=2, max_length=10)
    integrator: Literal["velocity-verlet"] = "velocity-verlet"
    duration_s: float = Field(default=86_400.0, ge=-31_536_000.0, le=31_536_000.0)
    step_s: float = Field(default=3_600.0, gt=0.0, le=86_400.0)

    @field_validator("duration_s")
    @classmethod
    def duration_cannot_be_zero(cls, value: float) -> float:
        if value == 0:
            raise ValueError("duration_s must not be zero")
        return value

    @field_validator("bodies")
    @classmethod
    def body_names_are_bounded(cls, value: list[str]) -> list[str]:
        if any(not name or len(name) > 32 for name in value):
            raise ValueError("body names must contain between 1 and 32 characters")
        return value


class ErrorBody(BaseModel):
    code: str
    message: str
    capability: str | None = None
    request_id: str
    details: dict[str, object] | None = None
    valid_utc_from: str | None = None
    valid_utc_until: str | None = None


class ScienceErrorEnvelope(BaseModel):
    schema_version: SchemaVersionOne
    error: ErrorBody


class GenericScienceResponse(BaseModel):
    """Response model used where the scientific payload is endpoint-specific.

    Required version/meta fields are validated while documented legacy fields
    stay at the top level during the migration.
    """

    model_config = ConfigDict(extra="allow", allow_inf_nan=False)
    schema_version: SchemaVersionOne
    meta: ScienceResponseMeta


# The private orbital gateway validates these models without reserializing them.
# Extensions are preserved, but the scientific fields consumed by the public
# client are mandatory and cannot be coerced from strings, booleans or NaN.
FiniteNumber = Annotated[float, Field(strict=True, allow_inf_nan=False)]
PositiveNumber = Annotated[FiniteNumber, Field(gt=0)]
NonEmptyText = Annotated[str, Field(strict=True, min_length=1, pattern=r"\S")]
Vector3 = Annotated[list[FiniteNumber], Field(min_length=3, max_length=3)]
Count = Annotated[StrictInt, Field(ge=0)]


def _valid_utc(value: str) -> str:
    # Use the same leap-second-aware syntax as the scientific implementation.
    from ..ephemeris.time_conversion import epoch_metadata
    epoch_metadata(value)
    return value


ScientificUtc = Annotated[NonEmptyText, AfterValidator(_valid_utc)]


class OrbitalPayload(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True, allow_inf_nan=False)


class OrbitalResponseMeta(OrbitalPayload):
    request_id: NonEmptyText
    generated_at_utc: NonEmptyText
    service: Literal["native"]
    software_version: NonEmptyText
    capability: NonEmptyText

    @field_validator("generated_at_utc")
    @classmethod
    def timestamp_has_timezone(cls, value: str) -> str:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if timestamp.tzinfo is None or timestamp.utcoffset() is None:
            raise ValueError("Response timestamp must identify its timezone")
        return value


class OrbitalResponse(OrbitalPayload):
    schema_version: SchemaVersionOne
    meta: OrbitalResponseMeta


class CapabilityState(OrbitalPayload):
    available: StrictBool
    status: Literal["available", "unavailable", "configured-unverified", "degraded"]

    @model_validator(mode="after")
    def availability_matches_status(self):
        if self.available and self.status not in {"available", "degraded"}:
            raise ValueError("Available capability has an unavailable status")
        if not self.available and self.status == "available":
            raise ValueError("Unavailable capability has an available status")
        return self


class ReferenceCapability(CapabilityState):
    mode: Literal["dynamic-de442s", "fixed-snapshot", "unavailable"]

    @model_validator(mode="after")
    def availability_matches_mode(self):
        if self.available == (self.mode == "unavailable"):
            raise ValueError("Reference mode disagrees with availability")
        return self


class CalculationCapability(CapabilityState):
    canonical_method: Literal["POST"]
    requires_valid_iers_for_requested_epoch: StrictBool | None = None


class CatalogueCapability(OrbitalPayload):
    available: StrictBool
    moons: StrictBool
    stars: StrictBool
    constellations: StrictBool

    @model_validator(mode="after")
    def complete_catalogue_availability(self):
        if self.available != all((self.moons, self.stars, self.constellations)):
            raise ValueError("Aggregate catalogue availability is inconsistent")
        return self


class CapabilitiesMap(OrbitalPayload):
    reference_state: ReferenceCapability
    catalogs: CatalogueCapability
    sky: CalculationCapability
    sky_constellations: CalculationCapability
    eclipses_local: CalculationCapability
    simulate: CalculationCapability

    @model_validator(mode="after")
    def observatory_requires_sky(self):
        if self.sky_constellations.available and not self.sky.available:
            raise ValueError("Constellation observatory requires the sky capability")
        return self


class SnapshotAvailability(OrbitalPayload):
    available: StrictBool
    fixed_epoch: StrictBool
    epoch_utc: ScientificUtc | None = None
    source: NonEmptyText | None = None

    @model_validator(mode="after")
    def available_snapshot_has_provenance(self):
        if self.available and (not self.fixed_epoch or not self.epoch_utc or not self.source):
            raise ValueError("Available snapshot requires a fixed epoch and provenance")
        return self


class ReferenceLimits(OrbitalPayload):
    valid_utc_from: ScientificUtc | None = None
    valid_utc_until: ScientificUtc | None = None


class SimulationLimits(OrbitalPayload):
    max_bodies: Annotated[StrictInt, Field(ge=2)]
    max_steps: Annotated[StrictInt, Field(ge=1)]
    max_duration_s: PositiveNumber
    max_step_s: PositiveNumber


class CapabilitiesLimits(OrbitalPayload):
    reference_state: ReferenceLimits | None = None
    simulate: SimulationLimits | None = None
    request_body_bytes: Annotated[StrictInt, Field(ge=1)]


class OrbitalCapabilitiesResponse(OrbitalResponse):
    snapshot: SnapshotAvailability
    capabilities: CapabilitiesMap
    limits: CapabilitiesLimits

    @model_validator(mode="after")
    def available_capabilities_have_limits(self):
        reference = self.capabilities.reference_state
        if reference.available and reference.mode == "dynamic-de442s":
            coverage = self.limits.reference_state
            if coverage is None or coverage.valid_utc_from is None or coverage.valid_utc_until is None:
                raise ValueError("Dynamic reference capability requires coverage")
            from astropy.time import Time
            if Time(coverage.valid_utc_from, scale="utc") >= Time(coverage.valid_utc_until, scale="utc"):
                raise ValueError("Reference coverage is empty or reversed")
        if reference.available and reference.mode == "fixed-snapshot" and not self.snapshot.available:
            raise ValueError("Fixed reference capability requires an available snapshot")
        if self.capabilities.simulate.available and self.limits.simulate is None:
            raise ValueError("Available simulation requires execution limits")
        return self


class PhysicalStateBody(OrbitalPayload):
    name: NonEmptyText
    naif_id: StrictInt
    mu_m3_s2: PositiveNumber
    position_m: Vector3
    velocity_m_s: Vector3
    state_target_naif_id: StrictInt
    state_kind: Literal["physical-center", "system-barycenter"]


class ReferenceBody(PhysicalStateBody):
    body_naif_id: StrictInt
    state_center_naif_id: Annotated[StrictInt, Field(ge=0, le=0)]
    state_target_name: NonEmptyText
    radius_m: PositiveNumber
    color: NonEmptyText


class ReferenceEpoch(OrbitalPayload):
    input_utc: ScientificUtc
    canonical_utc: ScientificUtc
    ephemeris_time_et_s: FiniteNumber
    state_time_scale: Literal["TDB/ET"]
    utc_to_tdb_provider: NonEmptyText
    utc_policy: NonEmptyText


class ReferenceCoverage(OrbitalPayload):
    valid_utc_from: ScientificUtc
    valid_utc_until: ScientificUtc


class OrbitalReferenceResponse(OrbitalResponse):
    epoch: ScientificUtc
    epoch_metadata: ReferenceEpoch
    frame: Literal["J2000"]
    center: Literal["Solar System Barycenter"]
    time_scale: Literal["TDB/ET"]
    source: NonEmptyText
    origin: NonEmptyText
    provider: NonEmptyText
    coverage: ReferenceCoverage
    bodies: Annotated[list[ReferenceBody], Field(min_length=1)]

    @model_validator(mode="after")
    def canonical_epoch_matches(self):
        if self.epoch != self.epoch_metadata.canonical_utc:
            raise ValueError("Reference epoch metadata is inconsistent")
        return self


class SimulationBody(PhysicalStateBody):
    source_initial_state: NonEmptyText


class SimulationState(OrbitalPayload):
    epoch_utc: ScientificUtc
    frame: Literal["J2000"]
    center: Literal["Solar System Barycenter"]
    bodies: Annotated[list[SimulationBody], Field(min_length=2, max_length=10)]


class SimulationExecution(OrbitalPayload):
    steps: Annotated[StrictInt, Field(ge=1, le=20_000)]
    integrated_duration_s: FiniteNumber
    computation_ms: Annotated[FiniteNumber, Field(ge=0)]
    fixed_step_s: PositiveNumber


class ConservationMetrics(OrbitalPayload):
    kinetic_j: FiniteNumber
    potential_j: FiniteNumber
    total_j: FiniteNumber
    linear_momentum: Vector3
    angular_momentum: Vector3
    barycenter_m: Vector3


class ConservationDrift(OrbitalPayload):
    energy_relative: FiniteNumber | None
    linear_momentum_delta: FiniteNumber
    angular_momentum_delta: FiniteNumber
    barycenter_displacement_m: FiniteNumber


class SimulationMetrics(OrbitalPayload):
    initial: ConservationMetrics
    final: ConservationMetrics
    drift: ConservationDrift


class SimulationModel(OrbitalPayload):
    gravity: Literal["Newtonian point masses"]
    excluded_effects: list[NonEmptyText]


class OrbitalSimulationInput(SimulationInput):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class OrbitalSimulationResponse(OrbitalResponse):
    input: OrbitalSimulationInput
    execution: SimulationExecution
    state: SimulationState
    metrics: SimulationMetrics
    model: SimulationModel
    limitations: Annotated[list[NonEmptyText], Field(min_length=1)]

    @model_validator(mode="after")
    def fixed_step_execution_matches(self):
        execution = self.execution
        expected = execution.steps * execution.fixed_step_s
        if self.input.duration_s < 0:
            expected = -expected
        if execution.integrated_duration_s != expected or execution.fixed_step_s != self.input.step_s:
            raise ValueError("Simulation execution is inconsistent")
        return self


class OrbitalCatalogueResponse(OrbitalResponse):
    total: Count
    returned: Count
    offset: Count
    limit: Annotated[StrictInt, Field(ge=1)]

    @model_validator(mode="after")
    def pagination_matches(self):
        expected = min(self.limit, max(0, self.total - self.offset))
        if self.returned != len(self.items) or self.returned != expected:
            raise ValueError("Catalogue pagination is inconsistent")
        return self


class MoonOrbit(OrbitalPayload):
    a_m: PositiveNumber | None = None
    e: Annotated[FiniteNumber, Field(ge=0)] | None = None
    period_days: PositiveNumber | None = None
    epoch_tdb: NonEmptyText | None = None
    frame: NonEmptyText | None = None


class MoonRecord(OrbitalPayload):
    name: NonEmptyText
    designation: NonEmptyText | None
    primary: NonEmptyText
    naif_id: StrictInt | None
    mean_radius_m: PositiveNumber | None
    # Preserve published catalogue metadata (including zero-valued entries);
    # unlike a dynamical state, these values are never propagated here.
    mu_m3_s2: Annotated[FiniteNumber, Field(ge=0)] | None
    propagation_mode: Literal["mean_elements_catalog_only"]
    status: NonEmptyText
    source: NonEmptyText
    orbit: MoonOrbit | None = None

    @model_validator(mode="after")
    def no_catalogue_state(self):
        if {"position_m", "velocity_m_s"} & (self.model_extra or {}).keys():
            raise ValueError("Mean elements are not a positioned moon state")
        return self


class OrbitalMoonCatalogue(OrbitalCatalogueResponse):
    items: list[MoonRecord]
    counts: dict[NonEmptyText, Count]
    source: NonEmptyText | Annotated[list[NonEmptyText], Field(min_length=1)]
    provenance: NonEmptyText
    propagation_notice: NonEmptyText


class StarRecord(OrbitalPayload):
    gaia_dr3_source_id: NonEmptyText
    ra_deg: Annotated[FiniteNumber, Field(ge=0, lt=360)]
    dec_deg: Annotated[FiniteNumber, Field(ge=-90, le=90)]
    g_mag: FiniteNumber | None
    epoch: NonEmptyText
    source: NonEmptyText


class OrbitalStarCatalogue(OrbitalCatalogueResponse):
    items: list[StarRecord]
    catalogue_count: Count
    source: NonEmptyText
    provenance: NonEmptyText


class ConstellationRecord(OrbitalPayload):
    iau_abbreviation: Annotated[NonEmptyText, Field(min_length=3, max_length=3)]
    name: NonEmptyText
    aliases: list[NonEmptyText]
    boundary_source: NonEmptyText
    cultural_lines: NonEmptyText


class OrbitalConstellationCatalogue(OrbitalCatalogueResponse):
    items: list[ConstellationRecord]
    count: Literal[88]
    abbreviations: Annotated[list[NonEmptyText], Field(min_length=88, max_length=88)]
    source: NonEmptyText
    catalogue_epoch: NonEmptyText
    boundary_note: NonEmptyText
    boundary_representation: NonEmptyText
    limitations: list[NonEmptyText]
