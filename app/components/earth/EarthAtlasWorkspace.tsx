"use client";

import Link from "@/app/components/AppLink";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import PlanetSurfaceLoader from "@/app/components/PlanetSurfaceLoader";
import type { AtlasComparisonMode, AtlasSceneView, EarthVisualLayers } from "@/app/components/PlanetSurfaceExplorer";
import AtlasFoundationPanel from "@/app/components/atlas/AtlasFoundationPanel";
import AtlasResponsiveDrawer from "@/app/components/atlas/AtlasResponsiveDrawer";
import SiteSidebar from "@/app/components/SiteSidebar";
import type { OrbitalSceneStateV1 } from "@/lib/atlas/scene/contracts";
import { DEFAULT_ORBITAL_SCENE, earthRenderLayersFromScene, sceneHash, sceneStateFromHash } from "@/lib/atlas/scene/state";
import { scienceGateway } from "@/lib/science/client";
import type { LocalEclipseResponse, MoonCatalogue, ObserverInput, ReferenceSnapshot, ScienceResource, SkyResponse } from "@/lib/science/contracts";
import { currentScienceData as currentData, loadingScienceResource, resourceError, settleScienceResource } from "@/lib/science/resource";
import { observerFieldsAtUtc, parseObserverFields, type ObserverFormFields } from "@/lib/science/observerFields";

const INITIAL_OBSERVER: ObserverFormFields = {
  latitude: "-23.5505",
  longitude: "-46.6333",
  elevation: "760",
  utc: "2026-08-05T00:00",
};

function ResourceNotice<T>({ resource, unavailableCopy }: { resource: ScienceResource<T>; unavailableCopy: string }) {
  if (resource.status === "idle") return <p className="earth-resource-notice">Aguardando uma ação explícita do observador.</p>;
  if (resource.status === "loading") return <p className="earth-resource-notice" aria-live="polite">Atualizando dados científicos…</p>;
  if (resource.status === "unavailable") return <p className="earth-resource-notice unavailable" role="status">{resource.message || unavailableCopy}</p>;
  if (resource.status === "empty") return <p className="earth-resource-notice">{resource.message}</p>;
  if (resource.status === "out-of-range") return <p className="earth-resource-notice" role="status">{resource.message}{resource.validFromUtc ? ` Intervalo disponível: ${resource.validFromUtc}${resource.validUntilUtc ? ` a ${resource.validUntilUtc}` : ""}.` : ""}</p>;
  if (resource.status === "validation-error" || resource.status === "network-error" || resource.status === "server-error" || resource.status === "contract-error") return <p className="earth-resource-notice error" role="alert">{resource.status === "contract-error" ? "Contrato científico incompatível: " : ""}{resource.message}</p>;
  return null;
}

function ResultIdentity({ input, requested, status }: { input: ObserverInput; requested?: ObserverInput; status: ScienceResource<unknown>["status"] }) {
  const matches = requested && input.latitude_deg === requested.latitude_deg && input.longitude_deg === requested.longitude_deg && input.elevation_m === requested.elevation_m && Date.parse(input.utc) === Date.parse(requested.utc);
  return <p className="earth-method-note" role="status">{status !== "ready" || !matches ? "Resultado anterior/desatualizado para a consulta atual. " : "Resultado confirmado. "}Consulta de origem: {input.utc} · latitude {input.latitude_deg}° · longitude {input.longitude_deg}° · elevação {input.elevation_m} m.</p>;
}

