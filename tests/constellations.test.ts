import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { bindObserverControls } from "../app/components/atlas/observerControls.ts";
import { AtlasCameraTransition } from "../app/components/atlas/cameraTransition.ts";
import { CONSTELLATION_MEANINGS, constellationOrigin, projectCatalogueStars } from "../lib/atlas/constellationEducation.ts";
import { constellationViewDirection, fitObserverSky, observerDirection, observerFieldOfView, observerLightNotice } from "../lib/atlas/constellations.ts";
import { altAzToWorld, clipAltAzSegmentToHorizon, constellationSearchText, magnitudeToOpacity, magnitudeToPointSize } from "../lib/atlas/constellations.ts";
import { DEFAULT_CONSTELLATION_SCENE, sceneHash, sceneStateFromHash, updateSceneLayer } from "../lib/atlas/scene/state.ts";

test("AltAz display adapters preserve the documented local observer convention", () => {
  assert.deepEqual(altAzToWorld({ altitude_deg: 90, azimuth_deg: 0 }, 2).map((value) => Math.round(value * 1e6) / 1e6), [0, 2, 0]);
  assert.deepEqual(altAzToWorld({ altitude_deg: 0, azimuth_deg: 0 }, 2).map((value) => Math.round(value * 1e6) / 1e6), [0, 0, 2]);
  assert.deepEqual(altAzToWorld({ altitude_deg: 0, azimuth_deg: 90 }, 2).map((value) => Math.round(value * 1e6) / 1e6), [2, 0, 0]);
  assert.ok(magnitudeToPointSize(1) > magnitudeToPointSize(5));
  assert.ok(magnitudeToOpacity(1) > magnitudeToOpacity(5));
});

test("observer labels daytime, twilight and unknown light without claiming naked-eye visibility", () => {
  assert.equal(observerLightNotice("night"), undefined);
  assert.match(observerLightNotice("day")!, /Céu diurno.*não uma previsão/);
  for (const phase of ["civil", "nautical", "astronomical"]) assert.match(observerLightNotice(phase)!, /Crepúsculo.*pode impedir/);
  assert.match(observerLightNotice("unrecognized")!, /não reconhecida.*sem afirmar visibilidade/);
  const renderer = readFileSync(new URL("../app/components/PlanetSurfaceExplorer.tsx", import.meta.url), "utf8");
  assert.match(renderer, /observerLightNotice\(constellationSky.twilight\)/);
});

test("horizon clipping omits hidden segments and takes the short path across azimuth zero", () => {
  assert.equal(clipAltAzSegmentToHorizon({ altitude_deg: -2, azimuth_deg: 20 }, { altitude_deg: -1, azimuth_deg: 40 }), null);
  const clipped = clipAltAzSegmentToHorizon({ altitude_deg: 3, azimuth_deg: 359 }, { altitude_deg: -3, azimuth_deg: 1 });
  assert.ok(clipped);
  assert.equal(clipped?.[1].altitude_deg, 0);
  assert.ok(clipped?.[1].azimuth_deg === 0 || clipped?.[1].azimuth_deg === 360);
  assert.equal(constellationSearchText("Órion"), "orion");
});

test("constellation semantic scene state never serializes observer coordinates", () => {
  const scene = updateSceneLayer({ ...DEFAULT_CONSTELLATION_SCENE, selection: { type: "constellation", id: "Ori" } }, "sky-iau-boundaries", { visible: false });
  const hash = sceneHash(scene);
  assert.match(hash, /constellation/);
  assert.doesNotMatch(hash, /latitude|longitude|elevation/i);
  assert.deepEqual(sceneStateFromHash(hash)?.selection, { type: "constellation", id: "Ori" });
  assert.equal(sceneStateFromHash(hash)?.layers.find((layer) => layer.id === "sky-iau-boundaries")?.visible, false);
});

