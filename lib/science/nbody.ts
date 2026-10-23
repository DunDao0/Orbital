import type { Vector3 } from "./contracts.ts";

export const PHYSICS_STEP_S = 3_600;
export const MAX_SUBSTEPS_PER_TICK = 24;

export type BrowserNBody = {
  name: string;
  mu_m3_s2: number;
  position_m: number[];
  velocity_m_s: number[];
  [key: string]: unknown;
};

export type BrowserAdvanceResult<T extends BrowserNBody> = {
  bodies: T[];
  completedSteps: number;
  integratedTimeS: number;
  paused: boolean;
  error?: "COLLISION_OR_SINGULARITY";
};

function vector(values: number[]): Vector3 {
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) throw new Error("COLLISION_OR_SINGULARITY");
  return [values[0], values[1], values[2]];
}

function cloneBodies<T extends BrowserNBody>(input: readonly T[]): T[] {
  return input.map((body) => ({ ...body, position_m: [...body.position_m], velocity_m_s: [...body.velocity_m_s] }));
}

function accelerations<T extends BrowserNBody>(bodies: readonly T[]): Vector3[] {
  return bodies.map((body, at) => {
    const result: Vector3 = [0, 0, 0];
    const origin = vector(body.position_m);
    for (let other = 0; other < bodies.length; other += 1) {
      if (other === at) continue;
      const target = vector(bodies[other].position_m);
      const delta: Vector3 = [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]];
      const distance2 = delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2;
      if (!Number.isFinite(distance2) || distance2 <= 0) throw new Error("COLLISION_OR_SINGULARITY");
      const inverseCube = 1 / (Math.sqrt(distance2) * distance2);
      for (let axis = 0; axis < 3; axis += 1) result[axis] += bodies[other].mu_m3_s2 * delta[axis] * inverseCube;
    }
    return result;
  });
}

function fixedStep<T extends BrowserNBody>(input: readonly T[], stepS: number): T[] {
  const next = cloneBodies(input);
  const initialAcceleration = accelerations(input);
  next.forEach((body, index) => {
    body.position_m = vector(body.position_m).map((position, axis) => position + body.velocity_m_s[axis] * stepS + 0.5 * initialAcceleration[index][axis] * stepS ** 2);
  });
  const finalAcceleration = accelerations(next);
  next.forEach((body, index) => {
    body.velocity_m_s = vector(body.velocity_m_s).map((velocity, axis) => velocity + 0.5 * (initialAcceleration[index][axis] + finalAcceleration[index][axis]) * stepS);
    vector(body.position_m); vector(body.velocity_m_s);
  });
  return next;
}

export function advanceFixedSteps<T extends BrowserNBody>(input: readonly T[], stepsPerTick: number, physicsStepS = PHYSICS_STEP_S): BrowserAdvanceResult<T> {
  if (!Number.isInteger(stepsPerTick) || stepsPerTick < 1 || stepsPerTick > MAX_SUBSTEPS_PER_TICK || !Number.isFinite(physicsStepS) || physicsStepS <= 0) {
    throw new RangeError("invalid fixed-step advance request");
  }
  let current = cloneBodies(input);
  let completedSteps = 0;
  try {
    for (; completedSteps < stepsPerTick; completedSteps += 1) current = fixedStep(current, physicsStepS);
    return { bodies: current, completedSteps, integratedTimeS: completedSteps * physicsStepS, paused: false };
  } catch {
    return { bodies: current, completedSteps, integratedTimeS: completedSteps * physicsStepS, paused: true, error: "COLLISION_OR_SINGULARITY" };
  }
}
