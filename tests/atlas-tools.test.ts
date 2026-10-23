import assert from "node:assert/strict";
import test from "node:test";
import { horizonDistanceMeters, measureBodies, wgs84DistanceMeters } from "../lib/atlas/measurements.ts";
import { createJourneyPlayback, journeyPlaybackReducer, ORBITAL_JOURNEYS } from "../lib/atlas/journeys.ts";
import { newProject, parseProjectText, PROJECT_STORAGE_KEY, readStoredProject, sanitizeProjectText, validateProject, writeStoredProject } from "../lib/atlas/projects.ts";
import { filterOrbitalEvents, normalizeOrbitalEvent, ORBITAL_EVENTS } from "../lib/atlas/events.ts";
import { missionTemporalState, ORBITAL_MISSIONS, validateMissionManifest } from "../lib/atlas/missions.ts";
import { createFixtureTileLoader, EARTH_LAB_FEATURE_FLAG, EARTH_TEMPORAL_FIXTURE } from "../lib/atlas/earth-lab.ts";
import { ellipsoidTerrainProvider, isOutsideEllipsoid, TerrainTileCache } from "../lib/atlas/terrain.ts";
import { answerAtlasQuestion, createAssistantContext } from "../lib/atlas/assistant.ts";
import { DEFAULT_ORBITAL_SCENE } from "../lib/atlas/scene/state.ts";

test("measurements use supplied vectors and keep missing scientific values unavailable", () => {
  assert.deepEqual(measureBodies({ name: "A" }, { name: "B" }), {});
  const result = measureBodies({ name: "A", radius_m: 1, position_m: [0, 0, 0], velocity_m_s: [2, 0, 0] }, { name: "B", radius_m: 1, position_m: [3, 4, 0], velocity_m_s: [5, 0, 0] });
  assert.equal(result.centerDistanceM, 5);
  assert.equal(result.surfaceDistanceM, 3);
  assert.equal(result.relativeSpeedMps, 3);
});

test("terrestrial measurements use WGS84 and reject invalid inputs", () => {
  assert.equal(wgs84DistanceMeters(0, 0, 0, 0), 0);
  assert.equal(wgs84DistanceMeters(91, 0, 0, 0), undefined);
  assert.equal(horizonDistanceMeters(-1), undefined);
  assert.ok((horizonDistanceMeters(1_000) ?? 0) > 100_000);
});

test("three manifest-backed journeys preserve declarative scenes and transcripts", () => {
  assert.equal(ORBITAL_JOURNEYS.length, 3);
  for (const journey of ORBITAL_JOURNEYS) {
    assert.ok(journey.steps.length > 0);
    assert.ok(journey.steps.every((step) => step.transcript.length > 20 && step.citations.length > 0 && step.scene.version === 1));
  }
});

test("journey playback survives selecting step bodies and restores its original scene after restart", () => {
  const before = { ...DEFAULT_ORBITAL_SCENE, selection: { type: "journey", id: "earth-moon" } };
  const started = journeyPlaybackReducer(createJourneyPlayback("earth-moon"), { type: "start", scene: before });
  const advanced = journeyPlaybackReducer(started, { type: "step", index: 1 });
  assert.equal(advanced.active, true);
  assert.equal(advanced.stepIndex, 1);
  assert.equal(advanced.journeyId, "earth-moon");
  assert.equal(advanced.sceneBeforeJourney, before);
  const paused = journeyPlaybackReducer(advanced, { type: "pause" });
  assert.equal(journeyPlaybackReducer(paused, { type: "step", index: 0 }), paused);
  const restarted = journeyPlaybackReducer(advanced, { type: "start", scene: ORBITAL_JOURNEYS[1].steps[1].scene });
  assert.equal(restarted.sceneBeforeJourney, before);
  assert.equal(restarted.stepIndex, 0);
  assert.equal(journeyPlaybackReducer(restarted, { type: "exit" }).active, false);
});

test("projects reject invalid schemas, strip executable markup and retain only scene metadata", () => {
  assert.equal(sanitizeProjectText("<script>alert(1)</script> nota"), "scriptalert(1)/script nota");
  const project = newProject(DEFAULT_ORBITAL_SCENE);
  const restored = parseProjectText(JSON.stringify({ ...project, annotations: [{ id: "safe", kind: "note", text: "<b>não executável</b>", targetId: "earth" }] }));
  assert.equal(restored?.annotations[0]?.text, "bnão executável/b");
  assert.equal(validateProject({ schemaVersion: 2, title: "x", scenes: [], annotations: [] }), null);
  assert.equal(parseProjectText("not json"), null);
});