test("viewer aims at returned visible coordinates without raising hidden constellations", () => {
  const representative = { altitude_deg: 42, azimuth_deg: 130 };
  const sky = { selected: { representative_point: representative }, stars: [] };
  assert.deepEqual(constellationViewDirection(sky), altAzToWorld(representative, 1));
  const below = { selected: { representative_point: { altitude_deg: -30, azimuth_deg: 20 } }, stars: [] };
  assert.equal(constellationViewDirection(below), undefined);
  const partial = { ...below, stars: [{ altitude_deg: 12, azimuth_deg: 40, above_horizon: true }] };
  assert.deepEqual(constellationViewDirection(partial), altAzToWorld(partial.stars[0], 1));
  assert.equal(below.selected.representative_point.altitude_deg, -30);
});

test("catalogue selection loads the clicked identifier and rejects stale responses", () => {
  const source = readFileSync(new URL("../app/components/earth/ConstellationObservatory.tsx", import.meta.url), "utf8");
  const selection = source.slice(source.indexOf("function selectConstellation("), source.indexOf("return <div className=\"app-frame\""));
  assert.match(selection, /void loadConstellation\(iauAbbreviation\)/);
  assert.match(selection, /scrollIntoView/);
  assert.match(source, /constellation: iauAbbreviation/);
  assert.match(source, /!request.signal.aborted && version === requestVersion.current/);
  assert.match(source, /candidate\?\.constellation.iau_abbreviation === selectedAbbreviation/);
  const load = source.slice(source.indexOf("async function loadConstellation("));
  assert.ok(load.indexOf("controller.current?.abort()") < load.indexOf("observerInput(fields)"));
});

test("all 88 catalogue regions have an editorial meaning and projected stars", () => {
  const catalogue = JSON.parse(readFileSync(new URL("../public/scientific/constellation_guides.json", import.meta.url), "utf8"));
  assert.equal(Object.keys(CONSTELLATION_MEANINGS).length, 88);
  for (const guide of catalogue.items) {
    assert.ok(CONSTELLATION_MEANINGS[guide.iau_abbreviation], guide.name);
    assert.doesNotMatch(constellationOrigin(guide.iau_abbreviation), /ainda não/);
    const points = projectCatalogueStars(guide.brightest_gaia_stars, guide.representative_icrs_j2000.ra_deg, guide.representative_icrs_j2000.dec_deg);
    assert.ok(points.length > 0, guide.name);
    assert.ok(points.every((point) => point.x >= 60 - 1e-8 && point.x <= 740 + 1e-8 && point.y >= 50 - 1e-8 && point.y <= 380 + 1e-8), guide.name);
  }
});

test("catalogue projection crosses RA zero without splitting Andromeda or mutating data", () => {
  const stars = [359, 0, 1].map((ra_deg, index) => ({ gaia_dr3_source_id: String(index), ra_deg, dec_deg: 40, g_mag: 3 }));
  const original = JSON.stringify(stars);
  const projected = projectCatalogueStars(stars, 0, 40);
  assert.equal(projected[1].x, 400);
  assert.ok(projected[0].x > projected[1].x && projected[1].x > projected[2].x);
  assert.equal(JSON.stringify(stars), original);
  assert.deepEqual(projectCatalogueStars([], 0, 0), []);
  assert.deepEqual(projectCatalogueStars([{ ...stars[0], ra_deg: NaN }], 0, 0), []);
});

test("scientific star shader enables the color attribute and catalogue stays separate from local horizon", () => {
  const renderer = readFileSync(new URL("../app/components/PlanetSurfaceExplorer.tsx", import.meta.url), "utf8");
  const stars = renderer.slice(renderer.indexOf("function addScientificStars("), renderer.indexOf("function addScientificBoundaries("));
  assert.match(stars, /vertexColors: true/);
  assert.match(stars, /star.above_horizon/);
  const viewer = readFileSync(new URL("../app/components/earth/ConstellationObservatory.tsx", import.meta.url), "utf8");
  assert.match(viewer, /viewer === "catalogue" && selectedDetails/);
  assert.match(viewer, /key=\{selectedDetails.iau_abbreviation\}/);
  const story = readFileSync(new URL("../app/components/earth/ConstellationCatalogueView.tsx", import.meta.url), "utf8");
  assert.match(story, /não é o céu visível agora/);
  assert.match(story, /não a descoberta/);
  assert.match(story, /event.key === "Enter"/);
});

