import assert from "node:assert/strict";
import test from "node:test";
import { advanceFixedSteps, MAX_SUBSTEPS_PER_TICK, PHYSICS_STEP_S } from "../lib/science/nbody.ts";

const bodies = [
  { name: "Sun", mu_m3_s2: 1.3271244e20, position_m: [0, 0, 0], velocity_m_s: [0, 0, 0], state_target_naif_id: 10 },
  { name: "Earth", mu_m3_s2: 3.986004e14, position_m: [149_597_870_700, 0, 0], velocity_m_s: [0, 29_780, 0], state_target_naif_id: 399 },
];

test("reproduction speed changes step count while the physical step remains fixed", () => {
  const slow = advanceFixedSteps(bodies, 1);
  const fast = advanceFixedSteps(bodies, 6);
  assert.equal(PHYSICS_STEP_S, 3600);
  assert.equal(slow.integratedTimeS, PHYSICS_STEP_S);
  assert.equal(fast.integratedTimeS, 6 * PHYSICS_STEP_S);
  assert.equal(fast.completedSteps, 6);
});

test("browser N-body does not mutate input or physical metadata", () => {
  const original = structuredClone(bodies);
  const result = advanceFixedSteps(bodies, 2);
  assert.deepEqual(bodies, original);
  assert.equal(result.bodies[1].mu_m3_s2, bodies[1].mu_m3_s2);
  assert.equal(result.bodies[1].state_target_naif_id, 399);
  assert.notDeepEqual(result.bodies[1].position_m, bodies[1].position_m);
});

test("substep limit is enforced", () => {
  assert.throws(() => advanceFixedSteps(bodies, MAX_SUBSTEPS_PER_TICK + 1), RangeError);
  assert.throws(() => advanceFixedSteps(bodies, 0), RangeError);
});

test("singularity pauses on the last finite state and never returns NaN", () => {
  const coincident = [{ ...bodies[0], position_m: [0, 0, 0] }, { ...bodies[1], position_m: [0, 0, 0] }];
  const result = advanceFixedSteps(coincident, 3);
  assert.equal(result.paused, true);
  assert.equal(result.error, "COLLISION_OR_SINGULARITY");
  assert.equal(result.completedSteps, 0);
  assert.equal(result.integratedTimeS, 0);
  assert.ok(result.bodies.every((body) => [...body.position_m, ...body.velocity_m_s].every(Number.isFinite)));
});
