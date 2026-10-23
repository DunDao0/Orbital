import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { navigationDistances, zoomDistance } from "../app/components/orbital/navigation.ts";
import { orbitalPoints } from "../app/components/orbital/orbitalPoints.ts";
import { AU, BODY_VISUAL_SCALE, DEFAULT_VISUAL_SCALE, VisualScaleMapper } from "../app/components/orbital/VisualScaleMapper.ts";

const bodies = [
  { name: "Sun", radius_m: 695_700_000, position_m: [0, 0, 0] },
  { name: "Mercury", radius_m: 2_439_700, position_m: [0.39 * AU, 0, 0] },
  { name: "Earth", radius_m: 6_371_000, position_m: [AU, 0, 0] },
  { name: "Moon", radius_m: 1_737_400, position_m: [AU, 0.00257 * AU, 0] },
  { name: "Mars", radius_m: 3_389_500, position_m: [1.52 * AU, 0, 0] },
  { name: "Neptune", radius_m: 24_622_000, position_m: [30.1 * AU, 0, 0] },
];

test("navigation fits each visual radius and allows continuous reversible zoom", () => {
  for (const radius of [0.0001, 0.15, 0.28, 0.95, 1.9]) for (const aspect of [0.5, 1, 2]) {
    const distances = navigationDistances(radius, 48, aspect);
    assert.ok(distances.minimum > radius);
    assert.ok(distances.focus > distances.minimum);
    const closer = zoomDistance(distances.focus, 0.72, distances.minimum, distances.maximum);
    assert.ok(closer < distances.focus);
    assert.ok(Math.abs(zoomDistance(closer, 1 / 0.72, distances.minimum, distances.maximum) - distances.focus) < 1e-9);
    assert.equal(zoomDistance(radius, 0.001, distances.minimum, distances.maximum), distances.minimum);
    assert.equal(zoomDistance(400, 2, distances.minimum, distances.maximum), 400);
  }
  assert.ok(navigationDistances(0.28, 48, 0.5).focus > navigationDistances(0.28, 48, 2).focus);
});

test("focus navigation does not replace the scene scale and manual gestures cancel transitions", () => {
  const source = readFileSync(new URL("../app/components/SolarSystemScene.tsx", import.meta.url), "utf8");
  const focus = source.slice(source.indexOf("function focusSelected()"), source.indexOf("function fitSystem()"));
  assert.doesNotMatch(focus, /setVisualMode|requestAnimationFrame/);
  assert.match(source, /controls.addEventListener\("start", interruptNavigation\)/);
  assert.match(source, /if \(dragged\) return/);
  assert.match(source, /controls.removeEventListener\("start", interruptNavigation\)/);
});

test("visual scale is monotonic and never mutates the physical source vectors", () => {
  const original = structuredClone(bodies);
  const mapper = new VisualScaleMapper(bodies, { ...DEFAULT_VISUAL_SCALE, mode: "visual", focusBody: "Earth" });
  const mercury = mapper.mapBody(bodies[1]);
  const earth = mapper.mapBody(bodies[2]);
  const mars = mapper.mapBody(bodies[4]);
  const neptune = mapper.mapBody(bodies[5]);
  assert.ok(mercury && earth && mars && neptune);
  assert.ok(mercury.length() < earth.length());
  assert.ok(earth.length() < mars.length());
  assert.ok(mars.length() < neptune.length());
  assert.deepEqual(bodies, original);
});

test("real mode preserves proportional distances while visual mode expands inner-orbit readability", () => {
  const real = new VisualScaleMapper(bodies, { ...DEFAULT_VISUAL_SCALE, mode: "real", focusBody: "Earth" });
  const visual = new VisualScaleMapper(bodies, { ...DEFAULT_VISUAL_SCALE, mode: "visual", focusBody: "Earth" });
  const realMercury = real.mapBody(bodies[1]);
  const realEarth = real.mapBody(bodies[2]);
  const visualMercury = visual.mapBody(bodies[1]);
  assert.ok(realMercury && realEarth && visualMercury);
  assert.ok(Math.abs(realMercury.length() / realEarth.length() - 0.39) < 0.0001);
  assert.ok(visualMercury.length() > realMercury.length());
});

test("focus mode exposes only reference-backed local geometry", () => {
  const mapper = new VisualScaleMapper(bodies, { ...DEFAULT_VISUAL_SCALE, mode: "focus", focusBody: "Earth" });
  assert.deepEqual(mapper.mapBody(bodies[2])?.toArray(), [0, 0, 0]);
  assert.ok(mapper.mapBody(bodies[3])?.length());
  assert.equal(mapper.mapBody(bodies[4]), null);
  assert.equal(mapper.focusHasExactSatelliteState, true);
});

test("readable sizes distinguish rocky planets, gas giants and the Sun", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../public/reference-snapshot.json", import.meta.url), "utf8"));
  const mapper = new VisualScaleMapper(snapshot.bodies, DEFAULT_VISUAL_SCALE);
  const radius = (name: string) => mapper.displayRadius(snapshot.bodies.find((body: { name: string }) => body.name === name));
  assert.ok(radius("Moon") < radius("Mercury"));
  assert.ok(radius("Mercury") < radius("Mars"));
  assert.ok(radius("Mars") < radius("Earth"));
  assert.ok(radius("Earth") < radius("Neptune"));
  assert.ok(radius("Neptune") < radius("Saturn"));
  assert.ok(radius("Saturn") < radius("Jupiter"));
  assert.ok(radius("Jupiter") < radius("Sun"));
});

