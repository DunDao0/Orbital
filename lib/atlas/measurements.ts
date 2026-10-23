export type SpatialBody = { name: string; radius_m?: number; position_m?: number[]; velocity_m_s?: number[] };
export type SpaceMeasurement = { centerDistanceM?: number; surfaceDistanceM?: number; angularDiameterRad?: number; lightTimeS?: number; relativeSpeedMps?: number };

const C_MPS = 299_792_458;
const WGS84_A = 6_378_137;
const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F);

function norm(values: number[]): number { return Math.hypot(...values); }
function difference(left: number[], right: number[]): number[] { return left.map((value, index) => value - (right[index] ?? 0)); }

export function measureBodies(left: SpatialBody, right: SpatialBody): SpaceMeasurement {
  if (!left.position_m || !right.position_m || left.position_m.length !== 3 || right.position_m.length !== 3) return {};
  const centerDistanceM = norm(difference(left.position_m, right.position_m));
  const result: SpaceMeasurement = { centerDistanceM, lightTimeS: centerDistanceM / C_MPS };
  if (left.radius_m && right.radius_m) result.surfaceDistanceM = Math.max(0, centerDistanceM - left.radius_m - right.radius_m);
  if (right.radius_m && centerDistanceM > right.radius_m) result.angularDiameterRad = 2 * Math.asin(right.radius_m / centerDistanceM);
  if (left.velocity_m_s && right.velocity_m_s && left.velocity_m_s.length === 3 && right.velocity_m_s.length === 3) result.relativeSpeedMps = norm(difference(left.velocity_m_s, right.velocity_m_s));
  return result;
}

/** Vincenty's inverse solution on the WGS84 ellipsoid. Returns undefined for antipodal non-convergence. */
export function wgs84DistanceMeters(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number | undefined {
  if (![latitudeA, longitudeA, latitudeB, longitudeB].every(Number.isFinite) || Math.abs(latitudeA) > 90 || Math.abs(latitudeB) > 90 || Math.abs(longitudeA) > 180 || Math.abs(longitudeB) > 180) return undefined;
  const phi1 = latitudeA * Math.PI / 180;
  const phi2 = latitudeB * Math.PI / 180;
  const lambda = (longitudeB - longitudeA) * Math.PI / 180;
  const reduced1 = Math.atan((1 - WGS84_F) * Math.tan(phi1));
  const reduced2 = Math.atan((1 - WGS84_F) * Math.tan(phi2));
  const sinU1 = Math.sin(reduced1); const cosU1 = Math.cos(reduced1);
  const sinU2 = Math.sin(reduced2); const cosU2 = Math.cos(reduced2);
  let delta = lambda;
  let sigma = 0; let sinSigma = 0; let cosSigma = 0; let cosSqAlpha = 0; let cos2SigmaM = 0;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const sinLambda = Math.sin(delta); const cosLambda = Math.cos(delta);
    sinSigma = Math.hypot(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda);
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    const coefficient = WGS84_F / 16 * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
    const next = lambda + (1 - coefficient) * WGS84_F * sinAlpha * (sigma + coefficient * sinSigma * (cos2SigmaM + coefficient * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(next - delta) < 1e-12) { delta = next; break; }
    delta = next;
    if (iteration === 99) return undefined;
  }
  const uSq = cosSqAlpha * (WGS84_A ** 2 - WGS84_B ** 2) / WGS84_B ** 2;
  const a = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const b = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const correction = b * sinSigma * (cos2SigmaM + b / 4 * (cosSigma * (-1 + 2 * cos2SigmaM ** 2) - b / 6 * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  return WGS84_B * a * (sigma - correction);
}

export function horizonDistanceMeters(elevationM: number): number | undefined {
  if (!Number.isFinite(elevationM) || elevationM < 0) return undefined;
  return Math.sqrt((WGS84_A + elevationM) ** 2 - WGS84_A ** 2);
}

export function formatKilometres(value: number | undefined): string { return value === undefined ? "indisponível" : `${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`; }
