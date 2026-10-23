"use client";

import { useEffect, useRef, useState } from "react";
import { createFixtureTileLoader, EARTH_LAB_FEATURE_FLAG, EARTH_TEMPORAL_FIXTURE, type EarthTileLoader } from "@/lib/atlas/earth-lab";

export default function EarthLabPanel() {
  const loader = useRef<EarthTileLoader | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [status, setStatus] = useState("Camadas externas desativadas: não há provedor aprovado configurado.");
  const [cacheSize, setCacheSize] = useState(0);

  useEffect(() => {
    loader.current = createFixtureTileLoader();
    return () => { controller.current?.abort(); loader.current?.dispose(); loader.current = null; };
  }, []);

  async function verifyFixture() {
    controller.current?.abort();
    const next = new AbortController(); controller.current = next;
    setStatus("Verificando fixture local sem rede…");
    const tile = await loader.current?.load({ key: "offline-contract", signal: next.signal });
    if (next.signal.aborted) return;
    setCacheSize(loader.current?.size ?? 0);
    setStatus(tile ? "Fixture local carregada para validar cache e cancelamento. Não representa dado geográfico." : "Fixture cancelada ou indisponível.");
  }

  return <section className="atlas-tool-panel" aria-labelledby="earth-lab-title"><div><p className="eyebrow">EARTH LAB</p><h2 id="earth-lab-title">Camadas temporais sem dado falso</h2><p>A arquitetura existe offline; a camada externa permanece atrás de feature flag até haver fonte, licença e provedor permitidos.</p></div><div className="atlas-tool-grid"><article className="atlas-tool-card"><h3>{EARTH_TEMPORAL_FIXTURE.title}</h3><dl><div><dt>Fonte / licença</dt><dd>{EARTH_TEMPORAL_FIXTURE.source.name} · {EARTH_TEMPORAL_FIXTURE.source.license}</dd></div><div><dt>Data declarada</dt><dd>{EARTH_TEMPORAL_FIXTURE.dataUtc}</dd></div><div><dt>Cobertura</dt><dd>{EARTH_TEMPORAL_FIXTURE.coverage.description}</dd></div><div><dt>Resolução</dt><dd>{EARTH_TEMPORAL_FIXTURE.resolution}</dd></div><div><dt>Legenda</dt><dd>{EARTH_TEMPORAL_FIXTURE.legend}</dd></div></dl><button type="button" onClick={() => void verifyFixture()}>Verificar fixture offline</button><p aria-live="polite">{status} Cache: {cacheSize}/8.</p></article><article className="atlas-tool-card"><h3>Controles temporais</h3><label>Comparação temporal<select disabled aria-label="Comparação temporal indisponível"><option>divisor A/B — indisponível</option><option>alternância — indisponível</option><option>fade — indisponível</option><option>lado a lado — indisponível</option><option>animação — indisponível</option></select></label><p>O loader é sob demanda, cancelável e limitado por LRU. Nenhum tile entra no bundle principal e o Worker não atua como proxy.</p><p className="atlas-next-muted">Feature flag externa: {EARTH_LAB_FEATURE_FLAG ? "ativa" : "desativada"}.</p></article><article className="atlas-tool-card"><h3>Atribuição e limites</h3><p>{EARTH_TEMPORAL_FIXTURE.source.attribution}</p><ul className="atlas-transcript">{EARTH_TEMPORAL_FIXTURE.limitations.map((limit) => <li key={limit}>{limit}</li>)}</ul><p>Sem rede, o globo básico continua sem depender desta camada.</p></article></div></section>;
}
