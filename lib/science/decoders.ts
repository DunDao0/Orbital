import type {
  ConstellationCatalogue,
  ConstellationSkyResponse,
  EclipseContact,
  LocalEclipseResponse,
  MoonCatalogue,
  MoonRecord,
  ReferenceSnapshot,
  ScienceCapabilities,
  ScienceErrorEnvelope,
  ScienceResponseMeta,
  SimulationResponse,
  SkyObject,
  SkyResponse,
  SnapshotBody,
  StarCatalogue,
  StarRecord,
  Vector3,
} from "./contracts.ts";
import { isJsonObject } from "./contracts.ts";

export class ContractDecodeError extends Error {
  constructor(message = "A resposta científica não corresponde ao contrato desta versão.") {
    super(message);
    this.name = "ContractDecodeError";
  }
}

function fail(): never { throw new ContractDecodeError(); }
function object(value: unknown): Record<string, unknown> { return isJsonObject(value) ? value : fail(); }
function string(value: unknown): string { return typeof value === "string" ? value : fail(); }
function boolean(value: unknown): boolean { return typeof value === "boolean" ? value : fail(); }
function finite(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : fail(); }
function integer(value: unknown): number { const result = finite(value); return Number.isInteger(result) && result >= 0 ? result : fail(); }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : fail(); }
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : string(value); }

function vector3(value: unknown): Vector3 {
  const values = array(value);
  if (values.length !== 3) fail();
  return [finite(values[0]), finite(values[1]), finite(values[2])];
}

function meta(value: unknown): ScienceResponseMeta {
  const raw = object(value);
  const service = string(raw.service);
  if (service !== "edge" && service !== "native") fail();
  return { request_id: string(raw.request_id), generated_at_utc: string(raw.generated_at_utc), service, software_version: string(raw.software_version), capability: string(raw.capability) };
}

function versioned(value: unknown): { raw: Record<string, unknown>; meta: ScienceResponseMeta } {
  const raw = object(value);
  if (raw.schema_version !== 1) fail();
  return { raw, meta: meta(raw.meta) };
}

function snapshotBody(value: unknown): SnapshotBody {
  const raw = object(value);
  const stateKind = string(raw.state_kind);
  if (stateKind !== "physical-center" && stateKind !== "system-barycenter") fail();
  return {
    name: string(raw.name),
    naif_id: finite(raw.naif_id),
    body_naif_id: finite(raw.body_naif_id),
    state_target_naif_id: finite(raw.state_target_naif_id),
    state_center_naif_id: finite(raw.state_center_naif_id),
    state_kind: stateKind,
    state_target_name: string(raw.state_target_name),
    mu_m3_s2: finite(raw.mu_m3_s2),
    radius_m: finite(raw.radius_m),
    color: string(raw.color),
    position_m: vector3(raw.position_m),
    velocity_m_s: vector3(raw.velocity_m_s),
    center_note: optionalString(raw.center_note),
  };
}

export function decodeReferenceSnapshot(value: unknown): ReferenceSnapshot {
  const { raw, meta: responseMeta } = versioned(value);
  const fixedEpoch = raw.fixed_epoch === undefined ? undefined : boolean(raw.fixed_epoch);
  const coverageRaw = raw.coverage === undefined ? undefined : object(raw.coverage);
  const epochRaw = raw.epoch_metadata === undefined ? undefined : object(raw.epoch_metadata);
  if (epochRaw && epochRaw.state_time_scale !== "TDB/ET") fail();
  return {
    schema_version: 1,
    meta: responseMeta,
    epoch: string(raw.epoch),
    frame: string(raw.frame),
    center: optionalString(raw.center),
    time_scale: string(raw.time_scale),
    source: string(raw.source),
    fixed_epoch: fixedEpoch,
    epoch_metadata: epochRaw ? { input_utc: string(epochRaw.input_utc), canonical_utc: string(epochRaw.canonical_utc), ephemeris_time_et_s: finite(epochRaw.ephemeris_time_et_s), state_time_scale: "TDB/ET" } : undefined,
    coverage: coverageRaw ? { valid_utc_from: optionalString(coverageRaw.valid_utc_from), valid_utc_until: optionalString(coverageRaw.valid_utc_until) } : undefined,
    bodies: array(raw.bodies).map(snapshotBody),
  };
}

