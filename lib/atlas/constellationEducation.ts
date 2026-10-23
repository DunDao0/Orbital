/** Editorial facts, not astrometry. Sources are linked in the UI and docs. */
export const CONSTELLATION_MEANINGS: Record<string, string> = {
  And: "Andrômeda, princesa", Ant: "bomba de ar", Aps: "ave-do-paraíso", Aqr: "aguadeiro", Aql: "águia", Ara: "altar", Ari: "carneiro", Aur: "cocheiro", Boo: "boieiro",
  Cae: "buril", Cam: "girafa", Cnc: "caranguejo", CVn: "cães de caça", CMa: "cão maior", CMi: "cão menor", Cap: "cabra marinha", Car: "quilha", Cas: "rainha Cassiopeia", Cen: "centauro", Cep: "rei Cefeu", Cet: "monstro marinho",
  Cha: "camaleão", Cir: "compasso", Col: "pomba", Com: "cabeleira de Berenice", CrA: "coroa austral", CrB: "coroa boreal", Crv: "corvo", Crt: "taça", Cru: "cruzeiro", Cyg: "cisne", Del: "golfinho", Dor: "dourado", Dra: "dragão", Equ: "cavalinho", Eri: "rio Erídano",
  For: "forno", Gem: "gêmeos", Gru: "grou", Her: "Hércules", Hor: "relógio", Hya: "hidra", Hyi: "serpente aquática", Ind: "índio", Lac: "lagarto", Leo: "leão", LMi: "leão menor", Lep: "lebre", Lib: "balança", Lup: "lobo", Lyn: "lince", Lyr: "lira",
  Men: "Montanha da Mesa", Mic: "microscópio", Mon: "unicórnio", Mus: "mosca", Nor: "esquadro", Oct: "octante", Oph: "serpentário", Ori: "Órion, caçador", Pav: "pavão", Peg: "Pégaso", Per: "Perseu", Phe: "fênix", Pic: "cavalete", Psc: "peixes", PsA: "peixe austral", Pup: "popa", Pyx: "bússola", Ret: "retículo",
  Sge: "flecha", Sgr: "arqueiro", Sco: "escorpião", Scl: "escultor", Sct: "escudo", Ser: "serpente", Sex: "sextante", Tau: "touro", Tel: "telescópio", Tri: "triângulo", TrA: "triângulo austral", Tuc: "tucano", UMa: "ursa maior", UMi: "ursa menor", Vel: "velas", Vir: "virgem", Vol: "peixe voador", Vul: "raposa",
};

const MODERN_GROUPS = [
  { ids: "Ant Cae Car Cir For Hor Men Mic Nor Oct Pic Pup Pyx Ret Scl Tel Vel", text: "Tradição cartográfica de Lacaille, século XVIII; instrumentos e novas divisões do céu austral." },
  { ids: "Aps Cha Dor Gru Hyi Ind Mus Pav Phe TrA Tuc Vol", text: "Cartografia do céu austral na época das navegações; presente na Uranometria de Bayer (1603)." },
  { ids: "CVn Lac LMi Lyn Sct Sex Vul", text: "Cartografia de Hevelius, publicada em 1690." },
  { ids: "Cam Col Mon", text: "Cartografia de Plancius, entre o fim do século XVI e o início do XVII." },
  { ids: "Com", text: "Nome ligado à rainha Berenice II; individualizada na cartografia europeia do século XVI." },
  { ids: "Cru", text: "Separada de Centaurus na cartografia moderna; presente na Uranometria (1603)." },
];

export function constellationOrigin(id: string): string {
  if (!CONSTELLATION_MEANINGS[id]) return "Origem ainda não revisada editorialmente.";
  return MODERN_GROUPS.find((group) => group.ids.split(" ").includes(id))?.text
    ?? "Tradição antiga, registrada no repertório greco-romano de constelações. Não corresponde à descoberta individual de suas estrelas.";
}

// Independently identified on the official IAU charts, never matched to Gaia IDs by proximity.
export const NAMED_STAR_HIGHLIGHTS: Record<string, string[]> = {
  And: ["Alpheratz (α Andromedae)", "Mirach (β Andromedae)", "Almach (γ Andromedae)"],
  Ori: ["Betelgeuse (α Orionis)", "Rigel (β Orionis)", "Bellatrix (γ Orionis)", "Mintaka (δ Orionis)", "Alnilam (ε Orionis)", "Alnitak (ζ Orionis)", "Saiph (κ Orionis)"],
};

export const EDUCATION_SOURCES = {
  names: "https://iauarchive.eso.org/public/themes/constellations/",
  history: "https://library.cfa.harvard.edu/iau-constellations",
  stars: "https://iauarchive.eso.org/public/themes/naming_stars/",
};

export type CatalogueStar = { gaia_dr3_source_id: string; ra_deg: number; dec_deg: number; g_mag: number };

/** Equal-angle chart, not a local-sky calculation. Unwrap RA around navigation center. */
export function projectCatalogueStars(stars: readonly CatalogueStar[], centerRa: number, centerDec: number) {
  const valid = stars.filter((star) => Number.isFinite(star.ra_deg) && Number.isFinite(star.dec_deg) && Number.isFinite(star.g_mag));
  if (!valid.length) return [];
  const cosine = Math.max(0.08, Math.cos(centerDec * Math.PI / 180));
  const raw = valid.map((star) => ({ star, x: -(((star.ra_deg - centerRa + 540) % 360) - 180) * cosine, y: -star.dec_deg }));
  const xs = raw.map((point) => point.x), ys = raw.map((point) => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(680 / Math.max(2, maxX - minX), 330 / Math.max(2, maxY - minY));
  return raw.map(({ star, x, y }) => ({ ...star, x: 400 + (x - (minX + maxX) / 2) * scale, y: 215 + (y - (minY + maxY) / 2) * scale }));
}
