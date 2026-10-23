import type { FlyToRequest, OrbitalCameraMode, OrbitalSceneStateV1 } from "./scene/contracts";

export function applyFlyTo(scene: OrbitalSceneStateV1, request: FlyToRequest): OrbitalSceneStateV1 {
  const mode: OrbitalCameraMode = request.cameraPreset ?? "orbit";
  return { ...scene, target: { type: "body", id: request.targetId }, requestedUtc: request.requestedUtc ?? scene.requestedUtc, camera: { ...scene.camera, mode, distance: mode === "surface" ? 1.62 : mode === "overview" ? 7 : scene.camera.distance }, selection: { type: "body", id: request.targetId } };
}