function moonRecord(value: unknown): MoonRecord {
  const raw = object(value);
  const nullableNumber = (item: unknown) => item === null || item === undefined ? null : finite(item);
  const orbitRaw = raw.orbit === null || raw.orbit === undefined ? undefined : object(raw.orbit);
  const orbit = orbitRaw ? {
    a_m: orbitRaw.a_m === undefined ? undefined : nullableNumber(orbitRaw.a_m),
    e: orbitRaw.e === undefined ? undefined : nullableNumber(orbitRaw.e),
    period_days: orbitRaw.period_days === undefined ? undefined : nullableNumber(orbitRaw.period_days),
    epoch_tdb: orbitRaw.epoch_tdb === undefined ? undefined : orbitRaw.epoch_tdb === null ? null : string(orbitRaw.epoch_tdb),
    frame: orbitRaw.frame === undefined ? undefined : orbitRaw.frame === null ? null : string(orbitRaw.frame),
  } : undefined;
  return {
    name: string(raw.name), designation: raw.designation === null ? null : string(raw.designation), primary: string(raw.primary),
    naif_id: nullableNumber(raw.naif_id), mean_radius_m: nullableNumber(raw.mean_radius_m), mu_m3_s2: nullableNumber(raw.mu_m3_s2),
    propagation_mode: string(raw.propagation_mode), status: string(raw.status), source: string(raw.source),
    orbit,
  };
}

export function decodeMoonCatalogue(value: unknown): MoonCatalogue {
  const { raw, meta: responseMeta } = versioned(value);
  const countsRaw = object(raw.counts);
  const counts = Object.fromEntries(Object.entries(countsRaw).map(([key, item]) => [key, integer(item)]));
  const sourceValue = raw.source;
  const source = Array.isArray(sourceValue) ? sourceValue.map(string) : string(sourceValue);
  return { schema_version: 1, meta: responseMeta, items: array(raw.items).map(moonRecord), total: integer(raw.total), returned: integer(raw.returned), offset: integer(raw.offset), limit: integer(raw.limit), counts, source, provenance: string(raw.provenance), propagation_notice: string(raw.propagation_notice) };
}

function starRecord(value: unknown): StarRecord {
  const raw = object(value);
  return { ...raw, gaia_dr3_source_id: string(raw.gaia_dr3_source_id), ra_deg: finite(raw.ra_deg), dec_deg: finite(raw.dec_deg), g_mag: raw.g_mag === null ? null : finite(raw.g_mag), epoch: optionalString(raw.epoch) };
}

export function decodeStarCatalogue(value: unknown): StarCatalogue {
  const { raw, meta: responseMeta } = versioned(value);
  return { schema_version: 1, meta: responseMeta, catalogue_count: integer(raw.catalogue_count), total: integer(raw.total), returned: integer(raw.returned), offset: integer(raw.offset), limit: integer(raw.limit), source: string(raw.source), provenance: string(raw.provenance), items: array(raw.items).map(starRecord) };
}

export function decodeConstellationCatalogue(value: unknown): ConstellationCatalogue {
  const { raw, meta: responseMeta } = versioned(value);
  const items = array(raw.items).map((item) => {
    const guide = object(item);
    string(guide.iau_abbreviation); string(guide.name);
    if (guide.aliases !== undefined) array(guide.aliases).forEach(string);
    return guide as ConstellationCatalogue["items"][number];
  });
  return { schema_version: 1, meta: responseMeta, items, total: integer(raw.total), returned: integer(raw.returned), count: integer(raw.count), offset: integer(raw.offset), limit: integer(raw.limit), abbreviations: array(raw.abbreviations).map(string), source: string(raw.source), catalogue_epoch: optionalString(raw.catalogue_epoch), boundary_note: string(raw.boundary_note), boundary_representation: string(raw.boundary_representation), limitations: raw.limitations === undefined ? undefined : array(raw.limitations).map(string) };
}

function skyObject(value: unknown): SkyObject {
  const raw = object(value);
  return { name: string(raw.name), altitude_deg: finite(raw.altitude_deg), azimuth_deg: finite(raw.azimuth_deg), above_geometric_horizon: boolean(raw.above_geometric_horizon), above_horizon: raw.above_horizon === undefined ? undefined : boolean(raw.above_horizon), constellation: optionalString(raw.constellation) };
}

