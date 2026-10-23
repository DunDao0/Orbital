import assert from "node:assert/strict";
import test from "node:test";
import { advanceClock, clampClockUtc, intersectCoverage } from "../lib/atlas/clock.ts";
import { applyFlyTo } from "../lib/atlas/camera.ts";
import { sceneForSearchResult, searchOrbital } from "../lib/atlas/search.ts";
import { globeLayerDefinitions } from "../lib/atlas/layers.ts";
import { atlasVisualTarget, restoreAtlasScene } from "../lib/atlas/planetaryScene.ts";
import { ORBITAL_JOURNEYS, selectJourneyScene } from "../lib/atlas/journeys.ts";
import { DEFAULT_ORBITAL_SCENE, earthRenderLayersFromScene, sceneHash, sceneStateFromHash, updateSceneLayer, validateSceneState } from "../lib/atlas/scene/state.ts";

test("scene state round-trips through a URL fragment without observer coordinates", () => {
  const next = updateSceneLayer({ ...DEFAULT_ORBITAL_SCENE, requestedUtc: "2026-08-07T12:00:00.000Z", panel: "layers" }, "earth-grid", { visible: true, opacity: 0.5 });
  const restored = sceneStateFromHash(sceneHash(next));
  assert.deepEqual(restored, next);
  assert.doesNotMatch(sceneHash(next), /latitude|longitude|elevation|observer.*-23/i);
});

test("restored scene layers drive the Earth renderer instead of reverting to defaults", () => {
  const changed = updateSceneLayer(
    updateSceneLayer(
      updateSceneLayer(DEFAULT_ORBITAL_SCENE, "earth-atmosphere", { visible: false, opacity: 0.45 }),
      "earth-grid",
      { visible: true, opacity: 0.72 },
    ),
    "earth-observer-marker",
    { visible: true, opacity: 0.9 },
  );
  const restored = sceneStateFromHash(sceneHash(changed));
  assert.ok(restored);
  assert.deepEqual(earthRenderLayersFromScene(restored), {
    atmosphere: false,
    clouds: true,
    latitudeLongitudeGrid: true,
    observerMarker: true,
    atmosphereOpacity: 0.45,
    cloudsOpacity: 1,
    latitudeLongitudeGridOpacity: 0.72,
    observerMarkerOpacity: 0.9,
  });
});

test("legacy v1 UTC links migrate to requestedUtc without serializing the legacy field", () => {
  const legacy = { ...DEFAULT_ORBITAL_SCENE, requestedUtc: undefined, utc: "2026-08-05T00:00:00Z" };
  const restored = validateSceneState(legacy);
  assert.equal(restored?.requestedUtc, "2026-08-05T00:00:00.000Z");
  assert.doesNotMatch(sceneHash(restored!), /%22utc%22/);
});

test("scene validation rejects unsupported versions and incomplete state", () => {
  assert.equal(validateSceneState({ version: 2 }), null);
  assert.equal(validateSceneState({ version: 1, target: { type: "body", id: "earth" } }), null);
});

test("global clock intersects coverage and never advances beyond a boundary", () => {
  assert.deepEqual(intersectCoverage([{ validFromUtc: "2024-01-01T00:00:00Z" }, { validFromUtc: "2025-01-01T00:00:00Z", validUntilUtc: "2026-01-01T00:00:00Z" }]), { validFromUtc: "2025-01-01T00:00:00Z", validUntilUtc: "2026-01-01T00:00:00Z" });
  const clock = { utc: "2025-12-31T23:30:00.000Z", mode: "playing" as const, rate: 1, step: "hour" as const, validUntilUtc: "2026-01-01T00:00:00.000Z" };
  assert.equal(advanceClock(clock).utc, "2026-01-01T00:00:00.000Z");
  assert.equal(clampClockUtc("not-a-date", clock), "2026-01-01T00:00:00.000Z");
});

test("search accepts localized aliases and fly-to stays in declarative scene state", () => {
  assert.equal(searchOrbital("venus")[0]?.targetId, "venus");
  assert.equal(searchOrbital("plutao")[0]?.hasPhysicalState, false);
  assert.equal(searchOrbital("superficie")[0]?.id, "command:surface");
  const next = applyFlyTo(DEFAULT_ORBITAL_SCENE, { targetId: "earth", cameraPreset: "surface" });
  assert.equal(next.camera.mode, "surface");
  assert.equal(next.target.id, "earth");
});

test("every planet search result updates the renderer target and restores orbital distance", () => {
  const original = { ...DEFAULT_ORBITAL_SCENE, camera: { ...DEFAULT_ORBITAL_SCENE.camera, mode: "surface" as const, distance: 1.62 } };
  for (const id of ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]) {
    const result = searchOrbital(id).find((item) => item.targetId === id)!;
    const next = sceneForSearchResult(original, result);
    assert.deepEqual(next.target, { type: "body", id });
    assert.deepEqual(next.selection, { type: "body", id });
    assert.equal(next.camera.mode, "orbit");
    assert.equal(next.camera.distance, 5.5);
  }
  assert.equal(original.target.id, "earth");
  assert.equal(original.camera.mode, "surface");
});

test("globe controls expose only supported layers and require an observer for its marker", () => {
  const atlasEarth = globeLayerDefinitions("earth", false);
  assert.equal(atlasEarth.find((item) => item.id === "earth-grid")?.enabled, undefined);
  assert.equal(atlasEarth.find((item) => item.id === "earth-observer-marker")?.enabled, false);
  assert.ok(atlasEarth.every((item) => item.id.startsWith("earth-")));
  assert.equal(globeLayerDefinitions("earth", true).find((item) => item.id === "earth-observer-marker")?.enabled, undefined);
  assert.deepEqual(globeLayerDefinitions("mars", false), []);
});

test("selecting and reloading a journey preserves the previous globe and journey selection", () => {
  const original = { ...DEFAULT_ORBITAL_SCENE, target: { type: "body" as const, id: "jupiter" } };
  const selected = selectJourneyScene(original, "earth-moon");
  assert.deepEqual(selected.target, original.target);
  assert.equal(atlasVisualTarget(selected).planetId, "jupiter");
  const restored = restoreAtlasScene(sceneStateFromHash(sceneHash(selected)), null);
  assert.deepEqual(restored.selection, { type: "journey", id: "earth-moon" });
  assert.equal(restored.target.id, "jupiter");
  assert.equal(restored.panel, "journey");
  assert.equal(restoreAtlasScene({ ...selected, selection: { type: "journey", id: "unknown" } }, null).selection, undefined);
});

test("the Moon journey step uses explicit Earth context instead of silently rendering Mars", () => {
  const moonStep = ORBITAL_JOURNEYS.find((journey) => journey.id === "earth-moon")!.steps[1].scene;
  const view = atlasVisualTarget(moonStep);
  assert.equal(view.planetId, "earth");
  assert.match(view.notice ?? "", /Lua não é renderizada/);
  assert.equal(moonStep.target.id, "moon");
  const restored = restoreAtlasScene(sceneStateFromHash(sceneHash(moonStep)), null);
  assert.equal(restored.target.id, "moon");
  assert.deepEqual(atlasVisualTarget(restored), view);
  assert.equal(restoreAtlasScene(null, "venus").target.id, "venus");
});
