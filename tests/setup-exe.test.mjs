import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const environment = { ...process.env };
for (const key of Object.keys(environment)) if (key.toLowerCase() === "psmodulepath") delete environment[key];
function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", env: environment, windowsHide: true, timeout: 120_000 });
  assert.ifError(result.error);
  return result;
}
function ps(code) { return run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", code]); }
function quote(value) { return "'" + value.replaceAll("'", "''") + "'"; }
async function exists(path) { try { await access(path); return true; } catch { return false; } }

test("Windows EXE installs verified files, refuses conflicts, and uninstalls without deleting local changes", { skip: process.platform !== "win32", timeout: 180_000 }, async (context) => {
  const repo = fileURLToPath(new URL("../", import.meta.url));
  const { version } = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
  const registry = `HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Orbital-${version}`;
  const preflight = ps(`if (Test-Path -LiteralPath ${quote(registry)}) { exit 2 }; if (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Orbital ${version}')) { exit 2 }`);
  if (preflight.status === 2) { context.skip("This version is already installed for the current user; preserve it."); return; }
  assert.equal(preflight.status, 0, preflight.stderr);
  const base = resolve(tmpdir());
  const root = await mkdtemp(join(base, "orbital exe validation "));
  assert.equal(dirname(root), base);
  const installed = join(root, "installed app");
  const build = join(root, "build output");
  const uninstaller = join(installed, "scripts", "windows", "Uninstall-Orbital.ps1");
  context.after(async () => {
    if (await exists(uninstaller)) {
      const cleanup = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", uninstaller, "-Quiet"]);
      assert.equal(cleanup.status, 0, "Fixture uninstall failed; preserve the directory for diagnosis: " + root + "\n" + cleanup.stdout + cleanup.stderr);
    }
    await rm(root, { recursive: true, force: true });
  });
  const compiled = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(repo, "scripts", "windows", "Build-Installer.ps1"), "-OutputDirectory", build]);
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  const exe = join(build, `Orbital-${version}-Setup-x64.exe`);
  const occupied = join(root, "personal folder");
  await mkdir(occupied);
  await writeFile(join(occupied, "personal.txt"), "preserve this");
  assert.equal(run(exe, ["--install-dir", occupied]).status, 1);
  assert.equal(await readFile(join(occupied, "personal.txt"), "utf8"), "preserve this");
  assert.equal(run(exe, ["--install-dir", installed]).status, 0, "EXE install failed; inspect %TEMP%/Orbital-setup-last-error.txt");
  const manifestBytes = await readFile(join(installed, "SOURCE-MANIFEST.json"));
  const manifest = JSON.parse(manifestBytes);
  for (const file of manifest.files) {
    const bytes = await readFile(join(installed, file.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.path);
  }
  const marker = JSON.parse(await readFile(join(installed, "INSTALLATION.json"), "utf8"));
  assert.equal(marker.root, installed);
  assert.equal(marker.version, version);
  const integration = ps(`$key=Get-ItemProperty -LiteralPath ${quote(registry)}; $menu=Join-Path ([Environment]::GetFolderPath('Programs')) 'Orbital ${version}'; $shell=New-Object -ComObject WScript.Shell; @{root=$key.InstallLocation; publisher=$key.Publisher; links=@(Get-ChildItem -LiteralPath $menu -Filter '*.lnk' | ForEach-Object {$link=$shell.CreateShortcut($_.FullName); @{name=$_.Name; target=$link.TargetPath; arguments=$link.Arguments; working=$link.WorkingDirectory}})} | ConvertTo-Json -Depth 4`);
  assert.equal(integration.status, 0, integration.stderr);
  const metadata = JSON.parse(integration.stdout);
  assert.equal(metadata.root, installed);
  assert.equal(metadata.publisher, "DunDao0");
  assert.equal(metadata.links.length, 3);
  for (const link of metadata.links) {
    assert.match(link.target, /WindowsPowerShell\\v1\.0\\powershell\.exe$/i);
    assert.equal(link.working, installed);
    assert.ok(link.arguments.includes(installed));
  }
  const other = join(root, "other install");
  assert.equal(run(exe, ["--install-dir", other]).status, 1);
  assert.equal(await exists(other), false);
  await writeFile(join(installed, "SOURCE-MANIFEST.json"), Buffer.concat([manifestBytes, Buffer.from(" ")]));
  const refused = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", uninstaller, "-Quiet"]);
  assert.equal(refused.status, 1, "Modified manifest must block deletion");
  assert.ok(await exists(join(installed, "package.json")));
  await writeFile(join(installed, "SOURCE-MANIFEST.json"), manifestBytes);
  await writeFile(join(installed, "README.md"), "my changed README");
  await mkdir(join(installed, ".orbis", "logs"), { recursive: true });
  await writeFile(join(installed, ".orbis", "logs", "personal.log"), "keep my data");
  const removed = run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", uninstaller, "-Quiet"]);
  assert.equal(removed.status, 0, removed.stdout + removed.stderr);
  assert.equal(await readFile(join(installed, "README.md"), "utf8"), "my changed README");
  assert.equal(await readFile(join(installed, ".orbis", "logs", "personal.log"), "utf8"), "keep my data");
  assert.equal(await exists(join(installed, "package.json")), false);
  assert.equal(await exists(join(installed, "INSTALLATION.json")), false);
  const removedIntegration = ps(`if (Test-Path -LiteralPath ${quote(registry)}) { exit 1 }; if (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Programs')) 'Orbital ${version}')) { exit 1 }`);
  assert.equal(removedIntegration.status, 0, removedIntegration.stderr);
});
