"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import PlanetSurfaceLoader from "@/app/components/PlanetSurfaceLoader";
import SiteSidebar from "@/app/components/SiteSidebar";
import ConstellationCatalogueView from "./ConstellationCatalogueView";
import catalogueStyles from "./ConstellationCatalogueView.module.css";
import { constellationOrigin } from "@/lib/atlas/constellationEducation";
import { constellationSearchText } from "@/lib/atlas/constellations";
import { DEFAULT_CONSTELLATION_SCENE, sceneHash, sceneStateFromHash, updateSceneLayer } from "@/lib/atlas/scene/state";
import { scienceGateway } from "@/lib/science/client";
import type { ConstellationCatalogue, ConstellationGuide, ConstellationSkyResponse, ScienceResource } from "@/lib/science/contracts";
import { ScienceRequestError } from "@/lib/science/errors";
import { observerFieldsAtUtc, parseDecimalInput, parseObserverFields as observerInput, type ObserverFormFields } from "@/lib/science/observerFields";

type EnrichedGuide = ConstellationGuide & {
  declination_extent_deg?: { min: number; max: number };
  hemisphere?: string;
  potential_latitude_visibility_deg?: { min: number; max: number; method: string };
  continents?: { status: string; message: string };
  brightest_gaia_stars?: Array<{ gaia_dr3_source_id: string; g_mag: number; ra_deg: number; dec_deg: number; name_status: string }>;
};

const INITIAL_OBSERVER: ObserverFormFields = { latitude: "-23.5505", longitude: "-46.6333", elevation: "760", utc: "2026-08-05T00:00" };
const EMPTY_GUIDES: ConstellationGuide[] = [];

function errorResource<T>(error: unknown, previous?: T): ScienceResource<T> {
  if (error instanceof ScienceRequestError) {
    if (error.kind === "unavailable") return { status: "unavailable", capability: error.capability ?? "sky", message: error.message, previous };
    if (error.kind === "out-of-range") return { status: "out-of-range", message: error.message, validFromUtc: error.validFromUtc, validUntilUtc: error.validUntilUtc, previous };
    if (error.kind === "validation") return { status: "validation-error", message: error.message, previous };
    if (error.kind === "network") return { status: "network-error", message: error.message, previous };
    if (error.kind === "contract") return { status: "contract-error", message: error.message, requestId: error.requestId, previous };
    return { status: "server-error", message: error.message, requestId: error.requestId, previous };
  }
  return { status: "network-error", message: "Não foi possível alcançar o serviço científico local.", previous };
}

function currentData<T>(resource: ScienceResource<T>): T | undefined {
  return resource.status === "ready" ? resource.data : resource.status === "loading" ? resource.previous : "previous" in resource ? resource.previous : undefined;
}

function Notice<T>({ resource }: { resource: ScienceResource<T> }) {
  if (resource.status === "idle") return <p className="constellation-notice">Escolha uma constelação e solicite o cálculo para o observador.</p>;
  if (resource.status === "loading") return <p className="constellation-notice" aria-live="polite">Consultando o backend Astropy local…</p>;
  if (resource.status === "unavailable") return <p className="constellation-notice unavailable" role="status">{resource.message} Nenhum resultado foi aproximado no navegador.</p>;
  if (resource.status === "network-error" || resource.status === "server-error" || resource.status === "validation-error" || resource.status === "out-of-range" || resource.status === "contract-error") return <p className="constellation-notice error" role="alert">{resource.status === "contract-error" ? "Contrato científico incompatível: " : ""}{resource.message}</p>;
  return null;
}

function constellationLayersFromScene(scene: { layers: Array<{ id: string; visible: boolean }> }) {
  const visible = (id: string, fallback: boolean) => scene.layers.find((layer) => layer.id === id)?.visible ?? fallback;
  return { stars: visible("sky-gaia-stars", true), iauBoundaries: visible("sky-iau-boundaries", true), selectedConstellation: visible("sky-selected-constellation", true), horizonGrid: visible("sky-horizon-grid", true), cardinalDirections: visible("sky-cardinal-directions", true), culturalLines: false };
}

