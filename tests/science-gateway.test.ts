import assert from "node:assert/strict";
import test from "node:test";
import { createScienceGateway, useFixedSnapshotEpoch } from "../lib/science/client.ts";
import { ScienceRequestError } from "../lib/science/errors.ts";

const responseMeta = (capability: string) => ({ request_id: `${capability}-1`, generated_at_utc: "2026-08-18T12:00:00Z", service: "native", software_version: "0.1.0", capability });
const errorEnvelope = (code: string, message: string, capability?: string) => ({ schema_version: 1, error: { code, message, capability, request_id: "error-1" } });
const skyResponse = { schema_version: 1, meta: responseMeta("sky"), input: { latitude_deg: 1, longitude_deg: 2, elevation_m: 3, utc: "2026-01-01T00:00:00Z" }, input_scale: "UTC", coordinate_pipeline: ["ICRS", "AltAz"], frame: "AltAz", refraction: { enabled: false, pressure_hpa: 0 }, ephemeris: { provider: "Astropy builtin", is_de442s_reference_state: false }, iers: { mode: "offline", source: "IERS_Auto", status: "ok" }, twilight: { classification: "night", solar_altitude_deg: -30 }, objects: [{ name: "Sun", altitude_deg: -30, azimuth_deg: 10, above_geometric_horizon: false, above_horizon: false }], limitations: ["horizonte geométrico"] };
const referenceResponse = { schema_version: 1, meta: responseMeta("reference_state"), epoch: "2026-08-05T00:00:00Z", frame: "J2000", center: "Solar System Barycenter", time_scale: "TDB/ET", source: "NAIF DE442s", fixed_epoch: true, bodies: [{ name: "Earth", naif_id: 399, body_naif_id: 399, state_target_naif_id: 399, state_center_naif_id: 0, state_kind: "physical-center", state_target_name: "Earth", mu_m3_s2: 3.986e14, radius_m: 6378137, color: "#49f", position_m: [1, 2, 3], velocity_m_s: [4, 5, 6] }] };

test("gateway uses GET for reference/catalogues and POST JSON for observer calculations", async () => {
  const calls: Array<{ url: URL; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    calls.push({ url, init });
    if (url.pathname === "/api/reference/state") return Response.json(referenceResponse);
    if (url.pathname === "/api/catalogs/moons") return Response.json({ schema_version: 1, meta: responseMeta("catalogs"), items: [], total: 0, returned: 0, offset: 0, limit: 80, counts: {}, source: [], provenance: "fixture", propagation_notice: "fixture" });
    if (url.pathname === "/api/sky") return Response.json(skyResponse);
    if (url.pathname === "/api/eclipses/local") return Response.json({ schema_version: 1, meta: responseMeta("eclipses_local"), input: { latitude_deg: 1, longitude_deg: 2, elevation_m: 3, utc: "2026-01-01T00:00:00Z", search_hours: 18 }, event_found: false, search_window: { half_width_hours: 18, start_utc: "2025-12-31T06:00:00Z", end_utc: "2026-01-01T18:00:00Z", truncated: false }, classification: "none", maximum_utc: "2026-01-01T00:00:00Z", contacts: [], obscuration_area_fraction: 0, solar_altitude_at_maximum_deg: -30, solar_azimuth_at_maximum_deg: 10, sun_above_geometric_horizon_at_maximum: false, method: "fixture", precision_warning: "fixture", limitations: [] });
    return Response.json({ schema_version: 1, meta: responseMeta("simulate"), input: { utc: "2026-01-01T00:00:00Z", bodies: ["Sun", "Earth"], integrator: "velocity-verlet", duration_s: 3600, step_s: 3600 }, execution: { steps: 1, integrated_duration_s: 3600, computation_ms: 1, fixed_step_s: 3600 }, state: { epoch_utc: "2026-01-01T01:00:00Z", frame: "J2000", center: "Solar System Barycenter", bodies: [] }, metrics: { initial: {}, final: {}, drift: {} }, model: { gravity: "Newtonian point masses", excluded_effects: [] }, limitations: [] });
  };
  const gateway = createScienceGateway({ fetcher, browserOrigin: "http://orbis.test", browserHostname: "orbis.test" });
  await gateway.getReferenceState({ utc: "2026-08-05T00:00:00Z" });
  await gateway.getMoonCatalogue({ limit: 80 });
  const observer = { latitude_deg: 1, longitude_deg: 2, elevation_m: 3, utc: "2026-01-01T00:00:00Z" };
  await gateway.calculateSky(observer);
  await gateway.calculateEclipse({ ...observer, search_hours: 18 });
  await gateway.simulate({ utc: observer.utc, bodies: ["Sun", "Earth"], duration_s: 3600, step_s: 3600 });
  assert.deepEqual(calls.map((call) => call.init?.method ?? "GET"), ["GET", "GET", "POST", "POST", "POST"]);
  for (const call of calls.slice(2)) {
    assert.equal(call.url.search, "");
    assert.match(String(call.init?.body), /"latitude_deg":1|"bodies":\["Sun","Earth"\]/);
  }
  assert.doesNotMatch(calls[2].url.href, /latitude|longitude|elevation/);
});

