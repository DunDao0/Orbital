export type OrbitalLayerDefinition = {
  id: string;
  title: string;
  category: "visual" | "scientific" | "missions" | "events" | "reference";
  kind: "texture" | "raster-tiles" | "vector" | "markers" | "trajectory" | "geometry";
  temporal: boolean;
  opacitySupported: boolean;
  source: { name: string; attribution: string; license?: string };
  status: "static" | "snapshot" | "historical" | "near-real-time" | "live";
  coverage?: { validFromUtc?: string; validUntilUtc?: string; description: string };
  limitations?: string[];
  enabled?: boolean;
};

export const ORBITAL_LAYER_DEFINITIONS: OrbitalLayerDefinition[] = [
  { id: "earth-atmosphere", title: "Atmosfera procedural", category: "visual", kind: "geometry", temporal: false, opacitySupported: true, source: { name: "Orbis Scientia procedural", attribution: "Modelo visual local; não é observação atmosférica." }, status: "static", coverage: { description: "Sem cobertura temporal: apresentação procedural." } },
  { id: "earth-clouds", title: "Nuvens procedurais", category: "visual", kind: "geometry", temporal: false, opacitySupported: true, source: { name: "Orbis Scientia procedural", attribution: "Nuvens estáticas de apresentação; não são meteorologia atual." }, status: "static", limitations: ["Sem dado meteorológico temporal."] },
  { id: "earth-grid", title: "Grade latitude/longitude", category: "reference", kind: "vector", temporal: false, opacitySupported: true, source: { name: "WGS84", attribution: "Grade de referência visual." }, status: "static" },
  { id: "earth-observer-marker", title: "Marcador do observador", category: "reference", kind: "markers", temporal: false, opacitySupported: true, source: { name: "Sessão local", attribution: "Posição mantida apenas na sessão atual." }, status: "static" },
  { id: "earth-temporal-fixture", title: "Camada temporal demonstrativa", category: "scientific", kind: "raster-tiles", temporal: true, opacitySupported: true, source: { name: "Fixture local", attribution: "Contrato testável, sem provedor externo configurado." }, status: "historical", limitations: ["Desativada por padrão; não representa observação terrestre."] , enabled: false },
  { id: "sky-gaia-stars", title: "Estrelas Gaia DR3", category: "scientific", kind: "markers", temporal: true, opacitySupported: true, source: { name: "ESA Gaia DR3", attribution: "Subconjunto offline G ≤ 6,5; AltAz é calculado somente pelo backend nativo." }, status: "snapshot", limitations: ["Não é catálogo estelar completo."] },
  { id: "sky-iau-boundaries", title: "Fronteiras IAU", category: "reference", kind: "vector", temporal: false, opacitySupported: true, source: { name: "Roman 1987 / Delporte", attribution: "Regiões formais IAU transformadas de B1875 para ICRS/J2000." }, status: "static" },
  { id: "sky-selected-constellation", title: "Constelação selecionada", category: "reference", kind: "geometry", temporal: true, opacitySupported: true, source: { name: "Orbis Scientia", attribution: "Filtro visual sobre a geometria formal retornada pelo serviço local." }, status: "snapshot" },
  { id: "sky-horizon-grid", title: "Horizonte e grade AltAz", category: "reference", kind: "vector", temporal: true, opacitySupported: true, source: { name: "AltAz local", attribution: "Convenção visual para a resposta topocêntrica do backend." }, status: "snapshot" },
  { id: "sky-cardinal-directions", title: "Direções cardeais", category: "reference", kind: "vector", temporal: false, opacitySupported: true, source: { name: "Convenção do observador", attribution: "N=0°, E=90°, S=180°, W=270°; zênite no eixo +Y." }, status: "static" },
  { id: "sky-cultural-lines", title: "Linhas culturais", category: "reference", kind: "vector", temporal: false, opacitySupported: false, source: { name: "Não incluído", attribution: "Nenhum conjunto de linhas culturais foi fornecido ou inferido." }, status: "static", limitations: ["Desativada: dados ausentes."], enabled: false },
];

/** Only expose controls implemented by the active globe; sky has its own panel. */
export function globeLayerDefinitions(planetId: string, hasObserver: boolean): OrbitalLayerDefinition[] {
  if (planetId !== "earth") return [];
  return ORBITAL_LAYER_DEFINITIONS.filter((layer) => layer.id.startsWith("earth-")).map((layer) => {
    if (layer.id !== "earth-observer-marker" || hasObserver) return layer;
    return { ...layer, enabled: false, limitations: ["Disponível na Janela da Terra, após informar uma localização válida."] };
  });
}
