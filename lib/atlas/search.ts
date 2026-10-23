import type { OrbitalSceneStateV1, OrbitalSearchResult } from "./scene/contracts";
import { applyFlyTo } from "./camera.ts";

const INDEX: OrbitalSearchResult[] = [
  { id: "body:sun", type: "body", title: "Sol", targetId: "sun", aliases: ["sun", "10"], hasPhysicalState: true },
  { id: "body:mercury", type: "body", title: "Mercúrio", targetId: "mercury", aliases: ["mercury"], hasPhysicalState: true },
  { id: "body:venus", type: "body", title: "Vênus", targetId: "venus", aliases: ["venus"], hasPhysicalState: true },
  { id: "body:earth", type: "body", title: "Terra", targetId: "earth", aliases: ["earth", "399"], hasPhysicalState: true },
  { id: "body:moon", type: "body", title: "Lua", targetId: "moon", aliases: ["moon", "luna", "301"], hasPhysicalState: true },
  { id: "body:mars", type: "body", title: "Marte", targetId: "mars", aliases: ["mars"], hasPhysicalState: true },
  { id: "body:jupiter", type: "body", title: "Júpiter", targetId: "jupiter", aliases: ["jupiter"], hasPhysicalState: true },
  { id: "body:saturn", type: "body", title: "Saturno", targetId: "saturn", aliases: ["saturn"], hasPhysicalState: true },
  { id: "body:uranus", type: "body", title: "Urano", targetId: "uranus", aliases: ["uranus"], hasPhysicalState: true },
  { id: "body:neptune", type: "body", title: "Netuno", targetId: "neptune", aliases: ["neptune"], hasPhysicalState: true },
  { id: "body:pluto", type: "body", title: "Plutão", targetId: "pluto", aliases: ["pluto", "134340"], hasPhysicalState: false, subtitle: "Planeta anão; sem estado no snapshot atual" },
  { id: "moon-metadata:earth", type: "moon-metadata", title: "Satélites da Terra", subtitle: "Catálogo de metadados; não posiciona luas sem estado", aliases: ["luas", "satelites"], hasPhysicalState: false },
  { id: "constellation:iau", type: "constellation", title: "Constelações IAU", subtitle: "Limites de catálogo, sem linhas culturais", aliases: ["constelacao", "ceu"], hasPhysicalState: false },
  { id: "journey:solar-scale", type: "journey", title: "Jornada: Escala do Sistema Solar", subtitle: "Narrativa com dados de referência", hasPhysicalState: false },
  { id: "journey:earth-moon", type: "journey", title: "Jornada: Terra e Lua", subtitle: "Snapshot e catálogo lunar", hasPhysicalState: false },
  { id: "journey:eclipse", type: "journey", title: "Jornada: Como um eclipse acontece", subtitle: "Sem prever um evento novo", hasPhysicalState: false },
  { id: "mission:apollo-11", type: "mission", title: "Missão: Apollo 11", subtitle: "Manifesto histórico com fonte", hasPhysicalState: false },
  { id: "event:apollo-11-launch", type: "event", title: "Evento: lançamento da Apollo 11", subtitle: "Evento histórico", hasPhysicalState: false },
  { id: "command:surface", type: "command", title: "Comando: modo superfície", aliases: ["superficie", "solo"], hasPhysicalState: false },
  { id: "command:overview", type: "command", title: "Comando: visão geral", aliases: ["visao", "orbita"], hasPhysicalState: false },
];

function comparable(value: string): string { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase(); }

export function searchOrbital(query: string): OrbitalSearchResult[] {
  const terms = comparable(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return INDEX.slice(0, 8);
  return INDEX.filter((item) => terms.every((term) => comparable([item.title, item.subtitle ?? "", ...(item.aliases ?? [])].join(" ")).includes(term))).slice(0, 10);
}

/** Selection must change the same target consumed by the planet renderer. */
export function sceneForSearchResult(scene: OrbitalSceneStateV1, result: OrbitalSearchResult): OrbitalSceneStateV1 {
  if (result.id === "command:surface") return { ...scene, camera: { ...scene.camera, mode: "surface", distance: 1.62 }, panel: "terrain" };
  if (result.id === "command:overview") return { ...scene, camera: { ...scene.camera, mode: "overview", distance: 7 }, panel: "overview" };
  if (result.type === "body" && result.targetId) {
    return { ...applyFlyTo({ ...scene, camera: { ...scene.camera, distance: 5.5 } }, { targetId: result.targetId, cameraPreset: "orbit" }), panel: "overview" };
  }
  return { ...scene, selection: { type: result.type, id: result.id }, panel: result.type };
}
