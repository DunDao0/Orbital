"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import AtlasJourneyPanel from "@/app/components/atlas/AtlasJourneyPanel";
import AtlasMeasurementPanel from "@/app/components/atlas/AtlasMeasurementPanel";
import AtlasMissionPanel from "@/app/components/atlas/AtlasMissionPanel";
import AtlasEventsPanel from "@/app/components/atlas/AtlasEventsPanel";
import EarthLabPanel from "@/app/components/atlas/EarthLabPanel";
import AtlasTerrainPanel from "@/app/components/atlas/AtlasTerrainPanel";
import AtlasAssistantPanel from "@/app/components/atlas/AtlasAssistantPanel";
import AtlasProjectPanel from "@/app/components/atlas/AtlasProjectPanel";
import { advanceClock, type ClockStep, type SimulationClockState } from "@/lib/atlas/clock";
import { globeLayerDefinitions } from "@/lib/atlas/layers";
import { sceneForSearchResult, searchOrbital } from "@/lib/atlas/search";
import { selectJourneyScene } from "@/lib/atlas/journeys";
import type { OrbitalSceneStateV1, OrbitalSearchResult } from "@/lib/atlas/scene/contracts";
import { DEFAULT_ORBITAL_SCENE, sceneHash, updateSceneLayer } from "@/lib/atlas/scene/state";
import type { MoonRecord, ReferenceSnapshot } from "@/lib/science/contracts";
import type { AtlasComparisonMode } from "@/app/components/PlanetSurfaceExplorer";

type Props = {
  scene: OrbitalSceneStateV1;
  onSceneChange: (scene: OrbitalSceneStateV1) => void;
  snapshot?: ReferenceSnapshot;
  moon?: MoonRecord;
  comparisonMode: AtlasComparisonMode;
  onComparisonChange: (mode: AtlasComparisonMode) => void;
  layerContext?: "earth" | "atlas";
};

function layerValue(scene: OrbitalSceneStateV1, id: string) {
  return scene.layers.find((layer) => layer.id === id) ?? { id, visible: false, opacity: 1 };
}

