import { Vector3 } from "three";

type OrbitDisplayState = {
  name: string;
  mu_m3_s2: number;
  position_m: readonly number[];
  velocity_m_s: readonly number[];
};

function rawVector(values: readonly number[]): Vector3 {
  return new Vector3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
}

/**
 * Samples an osculating ellipse for display only, from the supplied state.
 * It neither propagates nor mutates the physical state or invents lunar states.
 */
export function orbitalPoints(body: OrbitDisplayState, sun: OrbitDisplayState): number[][] | null {
  if (body.name === "Sun" || body.name === "Moon") return null;
  const relativePosition = rawVector(body.position_m).sub(rawVector(sun.position_m));
  const relativeVelocity = rawVector(body.velocity_m_s).sub(rawVector(sun.velocity_m_s));
  const distance = relativePosition.length();
  const gravitationalParameter = sun.mu_m3_s2 + body.mu_m3_s2;
  if (!Number.isFinite(distance) || distance <= 0 || gravitationalParameter <= 0) return null;
  const angularMomentum = relativePosition.clone().cross(relativeVelocity);
  const angularMomentumSquared = angularMomentum.lengthSq();
  if (angularMomentumSquared < 1) return null;
  const eccentricityVector = relativeVelocity.clone().cross(angularMomentum).multiplyScalar(1 / gravitationalParameter).sub(relativePosition.clone().multiplyScalar(1 / distance));
  const eccentricity = eccentricityVector.length();
  const energy = relativeVelocity.lengthSq() / 2 - gravitationalParameter / distance;
  const semiMajorAxis = -gravitationalParameter / (2 * energy);
  if (!Number.isFinite(semiMajorAxis) || semiMajorAxis <= 0 || eccentricity >= 0.97) return null;
  const periapsis = eccentricity > 1e-4 ? eccentricityVector.normalize() : relativePosition.clone().normalize();
  const normal = angularMomentum.normalize();
  const transverse = normal.clone().cross(periapsis).normalize();
  // Keep |r × v|² from before normalization; a unit vector would collapse the orbit.
  const parameter = angularMomentumSquared / gravitationalParameter;
  const sunPosition = rawVector(sun.position_m);
  const points: number[][] = [];
  for (let step = 0; step <= 224; step += 1) {
    const anomaly = (step / 224) * Math.PI * 2;
    const radius = parameter / (1 + eccentricity * Math.cos(anomaly));
    const point = periapsis.clone().multiplyScalar(Math.cos(anomaly) * radius).addScaledVector(transverse, Math.sin(anomaly) * radius).add(sunPosition);
    points.push([point.x, point.y, point.z]);
  }
  return points;
}