test("body envelopes including Saturn rings never intersect at any compression", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../public/reference-snapshot.json", import.meta.url), "utf8"));
  const source = structuredClone(snapshot.bodies);
  for (const mode of ["visual", "real", "focus"] as const) for (const compression of [0, 0.68, 1]) {
    const mapper = new VisualScaleMapper(snapshot.bodies, { ...DEFAULT_VISUAL_SCALE, mode, compression });
    for (const body of snapshot.bodies) for (const other of snapshot.bodies) {
      if (body.name === other.name) continue;
      const a = mapper.mapBody(body), b = mapper.mapBody(other);
      if (!a || !b) continue;
      const envelope = (item: typeof body) => mapper.displayRadius(item) * (item.name === "Saturn" ? BODY_VISUAL_SCALE.saturnRingExtent : 1.3);
      assert.ok(envelope(body) + envelope(other) < a.distanceTo(b), `${mode}: ${body.name}/${other.name}`);
    }
  }
  assert.deepEqual(snapshot.bodies, source);
});

test("Moon keeps the reference-relative direction and real mode never expands it", () => {
  const mapper = new VisualScaleMapper(bodies, DEFAULT_VISUAL_SCALE);
  const delta = mapper.mapBody(bodies[3])!.sub(mapper.mapBody(bodies[2])!);
  assert.ok(Math.abs(delta.length() - 0.00257 * 450) < 1e-9);
  assert.ok(Math.abs(delta.x) < 1e-9 && delta.z > 0);
  const real = new VisualScaleMapper(bodies, { ...DEFAULT_VISUAL_SCALE, mode: "real" });
  assert.ok(Math.abs(real.mapBody(bodies[3])!.distanceTo(real.mapBody(bodies[2])!) - 0.00257 * 32 / 30.1) < 1e-9);
});

test("display orbit retains a circular radius and matches the body in both scale modes", () => {
  const sun = { ...bodies[0], mu_m3_s2: 1.32712440018e20, velocity_m_s: [15, -21, 9], position_m: [1e8, -3e8, 2e7] };
  const mu = sun.mu_m3_s2 + 3.986004418e14;
  const speed = Math.sqrt(mu / AU);
  const earth = {
    ...bodies[2], mu_m3_s2: 3.986004418e14,
    position_m: [sun.position_m[0] + AU, sun.position_m[1], sun.position_m[2]],
    velocity_m_s: [15, -21 + speed * Math.cos(0.4), 9 + speed * Math.sin(0.4)],
  };
  const input = [sun, earth];
  const original = structuredClone(input);
  const points = orbitalPoints(earth, sun);
  assert.ok(points);
  assert.equal(points.length, 225);
  for (const point of points) {
    const radius = Math.hypot(...point.map((axis, index) => axis - sun.position_m[index]));
    assert.ok(Math.abs(radius / AU - 1) < 1e-12, `circular radius: ${radius}`);
  }
  assert.ok(Math.hypot(...points[0].map((axis, index) => axis - earth.position_m[index])) < 0.001);
  assert.ok(Math.hypot(...points[224].map((axis, index) => axis - points[0][index])) < 0.001);
  for (const mode of ["real", "visual"] as const) {
    const mapper = new VisualScaleMapper(input, { ...DEFAULT_VISUAL_SCALE, mode });
    const bodyPosition = mapper.mapBody(earth)!;
    const orbitPosition = mapper.mapOrbitPoint(points[0], earth.name)!;
    assert.ok(bodyPosition.distanceTo(orbitPosition) < 1e-10);
    assert.ok(orbitPosition.length() > 1);
  }
  assert.deepEqual(input, original);
});

test("display ellipse reaches periapsis, apoapsis and a non-apsidal source position without mutation", () => {
  const sun = Object.freeze({
    name: "Sun", mu_m3_s2: 1.32712440018e20,
    position_m: Object.freeze([2e8, -4e8, 1e7]),
    velocity_m_s: Object.freeze([12, -6, 3]),
  });
  const bodyMu = 4.282837e13;
  const eccentricity = 0.2;
  const semiMajorAxis = 1.52 * AU;
  const parameter = semiMajorAxis * (1 - eccentricity ** 2);
  const velocityScale = Math.sqrt((sun.mu_m3_s2 + bodyMu) / parameter);
  // True anomaly 90°: r = p, v = sqrt(mu/p) * [-1, e, 0].
  const body = Object.freeze({
    name: "Mars", mu_m3_s2: bodyMu,
    position_m: Object.freeze([sun.position_m[0], sun.position_m[1] + parameter, sun.position_m[2]]),
    velocity_m_s: Object.freeze([12 - velocityScale, -6 + eccentricity * velocityScale, 3]),
  });
  const original = structuredClone([sun, body]);
  const points = orbitalPoints(body, sun);
  assert.ok(points);
  const radii = points.map((point) => Math.hypot(...point.map((axis, index) => axis - sun.position_m[index])));
  assert.ok(Math.abs(Math.min(...radii) / (semiMajorAxis * (1 - eccentricity)) - 1) < 1e-12);
  assert.ok(Math.abs(Math.max(...radii) / (semiMajorAxis * (1 + eccentricity)) - 1) < 1e-12);
  assert.ok(Math.hypot(...points[56].map((axis, index) => axis - body.position_m[index])) < 0.001);
  assert.deepEqual([sun, body], original);
});

test("display orbit does not invent solar, lunar or radial trajectories", () => {
  const sun = { name: "Sun", mu_m3_s2: 1.32712440018e20, position_m: [0, 0, 0], velocity_m_s: [0, 0, 0] };
  const body = { name: "Earth", mu_m3_s2: 3.986004418e14, position_m: [AU, 0, 0], velocity_m_s: [1000, 0, 0] };
  assert.equal(orbitalPoints(sun, sun), null);
  assert.equal(orbitalPoints({ ...body, name: "Moon" }, sun), null);
  assert.equal(orbitalPoints(body, sun), null);
});
