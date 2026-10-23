// Optional browser gate: uses an already installed Playwright, never installs it.
// Native astronomy is intercepted with explicitly synthetic UI fixtures.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ORBIS_PLAYWRIGHT_MODULE || "playwright");
const baseUrl = process.env.ORBIS_PREVIEW_URL || "http://127.0.0.1:3000";
if (!["127.0.0.1", "localhost"].includes(new URL(baseUrl).hostname)) throw new Error("Use a loopback preview only.");
const output = resolve("outputs/frontend-regressions");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(60_000);
const errors = [];
const expectedServiceFailures = [];
const nativeFallbackRequests = new Set([
  "http://127.0.0.1:8000/api/reference/state",
  "http://127.0.0.1:8000/api/capabilities",
]);
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
});
page.on("requestfailed", (request) => {
  const url = new URL(request.url());
  const expectedFallback = nativeFallbackRequests.has(`${url.origin}${url.pathname}`)
    && request.failure()?.errorText === "net::ERR_CONNECTION_REFUSED";
  if (!expectedFallback && request.failure()?.errorText !== "net::ERR_ABORTED") {
    errors.push(`Request failed: ${request.url()} (${request.failure()?.errorText})`);
  }
});
page.on("response", (response) => {
  if (response.status() >= 400) {
    const description = `HTTP ${response.status()}: ${response.url()}`;
    if (response.status() === 503 && response.headers()["x-orbis-test-fixture"] === "unavailable-capabilities") {
      expectedServiceFailures.push(description);
    } else errors.push(description);
  }
});
const results = [];
const catalogue = JSON.parse(await readFile(new URL("../public/scientific/constellation_guides.json", import.meta.url), "utf8"));
let skyRequests = 0;
let lastSkyInput;
// Explicit failure fixture: absence of the science service is not a JS/render
// error, but the UI must report it. All other unexpected HTTP failures still fail.
await context.route(`${baseUrl}/api/capabilities`, async (route) => {
  await route.fulfill({
    status: 503, headers: { "X-Orbis-Test-Fixture": "unavailable-capabilities" },
    json: { schema_version: 1, error: { code: "SCIENCE_SERVICE_UNAVAILABLE", message: "UI test: science service unavailable", request_id: "ui-fixture", capability: "capabilities" } },
  });
});
await context.route("http://127.0.0.1:8000/**", async (route) => {
  const url = new URL(route.request().url());
  const headers = {
    "Access-Control-Allow-Origin": new URL(baseUrl).origin,
    "Access-Control-Allow-Headers": "Content-Type, X-Request-ID",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  if (route.request().method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers });
    return;
  }
  if (url.pathname === "/api/sky/constellations") {
    assert.equal(route.request().method(), "POST");
    skyRequests++;
    const input = route.request().postDataJSON();
    lastSkyInput = input;
    const guide = catalogue.items.find((item) => item.iau_abbreviation === input.constellation);
    const stars = guide.brightest_gaia_stars.map((star, index) => ({
      ...star, epoch: "J2016.0", source: "SYNTHETIC UI FIXTURE; NOT AN OBSERVATION",
      iau_abbreviation: input.constellation, altitude_deg: 20 + index * 7,
      azimuth_deg: 12 + index * 8, above_horizon: true,
    }));
    await route.fulfill({ headers, json: {
      schema_version: 1,
      meta: { request_id: "ui-fixture", generated_at_utc: input.utc, service: "native", software_version: "ui-fixture", capability: "sky" },
      input, constellation: guide, stars, boundaries: [],
      max_g_mag: input.max_g_magnitude, twilight: "night",
      sun: { altitude_deg: -30, azimuth_deg: 180, above_horizon: false },
      method: "Synthetic frontend test fixture, not astronomical validation",
      frame: "AltAz UI fixture", catalogue_epoch: "J2016.0", refraction: "off",
      iers_warning: "UI fixture only", named_stars: { status: "unavailable", items: [] },
      limitations: ["Synthetic positions are used only inside this isolated browser test."],
    } });
  } else if (url.pathname === "/api/reference/state" || url.pathname === "/api/capabilities") {
    // Exercise the existing same-origin fixed-data fallback, without starting an API.
    await route.abort("connectionrefused");
  } else {
    errors.push(`Unexpected native request: ${route.request().method()} ${url.pathname}`);
    await route.fulfill({ status: 501, headers, json: { schema_version: 1, error: { code: "SCIENCE_SERVICE_UNAVAILABLE", message: "UI test: native service unavailable", request_id: "ui-fixture", capability: "sky" } } });
  }
});
const wait = (ms) => page.waitForTimeout(ms);
async function check(name, run) {
  await run();
  results.push(name);
  console.log(`PASS ${name}`);
}
async function canvas() {
  const locator = page.locator("canvas.atlas-webgl");
  await locator.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("canvas.atlas-webgl")?.dataset.atlasCamera);
  return locator;
}
async function openTools(title) {
  const summary = page.locator("summary").filter({ hasText: title });
  if (!(await summary.evaluate((element) => element.parentElement.open))) await summary.click();
}
async function pose() { return (await (await canvas()).getAttribute("data-atlas-camera")).split("/").map(Number); }
async function capture(name) {
  // Capture the viewport directly: WebGL animation should not be required to
  // stop for Playwright's element-stability check before saving evidence.
  await page.screenshot({ path: resolve(output, name), timeout: 60_000 });
}
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
async function settledPose() {
  let previous = await pose();
  for (let attempt = 0; attempt < 20; attempt++) {
    await wait(1200);
    const current = await pose();
    if (distance(previous, current) < 0.003) return current;
    previous = current;
  }
  throw new Error("Camera did not settle after releasing input.");
}
try {
  await check("Atlas camera retains wheel zoom and drag after release", async () => {
    await page.goto(`${baseUrl}/atlas?planet=earth`);
    const view = await canvas();
    await page.getByRole("button", { name: /^Qualidade:/ }).click();
    await view.scrollIntoViewIfNeeded();
    await wait(2800);
    const before = await pose();
    const box = await view.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -480);
    await wait(2400);
    const after = await pose();
    assert.ok(distance(before, after) > 0.1, "wheel must change the camera");
    await wait(1600);
    assert.ok(distance(after, await pose()) < 0.01, "zoom must not snap back");
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 130, box.y + box.height / 2 + 40, { steps: 12 });
    await page.mouse.up();
    await wait(2400);
    const dragged = await settledPose();
    assert.ok(distance(after, dragged) > 0.1);
    await wait(1600);
    assert.ok(distance(dragged, await pose()) < 0.01);
    await capture("earth-camera.png");
  });
  await check("Globe layer controls and shader compilation at every quality", async () => {
    await openTools("Camadas e atribuição");
    await page.getByRole("checkbox", { name: "Atmosfera procedural", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "Nuvens procedurais", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "Grade latitude/longitude", exact: true }).check();
    await page.getByRole("checkbox", { name: "Atmosfera procedural", exact: true }).check();
    const opacity = page.getByLabel("Opacidade Atmosfera procedural");
    await opacity.focus();
    await opacity.press("Home");
    for (let step = 0; step < 4; step++) await opacity.press("PageUp");
    assert.equal(await opacity.inputValue(), "40");
    await page.getByRole("checkbox", { name: "Nuvens procedurais", exact: true }).check();
    for (const quality of ["low", "medium", "high"]) {
      if (quality !== "low") await page.getByRole("button", { name: /^Qualidade:/ }).click();
      assert.equal((await page.getByRole("button", { name: /^Qualidade:/ }).innerText()).toLowerCase(), `qualidade: ${quality}`);
      await (await canvas()).scrollIntoViewIfNeeded();
      await wait(1600);
      await capture(`earth-${quality}.png`);
    }
    await page.getByRole("button", { name: /^Qualidade:/ }).click();
    await page.getByRole("button", { name: /^Qualidade:/ }).click();
    assert.equal(errors.length, 0, errors.join("\n"));
  });
  await check("Universal search changes the rendered target", async () => {
    await page.getByLabel("Buscar no Atlas (Ctrl+K)").fill("Júpiter");
    await page.locator(".atlas-search").getByRole("button", { name: /Júpiter/ }).click();
    await page.waitForFunction(() => JSON.parse(decodeURIComponent(location.hash.slice("#scene=".length))).target.id === "jupiter");
    await page.locator(".planet-chip.selected").filter({ hasText: "Júpiter" }).waitFor();
  });
  await check("Journey advances and restores its source scene", async () => {
    await page.getByLabel("Buscar no Atlas (Ctrl+K)").fill("Como um eclipse");
    await page.locator(".atlas-search").getByRole("button", { name: /Jornada/ }).click();
    const journey = page.locator("section[aria-labelledby='journey-title']");
    const sourceScene = await page.evaluate(() => location.hash);
    await journey.getByRole("button", { name: "Começar", exact: true }).click();
    await journey.getByRole("button", { name: "Próxima", exact: true }).click();
    assert.match(await journey.innerText(), /Etapa 2 de 2/);
    await journey.getByRole("button", { name: "Sair e restaurar" }).click();
    assert.match(await journey.innerText(), /Pronta para iniciar/);
    assert.equal(await page.evaluate(() => location.hash), sourceScene);
  });
  await check("Local project save/reload/open and normal word spacing", async () => {
    await openTools("Projetos locais");
    await page.getByLabel("Título", { exact: true }).fill("");
    await page.getByLabel("Título", { exact: true }).pressSequentially("Meu projeto de teste");
    assert.equal(await page.getByLabel("Título", { exact: true }).inputValue(), "Meu projeto de teste");
    await page.getByRole("button", { name: "Salvar no navegador", exact: true }).click();
    await page.reload();
    await canvas();
    await openTools("Projetos locais");
    await page.getByRole("button", { name: "Abrir projeto salvo", exact: true }).click();
    assert.equal(await page.getByLabel("Título", { exact: true }).inputValue(), "Meu projeto de teste");
    await openTools("Medições e comparação");
    const row = page.getByRole("row").filter({ hasText: "Distância geodésica" });
    assert.match(await row.innerText(), /indisponível/);
  });
  await check("Observer fields reject blanks; URL restores time; layers retain aim/FOV", async () => {
    await page.goto(`${baseUrl}/atlas/earth/constellations`);
    await page.getByRole("button", { name: /^Andromeda/ }).click();
    await page.getByRole("button", { name: "Céu local · horizonte real" }).click();
    const view = await canvas();
    await view.scrollIntoViewIfNeeded();
    await wait(1800);
    const box = await view.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -200);
    await view.press("ArrowRight");
    await wait(1400);
    const before = await view.getAttribute("data-observer-view");
    await page.getByRole("checkbox", { name: "Horizonte e grade", exact: true }).uncheck();
    await wait(1400);
    assert.equal(await view.getAttribute("data-observer-view"), before);
    assert.deepEqual(await pose(), [0, 0, 0]);
    await view.scrollIntoViewIfNeeded();
    await capture("horizon-fixture.png");
    await page.getByRole("checkbox", { name: "Horizonte e grade", exact: true }).check();
    await page.getByRole("button", { name: "Ver horizonte", exact: true }).click();
    await wait(1200);
    await view.scrollIntoViewIfNeeded();
    await capture("horizon-ground-fixture.png");
    await page.getByLabel("UTC", { exact: true }).fill("2026-08-05T07:00");
    await page.getByRole("button", { name: "Calcular céu local", exact: true }).click();
    await page.waitForFunction(() => location.hash.includes("07%3A00"));
    await page.reload();
    await page.getByRole("button", { name: /^Andromeda/ }).waitFor();
    assert.match(await page.getByLabel("UTC", { exact: true }).inputValue(), /^2026-08-05T07:00/);
    const beforeReloadedCalculation = skyRequests;
    await Promise.all([
      page.waitForResponse((response) => response.url() === "http://127.0.0.1:8000/api/sky/constellations" && response.request().method() === "POST" && response.ok()),
      page.getByRole("button", { name: "Calcular céu local", exact: true }).click(),
    ]);
    assert.ok(skyRequests > beforeReloadedCalculation, "restored form must submit a new request");
    assert.equal(lastSkyInput.utc, "2026-08-05T07:00:00.000Z");
    const count = skyRequests;
    await page.getByLabel("Latitude (graus)", { exact: true }).fill("");
    await page.getByRole("button", { name: "Calcular céu local", exact: true }).click();
    await wait(300);
    assert.equal(skyRequests, count, "invalid latitude must not call the API");
    await page.getByLabel("Latitude (graus)", { exact: true }).fill("-23,5505");
    await page.getByLabel("Limite Gaia G", { exact: true }).fill("");
    await page.getByRole("button", { name: "Calcular céu local", exact: true }).click();
    await wait(300);
    assert.equal(skyRequests, count, "blank magnitude must not call the API");
  });
  await check("Narrow layout, route re-entry and reduced-motion camera", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/atlas/earth/constellations`);
    await page.getByRole("button", { name: /^Andromeda/ }).click();
    await page.getByRole("button", { name: "Céu local · horizonte real" }).click();
    await canvas();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await (await canvas()).scrollIntoViewIfNeeded();
    await capture("horizon-mobile-fixture.png");
    await page.locator(".site-sidebar").getByRole("link", { name: /Missões/ }).click();
    await page.waitForURL(`${baseUrl}/missions`);
    assert.equal(await page.locator("canvas").count(), 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(".site-sidebar").getByRole("link", { name: /Atlas Planetário/ }).click();
    await page.waitForURL(`${baseUrl}/atlas`);
    const view = await canvas();
    assert.equal(await page.locator("canvas.atlas-webgl").count(), 1);
    await view.scrollIntoViewIfNeeded();
    await wait(1200);
    const before = await pose();
    const box = await view.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await wait(1400);
    const after = await pose();
    assert.ok(distance(before, after) > 0.1);
    await wait(1400);
    assert.ok(distance(after, await pose()) < 0.01);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
  await check("Solar-system route renders the corrected orbital paths", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(baseUrl);
    const view = page.locator("canvas.solar-system-webgl");
    await view.waitFor({ state: "visible" });
    await view.scrollIntoViewIfNeeded();
    await wait(1800);
    assert.equal(await page.locator("canvas").count(), 1);
    await page.getByText("A API não respondeu. O visor não cria uma aproximação científica substituta.", { exact: true }).waitFor();
    assert.ok(expectedServiceFailures.length > 0, "offline capabilities fixture must have been exercised");
    await capture("solar-orbits.png");
  });
  assert.equal(errors.length, 0, errors.join("\n"));
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify({ results, errors, expectedServiceFailures, fixture: "Native astronomy mocked and capabilities explicitly unavailable: frontend interactions only; no scientific accuracy claim." }, null, 2));
  await browser.close();
}
