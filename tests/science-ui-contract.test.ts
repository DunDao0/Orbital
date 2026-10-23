import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { currentScienceData, loadingScienceResource, settleScienceResource } from "../lib/science/resource.ts";
import type { ScienceResource } from "../lib/science/contracts.ts";
import { ScienceRequestError } from "../lib/science/errors.ts";
import { observerFieldsAtUtc, parseDecimalInput, parseObserverFields, parseObserverUtc } from "../lib/science/observerFields.ts";
import { horizonDistanceMeters, wgs84DistanceMeters } from "../lib/atlas/measurements.ts";
import { DEFAULT_CONSTELLATION_SCENE, sceneHash, sceneStateFromHash } from "../lib/atlas/scene/state.ts";

test("scientific decimal fields reject missing or JavaScript-only numeric syntax", () => {
  for (const value of ["", " ", "\t", "NaN", "Infinity", "-Infinity", "0x10", "1e3", "1,2.3", "1,2,3", "1 000", "--1"]) {
    assert.equal(parseDecimalInput(value), undefined, value);
  }
  for (const [value, expected] of [["0", 0], [" -23,5505 ", -23.5505], ["-46.6333", -46.6333], ["+760", 760], [",5", .5], ["5,5", 5.5]] as const) {
    assert.equal(parseDecimalInput(value), expected);
  }
});

test("observer parsing requires every coordinate and preserves explicit zero", () => {
  const fields = { latitude: "-23,5505", longitude: "-46,6333", elevation: "760", utc: "2026-08-05T00:00" };
  assert.deepEqual(parseObserverFields(fields).input, { latitude_deg: -23.5505, longitude_deg: -46.6333, elevation_m: 760, utc: "2026-08-05T00:00:00.000Z" });
  for (const key of ["latitude", "longitude", "elevation"] as const) {
    for (const value of ["", " ", "Infinity"]) assert.equal(parseObserverFields({ ...fields, [key]: value }).input, undefined, `${key}: ${value}`);
  }
  for (const [key, value] of [["latitude", "90.1"], ["longitude", "-180.1"], ["elevation", "-501"], ["elevation", "10001"]] as const) {
    assert.equal(parseObserverFields({ ...fields, [key]: value }).input, undefined);
  }
  assert.equal(parseObserverFields({ ...fields, latitude: "0", longitude: "0", elevation: "0" }).input?.latitude_deg, 0);
});

test("UTC input is timezone-independent and rejects impossible or ambiguous dates", () => {
  assert.equal(parseObserverUtc("2026-10-20T12:34"), "2026-10-20T12:34:00.000Z");
  assert.equal(parseObserverUtc("2026-10-20T12:34:56.123Z"), "2026-10-20T12:34:56.123Z");
  assert.equal(parseObserverUtc("2024-02-29T00:00"), "2024-02-29T00:00:00.000Z");
  for (const value of ["", " ", "2026-02-29T00:00", "2026-04-31T00:00", "2026-10-20T24:00", "20/10/2026", "2026-10-20T00:00-03:00"]) {
    assert.equal(parseObserverUtc(value), undefined, value);
  }
});

test("restored constellation UTC survives calculation without sharing observer coordinates", () => {
  const fields = { latitude: "12,5", longitude: "-45", elevation: "80", utc: "2026-08-05T00:00" };
  const utc = "2026-10-20T07:32:56.123Z";
  const hash = sceneHash({ ...DEFAULT_CONSTELLATION_SCENE, requestedUtc: utc });
  const restored = sceneStateFromHash(hash)!;
  const nextFields = observerFieldsAtUtc(fields, restored.requestedUtc);
  assert.equal(parseObserverFields(nextFields).input?.utc, utc);
  assert.deepEqual(nextFields, { ...fields, utc: "2026-10-20T07:32:56.123" });
  assert.doesNotMatch(hash, /latitude|longitude|elevation/i);
  assert.equal(fields.utc, "2026-08-05T00:00");
  assert.equal(observerFieldsAtUtc(fields, "invalid"), fields);
});