export function decodeSkyResponse(value: unknown): SkyResponse {
  const { raw, meta: responseMeta } = versioned(value);
  const input = object(raw.input); const refraction = object(raw.refraction); const ephemeris = object(raw.ephemeris); const iers = object(raw.iers); const twilight = object(raw.twilight);
  if (refraction.enabled !== false || refraction.pressure_hpa !== 0 || ephemeris.is_de442s_reference_state !== false || iers.mode !== "offline") fail();
  const iersStatus = string(iers.status); if (!["ok", "degraded", "out-of-range"].includes(iersStatus)) fail();
  const twilightClass = string(twilight.classification); if (!["day", "civil", "nautical", "astronomical", "night"].includes(twilightClass)) fail();
  return {
    schema_version: 1, meta: responseMeta,
    input: { latitude_deg: finite(input.latitude_deg), longitude_deg: finite(input.longitude_deg), elevation_m: finite(input.elevation_m), utc: string(input.utc) },
    input_scale: raw.input_scale === "UTC" ? "UTC" : fail(), coordinate_pipeline: array(raw.coordinate_pipeline).map(string), frame: string(raw.frame),
    refraction: { enabled: false, pressure_hpa: 0 }, ephemeris: { provider: string(ephemeris.provider), is_de442s_reference_state: false },
    iers: { mode: "offline", source: string(iers.source), status: iersStatus as SkyResponse["iers"]["status"], valid_from_utc: optionalString(iers.valid_from_utc), valid_until_utc: optionalString(iers.valid_until_utc), warning: optionalString(iers.warning) },
    twilight: { classification: twilightClass as SkyResponse["twilight"]["classification"], solar_altitude_deg: finite(twilight.solar_altitude_deg) },
    objects: array(raw.objects).map(skyObject), limitations: array(raw.limitations).map(string),
  };
}

function eclipseContact(value: unknown): EclipseContact {
  const raw = object(value); const kind = string(raw.kind);
  if (!["C1", "C2", "MAX", "C3", "C4"].includes(kind)) fail();
  return { kind: kind as EclipseContact["kind"], utc: string(raw.utc), sun_altitude_deg: raw.sun_altitude_deg === undefined ? undefined : finite(raw.sun_altitude_deg), sun_azimuth_deg: raw.sun_azimuth_deg === undefined ? undefined : finite(raw.sun_azimuth_deg), sun_above_geometric_horizon: raw.sun_above_geometric_horizon === undefined ? undefined : boolean(raw.sun_above_geometric_horizon) };
}

export function decodeLocalEclipseResponse(value: unknown): LocalEclipseResponse {
  const { raw, meta: responseMeta } = versioned(value); const input = object(raw.input); const searchWindow = object(raw.search_window); const classification = string(raw.classification);
  if (!["none", "partial", "total", "annular"].includes(classification)) fail();
  const contacts = array(raw.contacts).map(eclipseContact);
  const expected = classification === "none" ? [] : classification === "partial" ? ["C1", "MAX", "C4"] : ["C1", "C2", "MAX", "C3", "C4"];
  if (!searchWindow.truncated && contacts.map((item) => item.kind).join(",") !== expected.join(",")) fail();
  return {
    schema_version: 1, meta: responseMeta,
    input: { latitude_deg: finite(input.latitude_deg), longitude_deg: finite(input.longitude_deg), elevation_m: finite(input.elevation_m), utc: string(input.utc), search_hours: finite(input.search_hours) },
    event_found: boolean(raw.event_found), search_window: { half_width_hours: finite(searchWindow.half_width_hours), start_utc: string(searchWindow.start_utc), end_utc: string(searchWindow.end_utc), truncated: boolean(searchWindow.truncated) },
    classification: classification as LocalEclipseResponse["classification"], maximum_utc: string(raw.maximum_utc), contacts,
    contacts_utc: raw.contacts_utc === undefined ? undefined : array(raw.contacts_utc).map(string), external_contacts_utc: raw.external_contacts_utc === undefined ? undefined : array(raw.external_contacts_utc).map(string), internal_contacts_utc: raw.internal_contacts_utc === undefined ? undefined : array(raw.internal_contacts_utc).map(string),
    obscuration_area_fraction: finite(raw.obscuration_area_fraction), solar_altitude_at_maximum_deg: finite(raw.solar_altitude_at_maximum_deg), solar_azimuth_at_maximum_deg: finite(raw.solar_azimuth_at_maximum_deg), sun_above_geometric_horizon_at_maximum: boolean(raw.sun_above_geometric_horizon_at_maximum),
    method: string(raw.method), precision_warning: string(raw.precision_warning), limitations: array(raw.limitations).map(string),
  };
}

