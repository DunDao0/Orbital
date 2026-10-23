export type OrbitalTargetType = "body" | "mission" | "earth-place" | "event" | "journey" | "constellation";
export type OrbitalCameraMode = "overview" | "orbit" | "surface" | "ride-along" | "observer" | "north-pole" | "orbital-plane";
/** The route family that owns the presentation, never a physical reference frame. */
export type OrbitalExperience = "atlas" | "earth" | "constellations" | "missions" | "events" | "journeys";

export interface OrbitalSceneLayerState {
  id: string;
  visible: boolean;
  opacity: number;
}

export interface OrbitalSceneStateV1 {
  version: 1;
  experience: OrbitalExperience;
  target: { type: OrbitalTargetType; id: string };
  /** Requested display time. It does not imply an interpolated scientific state. */
  requestedUtc: string;
  camera: {
    mode: OrbitalCameraMode;
    distance: number;
    headingDeg: number;
    pitchDeg: number;
    rollDeg: number;
  };
  layers: OrbitalSceneLayerState[];
  selection?: { type: string; id: string };
  panel?: string;
}

export type FlyToRequest = {
  targetId: string;
  cameraPreset?: OrbitalCameraMode;
  durationMs?: number;
  requestedUtc?: string;
};

export type OrbitalSearchResult = {
  id: string;
  type: "body" | "moon-metadata" | "constellation" | "mission" | "event" | "earth-place" | "journey" | "command";
  title: string;
  subtitle?: string;
  targetId?: string;
  aliases?: string[];
  /** Whether selecting this item can use a state supplied by the scientific source. */
  hasPhysicalState: boolean;
};
