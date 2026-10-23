export type JsonObject = Record<string, unknown>;
export type Vector3 = [number, number, number];

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ScienceCapability = "reference_state" | "catalogs" | "sky" | "eclipses_local" | "simulate";
export type CapabilityStatus = "available" | "unavailable" | "configured-unverified" | "degraded";

export type ScienceResponseMeta = {
  request_id: string;
  generated_at_utc: string;
  service: "edge" | "native";
  software_version: string;
  capability: string;
};

export type VersionedScienceResponse = { schema_version: 1; meta: ScienceResponseMeta };

export type ScienceErrorEnvelope = {
  schema_version: 1;
  error: {
    code: string;
    message: string;
    capability?: ScienceCapability;
    request_id: string;
    details?: Record<string, unknown>;
    valid_utc_from?: string;
    valid_utc_until?: string;
  };
};

/** Shared, display-safe provenance. Never include internal bindings or local URLs. */
export type DataSource = { id: string; name: string; url?: string; license?: string; retrievedAtUtc?: string };
export type DataProvenance = { source: DataSource; dataset?: string; version?: string; epochUtc?: string; referenceFrame?: string; timeScale?: string; validFromUtc?: string; validUntilUtc?: string; generatedAtUtc?: string; limitations?: string[] };

export type ScienceResource<T> =
  | { status: "idle" }
  | { status: "loading"; previous?: T }
  | { status: "ready"; data: T }
  | { status: "empty"; message: string }
  | { status: "unavailable"; capability: ScienceCapability; message: string; previous?: T }
  | { status: "out-of-range"; message: string; validFromUtc?: string; validUntilUtc?: string; previous?: T }
  | { status: "validation-error"; message: string; previous?: T }
  | { status: "network-error"; message: string; previous?: T }
  | { status: "server-error"; message: string; requestId?: string; previous?: T }
  | { status: "contract-error"; message: string; requestId?: string; previous?: T };

export type StateTarget = {
  body_naif_id: number;
  state_target_naif_id: number;
  state_center_naif_id: number;
  state_kind: "physical-center" | "system-barycenter";
  state_target_name: string;
};

export type SnapshotBody = StateTarget & {
  name: string;
  naif_id: number;
  mu_m3_s2: number;
  radius_m: number;
  color: string;
  position_m: Vector3;
  velocity_m_s: Vector3;
  center_note?: string;
};

export type ReferenceSnapshot = VersionedScienceResponse & {
  epoch: string;
  epoch_metadata?: { input_utc: string; canonical_utc: string; ephemeris_time_et_s: number; state_time_scale: "TDB/ET" };
  frame: string;
  center?: string;
  time_scale: string;
  source: string;
  fixed_epoch?: boolean;
  coverage?: { valid_utc_from?: string; valid_utc_until?: string };
  bodies: SnapshotBody[];
};

export type MoonRecord = {
  name: string;
  designation: string | null;
  primary: string;
  naif_id: number | null;
  mean_radius_m: number | null;
  mu_m3_s2: number | null;
  propagation_mode: string;
  status: string;
  source: string;
  orbit?: { a_m?: number | null; e?: number | null; period_days?: number | null; epoch_tdb?: string | null; frame?: string | null };
};

export type MoonCatalogue = VersionedScienceResponse & {
  items: MoonRecord[];
  total: number;
  returned: number;
  offset: number;
  limit: number;
  counts: Record<string, number>;
  source: string | string[];
  provenance: string;
  propagation_notice: string;
};

export type StarRecord = { gaia_dr3_source_id: string; ra_deg: number; dec_deg: number; g_mag: number | null; epoch?: string; [key: string]: unknown };
export type StarCatalogue = VersionedScienceResponse & { catalogue_count: number; total: number; returned: number; offset: number; limit: number; source: string; provenance: string; items: StarRecord[] };

export type IersStatus = { mode: "offline"; source: string; status: "ok" | "degraded" | "out-of-range"; valid_from_utc?: string; valid_until_utc?: string; warning?: string };
export type ObserverInput = { latitude_deg: number; longitude_deg: number; elevation_m: number; utc: string };

export type SkyObject = {
  name: string;
  altitude_deg: number;
  azimuth_deg: number;
  above_geometric_horizon: boolean;
  above_horizon?: boolean;
  constellation?: string;
};

export type SkyResponse = VersionedScienceResponse & {
  input: ObserverInput;
  input_scale: "UTC";
  coordinate_pipeline: string[];
  frame: string;
  refraction: { enabled: false; pressure_hpa: 0 };
  ephemeris: { provider: string; is_de442s_reference_state: false };
  iers: IersStatus;
  twilight: { classification: "day" | "civil" | "nautical" | "astronomical" | "night"; solar_altitude_deg: number };
  objects: SkyObject[];
  limitations: string[];
};

