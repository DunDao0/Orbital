"use client";

import { useState } from "react";
import { answerAtlasQuestion, createAssistantContext, type AssistantReply } from "@/lib/atlas/assistant";
import type { OrbitalSceneStateV1 } from "@/lib/atlas/scene/contracts";
import { updateSceneLayer } from "@/lib/atlas/scene/state";

type Props = { scene: OrbitalSceneStateV1; onSceneChange: (scene: OrbitalSceneStateV1) => void };

function applyAssistantAction(scene: OrbitalSceneStateV1, reply: AssistantReply): OrbitalSceneStateV1 | null {
  if (!reply.action) return null;
  if (reply.action.type === "focus") return { ...scene, target: { type: "body", id: reply.action.value }, selection: { type: "body", id: reply.action.value } };
  if (reply.action.type === "open-panel") return { ...scene, panel: reply.action.value };
  if (reply.action.type === "toggle-layer") return updateSceneLayer(scene, reply.action.value, { visible: true });
  if (reply.action.type === "camera") return { ...scene, camera: { ...scene.camera, mode: reply.action.value as OrbitalSceneStateV1["camera"]["mode"] } };
  if (reply.action.type === "journey") return { ...scene, panel: "journey", selection: { type: "journey", id: reply.action.value } };
  return null;
}

export default function AtlasAssistantPanel({ scene, onSceneChange }: Props) {
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const context = createAssistantContext(scene);
  function ask() { setReply(answerAtlasQuestion(question, context)); }
  const actionScene = reply ? applyAssistantAction(scene, reply) : null;
  return <section className="atlas-tool-panel" aria-labelledby="assistant-title"><div><p className="eyebrow">PERGUNTE AO ORBITAL</p><h2 id="assistant-title">Assistência contextual, local e limitada</h2><p>Não usa chave no frontend nem envia localização. Perguntas que exigem efemérides, modelo externo ou dado ausente permanecem indisponíveis.</p></div><div className="atlas-tool-grid"><article className="atlas-tool-card"><label>Pergunta sobre a cena atual<input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") ask(); }} placeholder="Ex.: quais camadas estão visíveis?" /></label><button type="button" onClick={ask}>Perguntar</button><p className="atlas-next-muted">Contexto enviado à resposta local: experiência, alvo, UTC solicitado, câmera, objeto selecionado e IDs de camadas visíveis.</p></article><article className="atlas-tool-card"><h3>Resposta</h3>{reply ? <><p aria-live="polite">{reply.text}</p>{reply.sources.length > 0 && <ul className="atlas-source-list">{reply.sources.map((source) => <li key={source.href}><a href={source.href}>{source.label}</a></li>)}</ul>}{actionScene && <button type="button" onClick={() => onSceneChange(actionScene)}>Aplicar ação permitida</button>}</> : <p>Faça uma pergunta para consultar o contexto local.</p>}</article><article className="atlas-tool-card"><h3>Privacidade e limites</h3><dl><div><dt>Localização precisa</dt><dd>não faz parte do contexto</dd></div><div><dt>Credenciais</dt><dd>não são usadas</dd></div><div><dt>Dados científicos ausentes</dt><dd>respondem como indisponíveis</dd></div><div><dt>Renderer</dt><dd>ações passam pelo controlador de cena</dd></div></dl></article></div></section>;
}
