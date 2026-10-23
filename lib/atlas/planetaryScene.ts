import type { OrbitalSceneStateV1 } from "./scene/contracts.ts";
import { DEFAULT_ORBITAL_SCENE } from "./scene/state.ts";
import { ORBITAL_JOURNEYS } from "./journeys.ts";

export const ATLAS_PLANET_IDS = new Set(["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune", "pluto"]);

export function atlasDefaultScene(): OrbitalSceneStateV1 {
  return {
    ...DEFAULT_ORBITAL_SCENE,
    experience: "atlas",
    target: { type: "body", id: "mars" },
    selection: { type: "body", id: "mars" },
    layers: DEFAULT_ORBITAL_SCENE.layers.map((layer) => ({ ...layer })),
  };
}

/** Restore the semantic selection; it is not necessarily the globe's body. */
export function restoreAtlasScene(restored: OrbitalSceneStateV1 | null, queryPlanet: string | null): OrbitalSceneStateV1 {
  if (restored) {
    const next = { ...restored, experience: "atlas" as const };
    if (next.selection?.type === "journey" && !ORBITAL_JOURNEYS.some((journey) => journey.id === next.selection?.id)) delete next.selection;
    return next;
  }
  const base = atlasDefaultScene();
  if (!queryPlanet || !ATLAS_PLANET_IDS.has(queryPlanet)) return base;
  return { ...base, target: { type: "body", id: queryPlanet }, selection: { type: "body", id: queryPlanet } };
}

/** A missing globe is explicit context, never silently replaced with Mars. */
export function atlasVisualTarget(scene: OrbitalSceneStateV1): { planetId: string; notice?: string } {
  if (scene.target.type === "body" && ATLAS_PLANET_IDS.has(scene.target.id)) return { planetId: scene.target.id };
  if (scene.target.type === "body" && scene.target.id === "moon") {
    return { planetId: "earth", notice: "Lua selecionada como metadado. A Lua não é renderizada neste Atlas; o globo mostra a Terra como contexto. Nenhuma posição lunar foi inferida." };
  }
  return { planetId: "earth", notice: `O alvo “${scene.target.id}” não possui uma representação neste visor. A Terra permanece apenas como contexto visual, sem posição ou geometria inferida para o alvo.` };
}
