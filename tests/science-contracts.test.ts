import assert from "node:assert/strict";
import test from "node:test";
import {
  ContractDecodeError,
  decodeLocalEclipseResponse,
  decodeMoonCatalogue,
  decodeReferenceSnapshot,
  decodeScienceCapabilities,
  decodeScienceError,
} from "../lib/science/decoders.ts";
import { scienceErrorFromResponse } from "../lib/science/errors.ts";

const meta = { request_id: "fixture-1", generated_at_utc: "2026-08-18T12:00:00Z", service: "native", software_version: "0.1.0", capability: "reference_state" } as const;

function reference() {
  return {
    schema_version: 1, meta, epoch: "2026-08-05T00:00:00Z", frame: "J2000", center: "Solar System Barycenter", time_scale: "TDB/ET", source: "NAIF DE442s", fixed_epoch: true,
    bodies: [{ name: "Earth", naif_id: 399, body_naif_id: 399, state_target_naif_id: 399, state_center_naif_id: 0, state_kind: "physical-center", state_target_name: "Earth", mu_m3_s2: 3.986e14, radius_m: 6378137, color: "#49f", position_m: [1, 2, 3], velocity_m_s: [4, 5, 6] }],
  };
}

function capabilities() {
  return {
    schema_version: 1, meta: { ...meta, capability: "capabilities" }, snapshot: { available: true, fixed_epoch: true, epoch_utc: "2026-08-05T00:00:00Z" },
    capabilities: {
      reference_state: { available: true, status: "available", mode: "fixed-snapshot" },
      catalogs: { available: true, moons: true, stars: true, constellations: true },
      sky: { available: false, status: "unavailable", canonical_method: "POST" },
      eclipses_local: { available: false, status: "unavailable", canonical_method: "POST" },
      simulate: { available: false, status: "unavailable", canonical_method: "POST" },
    },
    limits: { reference_state: { valid_utc_from: "2026-08-05T00:00:00Z", valid_utc_until: "2026-08-05T00:00:00Z" }, simulate: { max_bodies: 10, max_steps: 20_000, max_duration_s: 31_536_000, max_step_s: 86_400 }, request_body_bytes: 65_536 },
  };
}

function partialEclipse() {
  return {
    schema_version: 1, meta: { ...meta, capability: "eclipses_local" }, input: { latitude_deg: 43, longitude_deg: -79, elevation_m: 76, utc: "2024-04-08T18:00:00Z", search_hours: 18 }, event_found: true,
    search_window: { half_width_hours: 18, start_utc: "2024-04-08T00:00:00Z", end_utc: "2024-04-09T12:00:00Z", truncated: false }, classification: "partial", maximum_utc: "2024-04-08T18:00:00Z",
    contacts: ["C1", "MAX", "C4"].map((kind, index) => ({ kind, utc: `2024-04-08T1${7 + index}:00:00Z`, sun_above_geometric_horizon: true })),
    obscuration_area_fraction: 0.8, solar_altitude_at_maximum_deg: 40, solar_azimuth_at_maximum_deg: 180, sun_above_geometric_horizon_at_maximum: true, method: "fixture", precision_warning: "non-operational", limitations: ["fixture"],
  };
}

test("runtime decoder accepts a valid versioned reference state", () => {
  const decoded = decodeReferenceSnapshot(reference());
  assert.equal(decoded.schema_version, 1);
  assert.equal(decoded.bodies[0].state_target_naif_id, 399);
  assert.deepEqual(decoded.bodies[0].position_m, [1, 2, 3]);
});

test("runtime decoder rejects unknown schema, short vectors and infinity", () => {
  assert.throws(() => decodeReferenceSnapshot({ ...reference(), schema_version: 2 }), ContractDecodeError);
  const short = reference(); short.bodies[0].position_m = [1, 2] as unknown as number[];
  assert.throws(() => decodeReferenceSnapshot(short), ContractDecodeError);
  const infinite = reference(); infinite.bodies[0].velocity_m_s = [1, 2, Infinity];
  assert.throws(() => decodeReferenceSnapshot(infinite), ContractDecodeError);
});

test("eclipse decoder enforces semantic contacts", () => {
  assert.deepEqual(decodeLocalEclipseResponse(partialEclipse()).contacts.map((item) => item.kind), ["C1", "MAX", "C4"]);
  const unknown = partialEclipse(); unknown.contacts[1].kind = "P2";
  assert.throws(() => decodeLocalEclipseResponse(unknown), ContractDecodeError);
});

test("malformed catalogue, error and capabilities fail closed", () => {
  assert.throws(() => decodeMoonCatalogue({ schema_version: 1, meta, items: "not-an-array" }), ContractDecodeError);
  assert.throws(() => decodeScienceError({ schema_version: 1, error: { code: "X", message: 123 } }), ContractDecodeError);
  const malformedCapabilities = capabilities(); malformedCapabilities.capabilities.sky.status = "maybe";
  assert.throws(() => decodeScienceCapabilities(malformedCapabilities), ContractDecodeError);
  const error = scienceErrorFromResponse(502, { error: "legacy" }, "fallback");
  assert.equal(error.kind, "contract");
});

test("canonical capability fixture validates with explicit fixed snapshot", () => {
  const decoded = decodeScienceCapabilities(capabilities());
  assert.equal(decoded.snapshot.fixed_epoch, true);
  assert.equal(decoded.capabilities.sky.canonical_method, "POST");
});
