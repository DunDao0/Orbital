import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function workerWithAssets(extraEnv = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  const assetsRoot = new URL("../dist/client/", import.meta.url);
  const env = {
    ASSETS: {
      async fetch(request) {
        const requestUrl = new URL(request.url);
        const assetName = requestUrl.pathname.replace(/^\/+/, "");
        try {
          return new Response(await readFile(new URL(assetName, assetsRoot)), { status: 200, headers: { "Content-Type": "application/json" } });
        } catch {
          return new Response("Not found", { status: 404 });
        }
      },
    },
    ...extraEnv,
  };
  return (pathname, init = {}) => worker.fetch(new Request(`http://orbis.test${pathname}`, {
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body,
  }), env, { waitUntil() {}, passThroughOnException() {} });
}

function assertEnvelope(response, body, capability) {
  assert.equal(body.schema_version, 1);
  assert.equal(body.meta.capability, capability);
  assert.equal(body.meta.request_id, response.headers.get("X-Request-ID"));
}

function assertPrivate(response) {
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
}

function nativeCapabilities(simulate = true) {
  return {
    schema_version: 1,
    meta: { request_id: "native-test", generated_at_utc: "2026-09-22T00:00:00Z", service: "native", software_version: "0.1.0", capability: "capabilities" },
    snapshot: { available: true, fixed_epoch: true },
    capabilities: {
      reference_state: { available: simulate, status: simulate ? "available" : "unavailable", mode: simulate ? "dynamic-de442s" : "unavailable" },
      catalogs: { available: true, moons: true, stars: true, constellations: true },
      sky: { available: true, status: "available", canonical_method: "POST" },
      eclipses_local: { available: true, status: "available", canonical_method: "POST" },
      simulate: { available: simulate, status: simulate ? "available" : "unavailable", canonical_method: "POST" },
    },
    limits: { request_body_bytes: 65536, reference_state: { valid_utc_from: null, valid_utc_until: null } },
  };
}

test("capabilities fail closed for malformed envelopes and preserve partial availability", async () => {
  for (const value of [{}, { ...nativeCapabilities(), schema_version: 2 }, { ...nativeCapabilities(), capabilities: {} }]) {
    const request = await workerWithAssets({ CUSTOMER_HTTP_SCIENCE_API: { async fetch() { return Response.json(value); } } });
    const body = await (await request("/api/capabilities")).json();
    for (const key of ["sky", "eclipses_local", "simulate"]) assert.equal(body.capabilities[key].available, false);
  }
  for (const fetch of [async () => { throw new Error("offline"); }, async () => new Response("{", { headers: { "content-type": "application/json" } })]) {
    const request = await workerWithAssets({ CUSTOMER_HTTP_SCIENCE_API: { fetch } });
    assert.equal((await (await request("/api/capabilities")).json()).capabilities.sky.available, false);
  }
  const request = await workerWithAssets({ CUSTOMER_HTTP_SCIENCE_API: { async fetch() { return Response.json(nativeCapabilities(false)); } } });
  const body = await (await request("/api/capabilities")).json();
  assert.equal(body.capabilities.sky.available, true);
  assert.equal(body.capabilities.eclipses_local.available, true);
  assert.equal(body.capabilities.simulate.available, false);
  assert.equal(body.capabilities.reference_state.mode, "fixed-snapshot");
});

test("fixed epoch accepts equivalent ISO offsets without accepting arbitrary date formats", async () => {
  const request = await workerWithAssets();
  for (const utc of ["2026-08-04T21:00:00-03:00", "2026-08-05T05:30:00+05:30", "2026-08-05T00:00:00.000000Z", "2026-08-05T00:00:00", "2026-08-05T00:00:00z"]) {
    assert.equal((await request(`/api/reference/state?${new URLSearchParams({ utc })}`)).status, 200, utc);
  }
  for (const utc of ["2026-08-04T21:00:01-03:00", "2026-08-05T00:00:00.000001Z", "08/05/2026", "2026-08-05", "2026-08-05T24:00:00Z", "2026-02-30T00:00:00Z"]) {
    assert.equal((await request(`/api/reference/state?${new URLSearchParams({ utc })}`)).status, 422, utc);
  }
});

