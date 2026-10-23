import type { OrbitalCameraMode, OrbitalExperience, OrbitalSceneLayerState, OrbitalSceneStateV1, OrbitalTargetType } from "./contracts";

const CAMERA_MODES: OrbitalCameraMode[] = ["overview", "orbit", "surface", "ride-along", "observer", "north-pole", "orbital-plane"];
const TARGET_TYPES: OrbitalTargetType[] = ["body", "mission", "earth-place", "event", "journey", "constellation"];
const EXPERIENCES: OrbitalExperience[] = ["atlas", "earth", "constellations", "missions", "events", "journeys"];

export const DEFAULT_ORBITAL_LAYERS: OrbitalSceneLayerState[] = [
  { id: "earth-atmosphere", visible: true, opacity: 1 },
  { id: "earth-clouds", visible: true, opacity: 1 },
  { id: "earth-grid", visible: false, opacity: 0.34 },
  { id: "earth-observer-marker", visible: false, opacity: 0.95 },
  { id: "atlas-orbits", visible: true, opacity: 0.65 },
  { id: "atlas-labels", visible: true, opacity: 1 },
  { id: "sky-gaia-stars", visible: true, opacity: 1 },
  { id: "sky-iau-boundaries", visible: true, opacity: 1 },
  { id: "sky-selected-constellation", visible: true, opacity: 1 },
  { id: "sky-horizon-grid", visible: true, opacity: 0.46 },
  { id: "sky-cardinal-directions", visible: true, opacity: 0.92 },
  { id: "sky-cultural-lines", visible: false, opacity: 1 },
];

/**
 * Renderer-facing subset of the serializable scene layers. Keeping this
 * transformation beside the hash contract prevents the panel and WebGL scene
 * from disagreeing after a shared link is reloaded.
 */
export type EarthRenderLayers = {
  atmosphere: boolean;
  clouds: boolean;
  latitudeLongitudeGrid: boolean;
  observerMarker: boolean;
  atmosphereOpacity: number;
  cloudsOpacity: number;
  latitudeLongitudeGridOpacity: number;
  observerMarkerOpacity: number;
};

export const DEFAULT_EARTH_RENDER_LAYERS: EarthRenderLayers = {
  atmosphere: true,
  clouds: true,
  latitudeLongitudeGrid: false,
  observerMarker: false,
  atmosphereOpacity: 1,
  cloudsOpacity: 1,
  latitudeLongitudeGridOpacity: 0.34,
  observerMarkerOpacity: 0.95,
};

export const DEFAULT_ORBITAL_SCENE: OrbitalSceneStateV1 = {
  version: 1,
  experience: "earth",
  target: { type: "body", id: "earth" },
  requestedUtc: "2026-08-05T00:00:00.000Z",
  camera: { mode: "orbit", distance: 5.5, headingDeg: 0, pitchDeg: 0, rollDeg: 0 },
  layers: DEFAULT_ORBITAL_LAYERS,
  panel: "overview",
};

/** Semantic observer-scene state. Location is deliberately not a member. */
export const DEFAULT_CONSTELLATION_SCENE: OrbitalSceneStateV1 = {
  ...DEFAULT_ORBITAL_SCENE,
  experience: "constellations",
  target: { type: "body", id: "earth" },
  selection: { type: "constellation", id: "Ori" },
  camera: { mode: "observer", distance: 1, headingDeg: 0, pitchDeg: 0, rollDeg: 0 },
  panel: "constellation",
};

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function utc(value: unknown, fallback: string): string {
  if (typeof value !== "string" || Number.isNaN(new Date(value).valueOf())) return fallback;
  return new Date(value).toISOString();
}

