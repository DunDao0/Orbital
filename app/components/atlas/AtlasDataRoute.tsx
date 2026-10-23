"use client";

import Link from "@/app/components/AppLink";
import { useState } from "react";
import AtlasEventsPanel from "@/app/components/atlas/AtlasEventsPanel";
import AtlasMissionPanel from "@/app/components/atlas/AtlasMissionPanel";
import type { OrbitalSceneStateV1 } from "@/lib/atlas/scene/contracts";
import { DEFAULT_ORBITAL_SCENE, sceneHash } from "@/lib/atlas/scene/state";

type Props = { kind: "missions" | "events"; missionId?: string };

export default function AtlasDataRoute({ kind, missionId }: Props) {
  const [scene, setScene] = useState<OrbitalSceneStateV1>({ ...DEFAULT_ORBITAL_SCENE, experience: kind });
  const title = kind === "missions" ? "Missões sem trajetória inventada." : "Eventos com fonte e limites claros.";
  const applyToViewer = (next: OrbitalSceneStateV1) => {
    setScene(next);
    window.location.assign(`/atlas/earth${sceneHash(next)}`);
  };
  return <main className="atlas-shell"><header className="atlas-topbar"><Link href="/atlas/earth">← Janela da Terra</Link><span>{kind === "missions" ? "MISSÕES" : "EVENTOS"} · DADOS E DESCOBERTA</span></header><section className="atlas-intro"><p className="eyebrow">ATLAS ORBITAL</p><h1>{title}</h1><p>Esta rota não cria WebGL. Ao selecionar um marco ou evento, o estado versionado abre a Janela da Terra com o UTC e a seleção aplicados.</p></section>{kind === "missions" ? <AtlasMissionPanel scene={scene} onSceneChange={applyToViewer} initialMissionId={missionId} /> : <AtlasEventsPanel scene={scene} onSceneChange={applyToViewer} />}</main>;
}
