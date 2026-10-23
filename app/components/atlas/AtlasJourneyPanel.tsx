"use client";

import { useEffect, useReducer } from "react";
import { createJourneyPlayback, journeyPlaybackReducer, ORBITAL_JOURNEYS } from "@/lib/atlas/journeys";
import type { OrbitalSceneStateV1 } from "@/lib/atlas/scene/contracts";

type Props = { scene: OrbitalSceneStateV1; onSceneChange: (scene: OrbitalSceneStateV1) => void };

export default function AtlasJourneyPanel({ scene, onSceneChange }: Props) {
  const requestedJourneyId = scene.target.type === "journey" ? scene.target.id : scene.selection?.type === "journey" ? scene.selection.id : undefined;
  const [playback, dispatch] = useReducer(journeyPlaybackReducer, requestedJourneyId, createJourneyPlayback);
  const { journeyId, stepIndex, active, paused } = playback;
  const journey = ORBITAL_JOURNEYS.find((candidate) => candidate.id === journeyId) ?? ORBITAL_JOURNEYS[0];
  const step = journey.steps[stepIndex];

  useEffect(() => {
    if (!requestedJourneyId || !ORBITAL_JOURNEYS.some((item) => item.id === requestedJourneyId)) return;
    const frame = window.requestAnimationFrame(() => dispatch({ type: "select", journeyId: requestedJourneyId }));
    return () => window.cancelAnimationFrame(frame);
  }, [requestedJourneyId]);

  function apply(index: number) {
    const next = journeyPlaybackReducer(playback, { type: "step", index });
    if (next === playback) return;
    dispatch({ type: "step", index });
    onSceneChange(journey.steps[next.stepIndex].scene);
  }

  function start() {
    dispatch({ type: "start", scene });
    onSceneChange(journey.steps[0].scene);
  }

  function exit() {
    const previous = playback.sceneBeforeJourney;
    dispatch({ type: "exit" });
    if (previous) onSceneChange(previous);
  }

  return <section className="atlas-tool-panel" aria-labelledby="journey-title">
    <div><p className="eyebrow">JORNADAS GUIADAS</p><h2 id="journey-title">Narrativas com cena, tempo e fontes</h2><p>Os botões nativos Anterior e Próxima são acessíveis por teclado. A jornada não reproduz movimento automático.</p></div>
    <div className="atlas-tool-grid atlas-journey-grid"><article className="atlas-tool-card"><label>Jornada<select value={journeyId} onChange={(event) => dispatch({ type: "select", journeyId: event.target.value })}>{ORBITAL_JOURNEYS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}</select></label><p>{journey.summary}</p><div className="atlas-next-actions"><button type="button" onClick={start}>{active ? "Reiniciar" : "Começar"}</button><button type="button" disabled={!active} onClick={() => dispatch({ type: "pause" })}>{paused ? "Continuar" : "Pausar"}</button><button type="button" disabled={!active || paused || stepIndex === 0} onClick={() => apply(stepIndex - 1)}>Anterior</button><button type="button" disabled={!active || paused || stepIndex === journey.steps.length - 1} onClick={() => apply(stepIndex + 1)}>Próxima</button><button type="button" disabled={!active} onClick={exit}>Sair e restaurar</button></div><progress value={stepIndex + 1} max={journey.steps.length} aria-label="Progresso da jornada" /><p aria-live="polite">{active ? `Etapa ${stepIndex + 1} de ${journey.steps.length}${paused ? " · pausada" : ""}` : "Pronta para iniciar"}</p></article>
      <article className="atlas-tool-card"><h3>{step.title}</h3><p>{step.transcript}</p><p>Corpo em foco: {step.body}. UTC solicitado da etapa: {step.scene.requestedUtc}.</p><ul className="atlas-source-list">{step.citations.map((citation) => <li key={citation.href}><a href={citation.href}>{citation.label}</a></li>)}</ul></article>
      <article className="atlas-tool-card"><h3>Transcrição completa</h3><ol className="atlas-transcript">{journey.steps.map((item, index) => <li key={item.id}><strong>{index + 1}. {item.title}</strong><span>{item.transcript}</span></li>)}</ol></article></div>
  </section>;
}