test("health has versioned edge metadata and a stable request ID", async () => {
  const request = await workerWithAssets();
  const response = await request("/api/health", { headers: { "X-Request-ID": "edge-test.1" } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.api, "orbis-edge-reference-api");
  assertEnvelope(response, body, "health");
  assert.equal(body.meta.request_id, "edge-test.1");
  assertPrivate(response);
});

test("capabilities distinguish absent, unhealthy and healthy private bindings", async () => {
  const absentRequest = await workerWithAssets();
  const absent = await absentRequest("/api/capabilities");
  const absentBody = await absent.json();
  assert.equal(absentBody.capabilities.sky.status, "unavailable");
  assert.equal(absentBody.capabilities.sky.available, false);

  const unhealthyRequest = await workerWithAssets({ CUSTOMER_HTTP_SCIENCE_API: { async fetch() { return new Response("offline", { status: 503 }); } } });
  const unhealthy = await unhealthyRequest("/api/capabilities");
  const unhealthyBody = await unhealthy.json();
  assert.equal(unhealthyBody.capabilities.sky.status, "configured-unverified");
  assert.equal(unhealthyBody.capabilities.sky.available, false);

  const healthyRequest = await workerWithAssets({ CUSTOMER_HTTP_SCIENCE_API: { async fetch() { return Response.json(nativeCapabilities()); } } });
  const healthy = await healthyRequest("/api/capabilities");
  const healthyBody = await healthy.json();
  assert.equal(healthyBody.capabilities.sky.status, "available");
  assert.equal(healthyBody.capabilities.sky.available, true);
  assertEnvelope(healthy, healthyBody, "capabilities");
  assertPrivate(healthy);

  for (const body of [absentBody, unhealthyBody, healthyBody]) {
    assert.doesNotMatch(JSON.stringify(body), /CUSTOMER_HTTP_SCIENCE_API|127\.0\.0\.1|localhost|:\/\/|:8000|tunnel/i);
  }
});

test("fixed snapshot is accepted only at its declared UTC and retains target identity", async () => {
  const request = await workerWithAssets();
  const response = await request("/api/reference/state?utc=2026-08-05T00:00:00Z&bodies=Earth,Jupiter");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.fixed_epoch, true);
  assert.deepEqual(body.bodies.map((item) => item.name), ["Earth", "Jupiter"]);
  assert.equal(body.bodies[1].state_target_naif_id, 5);
  assert.equal(body.bodies[1].state_kind, "system-barycenter");
  assertEnvelope(response, body, "reference_state");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=3600");

  const unavailable = await request("/api/reference/state?utc=2030-01-01T00:00:00Z");
  const error = await unavailable.json();
  assert.equal(unavailable.status, 422);
  assert.equal(error.error.code, "REFERENCE_EPOCH_UNAVAILABLE");
  assert.ok(error.error.request_id);
  assertPrivate(unavailable);
});

test("published moon, star and constellation catalogues keep inventories and public cache", async () => {
  const request = await workerWithAssets();
  const moons = await request("/api/catalogs/moons?primary=Earth&limit=250");
  const moonBody = await moons.json();
  assert.equal(moonBody.total, 1);
  assert.equal(moonBody.items[0].name, "Moon");
  assertEnvelope(moons, moonBody, "catalogs");
  assert.equal(moons.headers.get("Cache-Control"), "public, max-age=3600");

  const stars = await request("/api/catalogs/stars?max_magnitude=2&limit=5");
  const starBody = await stars.json();
  assert.equal(starBody.catalogue_count, 10_000);
  assert.ok(starBody.items.length <= 5 && starBody.items.every((item) => item.g_mag <= 2));

  const constellations = await request("/api/catalogs/constellations?query=%C3%93rion&limit=2");
  const constellationBody = await constellations.json();
  assert.equal(constellationBody.count, 88);
  assert.equal(constellationBody.total, 1);
  assert.equal(constellationBody.items[0].iau_abbreviation, "Ori");
  assert.equal(new Set(constellationBody.abbreviations).size, 88);
});

test("valid dynamic methods without a binding return the stable 501 contract", async () => {
  const request = await workerWithAssets();
  for (const [path, capability] of [["/api/sky", "sky"], ["/api/eclipses/local", "eclipses_local"], ["/api/simulate", "simulate"]]) {
    const response = await request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json();
    assert.equal(response.status, 501);
    assert.equal(body.schema_version, 1);
    assert.equal(body.error.code, "SCIENCE_SERVICE_UNAVAILABLE");
    assert.equal(body.error.capability, capability);
    assert.equal(body.error.message, "Cálculos científicos ao vivo não estão disponíveis neste ambiente.");
    assert.equal(body.error.request_id, response.headers.get("X-Request-ID"));
    assertPrivate(response);
  }
});

test("GET simulate is 405 while legacy GET sky and eclipse remain deprecated", async () => {
  const request = await workerWithAssets();
  const simulation = await request("/api/simulate");
  assert.equal(simulation.status, 405);
  assert.equal(simulation.headers.get("Allow"), "POST, OPTIONS");
  assert.equal((await simulation.json()).error.code, "METHOD_NOT_ALLOWED");

  for (const path of ["/api/sky?latitude_deg=1", "/api/eclipses/local?latitude_deg=1"]) {
    const response = await request(path);
    assert.equal(response.status, 501);
    assert.equal(response.headers.get("Deprecation"), "true");
    assert.match(response.headers.get("Warning"), /deprecated/i);
  }
});

test("OPTIONS declares methods for every route", async () => {
  const request = await workerWithAssets();
  const expectations = {
    "/api/health": "GET, OPTIONS",
    "/api/capabilities": "GET, OPTIONS",
    "/api/reference/state": "GET, OPTIONS",
    "/api/catalogs/moons": "GET, OPTIONS",
    "/api/catalogs/stars": "GET, OPTIONS",
    "/api/catalogs/constellations": "GET, OPTIONS",
    "/api/sky": "POST, GET, OPTIONS",
    "/api/sky/constellations": "POST, GET, OPTIONS",
    "/api/eclipses/local": "POST, GET, OPTIONS",
    "/api/simulate": "POST, OPTIONS",
  };
  for (const [path, allow] of Object.entries(expectations)) {
    const response = await request(path, { method: "OPTIONS" });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Allow"), allow);
    assertPrivate(response);
  }
});