test("empty measurement inputs remain unavailable instead of producing zero", () => {
  const missing = parseDecimalInput("") ?? Number.NaN;
  assert.equal(wgs84DistanceMeters(missing, missing, missing, missing), undefined);
  assert.equal(horizonDistanceMeters(missing), undefined);
  const zero = parseDecimalInput("0")!;
  assert.equal(wgs84DistanceMeters(zero, zero, zero, zero), 0);
  assert.equal(horizonDistanceMeters(zero), 0);
});

test("constellation hydration restores the shared UTC before serializing the scene", async () => {
  const source = await readFile(new URL("../app/components/earth/ConstellationObservatory.tsx", import.meta.url), "utf8");
  assert.match(source, /useState\(DEFAULT_CONSTELLATION_SCENE\)/);
  assert.doesNotMatch(source, /function initialConstellationScene/);
  assert.match(source, /observerFieldsAtUtc\(current, restored\.requestedUtc\)/);
  assert.match(source, /if \(!sceneReady\) return;\s*const hash = sceneHash\(scene\)/);
});

test("Earth restores shared time into its explicit observer form without restoring coordinates", async () => {
  const source = await readFile(new URL("../app/components/earth/EarthAtlasWorkspace.tsx", import.meta.url), "utf8");
  const restore = source.slice(source.indexOf("const restored = sceneStateFromHash("), source.indexOf("const parsedObserver ="));
  assert.match(restore, /observerFieldsAtUtc\(current, restored\.requestedUtc\)/);
  assert.doesNotMatch(restore, /latitude|longitude|elevation/);
  assert.match(source, /type="datetime-local" step="any"/);
});

