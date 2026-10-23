import type { OrbitalSceneStateV1 } from "./scene/contracts";
import { DEFAULT_ORBITAL_SCENE } from "./scene/state.ts";

export type OrbitalJourneyStep = { id: string; title: string; body: string; scene: OrbitalSceneStateV1; transcript: string; citations: Array<{ label: string; href: string }> };
export type OrbitalJourney = { id: string; title: string; summary: string; steps: OrbitalJourneyStep[] };

function scene(body: string, mode: OrbitalSceneStateV1["camera"]["mode"] = "orbit"): OrbitalSceneStateV1 { return { ...DEFAULT_ORBITAL_SCENE, experience: "journeys", target: { type: "body", id: body }, camera: { ...DEFAULT_ORBITAL_SCENE.camera, mode }, selection: { type: "body", id: body } }; }

export const ORBITAL_JOURNEYS: OrbitalJourney[] = [
  { id: "solar-scale", title: "Escala do Sistema Solar", summary: "A escala visual é separada das distâncias físicas.", steps: [
    { id: "solar-scale-overview", title: "Uma cena legível", body: "earth", scene: scene("earth", "overview"), transcript: "O visor pode comprimir distâncias para leitura, mas os valores físicos continuam no snapshot ou no integrador. Nenhuma medida da interface usa a escala visual.", citations: [{ label: "Documentação de visualização orbital", href: "/docs/orbital-visualization.md" }] },
    { id: "solar-scale-orbit", title: "Órbitas e fonte", body: "earth", scene: scene("earth", "orbital-plane"), transcript: "As trajetórias desenhadas são osculantes e não uma efeméride futura. A fonte e a época devem acompanhar cada leitura científica.", citations: [{ label: "Snapshot de referência", href: "/reference-snapshot.json" }] },
  ] },
  { id: "earth-moon", title: "Terra e Lua", summary: "Catálogo e estado de referência têm papéis diferentes.", steps: [
    { id: "earth-moon-earth", title: "Terra visual", body: "earth", scene: scene("earth", "orbit"), transcript: "Atmosfera, nuvens e grade são adaptadores visuais. Eles não modificam o estado físico da Terra.", citations: [{ label: "Referências visuais", href: "/atlas/CREDITS.md" }] },
    { id: "earth-moon-moon", title: "Lua catalogada", body: "moon", scene: scene("moon", "orbit"), transcript: "A Lua é exibida como satélite apenas quando há estado explícito. Os elementos médios de outros satélites permanecem metadados, não posições inventadas.", citations: [{ label: "Catálogo lunar", href: "/scientific/moons.json" }] },
  ] },
  { id: "eclipse", title: "Como um eclipse acontece", summary: "O resultado local depende da geometria topocêntrica e do horário.", steps: [
    { id: "eclipse-observer", title: "Observador e UTC", body: "earth", scene: scene("earth", "observer"), transcript: "Latitude, longitude, altitude e UTC são enviados somente quando o usuário calcula. Não entram automaticamente em links compartilhados.", citations: [{ label: "Limitações científicas", href: "/docs/limitations.md" }] },
    { id: "eclipse-result", title: "Cálculo disponível", body: "earth", scene: scene("earth", "orbit"), transcript: "Sem serviço científico, o Atlas declara indisponibilidade. Ele não estima contatos nem inventa um eclipse para preencher a narrativa.", citations: [{ label: "Método e validação", href: "/docs/validation.md" }] },
  ] },
];

/** Choosing a narrative must not replace the body before its first step. */
export function selectJourneyScene(scene: OrbitalSceneStateV1, journeyId: string): OrbitalSceneStateV1 {
  if (!ORBITAL_JOURNEYS.some((journey) => journey.id === journeyId)) return scene;
  return { ...scene, experience: "journeys", selection: { type: "journey", id: journeyId }, panel: "journey" };
}

export type JourneyPlaybackState = {
  journeyId: string;
  stepIndex: number;
  active: boolean;
  paused: boolean;
  sceneBeforeJourney: OrbitalSceneStateV1 | null;
};

type JourneyPlaybackAction =
  | { type: "select"; journeyId: string }
  | { type: "start"; scene: OrbitalSceneStateV1 }
  | { type: "step"; index: number }
  | { type: "pause" }
  | { type: "exit" };

export function createJourneyPlayback(journeyId?: string): JourneyPlaybackState {
  return { journeyId: ORBITAL_JOURNEYS.find((journey) => journey.id === journeyId)?.id ?? ORBITAL_JOURNEYS[0].id, stepIndex: 0, active: false, paused: false, sceneBeforeJourney: null };
}

/** Playback identity survives a step changing the scene's selected body. */
export function journeyPlaybackReducer(state: JourneyPlaybackState, action: JourneyPlaybackAction): JourneyPlaybackState {
  if (action.type === "select") return createJourneyPlayback(action.journeyId);
  if (action.type === "start") return { ...state, active: true, paused: false, stepIndex: 0, sceneBeforeJourney: state.sceneBeforeJourney ?? action.scene };
  if (action.type === "exit") return { ...state, active: false, paused: false, sceneBeforeJourney: null };
  if (action.type === "pause") return state.active ? { ...state, paused: !state.paused } : state;
  if (!state.active || state.paused) return state;
  const journey = ORBITAL_JOURNEYS.find((item) => item.id === state.journeyId)!;
  return { ...state, stepIndex: Math.max(0, Math.min(action.index, journey.steps.length - 1)) };
}
