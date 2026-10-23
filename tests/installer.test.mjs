import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { frontendAddress, frontendConfig, startFrontend } from "../scripts/windows/start-frontend.mjs";

test("installer frontend keeps project config and enforces fixed loopback binding", () => {
  const config = frontendConfig();
  assert.match(config.configFile, /vite\.config\.ts$/);
  assert.equal(config.server.host, "127.0.0.1");
  assert.equal(config.server.port, 3000);
  assert.equal(config.server.strictPort, true);
  assert.equal(config.server.open, false);
  const plugin = config.plugins[0];
  const changed = { server: { host: "0.0.0.0", port: 4444, strictPort: false, open: true } };
  plugin.config.handler(changed);
  assert.deepEqual(changed.server, config.server);
  assert.doesNotThrow(() => plugin.configResolved(changed));
  assert.throws(() => plugin.configResolved({ server: { ...changed.server, host: "::" } }), /exclusivamente/);
});

test("installer health endpoint identifies this application without intercepting routes", () => {
  let middleware;
  frontendConfig().plugins[0].configureServer({ middlewares: { use(handler) { middleware = handler; } } });
  let status;
  let headers;
  let body;
  const response = {
    writeHead(value, valueHeaders) { status = value; headers = valueHeaders; },
    end(value) { body = JSON.parse(value); },
  };
  let next = 0;
  middleware({ url: "/__orbis/health", method: "GET" }, response, () => next++);
  assert.equal(status, 200);
  assert.equal(headers["Cache-Control"], "no-store");
  assert.deepEqual(body, { status: "ok", api: "orbis-local-frontend" });
  middleware({ url: "/atlas/earth", method: "GET" }, response, () => next++);
  middleware({ url: "/__orbis/health", method: "POST" }, response, () => next++);
  assert.equal(next, 2);
});

test("installer frontend checks the actual socket and closes on unsafe binding or startup failure", async () => {
  let closed = 0;
  let listened = 0;
  const server = {
    async listen() { listened++; },
    async close() { closed++; },
    httpServer: { address: () => ({ address: frontendAddress.host, port: frontendAddress.port }) },
  };
  assert.equal(await startFrontend(async (config) => {
    assert.equal(config.server.strictPort, true);
    return server;
  }), server);
  assert.equal(listened, 1);
  assert.equal(closed, 0);

  for (const address of [null, "pipe", { address: "0.0.0.0", port: 3000 }, { address: "127.0.0.1", port: 3001 }]) {
    await assert.rejects(startFrontend(async () => ({
      ...server,
      httpServer: { address: () => address },
    })), /endereço inesperado/);
  }
  assert.equal(closed, 4);
  await assert.rejects(startFrontend(async () => ({
    ...server,
    async listen() { throw new Error("Port 3000 is already in use"); },
  })), /already in use/);
  assert.equal(closed, 5);
});

test("installer runtime manifest pins supported architectures and verified HTTPS archives", async () => {
  const pins = JSON.parse(await readFile(new URL("../scripts/windows/runtimes.json", import.meta.url), "utf8"));
  assert.equal(pins.schema, 1);
  assert.equal(pins.platform, "windows-x64");
  assert.match(pins.python, /^3\.12\.\d+$/);
  for (const runtime of [pins.node, pins.uv]) {
    assert.match(runtime.version, /^\d+\.\d+\.\d+$/);
    assert.match(runtime.sha256, /^[a-f0-9]{64}$/);
    const url = new URL(runtime.url);
    assert.equal(url.protocol, "https:");
    assert.equal(url.username, "");
    assert.equal(url.password, "");
    assert.equal(url.search, "");
    assert.equal(url.hash, "");
  }
  const [major, minor] = pins.node.version.split(".").map(Number);
  assert.ok(major > 22 || major === 22 && minor >= 13, "Node must meet the project's minimum version");
  assert.equal(pins.node.folder, `node-v${pins.node.version}-win-x64`);
  assert.equal(pins.node.url, `https://nodejs.org/download/release/v${pins.node.version}/${pins.node.folder}.zip`);
  assert.equal(pins.uv.folder, `uv-${pins.uv.version}`);
  assert.equal(pins.uv.url, `https://github.com/astral-sh/uv/releases/download/${pins.uv.version}/uv-x86_64-pc-windows-msvc.zip`);
});

test("installer restore sources match the approved scientific inventory byte for byte", async () => {
  const inventory = JSON.parse(await readFile(new URL("../backend/data-inventory.json", import.meta.url), "utf8"));
  const sources = {
    "data/moons/moons.json": "public/scientific/moons.json",
    "data/stars/gaia_bright.json": "public/scientific/gaia_bright.json",
    "data/stars/iau_named_stars.json": "public/scientific/iau_named_stars.json",
    "data/constellations/iau_boundaries.json": "public/scientific/iau_boundaries.json",
    "data/constellations/constellation_guides.json": "public/scientific/constellation_guides.json",
    "data/constellations/iau_boundary_vertices_j2000.json": "public/scientific/iau_boundary_vertices_j2000.json",
    "data/manifests/kernels.json": "scripts/windows/manifests/kernels.json",
    "data/manifests/offline_catalogs.json": "scripts/windows/manifests/offline_catalogs.json",
    "data/manifests/benchmark.json": "scripts/windows/manifests/benchmark.json",
  };
  for (const [destination, source] of Object.entries(sources)) {
    const bytes = await readFile(new URL(`../${source}`, import.meta.url));
    assert.equal(bytes.length, inventory[destination].bytes, source);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), inventory[destination].sha256, source);
  }
});

