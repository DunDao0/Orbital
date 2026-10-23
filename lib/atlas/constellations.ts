/** Pure display adapters for the native AltAz constellation response.
 *
 * They never calculate AltAz from catalogue coordinates. The backend supplies
 * those values; this file only maps already-labelled local-sky directions into
 * the shared Three.js observer scene.
 */
export type AltAzPoint = { altitude_deg: number; azimuth_deg: number };

export type WorldPoint = readonly [number, number, number];

/** View adapter only: reflect east for a right-handed camera looking north (+Z). */
export function observerDirection(altitude: number, azimuth: number): WorldPoint {
  const [x, y, z] = altAzToWorld({ altitude_deg: altitude, azimuth_deg: azimuth }, 1);
  return [-x, y, z];
}

export function observerFieldOfView(value: number): number {
  return Math.max(20, Math.min(115, value));
}

/** Presentation only: interpret the API's light classification, never infer it. */
export function observerLightNotice(twilight: string): string | undefined {
  if (twilight === "night") return undefined;
  if (twilight === "day") return "Céu diurno: estrelas com brilho ampliado para localização, não uma previsão de visibilidade a olho nu.";
  if (["civil", "nautical", "astronomical"].includes(twilight)) return "Crepúsculo: estrelas com brilho ampliado; a luminosidade do céu pode impedir a observação a olho nu.";
  return "Condição de iluminação não reconhecida: o visor mostra posições geométricas, sem afirmar visibilidade a olho nu.";
}

/** Fit visible stars rather than an arbitrary interior point of the IAU polygon. */
export function fitObserverSky(sky: { stars: Array<AltAzPoint & { above_horizon: boolean }>; selected?: { representative_point: AltAzPoint } }, aspect: number) {
  const stars = sky.stars.filter((star) => star.above_horizon && star.altitude_deg >= 0);
  if (!stars.length) return { direction: observerDirection(18, sky.selected?.representative_point.azimuth_deg ?? 0), fov: 85 };
  const directions = stars.map((star) => observerDirection(star.altitude_deg, star.azimuth_deg));
  const sum = directions.reduce((total, point) => [total[0] + point[0], total[1] + point[1], total[2] + point[2]], [0, 0, 0]);
  const length = Math.hypot(...sum) || 1;
  const direction: WorldPoint = [sum[0] / length, sum[1] / length, sum[2] / length];
  const angle = Math.max(...directions.map((point) => Math.acos(Math.max(-1, Math.min(1, point[0] * direction[0] + point[1] * direction[1] + point[2] * direction[2])))));
  const fov = Math.atan(Math.tan(Math.min(angle * 1.25, 1.35)) / Math.min(1, Math.max(.2, aspect))) * 360 / Math.PI;
  return { direction, fov: observerFieldOfView(Math.max(55, fov)) };
}

/** Aim at a returned visible direction; never infer sky coordinates locally. */
export function constellationViewDirection(sky: { selected?: { representative_point: AltAzPoint }; stars: Array<AltAzPoint & { above_horizon: boolean }> }): WorldPoint | undefined {
  const representative = sky.selected?.representative_point;
  const visible = representative && representative.altitude_deg >= 0 ? representative : sky.stars.find((star) => star.above_horizon);
  return visible ? altAzToWorld(visible, 1) : undefined;
}

function radians(value: number): number {
  return value * Math.PI / 180;
}

export function normalizeAzimuth(azimuthDeg: number): number {
  return ((azimuthDeg % 360) + 360) % 360;
}

/** Local convention: +Y zenith, +Z north, +X east; azimuth is N→E. */
export function altAzToWorld(point: AltAzPoint, radius = 14): WorldPoint {
  const altitude = radians(point.altitude_deg);
  const azimuth = radians(normalizeAzimuth(point.azimuth_deg));
  const horizontal = Math.cos(altitude) * radius;
  return [Math.sin(azimuth) * horizontal, Math.sin(altitude) * radius, Math.cos(azimuth) * horizontal];
}

/** Brighter stars have lower G magnitude and a strictly larger visible point. */
export function magnitudeToPointSize(gMagnitude: number): number {
  const clamped = Math.min(6.5, Math.max(-2, gMagnitude));
  return 2.4 + (6.5 - clamped) * 1.15;
}

/** Opacity follows the same monotonic brightness convention as point size. */
export function magnitudeToOpacity(gMagnitude: number): number {
  const clamped = Math.min(6.5, Math.max(-2, gMagnitude));
  return 0.32 + (6.5 - clamped) / 8.5 * 0.68;
}

function interpolateAzimuth(start: number, end: number, fraction: number): number {
  const difference = ((end - start + 540) % 360) - 180;
  return normalizeAzimuth(start + difference * fraction);
}

/**
 * Clip an already transformed AltAz edge to the mathematical horizon.  The
 * source state is unchanged; this only avoids drawing hidden geometry through
 * the ground and handles the 0°/360° azimuth seam on its short path.
 */
export function clipAltAzSegmentToHorizon(start: AltAzPoint, end: AltAzPoint): [AltAzPoint, AltAzPoint] | null {
  const startVisible = start.altitude_deg >= 0;
  const endVisible = end.altitude_deg >= 0;
  if (!startVisible && !endVisible) return null;
  if (startVisible && endVisible) return [start, end];
  const fraction = start.altitude_deg / (start.altitude_deg - end.altitude_deg);
  const horizon: AltAzPoint = { altitude_deg: 0, azimuth_deg: interpolateAzimuth(start.azimuth_deg, end.azimuth_deg, fraction) };
  return startVisible ? [start, horizon] : [horizon, end];
}

export function constellationSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").trim();
}
