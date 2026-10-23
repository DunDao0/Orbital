"use client";

import { useMemo, useState } from "react";
import type { AtlasComparisonMode } from "@/app/components/PlanetSurfaceExplorer";
import { formatKilometres, horizonDistanceMeters, measureBodies, wgs84DistanceMeters, type SpatialBody } from "@/lib/atlas/measurements";
import type { MoonRecord, ReferenceSnapshot } from "@/lib/science/contracts";
import { parseDecimalInput } from "@/lib/science/observerFields";

type Props = {
  snapshot?: ReferenceSnapshot;
  moon?: MoonRecord;
  comparisonMode: AtlasComparisonMode;
  onComparisonChange: (mode: AtlasComparisonMode) => void;
};

type Point = { latitude: string; longitude: string; elevation: string };
const INITIAL_POINT: Point = { latitude: "", longitude: "", elevation: "" };

function formatDistance(value: number | undefined, unit: "km" | "m") {
  if (value === undefined) return "indisponível";
  if (unit === "m") return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m`;
  return formatKilometres(value);
}

function snapshotBody(snapshot: ReferenceSnapshot | undefined, name: string): SpatialBody | undefined {
  const body = snapshot?.bodies.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  return body ? { name: body.name, radius_m: body.radius_m, position_m: body.position_m, velocity_m_s: body.velocity_m_s } : undefined;
}

export default function AtlasMeasurementPanel({ snapshot, moon, comparisonMode, onComparisonChange }: Props) {
  const [pointA, setPointA] = useState<Point>(INITIAL_POINT);
  const [pointB, setPointB] = useState<Point>(INITIAL_POINT);
  const [unit, setUnit] = useState<"km" | "m">("km");
  const earth = useMemo(() => snapshotBody(snapshot, "Earth"), [snapshot]);
  const moonBody = useMemo<SpatialBody | undefined>(() => {
    const state = snapshotBody(snapshot, "Moon");
    if (state) return state;
    return moon ? { name: moon.name, radius_m: moon.mean_radius_m ?? undefined } : undefined;
  }, [moon, snapshot]);
  const spatial = earth && moonBody ? measureBodies(earth, moonBody) : {};
  const geoDistance = wgs84DistanceMeters(parseDecimalInput(pointA.latitude) ?? Number.NaN, parseDecimalInput(pointA.longitude) ?? Number.NaN, parseDecimalInput(pointB.latitude) ?? Number.NaN, parseDecimalInput(pointB.longitude) ?? Number.NaN);
  const horizon = horizonDistanceMeters(parseDecimalInput(pointA.elevation) ?? Number.NaN);

  return <section className="atlas-tool-panel" aria-labelledby="measurements-title">
    <div><p className="eyebrow">MEDIÇÕES E COMPARAÇÃO</p><h2 id="measurements-title">Valores físicos separados da escala visual</h2><p>Modelo geodésico: WGS84. O visualizador nunca converte distância de tela em distância científica.</p></div>
    <div className="atlas-tool-grid">
      <article className="atlas-tool-card"><h3>Terra: geodésia local</h3><div className="atlas-point-grid"><fieldset><legend>Ponto A</legend><label>Latitude<input inputMode="decimal" value={pointA.latitude} onChange={(event) => setPointA((current) => ({ ...current, latitude: event.target.value }))} /></label><label>Longitude<input inputMode="decimal" value={pointA.longitude} onChange={(event) => setPointA((current) => ({ ...current, longitude: event.target.value }))} /></label><label>Elevação (m)<input inputMode="decimal" value={pointA.elevation} onChange={(event) => setPointA((current) => ({ ...current, elevation: event.target.value }))} /></label></fieldset><fieldset><legend>Ponto B</legend><label>Latitude<input inputMode="decimal" value={pointB.latitude} onChange={(event) => setPointB((current) => ({ ...current, latitude: event.target.value }))} /></label><label>Longitude<input inputMode="decimal" value={pointB.longitude} onChange={(event) => setPointB((current) => ({ ...current, longitude: event.target.value }))} /></label></fieldset></div><label>Unidade<select value={unit} onChange={(event) => setUnit(event.target.value as "km" | "m")}><option value="km">quilômetros</option><option value="m">metros</option></select></label><table><caption>Medições WGS84 sem persistir coordenadas</caption><tbody><tr><th scope="row">Distância geodésica</th><td>{formatDistance(geoDistance, unit)}</td></tr><tr><th scope="row">Horizonte a partir de A</th><td>{formatDistance(horizon, unit)}</td></tr><tr><th scope="row">Área, perfil e altitude entre pontos</th><td>indisponíveis: não há fonte de terreno aprovada</td></tr></tbody></table></article>
      <article className="atlas-tool-card"><h3>Terra–Lua: estado disponível</h3><p>Os campos aparecem somente se o snapshot possui vetores. O catálogo lunar, por si só, não é uma posição observável.</p><table><caption>Medições espaciais</caption><tbody><tr><th scope="row">Distância centro a centro</th><td>{formatDistance(spatial.centerDistanceM, unit)}</td></tr><tr><th scope="row">Distância entre superfícies</th><td>{formatDistance(spatial.surfaceDistanceM, unit)}</td></tr><tr><th scope="row">Diâmetro angular da Lua</th><td>{spatial.angularDiameterRad === undefined ? "indisponível" : `${(spatial.angularDiameterRad * 180 / Math.PI).toLocaleString("pt-BR", { maximumFractionDigits: 5 })}°`}</td></tr><tr><th scope="row">Tempo-luz</th><td>{spatial.lightTimeS === undefined ? "indisponível" : `${spatial.lightTimeS.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} s`}</td></tr><tr><th scope="row">Velocidade relativa</th><td>{spatial.relativeSpeedMps === undefined ? "indisponível" : `${spatial.relativeSpeedMps.toLocaleString("pt-BR", { maximumFractionDigits: 3 })} m/s`}</td></tr><tr><th scope="row">Período orbital</th><td>{moon?.orbit?.period_days ? `${moon.orbit.period_days.toLocaleString("pt-BR")} dias (catálogo)` : "indisponível"}</td></tr></tbody></table><p className="atlas-scale-note">Escala visual: comprimida para navegação. Distâncias reais: somente valores acima, quando fornecidos pela fonte.</p></article>
      <article className="atlas-tool-card"><h3>Comparador no mesmo canvas</h3><p>O modo usa dois viewports/scissor do renderizador existente. Não cria canvas, renderer ou loop adicional.</p><label>Modo de comparação<select aria-label="Modo de comparação" value={comparisonMode} onChange={(event) => onComparisonChange(event.target.value as AtlasComparisonMode)}><option value="none">desativado</option><option value="real-size">referência relativa</option><option value="visual-scale">ampliação visual</option></select></label><p className="atlas-next-muted">A referência mantém a escala do globo; a ampliação aumenta somente o globo do viewport direito. Nenhuma das duas altera os vetores físicos.</p></article>
    </div>
  </section>;
}