test("both home calculations validate before dispatch and invalidate older attempts first", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const sky = source.slice(source.indexOf("async function calculateSky("), source.indexOf("async function calculateEclipse("));
  const eclipse = source.slice(source.indexOf("async function calculateEclipse("), source.indexOf('return <div className="app-frame"'));
  for (const [handler, attempt] of [[sky, "skyAttempt"], [eclipse, "eclipseAttempt"]] as const) {
    assert.match(handler, /parseObserverFields\(\{ latitude: location.lat, longitude: location.lon, elevation: location.alt, utc: location.utc \}\)/);
    assert.match(handler, /if \(!parsed.input\) \{[\s\S]*status: "validation-error"[\s\S]*return;/);
    assert.doesNotMatch(handler, /Number\(location\./);
    assert.ok(handler.indexOf("controller?.abort()") < handler.indexOf("parseObserverFields("));
    assert.ok(handler.includes(`version !== ${attempt}.current.version`));
    assert.match(handler, /controller.signal/);
  }
});

test("Earth resources preserve confirmed query identity across failures and replace it on success", () => {
  type QueryResult = { input: { utc: string; latitude_deg: number; longitude_deg: number }; value: number };
  const original: QueryResult = { input: { utc: "2024-04-08T18:00:00Z", latitude_deg: 1, longitude_deg: 2 }, value: 42 };
  const ready: ScienceResource<QueryResult> = { status: "ready", data: original };
  for (const kind of ["network", "unavailable", "validation", "out-of-range", "server", "contract"] as const) {
    const loading: ScienceResource<QueryResult> = loadingScienceResource(ready);
    const failed: ScienceResource<QueryResult> = settleScienceResource(loading, { status: "rejected", reason: new ScienceRequestError(kind, "new attempt failed") }, "sky", true);
    assert.notEqual(failed.status, "ready");
    assert.equal(currentScienceData(failed), original);
    const retry: ScienceResource<QueryResult> = loadingScienceResource(failed);
    assert.equal(currentScienceData(retry)?.input.utc, original.input.utc);
    const next = { ...original, input: { ...original.input, utc: "2024-04-09T00:00:00Z", latitude_deg: 5 } };
    const succeeded: ScienceResource<QueryResult> = settleScienceResource(retry, { status: "fulfilled", value: next }, "sky", true);
    assert.equal(currentScienceData(succeeded), next);
    assert.equal(succeeded.status, "ready");
  }
  const firstFailure = settleScienceResource({ status: "loading" }, { status: "rejected", reason: new Error("offline") }, "sky", true);
  assert.equal(currentScienceData(firstFailure), undefined);
});

test("canceled and out-of-order attempts cannot overwrite a newer scientific result", () => {
  const current: ScienceResource<number> = { status: "ready", data: 2 };
  assert.equal(settleScienceResource(current, { status: "fulfilled", value: 1 }, "sky", false), current);
  assert.equal(settleScienceResource(current, { status: "rejected", reason: new Error("late") }, "sky", false), current);
  const aborted = settleScienceResource(loadingScienceResource(current), { status: "rejected", reason: new DOMException("Canceled", "AbortError") }, "sky", true);
  assert.deepEqual(aborted, current);
  assert.deepEqual(settleScienceResource({ status: "loading" }, { status: "rejected", reason: new DOMException("Canceled", "AbortError") }, "sky", true), { status: "idle" });
});

test("scientific UI uses geometric-horizon, semantic contacts, methods and explicit unavailable/contract states", async () => {
  const [home, status] = await Promise.all([readFile(new URL("../app/page.tsx", import.meta.url), "utf8"), readFile(new URL("../app/components/science/ScienceStatus.tsx", import.meta.url), "utf8")]);
  assert.match(home, /acima do horizonte geométrico/);
  assert.match(home, /contact\.kind/);
  assert.match(home, /MethodNotice/);
  assert.match(home, /precision_warning/);
  assert.match(status, /resource\.status === "unavailable"/);
  assert.match(status, /resource\.status === "contract-error"/);
  assert.match(status, /resultado anterior/i);
  assert.doesNotMatch(home, /above_horizon \? "visível"/i);
});

test("Atlas keeps one renderer/canvas and narrative routes do not mount it", async () => {
  const renderer = await readFile(new URL("../app/components/PlanetSurfaceExplorer.tsx", import.meta.url), "utf8");
  assert.equal((renderer.match(/new THREE\.WebGLRenderer/g) ?? []).length, 1);
  assert.equal((renderer.match(/className = "atlas-webgl"/g) ?? []).length, 1);
  assert.equal((renderer.match(/window\.requestAnimationFrame\(render\)/g) ?? []).length, 1);
  assert.match(renderer, /visibilitychange/);
  assert.match(renderer, /document\.hidden/);
  for (const path of ["../app/atlas/events/page.tsx", "../app/atlas/journeys/page.tsx", "../app/atlas/missions/page.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /PlanetSurfaceLoader|PlanetSurfaceExplorer|atlas-webgl|WebGLRenderer/);
  }
});

test("Atlas foundation is shared, mobile tools are expandable and data routes hand selections to the viewer", async () => {
  const [atlas, earth, responsiveDrawer, dataRoute, journeys, css] = await Promise.all([
    readFile(new URL("../app/components/atlas/AtlasPlanetaryWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/earth/EarthAtlasWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/atlas/AtlasResponsiveDrawer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/atlas/AtlasDataRoute.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/atlas/journeys/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(atlas, /AtlasFoundationPanel/);
  assert.match(atlas, /sceneStateFromHash/);
  assert.match(atlas, /onPlanetChange/);
  assert.match(earth, /AtlasResponsiveDrawer/);
  assert.match(responsiveDrawer, /atlas-mobile-drawer/);
  assert.match(responsiveDrawer, /max-width: 620px/);
  assert.match(css, /atlas-mobile-drawer\[open\]/);
  assert.match(dataRoute, /\/atlas\/earth\$\{sceneHash\(next\)\}/);
  assert.match(journeys, /sceneHash\(launchScene\)/);
});
