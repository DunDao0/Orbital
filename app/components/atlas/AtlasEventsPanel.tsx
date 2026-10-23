"use client";

import { useMemo, useState } from "react";
import { filterOrbitalEvents, ORBITAL_EVENTS, type OrbitalEventFilter } from "@/lib/atlas/events";
import type { OrbitalSceneStateV1 } from "@/lib/atlas/scene/contracts";

type Props = { scene: OrbitalSceneStateV1; onSceneChange: (scene: OrbitalSceneStateV1) => void };

export default function AtlasEventsPanel({ scene, onSceneChange }: Props) {
  const [filter, setFilter] = useState<OrbitalEventFilter>({ category: "all" });
  const events = useMemo(() => filterOrbitalEvents(ORBITAL_EVENTS, filter), [filter]);
  const targets = [...new Set(ORBITAL_EVENTS.flatMap((event) => event.targetIds ?? []))];
  return <section className="atlas-tool-panel" aria-labelledby="events-title">
    <div><p className="eyebrow">CENTRO DE EVENTOS</p><h2 id="events-title">Eventos com fonte, filtro e limites</h2><p>Não há evento ou geometria deduzidos por heurística no cliente.</p></div>
    <div className="atlas-tool-grid">
      <article className="atlas-tool-card"><h3>Filtros</h3>
        <label>Categoria<select value={filter.category ?? "all"} onChange={(event) => setFilter((current) => ({ ...current, category: event.target.value as OrbitalEventFilter["category"] }))}><option value="all">todas</option><option value="astronomy">astronômicos</option><option value="mission">missões</option><option value="earth">Terra</option></select></label>
        <label>Após UTC<input type="datetime-local" onChange={(event) => setFilter((current) => ({ ...current, dateFromUtc: event.target.value ? new Date(`${event.target.value}Z`).toISOString() : undefined }))} /></label>
        <label>Antes UTC<input type="datetime-local" onChange={(event) => setFilter((current) => ({ ...current, dateUntilUtc: event.target.value ? new Date(`${event.target.value}Z`).toISOString() : undefined }))} /></label>
        <label>Alvo<select value={filter.targetId ?? ""} onChange={(event) => setFilter((current) => ({ ...current, targetId: event.target.value || undefined }))}><option value="">todos</option>{targets.map((target) => <option key={target} value={target}>{target}</option>)}</select></label>
        <p aria-live="polite">{events.length} evento(s) encontrado(s).</p>
      </article>
      <article className="atlas-tool-card atlas-events-list"><h3>Resultados</h3>
        {events.length === 0 ? <p role="status">Nenhum evento para estes filtros.</p> : events.map((event) => <article key={event.id}><p className="eyebrow">{event.category}</p><h4>{event.title}</h4><p>{event.startUtc}{event.endUtc ? ` a ${event.endUtc}` : ""}</p><button type="button" onClick={() => onSceneChange({ ...scene, experience: "events", target: { type: "event", id: event.id }, selection: { type: "event", id: event.id }, requestedUtc: event.startUtc, panel: "event" })}>Selecionar evento e UTC</button><a href={event.source.href}>{event.source.name}</a>{event.limitations?.map((limit) => <small key={limit}>{limit}</small>)}</article>)}
      </article>
      <article className="atlas-tool-card"><h3>Geometria e camadas</h3><p>Os eventos deste MVP não têm geometria espacial publicada. Portanto nenhum contorno, rota ou camada foi desenhado como substituto.</p><p>Eventos de eclipse remetem ao serviço científico local; resultados dependem de localização e UTC fornecidos explicitamente na Janela da Terra.</p></article></div></section>;
}
