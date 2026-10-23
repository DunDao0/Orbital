"use client";

import Link from "@/app/components/AppLink";

import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import SiteSidebar from "@/app/components/SiteSidebar";
import CoverageNotice from "@/app/components/science/CoverageNotice";
import MethodNotice from "@/app/components/science/MethodNotice";
import ObserverFields from "@/app/components/science/ObserverFields";
import ProvenanceCard from "@/app/components/science/ProvenanceCard";
import ScienceStatus from "@/app/components/science/ScienceStatus";
import { scienceGateway } from "@/lib/science/client";
import { advanceFixedSteps, PHYSICS_STEP_S } from "@/lib/science/nbody";
import { isJsonObject, type LocalEclipseResponse, type MoonCatalogue, type MoonRecord, type ReferenceSnapshot, type ScienceCapabilities, type ScienceResource, type SkyResponse } from "@/lib/science/contracts";
import { ScienceRequestError } from "@/lib/science/errors";
import { parseObserverFields } from "@/lib/science/observerFields";

const SolarSystemScene = lazy(() => import("@/app/components/SolarSystemScene"));

type Body = {
  name: string;
  naif_id: number;
  body_naif_id: number;
  state_target_naif_id: number;
  state_center_naif_id: number;
  state_kind: "physical-center" | "system-barycenter";
  state_target_name: string;
  mu_m3_s2: number;
  radius_m: number;
  color: string;
  position_m: number[];
  velocity_m_s: number[];
};

type DataStatus = {
  manifest_generated_utc: string;
  reference_snapshot: { epoch: string | null; source: string | null; body_count: number };
  kernels: { count: number; manifest: string };
  catalogs: {
    moons: { count: number; by_primary: Record<string, number>; source: string[] | null };
    stars: { count: number; source: string | null };
    constellations: { count: number; source: string | null };
  };
  provenance: string;
};

type Moon = MoonRecord;

const AU = 149_597_870_700;
const MOON_PRIMARY_OPTIONS = ["Earth", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const ATLAS_PLANETS: Record<string, string> = { Mercury: "mercury", Venus: "venus", Earth: "earth", Mars: "mars", Jupiter: "jupiter", Saturn: "saturn", Uranus: "uranus", Neptune: "neptune", Pluto: "pluto" };
const FIXED_SNAPSHOT_UTC = "2026-08-05T00:00:00Z";

async function staticJson<T>(path: string, validate: (value: unknown) => T): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return validate(await response.json());
}

function decodeDataStatus(value: unknown): DataStatus {
  if (!isJsonObject(value) || !isJsonObject(value.reference_snapshot) || !isJsonObject(value.kernels) || !isJsonObject(value.catalogs)) throw new Error("invalid data status");
  const catalogs = value.catalogs;
  if (!isJsonObject(catalogs.moons) || !isJsonObject(catalogs.stars) || !isJsonObject(catalogs.constellations)) throw new Error("invalid data status");
  const counts = isJsonObject(catalogs.moons.by_primary) ? Object.fromEntries(Object.entries(catalogs.moons.by_primary).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))) : {};
  return {
    manifest_generated_utc: String(value.manifest_generated_utc ?? ""),
    reference_snapshot: { epoch: typeof value.reference_snapshot.epoch === "string" ? value.reference_snapshot.epoch : null, source: typeof value.reference_snapshot.source === "string" ? value.reference_snapshot.source : null, body_count: Number(value.reference_snapshot.body_count) },
    kernels: { count: Number(value.kernels.count), manifest: String(value.kernels.manifest ?? "") },
    catalogs: { moons: { count: Number(catalogs.moons.count), by_primary: counts, source: Array.isArray(catalogs.moons.source) ? catalogs.moons.source.filter((item): item is string => typeof item === "string") : null }, stars: { count: Number(catalogs.stars.count), source: typeof catalogs.stars.source === "string" ? catalogs.stars.source : null }, constellations: { count: Number(catalogs.constellations.count), source: typeof catalogs.constellations.source === "string" ? catalogs.constellations.source : null } },
    provenance: String(value.provenance ?? ""),
  };
}

function previousData<T>(resource: ScienceResource<T>): T | undefined {
  return resource.status === "ready" ? resource.data : resource.status === "loading" ? resource.previous : "previous" in resource ? resource.previous : undefined;
}