test("Git keeps inventory-pinned scientific bytes unchanged on Windows and in source ZIPs", async () => {
  const attributes = await readFile(new URL("../.gitattributes", import.meta.url), "utf8");
  const rules = attributes.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  for (const pattern of ["public/scientific/*.json", "scripts/windows/manifests/*.json"]) {
    const attributesForPath = rules.filter((line) => line.split(/\s+/)[0] === pattern)
      .flatMap((line) => line.split(/\s+/).slice(1));
    assert.ok(attributesForPath.includes("-text"), `${pattern} requires no newline conversion`);
    assert.ok(!attributesForPath.some((attribute) => attribute === "text" || attribute.startsWith("text=")), `${pattern} must not re-enable newline conversion`);
  }
});

test("Windows source export includes the local runtime sources and excludes private directories", { skip: process.platform !== "win32" }, async (context) => {
  const temporaryBase = resolve(tmpdir());
  const root = await mkdtemp(join(temporaryBase, "orbital standalone export "));
  assert.equal(dirname(root), temporaryBase);
  context.after(() => rm(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL("../scripts/windows/Export-Source.ps1", import.meta.url)).replaceAll("'", "''");
  const archive = join(root, "Orbital.zip").replaceAll("'", "''");
  const command = `$ErrorActionPreference = 'Stop'; & '${script}' -Destination '${archive}' *> $null; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [IO.Compression.ZipFile]::OpenRead('${archive}'); try { @($zip.Entries.FullName) | ConvertTo-Json } finally { $zip.Dispose() }`;
  // A Node child started from PowerShell 7 inherits incompatible module paths.
  // Let Windows PowerShell discover its own built-in modules, as the CMD launcher does.
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === "psmodulepath") delete environment[key];
  }
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8", timeout: 120_000, windowsHide: true, env: environment,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const entries = JSON.parse(result.stdout);
  for (const required of ["SOURCE-MANIFEST.json", "ORBIS_SCIENTIA_IMPLEMENTATION.md", "Instalar-e-Abrir.cmd", "Parar-Orbital.cmd", "vite.config.ts", "worker/index.ts", "scripts/windows/start-frontend.mjs", "scripts/windows/Install-Orbital.ps1", "backend/locks/windows-cp312.lock"]) {
    assert.ok(entries.includes(required), required);
  }
  assert.ok(!entries.some((entry) => /^(?:\.[^/]+|node_modules|data|build)\//.test(entry)));
});

test("installer parses with bundled Windows PowerShell 5.1 without executing it", { skip: process.platform !== "win32" }, () => {
  const script = fileURLToPath(new URL("../scripts/windows/Install-Orbital.ps1", import.meta.url)).replaceAll("'", "''");
  const command = `$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${script}', [ref]$null, [ref]$errors) > $null; if ($errors.Count -gt 0) { $errors | Format-List; exit 1 }; Write-Output $PSVersionTable.PSVersion.ToString()`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout.trim(), /^5\.1\./);
});

test("installer status recognizes a fractional heartbeat and root without a trailing slash in a path with spaces", { skip: process.platform !== "win32" }, async (context) => {
  const temporaryBase = resolve(tmpdir());
  const root = await mkdtemp(join(temporaryBase, "orbis installer state "));
  assert.equal(dirname(root), temporaryBase);
  context.after(() => rm(root, { recursive: true, force: true }));
  const scripts = join(root, "scripts", "windows");
  await mkdir(scripts, { recursive: true });
  await mkdir(join(root, ".orbis"));
  const installer = join(scripts, "Install-Orbital.ps1");
  await copyFile(new URL("../scripts/windows/Install-Orbital.ps1", import.meta.url), installer);
  const state = {
    root,
    session: "isolated-status-test",
    pid: 12345,
    status: "ready",
    heartbeat: Math.floor(Date.now() / 1000),
    warning: null,
  };
  assert.ok(!root.endsWith("\\") && !root.endsWith("/"));
  await writeFile(join(root, ".orbis", "state.json"), JSON.stringify(state));
  // Status reads only this fixture: it must not start servers, install anything,
  // check the fake PID, or contact the real project listening on ports 3000/8000.
  const stateFile = join(root, ".orbis", "state.json").replaceAll("'", "''");
  // Write the same fractional timestamp as Python time.time(), immediately
  // before reading it. Integer-second arithmetic can incorrectly call it future.
  const command = `$state = Get-Content -LiteralPath '${stateFile}' -Raw | ConvertFrom-Json; $state.heartbeat = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0; [IO.File]::WriteAllText('${stateFile}', ($state | ConvertTo-Json)); & '${installer.replaceAll("'", "''")}' -Action Status`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command], {
    encoding: "utf8", timeout: 30_000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const reported = JSON.parse(result.stdout.trim());
  assert.equal(reported.status, "ready");
  assert.equal(reported.root, root);
  assert.equal(reported.session, state.session);
});
