import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server renders the scientific planetarium shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Orbis Scientia/);
  assert.match(html, /PLANETÁRIO CIENTÍFICO RASTREÁVEL/);
  assert.match(html, /Do estado físico ao céu observado/);
  assert.match(html, /Atalhos de investigação/);
  assert.match(html, /REFERÊNCIA · DE442s LOCAL/);
  assert.match(html, /Carregar efeméride UTC/);
  assert.match(html, /CENA WEBGL · XYZ J2000/);
  assert.match(html, /VISTA ORBITAL/);
  assert.match(html, /Órbitas osculantes derivadas do estado atual/);
  assert.match(html, /Modo de escala visual/);
  assert.match(html, /Mapa orbital/);
  assert.match(html, /Sistemas planetários pesquisáveis/);
  assert.match(html, /Plutão<small>planeta anão · Atlas/);
  assert.match(html, /Sistema Solar<small>estados e dinâmica/);
  assert.match(html, /Atlas Planetário<small>mundos em 3D/);
  assert.doesNotMatch(html, /SkeletonPreview|react-loading-skeleton/);
});

test("server renders the interactive planetary atlas route", async () => {
  const response = await render("/atlas");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /ATLAS PLANETÁRIO/);
  assert.match(html, /Entre em órbita/);
  assert.match(html, /NOVE MUNDOS · UMA EXPERIÊNCIA CONTÍNUA/);
  assert.match(html, /Sistema Solar<small>estados e dinâmica/);
  assert.match(html, /Construindo ambiente planetário/);
});

test("server renders the dedicated Earth window with scientific limits outside the canvas", async () => {
  const response = await render("/atlas/earth");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /JANELA DA TERRA/);
  assert.match(html, /Uma leitura visual separada do cálculo científico/);
  assert.match(html, /Raio equatorial \/ polar/);
  assert.match(html, /Coordenadas permanecem somente nesta sessão/);
  assert.match(html, /Cálculos do céu local estão indisponíveis neste ambiente/);
  assert.match(html, /Resultado calculado pelo modelo topocêntrico atual/);
  assert.match(html, /Terra–Lua/);
  assert.match(html, /MEDIÇÕES E COMPARAÇÃO/);
  assert.match(html, /JORNADAS GUIADAS/);
  assert.match(html, /EXPLORADOR DE MISSÕES/);
  assert.match(html, /CENTRO DE EVENTOS/);
  assert.match(html, /EARTH LAB/);
  assert.match(html, /PERGUNTE AO ORBITAL/);
  assert.match(html, /\/atlas\/earth/);
  assert.doesNotMatch(html, /CUSTOMER_HTTP_SCIENCE_API|127\.0\.0\.1:8000/);
});

test("server renders the constellation observatory shell without leaking a local service address", async () => {
  const response = await render("/atlas/earth/constellations");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /OBSERVATÓRIO · CONSTELAÇÕES IAU · ALTAZ LOCAL/);
  assert.match(html, /88 regiões oficiais/);
  assert.match(html, /Linhas culturais \(dados ausentes; desativadas\)/);
  assert.match(html, /Explorar estrelas e história/);
  assert.match(html, /Céu local · horizonte real/);
  assert.match(html, /aria-label="Visor da constelação"/);
  assert.doesNotMatch(html, /127\.0\.0\.1:8000|CUSTOMER_HTTP_SCIENCE_API/);
});

test("server renders narrative, mission and event routes without a second canvas", async () => {
  for (const [path, expected] of [["/atlas/journeys", /Histórias que continuam legíveis fora do canvas/], ["/missions", /Missões sem trajetória inventada/], ["/missions/apollo-11", /Missões sem trajetória inventada/], ["/events", /Eventos com fonte e limites claros/] ]) {
    const response = await render(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, expected);
    assert.doesNotMatch(html, /<canvas/i);
  }
});