test("observer fits visible stars, wraps north and never promotes below-horizon objects", () => {
  const stars = [{ altitude_deg: 20, azimuth_deg: 359, above_horizon: true }, { altitude_deg: 40, azimuth_deg: 1, above_horizon: true }, { altitude_deg: -50, azimuth_deg: 180, above_horizon: false }];
  const snapshot = JSON.stringify(stars);
  const fit = fitObserverSky({ stars }, 1.7);
  assert.ok(Math.abs(fit.direction[0]) < .02);
  assert.ok(fit.direction[1] > .4 && fit.direction[2] > .8);
  assert.equal(JSON.stringify(stars), snapshot);
  assert.deepEqual(fitObserverSky({ stars: [stars[2]] }, 1).direction, observerDirection(18, 0));
  assert.ok(observerDirection(0, 90)[0] < 0, "east is camera-right when looking north with Y up");
  assert.equal(observerFieldOfView(-30), 20);
  assert.equal(observerFieldOfView(300), 115);
  assert.ok(fitObserverSky({ stars }, .45).fov >= fit.fov);
});

test("observer keeps the eye at the origin and releases dedicated input listeners", () => {
  const renderer = readFileSync(new URL("../app/components/PlanetSurfaceExplorer.tsx", import.meta.url), "utf8");
  assert.match(renderer, /runtime.controls.enabled = !observer/);
  assert.match(renderer, /if \(sceneRuntime.observerActive\) \{\s*camera.position.set\(0, 0, 0\);\s*camera.lookAt\(sceneRuntime.targetGoal\)/);
  assert.match(renderer, /releaseObserverControls\(\)/);
  assert.match(renderer, /part.material.map\?\.dispose\(\)/);
  const controls = readFileSync(new URL("../app/components/atlas/observerControls.ts", import.meta.url), "utf8");
  for (const event of ["pointerdown", "pointermove", "pointerup", "pointercancel", "lostpointercapture", "wheel", "keydown"]) {
    assert.ok(controls.includes(`addEventListener("${event}"`));
    assert.ok(controls.includes(`removeEventListener("${event}"`));
  }
});

test("observer input changes aim and field of view, never camera position, and cleans up", () => {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const captured = new Set<number>();
  const canvas = {
    clientHeight: 600, focus() {},
    addEventListener: (name: string, callback: (event: Record<string, unknown>) => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
  } as unknown as HTMLCanvasElement;
  const camera = new PerspectiveCamera(80);
  const direction = new Vector3(0, 0, 1);
  let active = true;
  const release = bindObserverControls(canvas, camera, direction, () => active);
  const event = { preventDefault() {}, pointerId: 1, button: 0, clientX: 100, clientY: 100 };
  listeners.get("wheel")!({ ...event, deltaY: -100 });
  assert.ok(camera.fov < 80);
  listeners.get("keydown")!({ ...event, key: "ArrowRight" });
  assert.ok(direction.x < 0, "right arrow turns east from north");
  const before = direction.clone();
  listeners.get("pointerdown")!(event);
  listeners.get("pointermove")!({ ...event, clientX: 200, clientY: 140 });
  assert.ok(direction.distanceTo(before) > .01);
  listeners.get("pointerup")!(event);
  const after = direction.clone();
  listeners.get("pointermove")!({ ...event, clientX: 500 });
  assert.deepEqual(direction, after);
  assert.equal(camera.position.length(), 0);
  active = false;
  const fov = camera.fov;
  listeners.get("wheel")!({ ...event, deltaY: 100 });
  assert.equal(camera.fov, fov);
  release();
  assert.equal(listeners.size, 0);
});

test("Atlas camera transition settles and no longer replaces manual framing", () => {
  const transition = new AtlasCameraTransition();
  const position = new Vector3(0, 0.3, 5.5);
  const target = new Vector3();
  const destination = new Vector3(0, 0.18, 1.62);
  const targetDestination = new Vector3(0, 0, 1);
  transition.start(destination, targetDestination);
  const initialDistance = position.distanceTo(destination);
  transition.update(position, target, 1 / 60, false);
  assert.ok(position.distanceTo(destination) < initialDistance);
  assert.ok(position.distanceTo(destination) > 0);
  for (let frame = 0; frame < 300; frame += 1) transition.update(position, target, 1 / 60, false);
  assert.deepEqual(position, destination);
  assert.deepEqual(target, targetDestination);
  position.set(0.4, 0.5, 2.4);
  target.set(0.1, 0.2, 0.9);
  const manualPosition = position.clone();
  const manualTarget = target.clone();
  for (let frame = 0; frame < 60; frame += 1) transition.update(position, target, 1 / 60, false);
  assert.deepEqual(position, manualPosition);
  assert.deepEqual(target, manualTarget);
});

test("Atlas manual cancellation retains camera and target even with reduced motion", () => {
  const transition = new AtlasCameraTransition();
  const position = new Vector3(0, 0.3, 5.5);
  const target = new Vector3();
  transition.start(new Vector3(0, 0.18, 1.62), new Vector3(0, 0, 1));
  transition.update(position, target, 1 / 60, false);
  transition.cancel();
  position.set(1, 0.8, 3);
  target.set(0.1, 0.2, 0.3);
  const manualPosition = position.clone();
  const manualTarget = target.clone();
  transition.update(position, target, 1 / 60, false);
  transition.update(position, target, 1 / 60, true);
  assert.deepEqual(position, manualPosition);
  assert.deepEqual(target, manualTarget);
});

test("Atlas reduced-motion transitions snap once and copy destinations safely", () => {
  const transition = new AtlasCameraTransition();
  const position = new Vector3();
  const target = new Vector3();
  const destination = new Vector3(0, 0.3, 5.5);
  const targetDestination = new Vector3(0, 0, 1);
  transition.start(destination, targetDestination);
  destination.set(100, 100, 100);
  targetDestination.set(100, 100, 100);
  transition.update(position, target, 0, true);
  assert.deepEqual(position.toArray(), [0, 0.3, 5.5]);
  assert.deepEqual(target.toArray(), [0, 0, 1]);
  position.set(0.2, 0.1, 4);
  transition.update(position, target, 1 / 60, true);
  assert.deepEqual(position.toArray(), [0.2, 0.1, 4]);
  transition.start(new Vector3(0, 0.18, 1.62), new Vector3(0, 0, 1));
  transition.update(position, target, 1 / 60, true);
  assert.deepEqual(position.toArray(), [0, 0.18, 1.62]);
});

test("Atlas integrates manual cancellation and horizon layer updates without reframing", () => {
  const source = readFileSync(new URL("../app/components/PlanetSurfaceExplorer.tsx", import.meta.url), "utf8");
  assert.match(source, /const interruptCameraTransition = \(\) => sceneRuntime.cameraTransition.cancel\(\)/);
  assert.match(source, /controls.addEventListener\("start", interruptCameraTransition\)/);
  assert.match(source, /controls.removeEventListener\("start", interruptCameraTransition\)/);
  assert.match(source, /sceneRuntime.cameraTransition.update\(camera.position, controls.target, delta, reduceMotion\)/);
  assert.doesNotMatch(source, /camera.position.lerp\(sceneRuntime.cameraGoal/);
  const effects = Array.from(source.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/g));
  const layerEffects = effects.filter((effect) => effect[2].split(",").map((dependency) => dependency.trim()).includes("constellationSkyLayers"));
  assert.equal(layerEffects.length, 1);
  assert.match(layerEffects[0][1], /applyScientificSkyLayers/);
  assert.doesNotMatch(layerEffects[0][1], /configureCameraGoal|fitObserverSky|buildScientificSky|camera\.fov|targetGoal/);
  const fitEffect = effects.find((effect) => effect[1].includes("fitObserverSky"));
  assert.ok(fitEffect);
  assert.deepEqual(fitEffect[2].split(",").map((dependency) => dependency.trim()), ["constellationSky", "view"]);
});