test("saved projects can be recovered explicitly without writes while loading", () => {
  const data = new Map<string, string>();
  let writes = 0;
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { writes++; data.set(key, value); } };
  assert.deepEqual(readStoredProject(storage), { status: "missing" });
  const project = { ...newProject(DEFAULT_ORBITAL_SCENE), title: "Minha cena da Terra", annotations: [{ id: "note", kind: "note" as const, text: "Meu projeto salvo" }] };
  assert.equal(writeStoredProject(storage, project).status, "saved");
  const loaded = readStoredProject(storage);
  assert.equal(loaded.status, "ready");
  if (loaded.status === "ready") assert.deepEqual(loaded.project, validateProject(project));
  assert.equal(writes, 1);
  data.set(PROJECT_STORAGE_KEY, "invalid-json");
  assert.deepEqual(readStoredProject(storage), { status: "invalid" });
  assert.equal(data.get(PROJECT_STORAGE_KEY), "invalid-json");
  assert.equal(writes, 1);
});

test("storage failures and oversized projects preserve existing data and report failure", () => {
  const project = newProject(DEFAULT_ORBITAL_SCENE);
  const denied = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
  assert.deepEqual(readStoredProject(denied), { status: "unavailable" });
  assert.deepEqual(writeStoredProject(denied, project), { status: "unavailable" });
  let writes = 0;
  assert.deepEqual(writeStoredProject({ setItem: () => { writes++; } }, { ...project, description: "x".repeat(500_001) }), { status: "invalid" });
  assert.equal(writes, 0);
});

test("missions have validated coverage and never imply a state beyond it", () => {
  const mission = ORBITAL_MISSIONS[0];
  assert.deepEqual(validateMissionManifest(mission), mission);
  assert.equal(mission.frame, "not-applicable/no-trajectory");
  assert.equal(mission.timeScale, "UTC");
  assert.equal(missionTemporalState(mission, "1900-01-01T00:00:00Z"), "out-of-coverage");
  assert.equal(validateMissionManifest({ ...mission, coverage: { validFromUtc: "bad", validUntilUtc: "bad" } }), null);
});

test("events require a source and filters preserve only normalized known records", () => {
  assert.equal(normalizeOrbitalEvent({ id: "x", title: "sem fonte", category: "earth", startUtc: "2024-01-01T00:00:00Z" }), null);
  const filtered = filterOrbitalEvents(ORBITAL_EVENTS, { category: "mission", targetId: "Moon" });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "apollo-11-launch");
});

test("earth lab fixture remains offline, cancelable and bounded by its LRU cache", async () => {
  assert.equal(EARTH_LAB_FEATURE_FLAG, false);
  assert.match(EARTH_TEMPORAL_FIXTURE.source.attribution, /(sem fonte geográfica|não geográfica)/i);
  const loader = createFixtureTileLoader(1);
  const first = await loader.load({ key: "one", signal: new AbortController().signal });
  assert.equal(first?.bytes.length, 4);
  assert.equal(loader.size, 1);
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal(await loader.load({ key: "two", signal: cancelled.signal }), null);
  loader.dispose(); assert.equal(loader.size, 0);
});

test("terrain falls back to an ellipsoid without inventing heights and disposes cache", async () => {
  const cache = new TerrainTileCache(1);
  cache.set("a", { heightsM: new Float32Array([0]), width: 1, height: 1 });
  cache.set("b", { heightsM: new Float32Array([0]), width: 1, height: 1 });
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.size, 1);
  assert.equal(isOutsideEllipsoid(1), false);
  assert.equal(isOutsideEllipsoid(1.001), true);
  assert.equal(await ellipsoidTerrainProvider.getTile({ z: 0, x: 0, y: 0 }, new AbortController().signal), null);
  cache.dispose(); assert.equal(cache.size, 0);
});

test("assistant context excludes location and reports unavailable science without inventing it", () => {
  const context = createAssistantContext(DEFAULT_ORBITAL_SCENE);
  assert.deepEqual(Object.keys(context).sort(), ["cameraMode", "experience", "requestedUtc", "selectedObjectId", "targetId", "visibleLayers"].sort());
  assert.doesNotMatch(JSON.stringify(context), /latitude|longitude|elevation/i);
  const layers = answerAtlasQuestion("quais camadas estão ativas?", context);
  assert.equal(layers.status, "ready"); assert.equal(layers.action?.type, "open-panel");
  const absent = answerAtlasQuestion("qual será a posição de Marte amanhã?", context);
  assert.equal(absent.status, "unavailable"); assert.match(absent.text, /Nenhum valor foi estimado/);
});
