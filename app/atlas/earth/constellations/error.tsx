"use client";

export default function ConstellationsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="constellation-shell"><section className="constellation-panel" data-error-digest={error.digest ?? ""}><p className="eyebrow">PALCO WEBGL INDISPONÍVEL</p><h1>O catálogo e o método continuam documentados.</h1><p>O navegador não conseguiu inicializar a visualização complementar. Nenhuma posição foi substituída por um mapa aproximado; tente novamente ou consulte a alternativa HTML quando a API local estiver disponível.</p><button type="button" onClick={reset}>Tentar inicializar novamente</button></section></main>;
}