test("dynamic proxy preserves POST body and request ID but strips browser authority and query", async () => {
  const captured = [];
  const binding = {
    async fetch(request) {
      captured.push(request);
      return Response.json({ schema_version: 1, meta: { request_id: request.headers.get("X-Request-ID") }, status: "ok" }, { headers: { "X-Request-ID": request.headers.get("X-Request-ID"), "Cache-Control": "public, max-age=9999", "X-Internal": "secret" } });
    },
  };
  const request = await workerWithAssets({ CUSTOMER_HTTP_SCIENCE_API: binding });
  const payload = JSON.stringify({ latitude_deg: 12.5, longitude_deg: -44.25, elevation_m: 3, utc: "2026-01-01T00:00:00Z" });
  const response = await request("/api/sky?discard=me", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Request-ID": "proxy-safe", Cookie: "session=secret", Authorization: "Bearer secret" },
    body: payload,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Request-ID"), "proxy-safe");
  assert.equal(response.headers.get("X-Internal"), null);
  assertPrivate(response);
  assert.equal(captured.length, 1);
  const upstream = captured[0];
  assert.equal(upstream.method, "POST");
  assert.equal(new URL(upstream.url).search, "");
  assert.equal(await upstream.text(), payload);
  assert.equal(upstream.headers.get("Content-Type"), "application/json");
  assert.equal(upstream.headers.get("Accept"), "application/json");
  assert.equal(upstream.headers.get("X-Request-ID"), "proxy-safe");
  assert.equal(upstream.headers.get("Cookie"), null);
  assert.equal(upstream.headers.get("Authorization"), null);
});

test("legacy GET proxy preserves query and scientific status", async () => {
  let captured;
  const request = await workerWithAssets({ CUSTOMER_HTTP_SCIENCE_API: { async fetch(incoming) { captured = incoming; return Response.json({ schema_version: 1, error: { code: "VALIDATION_ERROR", request_id: "upstream-id" } }, { status: 422, headers: { "X-Request-ID": "upstream-id" } }); } } });
  const response = await request("/api/sky?latitude_deg=12.5&longitude_deg=-44.25", { headers: { "X-Request-ID": "legacy-id" } });
  assert.equal(response.status, 422);
  assert.equal(new URL(captured.url).searchParams.get("latitude_deg"), "12.5");
  assert.equal(response.headers.get("X-Request-ID"), "upstream-id");
  assert.equal(response.headers.get("Deprecation"), "true");
  assertPrivate(response);
});

test("binding failure and invalid upstream JSON produce stable sanitized errors", async () => {
  const failing = await workerWithAssets({ CUSTOMER_HTTP_SCIENCE_API: { async fetch() { throw new Error("http://127.0.0.1:8000 secret binding"); } } });
  const failedResponse = await failing("/api/sky", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  const failed = await failedResponse.json();
  assert.equal(failedResponse.status, 502);
  assert.equal(failed.error.code, "UPSTREAM_SCIENCE_SERVICE_UNAVAILABLE");

  const nonJson = await workerWithAssets({ CUSTOMER_HTTP_SCIENCE_API: { async fetch() { return new Response("internal http://localhost:8000", { status: 500, headers: { "Content-Type": "text/plain" } }); } } });
  const invalidResponse = await nonJson("/api/eclipses/local", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  const invalid = await invalidResponse.json();
  assert.equal(invalidResponse.status, 502);
  assert.equal(invalid.error.code, "UPSTREAM_SCIENCE_SERVICE_UNAVAILABLE");
  for (const body of [failed, invalid]) assert.doesNotMatch(JSON.stringify(body), /binding|localhost|127\.0\.0\.1|:8000|:\/\/|tunnel/i);
});

test("dynamic proxy preserves IERS unavailability and offline provenance", async () => {
  const payload = { schema_version: 1, error: { code: "IERS_DATA_UNAVAILABLE", capability: "sky", message: "Previsões IERS locais vencidas.", request_id: "iers-fixture", details: { reason: "expired-prediction", iers: { mode: "offline", source: "fixture" } } } };
  const request = await workerWithAssets({ CUSTOMER_HTTP_SCIENCE_API: { async fetch() { return Response.json(payload, { status: 503 }); } } });
  const response = await request("/api/sky", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), payload);
  assertPrivate(response);
});

test("dynamic body above 64 KiB is rejected before proxying", async () => {
  let called = false;
  const request = await workerWithAssets({ CUSTOMER_HTTP_SCIENCE_API: { async fetch() { called = true; return Response.json({}); } } });
  const response = await request("/api/simulate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(64 * 1024) }) });
  const body = await response.json();
  assert.equal(response.status, 413);
  assert.equal(body.error.code, "REQUEST_BODY_TOO_LARGE");
  assertPrivate(response);
  assert.equal(called, false);
});
