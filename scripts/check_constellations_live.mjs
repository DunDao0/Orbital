// Opt-in integration gate. Requires the existing, real local science API.
// No routes, responses, celestial coordinates or service data are mocked.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Matrix4, Vector3 } from "three";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ORBIS_PLAYWRIGHT_MODULE || "playwright");
const baseUrl = process.env.ORBIS_PREVIEW_URL || "http://127.0.0.1:3000";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseUrl).hostname));
const api = "http://127.0.0.1:8000";
const stage = process.env.ORBIS_AUDIT_STAGE || "final";
assert.match(stage, /^[a-z0-9-]+$/);
const output = resolve(`outputs/constellations-live-${stage}`);
await mkdir(output, { recursive: true });
const report = { status: "running", source: "Real native API; no mocks", cases: [], errors: [], warnings: [] };
let browser;
try {
  const health = await fetch(`${api}/api/health`, { signal: AbortSignal.timeout(15_000) }).then((response) => response.json());
  assert.equal(health.api, "orbis-local-scientific-api");
  assert.equal(health.meta.service, "native");
  const capabilities = await fetch(`${api}/api/capabilities`, { signal: AbortSignal.timeout(15_000) }).then((response) => response.json());
  assert.equal(capabilities.capabilities.sky.available, true);
  report.health = health;
  report.capabilities = capabilities;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  // Read-only WebGL draw probe in this isolated test context, never application
  // code. It inspects the actual POINTS buffer and matrices submitted to the GPU.
  await context.addInitScript(() => {
    const buffers = new WeakMap();
    const proto = WebGL2RenderingContext.prototype;
    const upload = proto.bufferData;
    proto.bufferData = function (target, data, ...rest) {
      const result = upload.call(this, target, data, ...rest);
      if (target === this.ARRAY_BUFFER && data instanceof Float32Array) {
        buffers.set(this.getParameter(this.ARRAY_BUFFER_BINDING), Array.from(data));
      }
      return result;
    };
    const draw = proto.drawArrays;
    proto.drawArrays = function (mode, first, count) {
      const result = draw.call(this, mode, first, count);
      const points = window.__skyProbeRequested && mode === this.POINTS;
      const lines = window.__skyLineProbeRequested && mode === this.LINES;
      if (points || lines) {
        const program = this.getParameter(this.CURRENT_PROGRAM);
        const position = this.getAttribLocation(program, "position");
        const buffer = this.getVertexAttrib(position, this.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
        const sample = {
          count, first, positions: buffers.get(buffer),
          modelView: Array.from(this.getUniform(program, this.getUniformLocation(program, "modelViewMatrix"))),
          projection: Array.from(this.getUniform(program, this.getUniformLocation(program, "projectionMatrix"))),
        };
        if (points) { window.__skyProbe = sample; window.__skyProbeRequested = false; }
        if (lines) { window.__skyLineProbe = sample; window.__skyLineProbeRequested = false; }
      }
      return result;
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
    if (message.type() === "warning") report.warnings.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) report.errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") report.errors.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  await page.goto(`${baseUrl}/atlas/earth/constellations`);

  async function calculate(action) {
    const [response] = await Promise.all([
      page.waitForResponse((response) => response.url() === `${api}/api/sky/constellations` && response.request().method() === "POST"),
      action(),
    ]);
    const result = await response.json();
    assert.equal(response.status(), 200, JSON.stringify(result.error));
    assert.equal(result.meta.service, "native");
    assert.equal(result.schema_version, 1);
    return result;
  }
  async function fields(utc, latitude = "-23.5505", longitude = "-46.6333", elevation = "760", magnitude = "5.5") {
    await page.getByLabel("UTC", { exact: true }).fill(utc);
    await page.getByLabel("Latitude (graus)", { exact: true }).fill(latitude);
    await page.getByLabel("Longitude (graus)", { exact: true }).fill(longitude);
    await page.getByLabel("Elevação (m)", { exact: true }).fill(elevation);
    await page.getByLabel("Limite Gaia G", { exact: true }).fill(magnitude);
  }
  async function select(name) {
    return calculate(() => page.locator(".constellation-list").getByRole("button", { name: new RegExp(`^${name}\\b`) }).click());
  }
  function world(point, radius) {
    const altitude = point.altitude_deg * Math.PI / 180;
    const azimuth = point.azimuth_deg * Math.PI / 180;
    return [Math.sin(azimuth) * Math.cos(altitude) * radius, Math.sin(altitude) * radius, Math.cos(azimuth) * Math.cos(altitude) * radius];
  }
  async function inspectBoundaries(result) {
    // Hide only the reference grid/ticks to isolate the actual IAU draw call.
    await page.getByRole("checkbox", { name: "Horizonte e grade", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "Direções cardeais", exact: true }).uncheck();
    await page.waitForTimeout(150);
    const expected = [];
    for (const { start, end } of result.boundaries) {
      if (start.altitude_deg < 0 && end.altitude_deg < 0) continue;
      if (start.altitude_deg >= 0 && end.altitude_deg >= 0) expected.push(...world(start, 14), ...world(end, 14));
      else {
        const fraction = start.altitude_deg / (start.altitude_deg - end.altitude_deg);
        const turn = ((end.azimuth_deg - start.azimuth_deg + 540) % 360) - 180;
        const horizon = { altitude_deg: 0, azimuth_deg: start.azimuth_deg + turn * fraction };
        expected.push(...world(start.altitude_deg >= 0 ? start : horizon, 14), ...world(end.altitude_deg >= 0 ? end : horizon, 14));
      }
    }
    await page.evaluate(() => { window.__skyLineProbe = null; window.__skyLineProbeRequested = true; });
    let maximumError = 0;
    if (expected.length) {
      await page.waitForFunction(() => window.__skyLineProbe);
      const sample = await page.evaluate(() => window.__skyLineProbe);
      assert.equal(sample.count, expected.length / 3);
      assert.equal(sample.positions.length, expected.length);
      sample.positions.forEach((value, index) => {
        maximumError = Math.max(maximumError, Math.abs(value - expected[index]));
        if (index % 3 === 1) assert.ok(value >= -1e-6, "IAU boundaries may not extend below the ground");
      });
      assert.ok(maximumError < 0.00001);
    } else {
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => window.__skyLineProbe), null);
    }
    await page.evaluate(() => { window.__skyLineProbeRequested = false; });
    await page.getByRole("checkbox", { name: "Horizonte e grade", exact: true }).check();
    await page.getByRole("checkbox", { name: "Direções cardeais", exact: true }).check();
    return { vertices: expected.length / 3, maximumError };
  }
  async function inspect(name, result, expectedVisibility) {
    const visible = result.stars.filter((star) => star.above_horizon);
    assert.ok(result.stars.every((star) => star.above_horizon === (star.altitude_deg >= 0)));
    if (expectedVisibility === "below") assert.equal(visible.length, 0);
    if (expectedVisibility === "visible") assert.ok(visible.length > 0);
    if (expectedVisibility === "partial") assert.ok(visible.length > 0 && visible.length < result.stars.length);
    const view = page.locator("canvas.atlas-webgl");
    await view.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Enquadrar estrelas", exact: true }).click();
    await view.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector("canvas.atlas-webgl")?.dataset.observerView);
    await page.waitForTimeout(1200);
    const notice = await page.locator(".atlas-explorer [role='status']").innerText();
    assert.ok(notice.includes(`${visible.length} estrelas acima do horizonte · ${result.stars.length} no recorte`), notice);
    if (stage !== "baseline" && result.twilight === "day") assert.match(notice, /Céu diurno.*não uma previsão de visibilidade a olho nu/);
    assert.equal(await view.getAttribute("data-atlas-camera"), "0.0000/0.0000/0.0000");
    await page.evaluate(() => { window.__skyProbe = null; window.__skyProbeRequested = true; });
    let pointSample;
    if (visible.length) {
      await page.waitForFunction(() => window.__skyProbe);
      pointSample = await page.evaluate(() => window.__skyProbe);
      assert.equal(pointSample.count, visible.length, "GPU point count must match real above-horizon stars");
      assert.equal(pointSample.first, 0);
      assert.equal(pointSample.positions.length, visible.length * 3);
    } else {
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => window.__skyProbe), null, "no hidden or procedural stars may be drawn");
      await page.getByText("Não há estrelas desta seleção acima do horizonte no UTC escolhido. Isso não é uma falha do visor.", { exact: true }).waitFor();
    }
    let maximumPositionError = 0;
    let inFrame = 0;
    if (pointSample) {
      const viewMatrix = new Matrix4().fromArray(pointSample.modelView);
      const projection = new Matrix4().fromArray(pointSample.projection);
      assert.ok(viewMatrix.determinant() < 0, "the observer's east display reflection must be present");
      assert.ok(viewMatrix.elements.slice(12, 15).every((value) => Math.abs(value) < 1e-6), "the AltAz eye must not be translated");
      visible.forEach((star, index) => {
        const expected = world(star, 14.1);
        const actual = pointSample.positions.slice(index * 3, index * 3 + 3);
        maximumPositionError = Math.max(maximumPositionError, ...actual.map((value, axis) => Math.abs(value - expected[axis])));
        const cameraPoint = new Vector3(...actual).applyMatrix4(viewMatrix);
        const ndc = cameraPoint.clone().applyMatrix4(projection);
        if (cameraPoint.z < 0 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1) inFrame++;
      });
      assert.ok(maximumPositionError < 0.00001, `AltAz-to-buffer error: ${maximumPositionError}`);
      assert.equal(inFrame, visible.length, "Fit must frame every returned above-horizon star in these bounded fields");
    }
    const tableRows = page.locator(".constellation-accessible tbody tr");
    assert.equal(await tableRows.count(), Math.min(result.stars.length, 120));
    if (result.stars.length) {
      const first = await tableRows.first().innerText();
      assert.ok(first.includes(result.stars[0].gaia_dr3_source_id));
      assert.ok(first.includes(`${result.stars[0].altitude_deg.toFixed(2)}°`));
      assert.ok(first.includes(`${result.stars[0].azimuth_deg.toFixed(2)}°`));
    }
    const boundaries = await inspectBoundaries(result);
    await view.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await page.screenshot({ path: resolve(output, `${name}.png`) });
    await writeFile(resolve(output, `${name}.json`), JSON.stringify(result, null, 2));
    report.cases.push({ name, constellation: result.constellation.iau_abbreviation, input: result.input, total: result.stars.length, above: visible.length, boundaryVisibility: result.selected?.boundary_visibility, boundaries, twilight: result.twilight, sun: result.sun, gpuPoints: pointSample?.count ?? 0, inFrame, maximumPositionError, camera: await view.getAttribute("data-observer-view"), iersWarning: result.iers_warning });
    console.log(`PASS ${name}: ${visible.length}/${result.stars.length} above horizon; ${inFrame} in frame`);
  }

  await fields("2026-08-05T00:00");
  let result = await select("Andromeda");
  await page.getByRole("button", { name: "Céu local · horizonte real", exact: true }).click();
  await inspect("andromeda-below", result, "below");
  result = await calculate(() => page.getByRole("button", { name: /^Usar horário favorável/ }).click());
  await inspect("andromeda-favorable", result, "visible");
  await page.setViewportSize({ width: 390, height: 844 });
  await inspect("andromeda-mobile", result, "visible");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1440, height: 900 });

  await fields("2026-08-05T03:00");
  result = await select("Andromeda");
  await inspect("andromeda-partial", result, "partial");
  await fields("2026-08-05T00:00");
  result = await select("Scorpius");
  await inspect("scorpius-night", result, "visible");
  const view = page.locator("canvas.atlas-webgl");
  const before = await view.getAttribute("data-observer-view");
  await page.getByRole("checkbox", { name: "Fronteiras IAU", exact: true }).uncheck();
  await page.waitForTimeout(1100);
  assert.equal(await view.getAttribute("data-observer-view"), before);
  await page.getByRole("checkbox", { name: "Fronteiras IAU", exact: true }).check();
  await page.getByRole("button", { name: "Ver horizonte", exact: true }).click();
  await view.scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, "scorpius-horizon.png") });

  await fields("2026-08-05T15:00");
  result = await select("Orion");
  await inspect("orion-day", result, "visible");
  assert.equal(result.twilight, "day");
  await fields("2026-08-05T00:00", "51.5", "-0.12", "20");
  result = await select("Ursa Minor");
  await inspect("ursa-minor-north", result, "visible");
  assert.equal(report.errors.length, 0, report.errors.join("\n"));
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = String(error.stack || error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: resolve(output, "failure.png"), timeout: 10_000 }).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(output, "results.json"), JSON.stringify(report, null, 2));
  await browser?.close();
}