export type EclipseContact = { kind: "C1" | "C2" | "MAX" | "C3" | "C4"; utc: string; sun_altitude_deg?: number; sun_azimuth_deg?: number; sun_above_geometric_horizon?: boolean };
export type EclipseInput = ObserverInput & { search_hours?: number };
export type LocalEclipseResponse = VersionedScienceResponse & {
  input: EclipseInput;
  event_found: boolean;
  search_window: { half_width_hours: number; start_utc: string; end_utc: string; truncated: boolean };
  classification: "none" | "partial" | "total" | "annular";
  maximum_utc: string;
  contacts: EclipseContact[];
  contacts_utc?: string[];
  external_contacts_utc?: string[];
  internal_contacts_utc?: string[];
  obscuration_area_fraction: number;
  solar_altitude_at_maximum_deg: number;
  solar_azimuth_at_maximum_deg: number;
  sun_above_geometric_horizon_at_maximum: boolean;
  method: string;
  precision_warning: string;
  limitations: string[];
};

export type SimulationInput = { utc: string; bodies: string[]; integrator?: "velocity-verlet"; duration_s: number; step_s: number };
export type SimulationResponse = VersionedScienceResponse & {
  input: Required<SimulationInput>;
  execution: { steps: number; integrated_duration_s: number; computation_ms: number; fixed_step_s: number };
  state: { epoch_utc: string; frame: string; center: string; bodies: Array<{ name: string; naif_id: number; mu_m3_s2: number; position_m: Vector3; velocity_m_s: Vector3; source_initial_state: string; state_target_naif_id: number; state_kind: "physical-center" | "system-barycenter" }> };
  metrics: { initial: Record<string, unknown>; final: Record<string, unknown>; drift: Record<string, number | null> };
  model: { gravity: "Newtonian point masses"; excluded_effects: string[] };
  limitations: string[];
};

export type ScienceCapabilities = VersionedScienceResponse & {
  snapshot: { available: boolean; fixed_epoch: boolean; epoch_utc?: string; source?: string };
  capabilities: {
    reference_state: { available: boolean; status: CapabilityStatus; mode: "dynamic-de442s" | "fixed-snapshot" | "unavailable" };
    catalogs: { available: boolean; moons: boolean; stars: boolean; constellations: boolean };
    sky: { available: boolean; status: CapabilityStatus; canonical_method: "POST" };
    eclipses_local: { available: boolean; status: CapabilityStatus; canonical_method: "POST" };
    simulate: { available: boolean; status: CapabilityStatus; canonical_method: "POST" };
  };
  limits: {
    reference_state?: { valid_utc_from?: string; valid_utc_until?: string };
    simulate?: { max_bodies: number; max_steps: number; max_duration_s: number; max_step_s: number };
    request_body_bytes: number;
  };
};

export type ConstellationGuide = {
  iau_abbreviation: string;
  name: string;
  aliases?: string[];
  representative_icrs_j2000?: { ra_deg: number; dec_deg: number };
  representative_note?: string;
  gaia_subset_count?: number;
  history?: { status: "available" | "unavailable"; message?: string; [key: string]: unknown };
  notable_stars?: unknown[];
  [key: string]: unknown;
};

export type ConstellationCatalogue = VersionedScienceResponse & {
  items: ConstellationGuide[];
  total: number;
  returned: number;
  count: number;
  offset: number;
  limit: number;
  abbreviations: string[];
  source: string;
  catalogue_epoch?: string;
  boundary_note: string;
  boundary_representation: string;
  limitations?: string[];
};

export type ConstellationSkyStar = { gaia_dr3_source_id: string; g_mag: number; ra_deg: number; dec_deg: number; epoch: string; source: string; iau_abbreviation: string; altitude_deg: number; azimuth_deg: number; above_horizon: boolean };
export type ConstellationSkyBoundary = { start: { altitude_deg: number; azimuth_deg: number }; end: { altitude_deg: number; azimuth_deg: number }; constellations: string[] };

export type ConstellationSkyResponse = VersionedScienceResponse & {
  input: ObserverInput;
  method: string;
  frame: string;
  catalogue_epoch: string;
  refraction: string;
  iers_warning: string;
  twilight: string;
  sun: { altitude_deg: number; azimuth_deg: number; above_horizon: boolean };
  now_observing?: Array<{ iau_abbreviation: string; name: string; bright_stars_above_horizon: number; highest_bright_star_altitude_deg: number; criterion: string; light_condition: string }>;
  constellation: ConstellationGuide;
  max_g_mag: number;
  stars: ConstellationSkyStar[];
  boundaries: ConstellationSkyBoundary[];
  named_stars: { status?: string; source?: string; items: unknown[] };
  limitations: string[];
  selected?: { iau_abbreviation: string; representative_point: { altitude_deg: number; azimuth_deg: number; above_horizon: boolean }; boundary_visibility: "below-horizon" | "partially-above-horizon" | "fully-above-horizon"; bright_stars_above_horizon: number };
  planning?: { method: string; current_utc_day: ConstellationVisibilityWindow; monthly: Array<ConstellationVisibilityWindow & { month: number }>; limitations: string[] };
};

export type ConstellationVisibilityWindow = { reference_utc_day: string; cadence_minutes: number; astronomical_night: boolean; circumpolar_state: "circumpolar" | "never-rises" | "rises-and-sets"; rises_in_window: boolean; sets_in_window: boolean; classification: "unavailable" | "low" | "reasonable" | "favorable"; reason?: string; maximum_altitude_deg?: number; best_utc?: string; bright_stars_above_horizon?: number; criterion?: string };
