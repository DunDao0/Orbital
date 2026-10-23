import type { Metadata } from "next";
import Link from "@/app/components/AppLink";
import SiteSidebar from "@/app/components/SiteSidebar";
import { ORBITAL_JOURNEYS } from "@/lib/atlas/journeys";
import { sceneHash } from "@/lib/atlas/scene/state";

export const metadata: Metadata = { title: "Jornadas | Atlas Planetário | Orbis Scientia", description: "Transcrições e fontes das jornadas guiadas do Atlas." };

export default function AtlasJourneysPage() {
  return <div className="app-frame"><SiteSidebar active="atlas" /><main className="atlas-shell"><header className="atlas-topbar"><Link href="/atlas/earth">← Janela da Terra</Link><span>JORNADAS · TEXTO E FONTES</span></header><section className="atlas-intro"><p className="eyebrow">JORNADAS GUIADAS</p><h1>Histórias que continuam legíveis fora do canvas.</h1><p>Inicie uma jornada na Janela da Terra para aplicar cada cena ao controlador universal. Esta rota mantém a transcrição e as referências acessíveis sem WebGL.</p></section><div className="atlas-tool-grid">{ORBITAL_JOURNEYS.map((journey) => {
    const firstScene = journey.steps[0].scene;
    const launchScene = { ...firstScene, experience: "journeys" as const, target: { type: "journey" as const, id: journey.id }, selection: { type: "journey", id: journey.id }, panel: "journey" };
    return <article className="atlas-tool-card" key={journey.id} id={journey.id}><h2>{journey.title}</h2><p>{journey.summary}</p><ol className="atlas-transcript">{journey.steps.map((step) => <li key={step.id}><strong>{step.title}</strong><span>{step.transcript}</span>{step.citations.map((citation) => <a key={citation.href} href={citation.href}>{citation.label}</a>)}</li>)}</ol><Link className="atlas-object-link" href={`/atlas/earth${sceneHash(launchScene)}`}>Executar no Atlas da Terra</Link></article>;
  })}</div></main></div>;
}