export default function EarthAtlasWorkspace() {
  const [observer, setObserver] = useState<ObserverFormFields>(INITIAL_OBSERVER);
  const [observerError, setObserverError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ScienceResource<ReferenceSnapshot>>({ status: "loading" });
  const [moonCatalogue, setMoonCatalogue] = useState<ScienceResource<MoonCatalogue>>({ status: "loading" });
  const [capabilityState, setCapabilityState] = useState<ScienceResource<Awaited<ReturnType<typeof scienceGateway.getCapabilities>>>>({ status: "loading" });
  const [sky, setSky] = useState<ScienceResource<SkyResponse>>({ status: "idle" });
  const [eclipse, setEclipse] = useState<ScienceResource<LocalEclipseResponse>>({ status: "idle" });
  const [scene, setScene] = useState<OrbitalSceneStateV1>(DEFAULT_ORBITAL_SCENE);
  const [sceneReady, setSceneReady] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<AtlasComparisonMode>("none");
  const requestVersion = useRef(0);
  const requestController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const loadStaticData = async () => {
      try {
        const data = await scienceGateway.getReferenceState({ utc: "2026-08-05T00:00:00Z" }, controller.signal);
        if (!controller.signal.aborted) setSnapshot({ status: "ready", data });
      } catch (error) {
        if (!controller.signal.aborted) setSnapshot(resourceError(error, "sky"));
      }
      try {
        // "Earth" é o identificador canônico do catálogo atual, confirmado no contrato do Worker e do backend.
        const data = await scienceGateway.getMoonCatalogue({ primary: "Earth", limit: 8 }, controller.signal);
        if (!controller.signal.aborted) setMoonCatalogue(data.items.length ? { status: "ready", data } : { status: "empty", message: "Nenhum satélite foi retornado pelo catálogo da Terra." });
      } catch (error) {
        if (!controller.signal.aborted) setMoonCatalogue(resourceError(error, "sky"));
      }
      try {
        const data = await scienceGateway.getCapabilities(controller.signal);
        if (!controller.signal.aborted) setCapabilityState({ status: "ready", data });
      } catch (error) {
        if (!controller.signal.aborted) setCapabilityState(resourceError(error, "sky"));
      }
    };
    void loadStaticData();
    return () => controller.abort();
  }, []);

  useEffect(() => () => requestController.current?.abort(), []);

  useEffect(() => {
    const restored = sceneStateFromHash(window.location.hash);
    const frame = window.requestAnimationFrame(() => {
      if (restored) {
        setScene(restored);
        setObserver((current) => observerFieldsAtUtc(current, restored.requestedUtc));
      }
      setSceneReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!sceneReady) return;
    const hash = sceneHash(scene);
    if (window.location.hash !== hash) window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
  }, [scene, sceneReady]);

  const parsedObserver = useMemo(() => parseObserverFields(observer).input, [observer]);
  const sceneLayers = useMemo(() => earthRenderLayersFromScene(scene), [scene]);
  const visualLayers = useMemo<EarthVisualLayers>(() => ({
    ...sceneLayers,
    observer: parsedObserver ? { latitudeDeg: parsedObserver.latitude_deg, longitudeDeg: parsedObserver.longitude_deg } : undefined,
  }), [parsedObserver, sceneLayers]);
  const snapshotData = currentData(snapshot);
  const moonData = currentData(moonCatalogue);
  const capabilityData = currentData(capabilityState);
  const skyData = currentData(sky);
  const eclipseData = currentData(eclipse);

  const changeExplorerView = useCallback((view: AtlasSceneView) => {
    if (view === "observer") return;
    setScene((current) => {
      const mode = view === "surface" ? "surface" : "orbit";
      const distance = view === "surface" ? 1.62 : 5.5;
      if (current.camera.mode === mode && current.camera.distance === distance) return current;
      return { ...current, camera: { ...current.camera, mode, distance }, panel: view === "surface" ? "terrain" : "overview" };
    });
  }, []);

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseObserverFields(observer);
    if (!parsed.input) {
      setObserverError(parsed.message ?? "Revise os campos do observador.");
      return;
    }
    setObserverError(null);
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const version = ++requestVersion.current;
    setSky(loadingScienceResource);
    setEclipse(loadingScienceResource);
    const [skyResult, eclipseResult] = await Promise.allSettled([
      scienceGateway.calculateSky(parsed.input, controller.signal),
      scienceGateway.calculateEclipse({ ...parsed.input, search_hours: 18 }, controller.signal),
    ]);
    if (controller.signal.aborted || version !== requestVersion.current) return;
    setSky((current) => settleScienceResource(current, skyResult, "sky", !controller.signal.aborted && version === requestVersion.current));
    setEclipse((current) => settleScienceResource(current, eclipseResult, "eclipses_local", !controller.signal.aborted && version === requestVersion.current));
  }

  const moon = moonData?.items[0];

  return <div className="app-frame"><SiteSidebar active="earth" /><main className="earth-atlas-shell">
    <header className="earth-topbar"><a href="/atlas">← Atlas planetário</a><span>JANELA DA TERRA · DADOS, MÉTODO E CAMADAS</span></header>
    <section className="earth-intro"><div><p className="eyebrow">TERRA · ATLAS ESPECIALIZADO</p><h1>Uma leitura visual separada do cálculo científico.</h1></div><p>O globo abaixo usa o mesmo renderizador do Atlas. A cena é interpretativa; snapshot, catálogo e cálculos locais permanecem identificados em HTML.</p></section>
    <div className="earth-canvas-panel"><PlanetSurfaceLoader initialPlanetId="earth" lockPlanet hideDetails earthVisualLayers={visualLayers} requestedView={scene.camera.mode === "surface" ? "surface" : "orbital"} onViewChange={changeExplorerView} comparisonMode={comparisonMode} /></div>

    <AtlasResponsiveDrawer title="Ferramentas da Terra" description="Cena, tempo, camadas e busca">
      <AtlasFoundationPanel scene={scene} onSceneChange={setScene} snapshot={snapshotData} moon={moon} comparisonMode={comparisonMode} onComparisonChange={setComparisonMode} />
    </AtlasResponsiveDrawer>

    <section className="earth-inspector" aria-label="Inspector científico da Terra">
      <article className="earth-panel earth-overview"><p className="eyebrow">VISÃO GERAL</p><h2>Terra</h2><dl><div><dt>Classificação</dt><dd>planeta rochoso</dd></div><div><dt>Raio no snapshot</dt><dd>{snapshotData?.bodies.find((body) => body.name === "Earth")?.radius_m ? `${(snapshotData.bodies.find((body) => body.name === "Earth")!.radius_m! / 1_000).toLocaleString("pt-BR")} km` : "não disponível"}</dd></div><div><dt>Raio equatorial / polar</dt><dd>não fornecido pelo snapshot público atual</dd></div><div><dt>Rotação, translação e inclinação</dt><dd>não fornecidas como parâmetros nesta rota</dd></div><div><dt>Escala exibida</dt><dd>normalizada para exploração visual; não é escala física</dd></div><div><dt>Snapshot</dt><dd>{snapshotData ? `${snapshotData.source} · ${snapshotData.epoch}` : "carregando ou indisponível"}</dd></div></dl><Link href="/atlas/earth/constellations">Abrir observatório de constelações</Link><a href="#earth-moon">Ver catálogo Terra–Lua</a></article>

      <article className="earth-panel"><p className="eyebrow">DADOS E MÉTODO</p><h2>Disponibilidade declarada</h2>{capabilityData ? <dl><div><dt>Snapshot</dt><dd>{capabilityData.snapshot.available ? "disponível" : "indisponível"}</dd></div><div><dt>Catálogos</dt><dd>{capabilityData.capabilities.catalogs.available ? "disponíveis" : "indisponíveis"}</dd></div><div><dt>Céu / eclipses / simulação</dt><dd>{capabilityData.capabilities.sky.status} / {capabilityData.capabilities.eclipses_local.status} / {capabilityData.capabilities.simulate.status}</dd></div><div><dt>Cobertura da referência</dt><dd>{capabilityData.limits.reference_state?.valid_utc_from ?? "não informada"}{capabilityData.limits.reference_state?.valid_utc_until ? ` a ${capabilityData.limits.reference_state.valid_utc_until}` : ""}</dd></div></dl> : <ResourceNotice resource={capabilityState} unavailableCopy="As capacidades científicas não puderam ser consultadas." />}<p className="earth-method-note">Em um 501: Cálculos do céu local estão indisponíveis neste ambiente. O Atlas e os catálogos continuam disponíveis.</p><p className="earth-method-note">A iluminação atual é de apresentação visual e não afirma representar o terminador no UTC escolhido. Não há cálculo aproximado no navegador.</p></article>

      <article className="earth-panel earth-layers"><p className="eyebrow">CAMADAS VISUAIS</p><h2>Controle de apresentação</h2><p>Atmosfera, nuvens procedurais, grade e marcador agora são controlados no painel temporal abaixo, com visibilidade, opacidade, fonte e limitações declaradas.</p><a href="#atlas-next-title">Abrir controles de camadas</a><p>Não há textura diurna licenciada, luzes noturnas cartográficas ou nuvens meteorológicas atuais nesta versão. A superfície e as nuvens são procedurais e não temporais.</p></article>
    </section>

    <section className="earth-science-grid">
      <form className="earth-panel earth-observer" onSubmit={calculate}>
        <p className="eyebrow">OBSERVADOR</p><h2>Calcular a partir de uma localização</h2><p>Coordenadas permanecem somente nesta sessão; não entram na URL, não são persistidas e não são registradas pelo aplicativo.</p>
        <div className="earth-fields">
          <label>Latitude (graus)<input required inputMode="decimal" value={observer.latitude} onChange={(event) => setObserver((current) => ({ ...current, latitude: event.target.value }))} /></label>
          <label>Longitude (graus)<input required inputMode="decimal" value={observer.longitude} onChange={(event) => setObserver((current) => ({ ...current, longitude: event.target.value }))} /></label>
          <label>Elevação (m)<input required inputMode="decimal" value={observer.elevation} onChange={(event) => setObserver((current) => ({ ...current, elevation: event.target.value }))} /></label>
          <label>UTC<input required type="datetime-local" step="any" value={observer.utc} onChange={(event) => setObserver((current) => ({ ...current, utc: event.target.value }))} /></label>
        </div>
        {observerError && <p className="earth-resource-notice error" role="alert">{observerError}</p>}
        <button type="submit" disabled={!sceneReady}>Calcular céu e eclipse</button>
      </form>

      <article className="earth-panel"><p className="eyebrow">CÉU LOCAL</p><h2>AltAz do serviço científico</h2><ResourceNotice resource={sky} unavailableCopy="Cálculos do céu local estão indisponíveis neste ambiente. O Atlas e os catálogos continuam disponíveis." />{skyData && <><ResultIdentity input={skyData.input} requested={parsedObserver} status={sky.status} /><dl><div><dt>Horário calculado</dt><dd>{skyData.input.utc}</dd></div><div><dt>Referencial</dt><dd>{skyData.frame}</dd></div><div><dt>Efeméride</dt><dd>{skyData.ephemeris.provider}</dd></div><div><dt>Crepúsculo</dt><dd>{skyData.twilight.classification}</dd></div><div><dt>Refração</dt><dd>desabilitada · 0 hPa</dd></div></dl><ul className="earth-object-list">{skyData.objects.map((object) => <li key={object.name}><strong>{object.name}</strong><span>alt {object.altitude_deg.toFixed(2)}° · az {object.azimuth_deg.toFixed(2)}° · {object.above_geometric_horizon ? "acima do horizonte geométrico" : "abaixo do horizonte geométrico"}{object.constellation ? ` · ${object.constellation}` : ""}</span></li>)}</ul><p className="earth-method-note">Condição de visibilidade não modelada. IERS: {skyData.iers.source} · {skyData.iers.status}.</p></>}</article>

      <article className="earth-panel"><p className="eyebrow">ECLIPSE LOCAL</p><h2>Resultado topocêntrico</h2><ResourceNotice resource={eclipse} unavailableCopy="Cálculos de eclipses locais estão indisponíveis neste ambiente. Nenhuma data ou contato foi estimado." /><p className="earth-method-note">Resultado calculado pelo modelo topocêntrico atual. Não destinado a previsão operacional de alta precisão.</p>{eclipseData && <><ResultIdentity input={eclipseData.input} requested={parsedObserver} status={eclipse.status} /><dl><div><dt>Candidato</dt><dd>{eclipseData.classification}</dd></div><div><dt>Máximo</dt><dd>{eclipseData.maximum_utc}</dd></div><div><dt>Sol no máximo</dt><dd>{eclipseData.sun_above_geometric_horizon_at_maximum ? "acima do horizonte geométrico" : "abaixo do horizonte geométrico"}</dd></div><div><dt>Altitude / azimute</dt><dd>{eclipseData.solar_altitude_at_maximum_deg.toFixed(2)}° / {eclipseData.solar_azimuth_at_maximum_deg.toFixed(2)}°</dd></div><div><dt>Contatos</dt><dd>{eclipseData.contacts.length ? eclipseData.contacts.map((contact) => `${contact.kind}: ${contact.utc}`).join(" · ") : "nenhum"}</dd></div></dl><p className="earth-method-note">Condição de visibilidade não modelada. {eclipseData.method}</p><p className="earth-method-note">{eclipseData.precision_warning}</p></>}</article>
    </section>

    <section id="earth-moon" className="earth-panel earth-moon"><p className="eyebrow">TERRA–LUA</p><h2>Satélite no catálogo</h2><ResourceNotice resource={moonCatalogue} unavailableCopy="O catálogo de luas não está disponível neste ambiente." />{moon && <dl><div><dt>Nome</dt><dd>{moon.name}</dd></div><div><dt>Identificador NAIF</dt><dd>{moon.naif_id ?? "não informado"}</dd></div><div><dt>Designação</dt><dd>{moon.designation ?? "não informada"}</dd></div><div><dt>Raio médio</dt><dd>{moon.mean_radius_m ? `${(moon.mean_radius_m / 1_000).toLocaleString("pt-BR")} km` : "não informado"}</dd></div><div><dt>Fonte</dt><dd>{moon.source}</dd></div><div><dt>Estado visual</dt><dd>O foco Terra–Lua só usa estado explícito do snapshot orbital; este catálogo não fornece posição atual.</dd></div></dl>}<Link href="/">Abrir o foco Terra–Lua no planetário orbital</Link></section>
  </main></div>;
}
