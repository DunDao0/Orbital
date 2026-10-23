/** Camera distances in visual scene units, never in the physical simulation. */
export function navigationDistances(radius: number, fov: number, aspect: number) {
  const safeRadius = Math.max(radius, 0.00001);
  const halfFov = Math.atan(Math.tan(fov * Math.PI / 360) * Math.min(1, Math.max(aspect, 0.1)));
  return { minimum: safeRadius * 1.12, focus: safeRadius / Math.sin(halfFov) * 1.6, maximum: 400 };
}

export function zoomDistance(distance: number, factor: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, distance * factor));
}
