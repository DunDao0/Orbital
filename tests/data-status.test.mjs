import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("public data status reports the generated scientific inventories", async () => {
  const status = JSON.parse(await readFile(new URL("../public/data-status.json", import.meta.url), "utf8"));
  assert.equal(status.schema, 1);
  assert.equal(status.kernels.count, 3);
  assert.ok(status.catalogs.moons.count >= 400);
  assert.equal(status.catalogs.stars.count, 10_000);
  assert.equal(status.catalogs.constellations.count, 88);
  assert.equal(status.catalogs.constellation_guides.count, 88);
  assert.equal(status.reference_snapshot.body_count, 10);
});

test("public Worker catalogue assets are generated from the verified local snapshots", async () => {
  const status = JSON.parse(await readFile(new URL("../public/data-status.json", import.meta.url), "utf8"));
  const moons = JSON.parse(await readFile(new URL("../public/scientific/moons.json", import.meta.url), "utf8"));
  const stars = JSON.parse(await readFile(new URL("../public/scientific/gaia_bright.json", import.meta.url), "utf8"));
  const constellations = JSON.parse(await readFile(new URL("../public/scientific/iau_boundaries.json", import.meta.url), "utf8"));
  const constellationGuides = JSON.parse(await readFile(new URL("../public/scientific/constellation_guides.json", import.meta.url), "utf8"));
  assert.equal(moons.moons.length, status.catalogs.moons.count);
  assert.equal(stars.count, status.catalogs.stars.count);
  assert.equal(constellations.count, status.catalogs.constellations.count);
  assert.equal(constellationGuides.items.length, status.catalogs.constellation_guides.count);
});