export function validateSceneState(value: unknown): OrbitalSceneStateV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) return null;
  const target = raw.target as Record<string, unknown> | undefined;
  const camera = raw.camera as Record<string, unknown> | undefined;
  if (!target || !camera || typeof target.id !== "string" || !TARGET_TYPES.includes(target.type as OrbitalTargetType) || !CAMERA_MODES.includes(camera.mode as OrbitalCameraMode)) return null;
  const rawLayers = Array.isArray(raw.layers) ? raw.layers : [];
  const layers = rawLayers.flatMap((layer): OrbitalSceneLayerState[] => {
    if (!layer || typeof layer !== "object") return [];
    const item = layer as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.visible !== "boolean") return [];
    return [{ id: item.id, visible: item.visible, opacity: Math.min(1, Math.max(0, finite(item.opacity, 1))) }];
  });
  const selection = raw.selection && typeof raw.selection === "object" && typeof (raw.selection as Record<string, unknown>).id === "string" && typeof (raw.selection as Record<string, unknown>).type === "string" ? { type: (raw.selection as Record<string, string>).type, id: (raw.selection as Record<string, string>).id } : undefined;
  const state: OrbitalSceneStateV1 = {
    version: 1,
    target: { type: target.type as OrbitalTargetType, id: target.id },
    // v1 links from before the explicit name used `utc`; accept them only as a
    // migration input and serialize the unambiguous `requestedUtc` thereafter.
    experience: EXPERIENCES.includes(raw.experience as OrbitalExperience) ? raw.experience as OrbitalExperience : DEFAULT_ORBITAL_SCENE.experience,
    requestedUtc: utc(raw.requestedUtc ?? raw.utc, DEFAULT_ORBITAL_SCENE.requestedUtc),
    camera: {
      mode: camera.mode as OrbitalCameraMode,
      distance: Math.max(0.01, finite(camera.distance, DEFAULT_ORBITAL_SCENE.camera.distance)),
      headingDeg: finite(camera.headingDeg, 0),
      pitchDeg: finite(camera.pitchDeg, 0),
      rollDeg: finite(camera.rollDeg, 0),
    },
    layers: layers.length ? layers : DEFAULT_ORBITAL_LAYERS.map((layer) => ({ ...layer })),
    panel: typeof raw.panel === "string" ? raw.panel : undefined,
  };
  if (selection) state.selection = selection;
  if (!state.panel) delete state.panel;
  return state;
}

export function serializeSceneState(state: OrbitalSceneStateV1): string {
  return encodeURIComponent(JSON.stringify(state));
}

export function sceneStateFromHash(hash: string): OrbitalSceneStateV1 | null {
  const value = new URLSearchParams(hash.replace(/^#/, "")).get("scene");
  if (!value) return null;
  try { return validateSceneState(JSON.parse(value)); } catch { return null; }
}

export function sceneHash(state: OrbitalSceneStateV1): string {
  return `#scene=${serializeSceneState(state)}`;
}

export function updateSceneLayer(state: OrbitalSceneStateV1, id: string, patch: Partial<Pick<OrbitalSceneLayerState, "visible" | "opacity">>): OrbitalSceneStateV1 {
  const existing = state.layers.find((layer) => layer.id === id);
  const next = { id, visible: patch.visible ?? existing?.visible ?? false, opacity: Math.min(1, Math.max(0, patch.opacity ?? existing?.opacity ?? 1)) };
  return { ...state, layers: [...state.layers.filter((layer) => layer.id !== id), next] };
}

export function earthRenderLayersFromScene(scene: OrbitalSceneStateV1): EarthRenderLayers {
  return scene.layers.reduce<EarthRenderLayers>((layers, layer) => {
    if (layer.id === "earth-atmosphere") return { ...layers, atmosphere: layer.visible, atmosphereOpacity: layer.opacity };
    if (layer.id === "earth-clouds") return { ...layers, clouds: layer.visible, cloudsOpacity: layer.opacity };
    if (layer.id === "earth-grid") return { ...layers, latitudeLongitudeGrid: layer.visible, latitudeLongitudeGridOpacity: layer.opacity };
    if (layer.id === "earth-observer-marker") return { ...layers, observerMarker: layer.visible, observerMarkerOpacity: layer.opacity };
    return layers;
  }, { ...DEFAULT_EARTH_RENDER_LAYERS });
}