test("a newer observer request aborts the previous one without converting AbortError", async () => {
  let call = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    call += 1;
    if (call === 2) return Response.json(skyResponse);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
  };
  const gateway = createScienceGateway({ fetcher, browserOrigin: "http://localhost:3000", browserHostname: "localhost" });
  const input = { latitude_deg: 1, longitude_deg: 2, elevation_m: 3, utc: "2026-01-01T00:00:00Z" };
  const first = gateway.calculateSky(input);
  const second = gateway.calculateSky({ ...input, latitude_deg: 4 });
  await assert.rejects(first, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
  assert.equal((await second).input.latitude_deg, 1);
});

test("reference fallback accepts only the exact fixed UTC and exposes explicit epoch action", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.hostname === "127.0.0.1") throw new TypeError("native offline");
    if (url.searchParams.get("utc") === "2026-08-05T00:00:00Z") return Response.json(referenceResponse);
    return Response.json(errorEnvelope("REFERENCE_EPOCH_UNAVAILABLE", "época fixa diferente", "reference_state"), { status: 422 });
  };
  const gateway = createScienceGateway({ fetcher, browserOrigin: "http://localhost:3000", browserHostname: "localhost" });
  const fixed = await gateway.getReferenceState({ utc: "2026-08-05T00:00:00Z" });
  assert.equal(fixed.fixed_epoch, true);
  await assert.rejects(gateway.getReferenceState({ utc: "2030-01-01T00:00:00Z" }), (error: unknown) => error instanceof ScienceRequestError && error.kind === "out-of-range");
  const capability = { snapshot: { fixed_epoch: true, epoch_utc: "2026-08-05T00:00:00Z" } } as Parameters<typeof useFixedSnapshotEpoch>[0];
  assert.equal(useFixedSnapshotEpoch(capability), "2026-08-05T00:00:00Z");
});

test("dynamic unavailability remains explicit and never creates an approximate result", async () => {
  const fetcher: typeof fetch = async () => Response.json(errorEnvelope("SCIENCE_SERVICE_UNAVAILABLE", "Cálculos científicos ao vivo não estão disponíveis neste ambiente.", "sky"), { status: 501 });
  const gateway = createScienceGateway({ fetcher, browserOrigin: "http://orbis.test", browserHostname: "orbis.test" });
  await assert.rejects(gateway.calculateSky({ latitude_deg: 1, longitude_deg: 2, elevation_m: 3, utc: "2026-01-01T00:00:00Z" }), (error: unknown) => error instanceof ScienceRequestError && error.kind === "unavailable" && error.capability === "sky");
});

test("IERS unavailable remains a scientific failure without an edge retry", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({ ...errorEnvelope("IERS_DATA_UNAVAILABLE", "Previsões IERS vencidas.", "sky") }, { status: 503 });
  };
  const gateway = createScienceGateway({ fetcher, browserOrigin: "http://localhost:3000", browserHostname: "localhost" });
  await assert.rejects(gateway.calculateSky({ latitude_deg: 1, longitude_deg: 2, elevation_m: 3, utc: "2026-08-05T00:00:00Z" }), (error: unknown) => error instanceof ScienceRequestError && error.kind === "unavailable" && error.code === "IERS_DATA_UNAVAILABLE");
  assert.equal(calls, 1);
});