function ToolDisclosure({ title, description, open = false, children }: { title: string; description: string; open?: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => setExpanded(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);
  return <details className="atlas-control-section" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><span>{title}</span><small>{description}</small></summary>
    <div className="atlas-control-section-content">{children}</div>
  </details>;
}

export default function AtlasFoundationPanel({ scene, onSceneChange, snapshot, moon, comparisonMode, onComparisonChange, layerContext = "earth" }: Props) {
  const [clock, setClock] = useState<Omit<SimulationClockState, "utc">>({ mode: "paused", rate: 1, step: "hour" });
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const history = useRef<OrbitalSceneStateV1[]>([]);
  const sceneRef = useRef(scene);
  const [historyLength, setHistoryLength] = useState(0);
  const results = useMemo(() => searchOrbital(query), [query]);
  const layerDefinitions = globeLayerDefinitions(layerContext === "earth" ? "earth" : scene.target.id, layerContext === "earth");

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchInput.current?.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (clock.mode !== "playing") return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const currentScene = sceneRef.current;
      const next = advanceClock({ ...clock, utc: currentScene.requestedUtc });
      if (next.utc !== currentScene.requestedUtc) onSceneChange({ ...currentScene, requestedUtc: next.utc });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [clock, onSceneChange]);

  function changeScene(next: OrbitalSceneStateV1) {
    history.current = [...history.current.slice(-15), scene];
    setHistoryLength(history.current.length);
    onSceneChange(next);
  }

  function selectResult(result: OrbitalSearchResult) {
    if (result.type === "body" && result.targetId) {
      if (result.targetId === "sun") {
        window.location.assign("/");
        return;
      }
      const next = sceneForSearchResult(scene, result);
      if (result.targetId === "moon") {
        const earthScene = { ...next, experience: "earth" as const, panel: "overview" };
        if (window.location.pathname === "/atlas/earth") changeScene(earthScene);
        else window.location.assign(`/atlas/earth${sceneHash(earthScene)}`);
        return;
      }
      const atlasScene = { ...next, experience: "atlas" as const };
      if (window.location.pathname === "/atlas") changeScene(atlasScene);
      else if (result.targetId === "earth") changeScene({ ...next, experience: "earth" });
      else window.location.assign(`/atlas${sceneHash(atlasScene)}`);
      return;
    }
    if (result.type === "journey") {
      changeScene(selectJourneyScene(scene, result.id.replace(/^journey:/, "")));
      return;
    }
    if (result.type === "constellation") { window.location.assign("/atlas/earth/constellations"); return; }
    if (result.type === "mission") { window.location.assign(`/missions/${result.id.replace(/^mission:/, "")}`); return; }
    if (result.type === "event") { window.location.assign(`/events#${result.id}`); return; }
    changeScene(sceneForSearchResult(scene, result));
  }

  async function copySceneLink() {
    const value = `${window.location.origin}${window.location.pathname}${sceneHash(scene)}`;
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1_800); } catch { setCopied(false); }
  }

  function restoreDefaultScene() {
    const atlasRoute = window.location.pathname === "/atlas";
    changeScene({
      ...DEFAULT_ORBITAL_SCENE,
      experience: atlasRoute ? "atlas" : "earth",
      target: { type: "body", id: atlasRoute ? "mars" : "earth" },
      selection: { type: "body", id: atlasRoute ? "mars" : "earth" },
      layers: DEFAULT_ORBITAL_SCENE.layers.map((layer) => ({ ...layer })),
    });
  }

  return <section className="atlas-next-panel" aria-labelledby="atlas-next-title">
    <div><p className="eyebrow">ATLAS TEMPORAL</p><h2 id="atlas-next-title">Cena, tempo, camadas e busca</h2><p>Estado versionado no fragmento da URL. Ele não inclui coordenadas do observador.</p></div>
    <div className="atlas-next-grid">
      <article className="atlas-next-card"><h3>Estado da cena</h3><p>Experiência: {scene.experience} · alvo: {scene.target.id} · câmera: {scene.camera.mode} · UTC solicitado: {scene.requestedUtc}</p><div className="atlas-next-actions"><button type="button" onClick={copySceneLink}> {copied ? "Link copiado" : "Copiar link da cena"}</button><button type="button" disabled={historyLength === 0} onClick={() => { const previous = history.current.pop(); setHistoryLength(history.current.length); if (previous) onSceneChange(previous); }}>Voltar à vista</button><button type="button" onClick={restoreDefaultScene}>Restaurar padrão</button></div><p className="atlas-next-muted">A posição do observador exige opção explícita futura; ela nunca entra automaticamente neste link.</p></article>
      <article className="atlas-next-card"><h3>Relógio global</h3><label>UTC<input aria-label="UTC global" type="datetime-local" value={scene.requestedUtc.slice(0, 16)} onChange={(event) => { const next = new Date(`${event.target.value}Z`); if (!Number.isNaN(next.valueOf())) onSceneChange({ ...scene, requestedUtc: next.toISOString() }); }} /></label><div className="atlas-next-actions"><button type="button" onClick={() => setClock((current) => ({ ...current, mode: current.mode === "playing" ? "paused" : "playing" }))}>{clock.mode === "playing" ? "Pausar" : "Reproduzir"}</button><button type="button" onClick={() => { const next = advanceClock({ ...clock, utc: scene.requestedUtc }, -1); onSceneChange({ ...scene, requestedUtc: next.utc }); }}>Passo anterior</button><button type="button" onClick={() => { const next = advanceClock({ ...clock, utc: scene.requestedUtc }); onSceneChange({ ...scene, requestedUtc: next.utc }); }}>Próximo passo</button></div><label>Passo<select value={clock.step} onChange={(event) => setClock((current) => ({ ...current, step: event.target.value as ClockStep }))}><option value="second">segundo</option><option value="minute">minuto</option><option value="hour">hora</option><option value="day">dia</option></select></label><label>Velocidade<select value={clock.rate} onChange={(event) => setClock((current) => ({ ...current, rate: Number(event.target.value) }))}><option value="1">1×</option><option value="10">10×</option><option value="60">60×</option></select></label><p className="atlas-next-muted">Sem camada científica temporal ativa, o horário organiza a cena e não interpola dados astronômicos.</p></article>
      <article className="atlas-next-card atlas-search"><h3>Busca universal</h3><label>Buscar no Atlas (Ctrl+K)<input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Terra, Lua, jornada…" /></label><ul>{results.map((result) => <li key={result.id}><button type="button" onClick={() => selectResult(result)}><strong>{result.title}</strong><span>{result.subtitle ?? result.type}{result.hasPhysicalState ? " · estado físico disponível por fonte" : " · sem estado físico"}</span></button></li>)}</ul></article>
    </div>
    <ToolDisclosure title="Camadas e atribuição" description="Visibilidade, opacidade, fonte e limites" open={scene.panel === "layers"}>
      {layerDefinitions.length === 0 && <p className="atlas-next-muted">Este planeta usa seu perfil visual próprio. Os controles individuais de camadas estão disponíveis para a Terra.</p>}
      <div className="atlas-layer-list" aria-label="Camadas da cena">{layerDefinitions.map((definition) => {
        const value = layerValue(scene, definition.id);
        return <article key={definition.id} className={definition.enabled === false ? "atlas-layer unavailable" : "atlas-layer"}><label><input type="checkbox" checked={value.visible} disabled={definition.enabled === false} onChange={(event) => changeScene(updateSceneLayer(scene, definition.id, { visible: event.target.checked }))} /> {definition.title}</label>{definition.opacitySupported && <label>Opacidade <input aria-label={`Opacidade ${definition.title}`} type="range" min="0" max="100" value={Math.round(value.opacity * 100)} disabled={definition.enabled === false} onChange={(event) => changeScene(updateSceneLayer(scene, definition.id, { opacity: Number(event.target.value) / 100 }))} /></label>}<p>{definition.source.attribution}</p><small>{definition.status}{definition.coverage ? ` · ${definition.coverage.description}` : ""}{definition.limitations?.length ? ` · ${definition.limitations.join(" ")}` : ""}</small></article>;
      })}</div>
    </ToolDisclosure>
    <ToolDisclosure title="Medições e comparação" description="WGS84, estados físicos e dois viewports no mesmo renderer" open={scene.panel === "measurements"}>
      <AtlasMeasurementPanel snapshot={snapshot} moon={moon} comparisonMode={comparisonMode} onComparisonChange={onComparisonChange} />
    </ToolDisclosure>
    <ToolDisclosure title="Jornadas guiadas" description="Três narrativas declarativas e restauráveis" open={scene.panel === "journey"}>
      <AtlasJourneyPanel scene={scene} onSceneChange={changeScene} />
    </ToolDisclosure>
    <ToolDisclosure title="Missões" description="Manifestos e marcos sem trajetória inventada" open={scene.panel === "mission"}>
      <AtlasMissionPanel scene={scene} onSceneChange={changeScene} />
    </ToolDisclosure>
    <ToolDisclosure title="Eventos" description="Filtros, UTC, fontes e limitações" open={scene.panel === "event"}>
      <AtlasEventsPanel scene={scene} onSceneChange={changeScene} />
    </ToolDisclosure>
    {(scene.experience === "earth" || scene.target.id === "earth") && <>
      <ToolDisclosure title="Earth Lab" description="Contratos temporais e fixture offline desativada" open={scene.panel === "earth-lab"}><EarthLabPanel /></ToolDisclosure>
      <ToolDisclosure title="Superfície e terreno" description="Elipsoide WGS84 sem relevo inventado" open={scene.panel === "terrain"}><AtlasTerrainPanel scene={scene} onSceneChange={changeScene} /></ToolDisclosure>
    </>}
    <ToolDisclosure title="Projetos locais" description="Cenas, anotações e exportação .orbis.json" open={scene.panel === "projects"}><AtlasProjectPanel scene={scene} onSceneChange={changeScene} /></ToolDisclosure>
    <ToolDisclosure title="Pergunte ao Orbis" description="Assistente local sem localização nem ciência inventada" open={scene.panel === "assistant"}><AtlasAssistantPanel scene={scene} onSceneChange={changeScene} /></ToolDisclosure>
  </section>;
}
