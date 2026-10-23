"use client";

export default function EarthAtlasError({ reset }: { error: Error; reset: () => void }) {
  return <main className="atlas-shell"><section className="earth-panel"><p className="eyebrow">JANELA DA TERRA</p><h1>Não foi possível abrir esta rota.</h1><p>Os dados científicos não foram substituídos por estimativas.</p><button type="button" onClick={reset}>Tentar novamente</button><a href="/atlas">Voltar ao Atlas</a></section></main>;
}
