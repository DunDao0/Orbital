"""Catalogue hashes, schema, cache versioning and dependency isolation."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import pytest

from astro_system import catalog_data
from astro_system.catalog_data import CatalogDataError, load_catalog, load_catalog_snapshot
from astro_system.catalogs.constellations import IAU_ABBREVIATIONS


def _record(raw):
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


@pytest.fixture
def bundle(tmp_path, monkeypatch):
    root = tmp_path / "data"
    star = {"gaia_dr3_source_id": "123", "ra_deg": 10.0, "dec_deg": 20.0, "g_mag": 3.0,
            "epoch": "J2016.0", "source": "fixture", "pmra_mas_yr": None}
    payloads = {
        "stars": {"source": "fixture", "count": 1, "stars": [star]},
        "moons": {"source": ["fixture"], "moons": [{
            "name": "Nereid", "designation": None, "primary": "Neptune", "naif_id": 802,
            "mean_radius_m": 170000, "mu_m3_s2": 0.0, "propagation_mode": "mean_elements_catalog_only",
            "status": "fixture", "source": "fixture", "orbit": None,
        }]},
        "constellations": {"schema": 1, "source": "fixture", "catalogue_epoch": "J2016.0", "items": [
            {"iau_abbreviation": name, "name": name, "aliases": [name],
             "representative_icrs_j2000": {"ra_deg": 10, "dec_deg": 20}}
            for name in IAU_ABBREVIATIONS
        ]},
        "boundaries": {"schema": 1, "source": "fixture", "coordinate_frame": "ICRS",
                       "coordinate_epoch": "J2000.0", "segment_count": 1, "segments": [{
                           "start": {"ra_deg": 10, "dec_deg": 20}, "end": {"ra_deg": 11, "dec_deg": 21},
                           "constellations": ["And", "Cas"],
                       }]},
        "named_stars": {"schema": 1, "source": "fixture", "status": "unavailable", "items": []},
    }
    inventory_path = tmp_path / "inventory.json"
    inventory = {}
    for kind, relative in catalog_data.CATALOG_PATHS.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps(payloads[kind]).encode()
        path.write_bytes(raw)
        inventory[f"data/{relative}"] = _record(raw)
    inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
    monkeypatch.setattr(catalog_data, "APPROVED_INVENTORY_PATH", inventory_path)
    return root, inventory_path, payloads, inventory


def _approve_fixture(bundle, kind, raw):
    root, inventory_path, _, inventory = bundle
    path = root / catalog_data.CATALOG_PATHS[kind]
    path.write_bytes(raw)
    inventory[f"data/{catalog_data.CATALOG_PATHS[kind]}"] = _record(raw)
    inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
    return path


def test_real_approved_catalogues_are_valid_and_preserve_zero_metadata():
    root = Path(__file__).resolve().parents[2] / "data"
    for kind, relative in catalog_data.CATALOG_PATHS.items():
        _, digest = load_catalog_snapshot(root / relative, kind)
        assert len(digest) == 64
    moons = load_catalog(root / catalog_data.CATALOG_PATHS["moons"], "moons")
    assert next(row for row in moons["moons"] if row["name"] == "Nereid")["mu_m3_s2"] == 0.0


def test_missing_moons_do_not_block_observatory_and_missing_names_only_blocks_observatory(bundle):
    root, _, _, _ = bundle
    assert all(catalog_data.catalogue_availability(root).values())
    assert catalog_data.observatory_availability(root)
    (root / catalog_data.CATALOG_PATHS["moons"]).unlink()
    assert catalog_data.catalogue_availability(root) == {"moons": False, "stars": True, "constellations": True}
    assert catalog_data.observatory_availability(root)
    (root / catalog_data.CATALOG_PATHS["named_stars"]).unlink()
    assert not catalog_data.observatory_availability(root)
    assert catalog_data.catalogue_availability(root)["constellations"]


def test_missing_catalogue_is_explicit_error_not_empty_list(bundle):
    root, _, _, _ = bundle
    path = root / catalog_data.CATALOG_PATHS["moons"]
    path.unlink()
    with pytest.raises(CatalogDataError) as caught:
        load_catalog(path, "moons")
    assert caught.value.reason == "missing-or-unreadable" and caught.value.kind == "moons"
    assert str(root) not in str(caught.value)


def test_same_stat_mutation_is_detected_after_cache_and_restoring_bytes_recovers(bundle):
    root, _, _, _ = bundle
    path = root / catalog_data.CATALOG_PATHS["stars"]
    original = path.read_bytes()
    stat = path.stat()
    first, original_digest = load_catalog_snapshot(path, "stars")
    first["stars"][0]["ra_deg"] = 999  # callers cannot modify cached objects
    assert load_catalog(path, "stars")["stars"][0]["ra_deg"] == 10.0
    altered = original.replace(b'"123"', b'"456"')
    assert len(altered) == len(original)
    path.write_bytes(altered)
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    with pytest.raises(CatalogDataError) as caught:
        load_catalog_snapshot(path, "stars")
    assert caught.value.reason == "integrity-failed"
    assert not catalog_data.catalogue_availability(root)["stars"]
    path.write_bytes(original)
    recovered, digest = load_catalog_snapshot(path, "stars")
    assert recovered["stars"][0]["gaia_dr3_source_id"] == "123" and digest == original_digest


def test_approved_version_change_at_same_path_does_not_return_old_cache(bundle):
    root, _, payloads, _ = bundle
    path = root / catalog_data.CATALOG_PATHS["stars"]
    _, before = load_catalog_snapshot(path, "stars")
    payloads["stars"]["stars"][0]["gaia_dr3_source_id"] = "456"
    _approve_fixture(bundle, "stars", json.dumps(payloads["stars"]).encode())
    after, digest = load_catalog_snapshot(path, "stars")
    assert after["stars"][0]["gaia_dr3_source_id"] == "456" and digest != before


@pytest.mark.parametrize("raw", [
    b"{", b"[]", b'{"source":"a","source":"b"}', b'{"source":"fixture","x":NaN}',
    b'{"source":"fixture","x":Infinity}', b'{"source":"fixture","x":1e999}',
])
def test_invalid_json_fails_even_when_test_inventory_approves_bytes(bundle, raw):
    path = _approve_fixture(bundle, "stars", raw)
    with pytest.raises(CatalogDataError) as caught:
        load_catalog(path, "stars")
    assert caught.value.reason == "invalid-schema"


@pytest.mark.parametrize("kind,mutation", [
    ("stars", "ra"), ("stars", "dec"), ("stars", "epoch"), ("stars", "count"), ("stars", "duplicate"),
    ("moons", "state"), ("moons", "gm"), ("constellations", "incomplete"),
    ("boundaries", "frame"), ("boundaries", "count"), ("named_stars", "invented"),
])
def test_scientific_schema_rejects_inconsistent_fixture(bundle, kind, mutation):
    _, _, payloads, _ = bundle
    payload = payloads[kind]
    if mutation == "ra":
        payload["stars"][0]["ra_deg"] = 360
    elif mutation == "dec":
        payload["stars"][0]["dec_deg"] = -91
    elif mutation == "epoch":
        payload["stars"][0]["epoch"] = "J2000.0"
    elif mutation == "duplicate":
        payload["stars"].append(payload["stars"][0].copy())
        payload["count"] = 2
    elif mutation == "count":
        payload["count" if kind == "stars" else "segment_count"] = 99
    elif mutation == "state":
        payload["moons"][0]["position_m"] = [1, 2, 3]
    elif mutation == "gm":
        payload["moons"][0]["mu_m3_s2"] = -1
    elif mutation == "incomplete":
        payload["items"].pop()
    elif mutation == "frame":
        payload["coordinate_frame"] = "invented"
    elif mutation == "invented":
        payload["items"] = [{"name": "not approved as available"}]
    path = _approve_fixture(bundle, kind, json.dumps(payload).encode())
    with pytest.raises(CatalogDataError) as caught:
        load_catalog(path, kind)
    assert caught.value.reason == "invalid-schema"


def test_missing_inventory_and_unrecognized_path_fail_closed(bundle):
    root, inventory_path, _, _ = bundle
    with pytest.raises(CatalogDataError) as caught:
        load_catalog(root / "outside.json", "stars")
    assert caught.value.reason == "outside-root"
    inventory_path.unlink()
    with pytest.raises(CatalogDataError) as caught:
        load_catalog(root / catalog_data.CATALOG_PATHS["stars"], "stars")
    assert caught.value.reason == "inventory-unavailable"