export function decodeScienceCapabilities(value: unknown): ScienceCapabilities {
  const { raw, meta: responseMeta } = versioned(value); const snapshot = object(raw.snapshot); const caps = object(raw.capabilities); const reference = object(caps.reference_state); const catalogs = object(caps.catalogs); const sky = object(caps.sky); const eclipses = object(caps.eclipses_local); const simulate = object(caps.simulate); const limits = object(raw.limits);
  if (responseMeta.capability !== "capabilities") fail();
  for (const capability of [reference, sky, eclipses, simulate]) {
    if (capability.available === true && !["available", "degraded"].includes(String(capability.status))) fail();
    if (capability.available === false && capability.status === "available") fail();
  }
  const status = (value: unknown) => { const result = string(value); return ["available", "unavailable", "configured-unverified", "degraded"].includes(result) ? result as ScienceCapabilities["capabilities"]["sky"]["status"] : fail(); };
  const mode = string(reference.mode); if (!["dynamic-de442s", "fixed-snapshot", "unavailable"].includes(mode)) fail();
  const method = (item: Record<string, unknown>) => item.canonical_method === "POST" ? "POST" as const : fail();
  const referenceLimits = limits.reference_state === undefined ? undefined : { ...object(limits.reference_state) }; const simulationLimits = limits.simulate === undefined ? undefined : object(limits.simulate);
  // Native capabilities use null coverage when kernels are absent. This does
  // not invalidate independent sky/eclipse capabilities.
  if (referenceLimits) {
    for (const key of ["valid_utc_from", "valid_utc_until"]) if (referenceLimits[key] === null) referenceLimits[key] = undefined;
  }
  return { schema_version: 1, meta: responseMeta, snapshot: { available: boolean(snapshot.available), fixed_epoch: boolean(snapshot.fixed_epoch), epoch_utc: optionalString(snapshot.epoch_utc), source: optionalString(snapshot.source) }, capabilities: { reference_state: { available: boolean(reference.available), status: status(reference.status), mode: mode as ScienceCapabilities["capabilities"]["reference_state"]["mode"] }, catalogs: { available: boolean(catalogs.available), moons: boolean(catalogs.moons), stars: boolean(catalogs.stars), constellations: boolean(catalogs.constellations) }, sky: { available: boolean(sky.available), status: status(sky.status), canonical_method: method(sky) }, eclipses_local: { available: boolean(eclipses.available), status: status(eclipses.status), canonical_method: method(eclipses) }, simulate: { available: boolean(simulate.available), status: status(simulate.status), canonical_method: method(simulate) } }, limits: { reference_state: referenceLimits ? { valid_utc_from: optionalString(referenceLimits.valid_utc_from), valid_utc_until: optionalString(referenceLimits.valid_utc_until) } : undefined, simulate: simulationLimits ? { max_bodies: integer(simulationLimits.max_bodies), max_steps: integer(simulationLimits.max_steps), max_duration_s: finite(simulationLimits.max_duration_s), max_step_s: finite(simulationLimits.max_step_s) } : undefined, request_body_bytes: integer(limits.request_body_bytes) } };
}

export function decodeSimulationResponse(value: unknown): SimulationResponse {
  const { raw } = versioned(value); const execution = object(raw.execution); const state = object(raw.state); const bodies = array(state.bodies);
  finite(execution.steps); finite(execution.integrated_duration_s); finite(execution.computation_ms); finite(execution.fixed_step_s);
  bodies.forEach((item) => { const body = object(item); string(body.name); vector3(body.position_m); vector3(body.velocity_m_s); finite(body.mu_m3_s2); });
  object(raw.metrics); object(raw.model); array(raw.limitations).forEach(string);
  return raw as unknown as SimulationResponse;
}

export function decodeConstellationSkyResponse(value: unknown): ConstellationSkyResponse {
  const { raw } = versioned(value); const constellation = object(raw.constellation); string(constellation.iau_abbreviation); string(constellation.name);
  array(raw.stars).forEach((item) => { const star = object(item); finite(star.altitude_deg); finite(star.azimuth_deg); finite(star.g_mag); });
  array(raw.boundaries).forEach((item) => { const boundary = object(item); object(boundary.start); object(boundary.end); });
  array(raw.limitations).forEach(string);
  return raw as unknown as ConstellationSkyResponse;
}

export function decodeScienceError(value: unknown): ScienceErrorEnvelope {
  const raw = object(value); if (raw.schema_version !== 1) fail(); const error = object(raw.error);
  const capability = optionalString(error.capability); if (capability && !["reference_state", "catalogs", "sky", "eclipses_local", "simulate"].includes(capability)) fail();
  return { schema_version: 1, error: { code: string(error.code), message: string(error.message), capability: capability as ScienceErrorEnvelope["error"]["capability"], request_id: string(error.request_id), details: error.details === undefined ? undefined : object(error.details), valid_utc_from: optionalString(error.valid_utc_from), valid_utc_until: optionalString(error.valid_utc_until) } };
}
