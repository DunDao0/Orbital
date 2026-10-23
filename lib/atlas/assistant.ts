import type { OrbitalSceneStateV1 } from "./scene/contracts";

export type OrbitalAssistantContext = { experience: string; targetId: string; requestedUtc: string; visibleLayers: string[]; selectedObjectId?: string; cameraMode: string; scienceResponseIds?: string[] };
export type AssistantReply = { status: "ready" | "unavailable"; text: string; sources: Array<{ label: string; href: string }>; action?: { type: "focus" | "open-panel" | "toggle-layer" | "journey" | "camera"; value: string } };

export function createAssistantContext(scene: OrbitalSceneStateV1): OrbitalAssistantContext { return { experience: scene.experience, targetId: scene.target.id, requestedUtc: scene.requestedUtc, visibleLayers: scene.layers.filter((layer) => layer.visible).map((layer) => layer.id), selectedObjectId: scene.selection?.id, cameraMode: scene.camera.mode }; }

export function answerAtlasQuestion(question: string, context: OrbitalAssistantContext): AssistantReply {
  const query = question.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  if (query.includes("camada")) return { status: "ready", text: `Camadas visíveis: ${context.visibleLayers.join(", ") || "nenhuma"}. As camadas procedurais são visuais e não dados temporais.`, sources: [{ label: "Camadas do Atlas", href: "/atlas/earth#atlas-next-title" }], action: { type: "open-panel", value: "layers" } };
  if (query.includes("terra") || query.includes("lua")) return { status: "ready", text: `A cena atual solicita UTC ${context.requestedUtc}. A Terra e a Lua só exibem valores científicos quando a resposta de snapshot ou catálogo os fornece.`, sources: [{ label: "Snapshot de referência", href: "/reference-snapshot.json" }], action: { type: "focus", value: context.targetId } };
  return { status: "unavailable", text: "Indisponível: esta pergunta exigiria um modelo externo ou um cálculo científico que não está disponível no contexto atual. Nenhum valor foi estimado.", sources: [] };
}
