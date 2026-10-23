"use client";

import { useMemo, useState } from "react";
import { missionTemporalState, ORBITAL_MISSIONS } from "@/lib/atlas/missions";
import type { OrbitalSceneStateV1 } from "@/lib/atlas/scene/contracts";

type Props = { scene: OrbitalSceneStateV1; onSceneChange: (scene: OrbitalSceneStateV1) => void; initialMissionId?: string };

export default function AtlasMissionPanel({ scene, onSceneChange, initialMissionId }: Props) {
  const [missionId, setMissionId] = useState(initialMissionId ?? ORBITAL_MISSIONS[0].id);
  const mission = useMemo(() => ORBITAL_MISSIONS.find((item) => item.id === missionId) ?? ORBITAL_MISSIONS[0], [missionId]);
  const status = missionTemporalState(mission, scene.requestedUtc);
  const focusMilestone = (utc: string) => onSceneChange({ ...scene, experience: "missions", target: { type: "mission", id: mission.id }, selection: { type: "mission", id: mission.id }, requestedUtc: utc, panel: "mission" });

  return <section className="atlas-tool-panel" aria-labelledby="missions-title"><div><p className="eyebrow">EXPLORADOR DE MISSÕES</p><h2 id="missions-title">Manifestos, marcos e cobertura temporal</h2><p>Esta primeira missão tem linha do tempo histórica e proveniência. Não há bundle de trajetória 3D aprovado neste projeto.</p></div><div className="atlas-tool-grid"><article className="atlas-tool-card"><label>Missão<select value={missionId} onChange={(event) => setMissionId(event.target.value)}>{ORBITAL_MISSIONS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><dl><div><dt>Agência</dt><dd>{mission.agency}</dd></div><div><dt>Referencial espacial</dt><dd>{mission.frame === "not-applicable/no-trajectory" ? "não aplicável — trajetória indisponível" : mission.frame}</dd></div><div><dt>Escala de tempo</dt><dd>{mission.timeScale}</dd></div><div><dt>Corpos-alvo</dt><dd>{mission.targetBodies.join(" · ")}</dd></div><div><dt>Cobertura</dt><dd>{mission.coverage.validFromUtc} a {mission.coverage.validUntilUtc}</dd></div><div><dt>Estado no UTC solicitado</dt><dd>{status === "out-of-coverage" ? "fora da cobertura — não extrapolado" : status}</dd></div></dl><button type="button" disabled>Acompanhar espaçonave indisponível</button><p className="atlas-next-muted">Sem bundle científico segmentado, não há posição, velocidade ou trajetória simulada.</p></article><article className="atlas-tool-card"><h3>Linha do tempo</h3><ol className="atlas-transcript">{mission.milestones.map((milestone) => <li key={milestone.utc}><strong>{milestone.title}</strong><span>{milestone.utc} · {milestone.description}</span><button type="button" className="quiet" onClick={() => focusMilestone(milestone.utc)}>Aplicar UTC e focar missão</button></li>)}</ol></article><article className="atlas-tool-card"><h3>Proveniência</h3><ul className="atlas-source-list">{mission.sources.map((source) => <li key={source.href}><a href={source.href} target="_blank" rel="noreferrer">{source.name} ↗</a></li>)}</ul><p>Trajetória 3D: indisponível, sem dado substituto. O controlador de cena recebe somente o identificador da missão e um marco com UTC conhecido.</p></article></div></section>;
}
