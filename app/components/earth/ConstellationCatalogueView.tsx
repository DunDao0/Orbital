"use client";

import { useMemo, useState } from "react";
import { CONSTELLATION_MEANINGS, constellationOrigin, EDUCATION_SOURCES, NAMED_STAR_HIGHLIGHTS, projectCatalogueStars, type CatalogueStar } from "@/lib/atlas/constellationEducation";
import { magnitudeToPointSize } from "@/lib/atlas/constellations";
import type { ConstellationGuide, ConstellationSkyResponse } from "@/lib/science/contracts";
import styles from "./ConstellationCatalogueView.module.css";

type Guide = ConstellationGuide & { brightest_gaia_stars?: CatalogueStar[] };

export default function ConstellationCatalogueView({ guide, sky }: { guide: Guide; sky?: ConstellationSkyResponse }) {
  const [selectedId, setSelectedId] = useState<string>();
  const center = guide.representative_icrs_j2000;
  // Preserve the initial stars as local results arrive. A restrictive magnitude
  // cut can contain fewer stars than the five already present in the catalogue.
  const stars = useMemo(() => {
    const byId = new Map((guide.brightest_gaia_stars ?? []).map((star) => [star.gaia_dr3_source_id, star]));
    for (const star of sky?.stars ?? []) byId.set(star.gaia_dr3_source_id, star);
    return Array.from(byId.values()).sort((a, b) => a.g_mag - b.g_mag);
  }, [guide, sky]);
  const points = useMemo(() => projectCatalogueStars(stars, center?.ra_deg ?? stars[0]?.ra_deg ?? 0, center?.dec_deg ?? 0), [stars, center]);
  const focused = points.find((star) => star.gaia_dr3_source_id === selectedId) ?? points[0];
  const named = NAMED_STAR_HIGHLIGHTS[guide.iau_abbreviation];
  const title = guide.aliases?.find((alias) => /[À-ÿ]/.test(alias)) ?? guide.name;

  return <div className={styles.explorer}>
    <div className={styles.chart}>
      <div className={styles.heading}><span>MAPA DE CATÁLOGO · ICRS · J2016.0</span><h3>{title}</h3><p>{points.length} estrelas catalogadas · brilho relativo pela magnitude G</p></div>
      {points.length ? <svg viewBox="0 0 800 440" aria-label={`Mapa de estrelas de ${title}; norte acima, ascensão reta crescente à esquerda`}>
        <title>Estrelas de {title}, independentes do horizonte local</title>
        <path d="M40 110H760 M40 220H760 M40 330H760 M200 45V395 M400 45V395 M600 45V395" stroke="#254258" strokeWidth="1" opacity=".45" />
        <text x="400" y="24" textAnchor="middle" fill="#91b6cc" fontSize="13">NORTE CELESTE ↑</text>
        <text x="40" y="425" fill="#91b6cc" fontSize="13">← Ascensão reta crescente · projeção de catálogo</text>
        {points.map((star, index) => {
          const active = star.gaia_dr3_source_id === focused?.gaia_dr3_source_id;
          const radius = magnitudeToPointSize(star.g_mag) / 2;
          return <g key={star.gaia_dr3_source_id} role="button" tabIndex={0} aria-label={`Estrela ${index + 1}, Gaia DR3 ${star.gaia_dr3_source_id}, magnitude G ${star.g_mag.toFixed(2)}`} aria-pressed={active}
            onClick={() => setSelectedId(star.gaia_dr3_source_id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(star.gaia_dr3_source_id); } }} className={styles.star}>
            <title>{`Gaia DR3 ${star.gaia_dr3_source_id} · G ${star.g_mag.toFixed(2)}`}</title>
            <circle cx={star.x} cy={star.y} r={Math.max(8, radius * 1.5)} fill="transparent" />
            <circle cx={star.x} cy={star.y} r={radius * 2.6} fill="#82c9ff" opacity=".12" />
            <circle cx={star.x} cy={star.y} r={radius} fill="#e7f5ff" />
            <circle cx={star.x} cy={star.y} r={radius * .45} fill="white" />
            {active && <circle cx={star.x} cy={star.y} r={radius + 7} fill="none" stroke="#f0cf83" />}
            {(index < 5 || active) && <text x={star.x + 14} y={star.y - 11} fill="#b8d6e8" fontSize="12" pointerEvents="none">{index + 1}</text>}
          </g>;
        }).reverse()}
      </svg> : <p>Nenhuma coordenada de estrela disponível neste recorte. Consulte a carta oficial nas fontes abaixo.</p>}
      <p className={styles.note}>Este mapa não é o céu visível agora. Mostra coordenadas de catálogo, inclusive abaixo do horizonte. Não desenhamos estrelas decorativas nem inferimos nomes por proximidade.</p>
      {focused && <div className={styles.selection} aria-live="polite"><strong>Gaia DR3 {focused.gaia_dr3_source_id}</strong><span>G {focused.g_mag.toFixed(2)} · RA {focused.ra_deg.toFixed(4)}° · Dec {focused.dec_deg.toFixed(4)}°</span><span>Nome próprio e data da primeira observação: não informados neste catálogo.</span></div>}
    </div>
    <article className={styles.story} aria-label={`Sobre ${title}`}>
      <p className="eyebrow">POR TRÁS DAS ESTRELAS</p><h3>{title} · {guide.iau_abbreviation}</h3>
      <h4>Por que esse nome?</h4><p>O nome representa {CONSTELLATION_MEANINGS[guide.iau_abbreviation] ?? guide.name}. {constellationOrigin(guide.iau_abbreviation)}</p>
      {guide.iau_abbreviation === "And" && <p>Na mitologia grega, Andrômeda é filha de Cefeu e Cassiopeia. Não confunda a constelação com M31: a galáxia de Andrômeda é um objeto distante nessa direção, não uma estrela do desenho.</p>}
      <h4>Quais estrelas fazem parte?</h4>
      {named ? <><ul>{named.map((star) => <li key={star}>{star}</li>)}</ul><p className={styles.note}>Destaques da carta IAU, apresentados separadamente: não há identificação cruzada deles com os pontos Gaia deste recorte.</p></> : <p>As estrelas do recorte estão identificadas no mapa e na lista abaixo pelo número Gaia DR3. Os nomes tradicionais podem ser consultados na carta IAU; ainda não há uma lista nominal revisada nesta ficha.</p>}
      <h4>Quando foram descobertas?</h4><p>Estrelas visíveis a olho nu podem ser conhecidas desde a Antiguidade, sem descobridor ou data individual documentados. J2016.0 é a época das coordenadas Gaia, não a descoberta. A aprovação moderna de um nome também não marca a primeira observação.</p>
      <h4>Uma região, não um grupo físico</h4><p>A IAU adotou 88 constelações em 1922; os limites de Delporte foram publicados em 1930. Estrelas na mesma direção podem estar muito distantes umas das outras. O recorte desta região contém {guide.gaia_subset_count ?? "—"} estrelas Gaia; não é um censo completo.</p>
      <details><summary>Estrelas representadas ({points.length})</summary><ol className={styles.starList}>{points.map((star, index) => <li key={star.gaia_dr3_source_id}><button type="button" onClick={() => setSelectedId(star.gaia_dr3_source_id)} aria-pressed={focused?.gaia_dr3_source_id === star.gaia_dr3_source_id}>{index + 1} · Gaia {star.gaia_dr3_source_id} · G {star.g_mag.toFixed(2)}</button></li>)}</ol></details>
      <nav className={styles.sources} aria-label="Fontes da ficha"><a href={EDUCATION_SOURCES.history} target="_blank" rel="noreferrer">Origem · Harvard/CfA</a><a href={EDUCATION_SOURCES.names} target="_blank" rel="noreferrer">Cartas e regiões · IAU</a><a href={EDUCATION_SOURCES.stars} target="_blank" rel="noreferrer">Nomes estelares · IAU</a>{named && <a href={`https://iauarchive.eso.org/static/public/constellations/pdf/${guide.iau_abbreviation.toUpperCase()}.pdf`} target="_blank" rel="noreferrer">Carta oficial de {title}</a>}</nav>
    </article>
  </div>;
}
