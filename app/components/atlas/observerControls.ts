import type { PerspectiveCamera, Vector3 } from "three";
import { observerDirection, observerFieldOfView } from "../../../lib/atlas/constellations.ts";

/** Look around a fixed eye, never dolly the observer away from the AltAz origin. */
export function bindObserverControls(canvas: HTMLCanvasElement, camera: PerspectiveCamera, direction: Vector3, active: () => boolean) {
  const pointers = new Map<number, { x: number; y: number }>();
  const zoom = (factor: number) => {
    camera.fov = observerFieldOfView(camera.fov * factor);
    camera.updateProjectionMatrix();
  };
  const aim = (dx: number, dy: number) => {
    const azimuth = Math.atan2(-direction.x, direction.z) * 180 / Math.PI;
    const altitude = Math.asin(Math.max(-1, Math.min(1, direction.y))) * 180 / Math.PI;
    direction.set(...observerDirection(Math.max(-12, Math.min(88, altitude + dy)), azimuth - dx));
  };
  const down = (event: PointerEvent) => {
    if (!active() || event.button !== 0) return;
    canvas.focus({ preventScroll: true });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    canvas.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!active() || !previous) return;
    if (pointers.size === 2) {
      const other = Array.from(pointers.entries()).find(([id]) => id !== event.pointerId)![1];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      if (before > 4 && after > 4) zoom(before / after);
    } else {
      const scale = camera.fov / Math.max(canvas.clientHeight, 1);
      aim((event.clientX - previous.x) * scale, (event.clientY - previous.y) * scale);
    }
    previous.x = event.clientX;
    previous.y = event.clientY;
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const wheel = (event: WheelEvent) => {
    if (!active()) return;
    event.preventDefault();
    zoom(Math.exp(Math.max(-100, Math.min(100, event.deltaY)) * .002));
  };
  const key = (event: KeyboardEvent) => {
    if (!active()) return;
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "+" || event.key === "=") zoom(.85);
    else if (event.key === "-") zoom(1 / .85);
    else aim(event.key === "ArrowLeft" ? 5 : event.key === "ArrowRight" ? -5 : 0, event.key === "ArrowUp" ? 5 : event.key === "ArrowDown" ? -5 : 0);
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("lostpointercapture", up);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("keydown", key);
  return () => {
    pointers.clear();
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    canvas.removeEventListener("lostpointercapture", up);
    canvas.removeEventListener("wheel", wheel);
    canvas.removeEventListener("keydown", key);
  };
}