function failedResource<T>(error: unknown, capability: "sky" | "eclipses_local", previous?: T): ScienceResource<T> {
  if (error instanceof ScienceRequestError) {
    if (error.kind === "unavailable") return { status: "unavailable", capability, message: error.message, previous };
    if (error.kind === "out-of-range") return { status: "out-of-range", message: error.message, validFromUtc: error.validFromUtc, validUntilUtc: error.validUntilUtc, previous };
    if (error.kind === "validation") return { status: "validation-error", message: error.message, previous };
    if (error.kind === "contract") return { status: "contract-error", message: error.message, requestId: error.requestId, previous };
    if (error.kind === "server") return { status: "server-error", message: error.message, requestId: error.requestId, previous };
  }
  return { status: "network-error", message: "Não foi possível concluir a consulta científica.", previous };
}

function twilightLabel(value: SkyResponse["twilight"]["classification"]): string {
  return value === "day" ? "dia" : value === "civil" ? "crepúsculo civil" : value === "nautical" ? "crepúsculo náutico" : value === "astronomical" ? "crepúsculo astronômico" : "noite";
}

export default function Home() {
  const [snapshot, setSnapshot] = useState<ReferenceSnapshot | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
  const [apiHealth, setApiHealth] = useState<ScienceCapabilities | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const [focusVersion, setFocusVersion] = useState(0);
  const [bodies, setBodies] = useState<Body[]>([]);
  const [mode, setMode] = useState<"reference" | "nbody">("reference");
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(6);
  const [selected, setSelected] = useState("Earth");
  const [elapsed, setElapsed] = useState(0);
  const [sky, setSky] = useState<ScienceResource<SkyResponse>>({ status: "idle" });
  const [eclipse, setEclipse] = useState<ScienceResource<LocalEclipseResponse>>({ status: "idle" });
  const skyAttempt = useRef<{ version: number; controller: AbortController | null }>({ version: 0, controller: null });
  const eclipseAttempt = useRef<{ version: number; controller: AbortController | null }>({ version: 0, controller: null });
  const [location, setLocation] = useState({ lat: "-23.5505", lon: "-46.6333", alt: "760", utc: "2024-04-08T18:00:00" });
  const [status, setStatus] = useState("Carregando instantâneo SPICE offline…");
  const [moonQuery, setMoonQuery] = useState("");
  const [moonPrimary, setMoonPrimary] = useState("");
  const [moonCatalogue, setMoonCatalogue] = useState<MoonCatalogue | null>(null);
  const [moonOffset, setMoonOffset] = useState(0);
  const [moonsLoading, setMoonsLoading] = useState(false);
  const [selectedMoon, setSelectedMoon] = useState<Moon | null>(null);

  useEffect(() => () => {
    skyAttempt.current.controller?.abort();
    eclipseAttempt.current.controller?.abort();
  }, []);

  const loadReferenceState = useCallback(async (requestedUtc: string) => {
    setReferenceLoading(true);
    setStatus("Consultando a efeméride local para a época UTC selecionada…");
    try {
      const value = await scienceGateway.getReferenceState({ utc: requestedUtc });
      setSnapshot(value);
      setBodies(value.bodies.map((body) => ({ ...body, position_m: [...body.position_m], velocity_m_s: [...body.velocity_m_s] })));
      setElapsed(0);
      setRunning(false);
      setMode("reference");
      setStatus(`${value.fixed_epoch ? "Snapshot fixo" : "Efeméride local"} carregado: ${value.epoch}.`);
    } catch (error) {
      if (error instanceof ScienceRequestError && error.kind === "out-of-range") {
        setStatus(`O estado solicitado não está disponível. O snapshot fixo não foi usado para ${requestedUtc}.`);
      } else {
        setStatus(error instanceof ScienceRequestError ? error.message : "Não foi possível carregar a efeméride solicitada.");
      }
    } finally {
      setReferenceLoading(false);
    }
  }, []);

  useEffect(() => {
    const referenceTimer = window.setTimeout(() => {
      void loadReferenceState(FIXED_SNAPSHOT_UTC);
    }, 0);
    scienceGateway.getCapabilities()
      .then(setApiHealth)
      .catch(() => setApiHealth(null));
    return () => window.clearTimeout(referenceTimer);
  }, [loadReferenceState]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMoonsLoading(true);
      try {
        setMoonCatalogue(await scienceGateway.getMoonCatalogue({ query: moonQuery, primary: moonPrimary || undefined, offset: moonOffset, limit: 80 }, controller.signal));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setMoonCatalogue(null);
      } finally {
        if (!controller.signal.aborted) setMoonsLoading(false);
      }
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [moonQuery, moonPrimary, moonOffset]);

  useEffect(() => {
    staticJson<DataStatus>("/data-status.json", decodeDataStatus)
      .then((value) => setDataStatus(value))
      .catch(() => setDataStatus(null));
  }, []);

  useEffect(() => {
    if (!running || mode !== "nbody") return;
    const timer = window.setInterval(() => {
      setBodies((current) => {
        if (!current.length) return current;
        const result = advanceFixedSteps(current, speed, PHYSICS_STEP_S);
        if (result.integratedTimeS) setElapsed((value) => value + result.integratedTimeS);
        if (result.paused) {
          setRunning(false);
          setStatus("Simulação pausada: colisão de centros ou singularidade; o último estado finito foi preservado.");
        }
        return result.bodies;
      });
    }, 120);
    return () => window.clearInterval(timer);
  }, [running, mode, speed]);

  const current = useMemo(() => bodies.find((body) => body.name === selected), [bodies, selected]);
  const selectedDistance = current ? Math.hypot(...current.position_m) / AU : 0;
  const selectedMoonCount = moonCatalogue?.counts[selected] ?? 0;
  const skyData = previousData(sky);
  const eclipseData = previousData(eclipse);
  const fixedSnapshotEpoch = apiHealth?.snapshot.epoch_utc ?? FIXED_SNAPSHOT_UTC;

  function reset() {
    if (!snapshot) return;
    setBodies(snapshot.bodies.map((body) => ({ ...body, position_m: [...body.position_m], velocity_m_s: [...body.velocity_m_s] })));
    setElapsed(0);
    setRunning(false);
  }

  function selectBody(name: string) {
    setSelected(name);
    setSelectedMoon(null);
    setMoonPrimary(MOON_PRIMARY_OPTIONS.includes(name) ? name : "");
    setMoonOffset(0);
  }

  function focusSelectedSystem() {
    setFocusVersion((value) => value + 1);
  }

  async function calculateSky(event: FormEvent) {
    event.preventDefault();
    skyAttempt.current.controller?.abort();
    const version = ++skyAttempt.current.version;
    const parsed = parseObserverFields({ latitude: location.lat, longitude: location.lon, elevation: location.alt, utc: location.utc });
    const previous = previousData(sky);
    if (!parsed.input) {
      setSky({ status: "validation-error", message: parsed.message ?? "Revise os campos do observador.", previous });
      return;
    }
    const controller = new AbortController();
    skyAttempt.current.controller = controller;
    setSky({ status: "loading", previous });
    try {
      const value = await scienceGateway.calculateSky(parsed.input, controller.signal);
      if (controller.signal.aborted || version !== skyAttempt.current.version) return;
      setSky(value.objects.length ? { status: "ready", data: value } : { status: "empty", message: "Nenhum objeto foi retornado." });
    } catch (error) {
      if (controller.signal.aborted || version !== skyAttempt.current.version) return;
      if (!(error instanceof Error && error.name === "AbortError")) setSky(failedResource(error, "sky", previous));
    }
  }

  async function calculateEclipse() {
    eclipseAttempt.current.controller?.abort();
    const version = ++eclipseAttempt.current.version;
    const parsed = parseObserverFields({ latitude: location.lat, longitude: location.lon, elevation: location.alt, utc: location.utc });
    const previous = previousData(eclipse);
    if (!parsed.input) {
      setEclipse({ status: "validation-error", message: parsed.message ?? "Revise os campos do observador.", previous });
      return;
    }
    const controller = new AbortController();
    eclipseAttempt.current.controller = controller;
    setEclipse({ status: "loading", previous });
    try {
      const value = await scienceGateway.calculateEclipse({ ...parsed.input, search_hours: 18 }, controller.signal);
      if (controller.signal.aborted || version !== eclipseAttempt.current.version) return;
      setEclipse({ status: "ready", data: value });
    } catch (error) {
      if (controller.signal.aborted || version !== eclipseAttempt.current.version) return;
      if (!(error instanceof Error && error.name === "AbortError")) setEclipse(failedResource(error, "eclipses_local", previous));
    }
  }

  return <div className="app-frame"><SiteSidebar active="orbital" /><main className="shell">
    <header className="topbar workspace-topbar">
      <div><p className="eyebrow">CENTRO ORBITAL · 01</p><h1>Orbis Scientia</h1></div>
      <div className="source-pill"><span className="pulse" /> {mode === "reference" ? snapshot?.fixed_epoch ? "REFERÊNCIA · SNAPSHOT FIXO" : "REFERÊNCIA · DE442s LOCAL" : "SIMULAÇÃO · N-BODY"}</div>
    </header>

    <section className="mission-overview" aria-labelledby="mission-title">
      <div className="mission-overview-copy"><p className="eyebrow">PLANETÁRIO CIENTÍFICO RASTREÁVEL</p><h2 id="mission-title">Do estado físico ao céu observado.</h2><p>Explore o Sistema Solar, compare a integração N-body com a referência e continue a investigação no Atlas ou no observatório terrestre. Toda transformação visual permanece separada dos vetores em SI.</p><div className="mission-actions"><a className="primary-action" href="#orbital-workspace">Abrir cena orbital</a><a href="/atlas">Explorar mundos</a><a href="/atlas/earth/constellations">Observar o céu</a></div></div>
      <dl className="mission-inventory" aria-label="Inventário científico disponível"><div><dt>Corpos com estado</dt><dd>{dataStatus?.reference_snapshot.body_count ?? 10}</dd><span>snapshot DE442s</span></div><div><dt>Luas pesquisáveis</dt><dd>{dataStatus?.catalogs.moons.count ?? 460}</dd><span>metadados JPL</span></div><div><dt>Estrelas</dt><dd>{dataStatus?.catalogs.stars.count.toLocaleString("pt-BR") ?? "10.000"}</dd><span>subconjunto Gaia DR3</span></div><div><dt>Regiões IAU</dt><dd>{dataStatus?.catalogs.constellations.count ?? 88}</dd><span>limites oficiais</span></div></dl>
    </section>

    <nav className="experience-deck" aria-label="Atalhos de investigação">
      <a href="/atlas"><span>02 · ATLAS</span><strong>Escolha um mundo</strong><small>Superfície, atmosfera e propriedades declaradas.</small></a>
      <a href="/atlas/earth"><span>03 · TERRA</span><strong>Abra a janela terrestre</strong><small>Camadas, observador, céu e método no mesmo contexto.</small></a>
      <Link href="/missions"><span>05 · MISSÕES</span><strong>Leia dados de missão</strong><small>Marcos documentados; nenhuma trajetória é inventada.</small></Link>
      <a href="/events"><span>06 · EVENTOS</span><strong>Investigue o tempo</strong><small>Seleções com fonte, cobertura e limitações visíveis.</small></a>
    </nav>

    <section className="workspace" id="orbital-workspace">
      <aside className="rail controls">
        <h3>Tempo e modelo</h3>
        <label>Modo de posição<select value={mode} onChange={(event) => { setMode(event.target.value as "reference" | "nbody"); setRunning(false); reset(); }}><option value="reference">Referência: snapshot SPICE</option><option value="nbody">N-body: Velocity-Verlet</option></select></label>
        <div className="button-row"><button onClick={() => setRunning((value) => !value)} disabled={mode === "reference" || bodies.length === 0}>{running ? "Pausar" : "Executar"}</button><button className="quiet" onClick={reset}>Reiniciar</button></div>
        <label>Velocidade de reprodução <output>{speed} passos / atualização</output><input aria-label="Velocidade de reprodução" type="range" min="1" max="24" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label>
        <p className="micro">Passo físico: 1 h fixo. A velocidade altera somente quantos passos fixos são executados por atualização.</p>
        <dl className="facts"><div><dt>Época de origem</dt><dd>{snapshot?.epoch ?? "—"}</dd></div><div><dt>Tempo integrado</dt><dd>{(elapsed / 86400).toFixed(3)} dias</dd></div><div><dt>Referencial</dt><dd>{snapshot?.frame ?? "—"}</dd></div></dl>
        <p className="micro">No modo local, use “Carregar efeméride UTC” para consultar o estado DE442s na data escolhida. O site hospedado continua limitado ao snapshot fixo.</p>
      </aside>

      <section className="visual-panel">
        <div className="panel-heading"><div><p className="eyebrow">CENA WEBGL · XYZ J2000</p><h3>Estados físicos e transformações visuais separadas</h3></div><span>{status}</span></div>
        <Suspense fallback={<div className="scene-loading">Preparando renderizador WebGL…</div>}><SolarSystemScene bodies={bodies} selected={selected} focusVersion={focusVersion} onSelect={selectBody} /></Suspense>
        <div className="legend"><span><i className="dot source" /> Vetores SPICE/DE442s</span><span><i className="dot physics" /> Integração N-body</span><span>Órbitas osculantes derivadas do estado atual; escala e câmera não escrevem na simulação.</span></div>
      </section>

      <aside className="rail object-panel">
        <h3>Corpos ativos</h3>
        <div className="body-list">{bodies.map((body) => <button key={body.name} onClick={() => selectBody(body.name)} className={body.name === selected ? "body active" : "body"}><i style={{ background: body.color }} />{body.name}</button>)}<a className="body dwarf-body" href="/atlas?planet=pluto"><i style={{ background: "#a78274" }} />Plutão<small>planeta anão · Atlas</small></a></div>
        <div className="object-readout"><p className="eyebrow">SELECIONADO</p><h3>{current?.name ?? "—"}</h3><dl><div><dt>NAIF físico</dt><dd>{current?.body_naif_id ?? "—"}</dd></div><div><dt>Alvo do estado</dt><dd>{current ? `${current.state_target_name} · NAIF ${current.state_target_naif_id} · ${current.state_kind === "system-barycenter" ? "baricentro do sistema" : "centro físico"}` : "—"}</dd></div><div><dt>Distância SSB</dt><dd>{selectedDistance.toFixed(4)} AU</dd></div><div><dt>GM</dt><dd>{current ? current.mu_m3_s2.toExponential(4) : "—"} m³/s²</dd></div><div><dt>Origem</dt><dd>{mode === "nbody" ? "N-body; estado inicial SPICE" : snapshot?.source ?? "SPICE; época fixa"}</dd></div>{selectedMoonCount > 0 && <div><dt>Luas no catálogo</dt><dd>{selectedMoonCount} · posições sem kernel não são desenhadas</dd></div>}</dl>{current && ATLAS_PLANETS[current.name] && <a className="quiet atlas-object-link" href={current.name === "Earth" ? "/atlas/earth" : `/atlas?planet=${ATLAS_PLANETS[current.name]}`}>Abrir ficha no Atlas</a>}{selectedMoonCount > 0 && <button className="quiet focus-button" onClick={focusSelectedSystem}>Focar sistema planetário</button>}</div>
      </aside>
    </section>

    <section className="analysis-grid">
      <form className="analysis-card" onSubmit={calculateSky}><p className="eyebrow">OBSERVADOR TERRESTRE</p><h2>Céu local</h2><p>As coordenadas ficam apenas nesta sessão e são enviadas no corpo JSON da solicitação.</p><ObserverFields value={location} onChange={setLocation} /><div className="button-row"><button type="submit">Calcular céu</button><button className="quiet" type="button" onClick={() => void loadReferenceState(location.utc)} disabled={referenceLoading}>{referenceLoading ? "Carregando…" : "Carregar efeméride UTC"}</button></div><CoverageNotice fixedEpoch={fixedSnapshotEpoch} validFromUtc={apiHealth?.limits.reference_state?.valid_utc_from} validUntilUtc={apiHealth?.limits.reference_state?.valid_utc_until} onUseFixed={() => { setLocation((current) => ({ ...current, utc: fixedSnapshotEpoch })); void loadReferenceState(fixedSnapshotEpoch); }} /><ScienceStatus resource={sky} />{skyData && <section aria-label="Resultado do céu local">{sky.status !== "ready" && <p className="micro">Resultado anterior confirmado.</p>}<dl className="facts"><div><dt>UTC calculado</dt><dd>{skyData.input.utc}</dd></div><div><dt>Crepúsculo</dt><dd>{twilightLabel(skyData.twilight.classification)}</dd></div><div><dt>Refração</dt><dd>desabilitada · {skyData.refraction.pressure_hpa} hPa</dd></div><div><dt>IERS</dt><dd>{skyData.iers.source} · {skyData.iers.status}</dd></div></dl><div className="science-table-wrap"><table><caption>Coordenadas topocêntricas calculadas</caption><thead><tr><th>Objeto</th><th>Altitude</th><th>Azimute</th><th>Horizonte geométrico</th><th>Constelação</th></tr></thead><tbody>{skyData.objects.map((object) => <tr key={object.name}><th>{object.name}</th><td>{object.altitude_deg.toFixed(2)}°</td><td>{object.azimuth_deg.toFixed(2)}°</td><td>{object.above_geometric_horizon ? "acima" : "abaixo"}</td><td>{object.constellation ?? "—"}</td></tr>)}</tbody></table></div><MethodNotice method={skyData.coordinate_pipeline.join(" → ")} limitations={skyData.limitations} /><ProvenanceCard source={skyData.ephemeris.provider} requestId={skyData.meta.request_id} generatedAtUtc={skyData.meta.generated_at_utc} /></section>}</form>
      <article className="analysis-card"><p className="eyebrow">ECLIPSE SOLAR</p><h2>Contato local</h2><p>Busca topocêntrica por separação aparente dos discos do Sol e Lua. Sem ajuste a evento conhecido.</p><button onClick={calculateEclipse}>Avaliar janela de 36 h</button><ScienceStatus resource={eclipse} />{eclipseData && <section aria-label="Resultado do eclipse local">{eclipse.status !== "ready" && <p className="micro">Resultado anterior confirmado.</p>}<dl className="facts"><div><dt>Evento</dt><dd>{eclipseData.event_found ? eclipseData.classification : "nenhum"}</dd></div><div><dt>Máximo</dt><dd>{eclipseData.maximum_utc}</dd></div><div><dt>Obscurecimento geométrico</dt><dd>{(eclipseData.obscuration_area_fraction * 100).toFixed(2)}%</dd></div><div><dt>Sol no máximo</dt><dd>{eclipseData.sun_above_geometric_horizon_at_maximum ? "acima do horizonte geométrico" : "abaixo do horizonte geométrico"}</dd></div></dl><ol className="eclipse-contacts">{eclipseData.contacts.map((contact) => <li key={contact.kind}><strong>{contact.kind}</strong> <time>{contact.utc}</time>{contact.sun_altitude_deg !== undefined ? ` · Sol alt ${contact.sun_altitude_deg.toFixed(2)}°` : ""}</li>)}</ol><p>Condição de visibilidade não modelada. Nunca observe o Sol sem proteção apropriada.</p><MethodNotice method={eclipseData.method} limitations={[eclipseData.precision_warning, ...eclipseData.limitations]} /><ProvenanceCard source="Astropy builtin · cálculo topocêntrico local" requestId={eclipseData.meta.request_id} generatedAtUtc={eclipseData.meta.generated_at_utc} /></section>}</article>
      <article className="analysis-card provenance"><p className="eyebrow">DADOS DESTA VERSÃO</p><h2>Inventários verificáveis</h2>{dataStatus ? <><ul><li>{dataStatus.kernels.count} kernels de referência com manifesto.</li><li>{dataStatus.catalogs.moons.count} luas catalogadas; {Object.entries(dataStatus.catalogs.moons.by_primary).map(([name, count]) => `${name} ${count}`).join(" · ")}.</li><li>{dataStatus.catalogs.stars.count.toLocaleString("pt-BR")} estrelas Gaia DR3.</li><li>{dataStatus.catalogs.constellations.count} constelações IAU.</li></ul><p>{dataStatus.provenance}</p></> : <p>O resumo de procedência não está disponível nesta versão.</p>}</article>
      <article className="analysis-card provenance"><p className="eyebrow">API DO SITE</p><h2>Contrato científico v1</h2>{apiHealth ? <><ul><li>Referência: {apiHealth.capabilities.reference_state.mode}.</li><li>Catálogos: {apiHealth.capabilities.catalogs.available ? "disponíveis" : "indisponíveis"}.</li><li>Céu: {apiHealth.capabilities.sky.status}.</li><li>Eclipse: {apiHealth.capabilities.eclipses_local.status}.</li><li>Simulação: {apiHealth.capabilities.simulate.status}.</li></ul><ProvenanceCard source={`${apiHealth.meta.service} · Orbis Scientia ${apiHealth.meta.software_version}`} requestId={apiHealth.meta.request_id} /></> : <p>A API não respondeu. O visor não cria uma aproximação científica substituta.</p>}</article>
      <article className="analysis-card provenance"><p className="eyebrow">TRILHA DE AUDITORIA</p><h2>O que este visor afirma</h2><ul><li>SI no núcleo: metros, segundos e GM.</li><li>Estados de referência: NAIF/SPICE DE442s quando exportados.</li><li>Constelações: limites IAU, não linhas culturais.</li><li>Dados ausentes são exibidos como ausentes — nunca inferidos para animação.</li></ul><a href="/reference-snapshot.json">Inspecionar snapshot de referência</a></article>
    </section>

    <section className="moon-explorer" aria-labelledby="moon-explorer-title">
      <div className="catalogue-heading"><div><p className="eyebrow">CATÁLOGO JPL SSD · LUAS</p><h2 id="moon-explorer-title">Sistemas planetários pesquisáveis</h2><p>O catálogo possui {moonCatalogue?.counts ? Object.values(moonCatalogue.counts).reduce((sum, count) => sum + count, 0) : "…"} luas. As posições só aparecem na cena quando existe uma fonte de estado de referência nomeada.</p></div><span>{moonsLoading ? "Consultando catálogo…" : `${moonCatalogue?.total ?? 0} resultado(s)`}</span></div>
      <div className="catalogue-controls"><label>Pesquisar nome ou designação<input value={moonQuery} onChange={(event) => { setMoonQuery(event.target.value); setMoonOffset(0); }} placeholder="Ex.: Ganymede ou S2023" /></label><label>Planeta principal<select value={moonPrimary} onChange={(event) => { setMoonPrimary(event.target.value); setMoonOffset(0); }}><option value="">Todos os sistemas</option>{MOON_PRIMARY_OPTIONS.map((primary) => <option key={primary} value={primary}>{primary} ({moonCatalogue?.counts[primary] ?? "…"})</option>)}</select></label></div>
      <div className="catalogue-layout">
        <div><div className="moon-list" aria-live="polite">{moonCatalogue?.items.map((moon) => <button key={`${moon.primary}-${moon.naif_id}-${moon.name}`} className={selectedMoon?.naif_id === moon.naif_id ? "moon-row active" : "moon-row"} onClick={() => setSelectedMoon(moon)}><span><strong>{moon.name}</strong>{moon.designation ? ` · ${moon.designation}` : ""}</span><small>{moon.primary} · {moon.propagation_mode.replaceAll("_", " ")}</small></button>)}</div><div className="catalogue-pagination"><button className="quiet" disabled={!moonCatalogue || moonOffset === 0} onClick={() => setMoonOffset((value) => Math.max(0, value - 80))}>Anteriores</button><span>{moonCatalogue ? `${moonCatalogue.offset + 1}–${Math.min(moonCatalogue.offset + moonCatalogue.items.length, moonCatalogue.total)} de ${moonCatalogue.total}` : "Catálogo indisponível"}</span><button className="quiet" disabled={!moonCatalogue || moonOffset + moonCatalogue.limit >= moonCatalogue.total} onClick={() => setMoonOffset((value) => value + 80)}>Próximas</button></div></div>
        <aside className="moon-detail"><p className="eyebrow">LUA SELECIONADA</p>{selectedMoon ? <><h3>{selectedMoon.name}</h3><dl><div><dt>Principal</dt><dd>{selectedMoon.primary}</dd></div><div><dt>NAIF</dt><dd>{selectedMoon.naif_id ?? "não informado"}</dd></div><div><dt>Raio médio</dt><dd>{selectedMoon.mean_radius_m ? `${(selectedMoon.mean_radius_m / 1000).toLocaleString("pt-BR")} km` : "não informado"}</dd></div><div><dt>Semieixo maior</dt><dd>{selectedMoon.orbit?.a_m ? `${(selectedMoon.orbit.a_m / 1000).toLocaleString("pt-BR")} km` : "não informado"}</dd></div><div><dt>Período</dt><dd>{selectedMoon.orbit?.period_days ? `${selectedMoon.orbit.period_days} dias` : "não informado"}</dd></div><div><dt>Modo</dt><dd>{selectedMoon.propagation_mode.replaceAll("_", " ")}</dd></div><div><dt>Status</dt><dd>{selectedMoon.status}</dd></div></dl><p>{moonCatalogue?.propagation_notice}</p></> : <p>Selecione uma lua. Elementos médios do catálogo são exibidos como metadados, não como posição observável.</p>}</aside>
      </div>
    </section>
  </main></div>;
}