export default function ConstellationObservatory() {
  const [observer, setObserver] = useState<ObserverFormFields>(INITIAL_OBSERVER);
  const [observerError, setObserverError] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<ScienceResource<ConstellationCatalogue>>({ status: "loading" });
  const [sky, setSky] = useState<ScienceResource<ConstellationSkyResponse>>({ status: "idle" });
  const [query, setQuery] = useState("");
  const [viewer, setViewer] = useState<"catalogue" | "local">("catalogue");
  const [scene, setScene] = useState(DEFAULT_CONSTELLATION_SCENE);
  const [sceneReady, setSceneReady] = useState(false);
  const [selectedAbbreviation, setSelectedAbbreviation] = useState("Ori");
  const [maxMagnitude, setMaxMagnitude] = useState("5.5");
  const [layers, setLayers] = useState(() => constellationLayersFromScene(DEFAULT_CONSTELLATION_SCENE));
  const requestVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const stage = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const request = new AbortController();
    void scienceGateway.getConstellations(request.signal)
      .then((data) => {
        if (request.signal.aborted) return;
        if (data.count !== 88 || !data.items.every((item) => typeof item.name === "string" && item.name.length > 0)) {
          setCatalogue({ status: "server-error", message: "A API científica local está em uma versão anterior ao observatório. Reinicie-a a partir desta pasta antes de calcular." });
          return;
        }
        setCatalogue({ status: "ready", data });
      })
      .catch((error: unknown) => { if (!request.signal.aborted) setCatalogue(errorResource(error)); });
    return () => request.abort();
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  useEffect(() => {
    const restored = sceneStateFromHash(window.location.hash);
    const frame = window.requestAnimationFrame(() => {
      if (restored?.experience === "constellations") {
        setScene(restored);
        setObserver((current) => observerFieldsAtUtc(current, restored.requestedUtc));
        setSelectedAbbreviation(restored.selection?.type === "constellation" ? restored.selection.id : "Ori");
        setLayers(constellationLayersFromScene(restored));
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

  const guides = currentData(catalogue)?.items ?? EMPTY_GUIDES;
  const selected = useMemo<ConstellationGuide | undefined>(() => guides.find((guide) => guide.iau_abbreviation === selectedAbbreviation) ?? guides[0], [guides, selectedAbbreviation]);
  const filteredGuides = useMemo(() => {
    const term = constellationSearchText(query);
    if (!term) return guides;
    return guides.filter((guide) => [guide.iau_abbreviation, guide.name, ...(guide.aliases ?? [])].some((value) => constellationSearchText(value).includes(term)));
  }, [guides, query]);
  const candidate = currentData(sky);
  const result = candidate?.constellation.iau_abbreviation === selectedAbbreviation ? candidate : undefined;

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected) await loadConstellation(selected.iau_abbreviation);
  }

  async function loadConstellation(iauAbbreviation: string, fields = observer) {
    // Invalidate even when the new form is invalid: an older request must not
    // populate the viewer after the user has selected another constellation.
    controller.current?.abort();
    const version = ++requestVersion.current;
    setSky({ status: "idle" });
    const parsed = observerInput(fields);
    if (!parsed.input) {
      setObserverError(parsed.message ?? "O catálogo de constelações ainda não está disponível.");
      setSky({ status: "validation-error", message: parsed.message ?? "Confira os dados do observador." });
      return;
    }
    const requestedMagnitude = parseDecimalInput(maxMagnitude);
    if (requestedMagnitude === undefined || requestedMagnitude < -2 || requestedMagnitude > 6.5) {
      setObserverError("Informe o limite G entre −2 e 6,5.");
      setSky({ status: "validation-error", message: "Informe o limite G entre −2 e 6,5." });
      return;
    }
    setObserverError(null);
    const request = new AbortController();
    controller.current = request;
    const previous = result?.constellation.iau_abbreviation === iauAbbreviation ? result : undefined;
    setSky({ status: "loading", previous });
    setScene((current) => ({ ...current, requestedUtc: parsed.input!.utc }));
    try {
      const data = await scienceGateway.calculateConstellationSky({ ...parsed.input, constellation: iauAbbreviation, max_g_magnitude: requestedMagnitude }, request.signal);
      if (!request.signal.aborted && version === requestVersion.current) setSky({ status: "ready", data });
    } catch (error) {
      if (!request.signal.aborted && version === requestVersion.current) setSky(errorResource(error, previous));
    }
  }

  const visibleStars = result?.stars.filter((star) => star.above_horizon) ?? [];
  const selectedDetails = selected as EnrichedGuide | undefined;
  const currentPlan = result?.planning?.current_utc_day;

  function changeLayer(key: Exclude<keyof typeof layers, "culturalLines">, checked: boolean) {
    const layerId = { stars: "sky-gaia-stars", iauBoundaries: "sky-iau-boundaries", selectedConstellation: "sky-selected-constellation", horizonGrid: "sky-horizon-grid", cardinalDirections: "sky-cardinal-directions" }[key];
    setLayers((current) => ({ ...current, [key]: checked }));
    setScene((current) => updateSceneLayer(current, layerId, { visible: checked }));
  }

  function selectConstellation(iauAbbreviation: string) {
    setSelectedAbbreviation(iauAbbreviation);
    setScene((current) => ({ ...current, experience: "constellations", target: { type: "body", id: "earth" }, selection: { type: "constellation", id: iauAbbreviation }, camera: { ...current.camera, mode: "observer" }, panel: "constellations" }));
    void loadConstellation(iauAbbreviation);
    stage.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  return <div className="app-frame"><SiteSidebar active="constellations" /><main className="constellation-shell">
    <header className="constellation-topbar"><a href="/atlas/earth">← Janela da Terra</a><span>OBSERVATÓRIO · CONSTELAÇÕES IAU · ALTAZ LOCAL</span></header>
    <section className="constellation-intro"><p className="eyebrow">TERRA · CÉU LOCAL</p><h1>Constelações vistas a partir de um observador na Terra.</h1><p>Explore estrelas e histórias no mapa de catálogo. No modo céu local, o renderer compartilhado do Atlas apresenta AltAz, crepúsculo e horizonte calculados pelo backend.</p></section>

    <section className="constellation-workbench" aria-label="Observatório de constelações">
      <form className="constellation-controls" onSubmit={calculate}>
        <p className="eyebrow">OBSERVADOR EXPLÍCITO</p><h2>Onde e quando observar</h2><p>A localização fica apenas nesta sessão e não é adicionada ao link da cena.</p>
        <div className="constellation-fields">
          <label>Latitude (graus)<input required inputMode="decimal" value={observer.latitude} onChange={(event) => setObserver((current) => ({ ...current, latitude: event.target.value }))} /></label>
          <label>Longitude (graus)<input required inputMode="decimal" value={observer.longitude} onChange={(event) => setObserver((current) => ({ ...current, longitude: event.target.value }))} /></label>
          <label>Elevação (m)<input required inputMode="decimal" value={observer.elevation} onChange={(event) => setObserver((current) => ({ ...current, elevation: event.target.value }))} /></label>
          <label>UTC<input required type="datetime-local" step="any" value={observer.utc} onChange={(event) => setObserver((current) => ({ ...current, utc: event.target.value }))} /></label>
          <label>Limite Gaia G<input required inputMode="decimal" value={maxMagnitude} onChange={(event) => setMaxMagnitude(event.target.value)} /></label>
        </div>
        {observerError && <p className="constellation-notice error" role="alert">{observerError}</p>}
        <button type="submit" disabled={!selected || !sceneReady}>Calcular céu local</button>
        <p className="constellation-method">WGS84 + UTC · refração desativada (0 hPa). Sem fallback astronômico no navegador.</p>
      </form>

      <aside className="constellation-catalogue"><p className="eyebrow">CATÁLOGO IAU</p><h2>88 regiões oficiais</h2><label>Buscar por IAU ou nome oficial<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ori, Orion…" /></label>{catalogue.status === "loading" && <p className="constellation-notice">Carregando catálogo offline…</p>}{catalogue.status !== "ready" && catalogue.status !== "loading" && <Notice resource={catalogue} />}<div className="constellation-list" aria-label="Lista de constelações">{filteredGuides.map((guide) => <button key={guide.iau_abbreviation} type="button" className={guide.iau_abbreviation === selected?.iau_abbreviation ? "active" : ""} aria-pressed={guide.iau_abbreviation === selected?.iau_abbreviation} onClick={() => selectConstellation(guide.iau_abbreviation)}><strong>{guide.name}</strong><span>{guide.iau_abbreviation} · {guide.gaia_subset_count ?? "—"} estrelas Gaia no recorte</span></button>)}</div></aside>
    </section>

    <section ref={stage} className="constellation-stage-wrap" aria-label="Visor da constelação">
      <div className={catalogueStyles.modes} role="group" aria-label="Modo de visualização"><button type="button" aria-pressed={viewer === "catalogue"} onClick={() => setViewer("catalogue")}>Explorar estrelas e história</button><button type="button" aria-pressed={viewer === "local"} onClick={() => setViewer("local")}>Céu local · horizonte real</button></div>
      <div className="constellation-panel"><h2>{selected?.name ?? "Selecione uma constelação"}</h2><Notice resource={sky} />{result && <p className="constellation-method">{sky.status !== "ready" ? "Resultado anterior · " : "Consulta · "}{result.input.utc} · latitude {result.input.latitude_deg}° · longitude {result.input.longitude_deg}°{result.selected?.boundary_visibility === "below-horizon" ? " · Região abaixo do horizonte neste local e horário." : ""}</p>}</div>
      {viewer === "catalogue" && selectedDetails && <ConstellationCatalogueView key={selectedDetails.iau_abbreviation} guide={selectedDetails} sky={result} />}
      {viewer === "local" && <>
      {result && visibleStars.length === 0 && <div className="constellation-panel"><p>Não há estrelas desta seleção acima do horizonte no UTC escolhido. Isso não é uma falha do visor.</p><div className={catalogueStyles.modes}><button type="button" onClick={() => setViewer("catalogue")}>Explorar no mapa de catálogo</button>{currentPlan?.best_utc && (currentPlan.maximum_altitude_deg ?? -90) > 0 && <button type="button" onClick={() => { const fields = observerFieldsAtUtc(observer, currentPlan.best_utc!); setObserver(fields); void loadConstellation(selectedAbbreviation, fields); }}>Usar horário favorável · {currentPlan.best_utc}</button>}</div></div>}
      {result ? <PlanetSurfaceLoader initialPlanetId="earth" lockPlanet hideDetails requestedView="observer" constellationSky={result} constellationSkyLayers={layers} /> : <div className="constellation-stage-placeholder"><strong>{sky.status === "loading" ? `Carregando ${selected?.name ?? "constelação"}…` : "Clique em uma constelação para abrir seu céu local aqui."}</strong><span>Usamos a localização, o UTC e o limite Gaia do formulário. Dados indisponíveis não são substituídos por estrelas inventadas.</span></div>}
      <div className="constellation-cardinals" aria-label="Convenção do observador"><span>N · norte</span><span>E · leste</span><span>S · sul</span><span>W · oeste</span><span>Zênite = +Y</span></div>
      </>}
    </section>

    <section className="constellation-details">
      <article className="constellation-panel"><p className="eyebrow">SELECIONADA</p><h2>{selected?.name ?? "Aguardando catálogo"}{selected ? ` · ${selected.iau_abbreviation}` : ""}</h2>{selected?.representative_icrs_j2000 && <dl><div><dt>Coordenada de navegação</dt><dd>RA {selected.representative_icrs_j2000.ra_deg.toFixed(4)}° · Dec {selected.representative_icrs_j2000.dec_deg.toFixed(4)}° (ICRS/J2000)</dd></div><div><dt>Extensão / hemisfério</dt><dd>{selectedDetails?.declination_extent_deg ? `Dec ${selectedDetails.declination_extent_deg.min.toFixed(2)}° a ${selectedDetails.declination_extent_deg.max.toFixed(2)}° · ${selectedDetails.hemisphere === "northern" ? "predominantemente norte" : selectedDetails?.hemisphere === "southern" ? "predominantemente sul" : "cruza o equador celeste"}` : "indisponível"}</dd></div><div><dt>Faixa de latitude potencial</dt><dd>{selectedDetails?.potential_latitude_visibility_deg ? `${selectedDetails.potential_latitude_visibility_deg.min.toFixed(1)}° a ${selectedDetails.potential_latitude_visibility_deg.max.toFixed(1)}°; potencial geométrico, não garantia.` : "indisponível"}</dd></div><div><dt>Continentes</dt><dd>{selectedDetails?.continents?.status === "unavailable" ? selectedDetails.continents.message : "sem resumo derivado"}</dd></div><div><dt>Origem histórica</dt><dd>{constellationOrigin(selected.iau_abbreviation)}</dd></div></dl>}<p className="constellation-method">Uma constelação é região e padrão aparente: estrelas dentro dela podem estar a distâncias muito diferentes e não formam necessariamente um grupo físico.</p></article>
      <article className="constellation-panel"><p className="eyebrow">AGORA OBSERVANDO</p><h2>{result ? `${result.twilight === "night" || result.twilight === "astronomical" ? "Céu escuro" : "Condições de luz"} · ${result.twilight}` : "Sem cálculo ativo"}</h2>{result ? <dl><div><dt>Região / horizonte</dt><dd>{result.selected?.boundary_visibility === "below-horizon" ? "abaixo do horizonte" : result.selected?.boundary_visibility === "partially-above-horizon" ? "parcialmente acima do horizonte" : "fronteira inteiramente acima da linha geométrica"}</dd></div><div><dt>Visibilidade e luz</dt><dd>{result.selected?.boundary_visibility === "below-horizon" ? "geometricamente indisponível" : result.twilight === "day" || result.twilight === "civil" || result.twilight === "nautical" ? "acima do horizonte, mas a luz diurna ou o crepúsculo pode impedir a observação" : "geometricamente acima do horizonte sob céu escuro/astronômico"}</dd></div><div><dt>Estrelas acima do horizonte</dt><dd>{visibleStars.length} de {result.stars.length} no filtro G ≤ {result.max_g_mag}</dd></div><div><dt>Sol</dt><dd>alt {result.sun.altitude_deg.toFixed(2)}° · az {result.sun.azimuth_deg.toFixed(2)}°</dd></div><div><dt>Melhor momento na janela UTC</dt><dd>{currentPlan?.best_utc ? `${currentPlan.best_utc} · alt máx ${currentPlan.maximum_altitude_deg?.toFixed(2)}° · resolução ${currentPlan.cadence_minutes} min` : currentPlan?.reason ?? "sem noite astronômica na janela"}</dd></div><div><dt>Nascer, pôr ou circumpolar</dt><dd>{currentPlan ? `${currentPlan.circumpolar_state} · ${currentPlan.rises_in_window ? "nasce" : "não nasce"} / ${currentPlan.sets_in_window ? "põe" : "não se põe"} na janela` : "indisponível"}</dd></div></dl> : <Notice resource={sky} />}<p className="constellation-method">{result?.iers_warning ?? "Aguardando uma resposta do backend Astropy local."}</p></article>
      <article className="constellation-panel constellation-layers"><p className="eyebrow">CAMADAS</p><h2>Camadas do céu local</h2>{([['stars', 'Estrelas Gaia'], ['iauBoundaries', 'Fronteiras IAU'], ['selectedConstellation', 'Constelação selecionada'], ['horizonGrid', 'Horizonte e grade'], ['cardinalDirections', 'Direções cardeais']] as const).map(([key, title]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={(event) => changeLayer(key, event.target.checked)} /> {title}</label>)}<label className="disabled"><input type="checkbox" checked={false} disabled /> Linhas culturais (dados ausentes; desativadas)</label></article>
    </section>

    {selectedDetails?.brightest_gaia_stars?.length ? <section className="constellation-brightest constellation-panel"><p className="eyebrow">ESTRELAS BRILHANTES DO RECORTE</p><h2>Gaia DR3, sem nome próprio inferido</h2><ul>{selectedDetails.brightest_gaia_stars.map((star) => <li key={star.gaia_dr3_source_id}><strong>Gaia DR3 {star.gaia_dr3_source_id}</strong><span>G {star.g_mag.toFixed(2)} · {star.name_status === "unavailable_no_official_wgsn_cross_match" ? "nome próprio oficial não curado" : star.name_status}</span></li>)}</ul></section> : null}

    {result?.now_observing?.length ? <section className="constellation-now constellation-panel"><p className="eyebrow">O QUE OBSERVAR AGORA</p><h2>Candidatas geométricas no UTC solicitado</h2><p className="constellation-method">Ordenadas pela altitude da estrela brilhante mais alta e pela contagem Gaia G ≤ 4,5 acima do horizonte. Não considera nuvens, poluição luminosa, relevo ou obstruções.</p><ol>{result.now_observing.map((item) => <li key={item.iau_abbreviation}><button type="button" onClick={() => selectConstellation(item.iau_abbreviation)}><strong>{item.name} · {item.iau_abbreviation}</strong><span>{item.bright_stars_above_horizon} estrelas brilhantes · pico alt {item.highest_bright_star_altitude_deg.toFixed(1)}° · luz: {item.light_condition}</span></button></li>)}</ol></section> : null}

    {result?.planning && <section className="constellation-planning constellation-panel"><p className="eyebrow">JANELA ANUAL</p><h2>Planejamento geométrico mensal</h2><p className="constellation-method">{result.planning.method}</p><table><caption>Dia 15 de cada mês em UTC; classificação pela altitude máxima da coordenada representativa durante amostras de noite astronômica.</caption><thead><tr><th>Mês</th><th>Noite astronômica</th><th>Alt. máxima</th><th>Melhor UTC</th><th>Classe</th></tr></thead><tbody>{result.planning.monthly.map((month) => <tr key={month.month}><td>{month.month}</td><td>{month.astronomical_night ? "sim" : "não"}</td><td>{month.maximum_altitude_deg === undefined ? "—" : `${month.maximum_altitude_deg.toFixed(1)}°`}</td><td>{month.best_utc ?? "—"}</td><td>{month.classification}</td></tr>)}</tbody></table><ul>{result.planning.limitations.map((limit) => <li key={limit}>{limit}</li>)}</ul></section>}

    {result && <section className="constellation-accessible constellation-panel"><p className="eyebrow">ALTERNATIVA ACESSÍVEL</p><h2>Objetos retornados pelo cálculo</h2><table><caption>Estrelas Gaia da constelação selecionada; ordenação preserva o retorno do catálogo.</caption><thead><tr><th>Gaia DR3</th><th>G</th><th>Alt</th><th>Az</th><th>Horizonte</th></tr></thead><tbody>{result.stars.slice(0, 120).map((star) => <tr key={star.gaia_dr3_source_id}><td>{star.gaia_dr3_source_id}</td><td>{star.g_mag.toFixed(2)}</td><td>{star.altitude_deg.toFixed(2)}°</td><td>{star.azimuth_deg.toFixed(2)}°</td><td>{star.above_horizon ? "acima" : "abaixo"}</td></tr>)}</tbody></table>{result.stars.length > 120 && <p className="constellation-method">Tabela limitada a 120 linhas para leitura; o total do cálculo é {result.stars.length}.</p>}</section>}

    <section className="constellation-provenance constellation-panel"><p className="eyebrow">DADOS, MÉTODO E LIMITES</p><h2>O que este observatório afirma</h2><ul><li>IAU/Roman–Delporte: limites formais de regiões, não desenhos de constelações.</li><li>Gaia DR3: subconjunto offline limitado a G ≤ 6,5 e época de catálogo J2016.0.</li><li>Transformação local: ICRS para AltAz topocêntrico no backend Astropy, com UTC e WGS84 informados.</li><li>Nomes de estrelas IAU: {!result || result.named_stars.status === "unavailable" ? "cross-match não disponível; destaques históricos separados dos pontos Gaia." : "conforme artefato fornecido."}</li></ul><h3>Glossário breve</h3><dl><div><dt>Constelação / asterismo</dt><dd>Constelação é uma região oficial; asterismo é um padrão visual que pode atravessar regiões.</dd></div><div><dt>Limite IAU</dt><dd>Fronteira formal usada para classificar coordenadas no céu.</dd></div><div><dt>Magnitude G</dt><dd>Fotometria do Gaia; não é idêntica à resposta visual humana.</dd></div><div><dt>Altitude / azimute</dt><dd>Ângulo acima do horizonte / direção local de norte para leste.</dd></div><div><dt>Circumpolar / crepúsculo astronômico</dt><dd>Uma coordenada não se põe geometricamente / Sol abaixo de −18°.</dd></div></dl>{result && <><p className="constellation-method">{result.method}</p><ul>{result.limitations.map((limit) => <li key={limit}>{limit}</li>)}</ul></>}</section>
  </main></div>;
}
