"""Runtime data failures are explicit and do not poison independent routes."""
import os
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
import pytest
from astropy import units as u

from astro_system.api import main
from astro_system.api.services import create_app
from astro_system.catalog_data import CatalogDataError
from astro_system.coordinates.constellation_observatory import _gaia_catalogue

DATA_ROOT = Path(__file__).resolve().parents[2] / "data"
CATALOGUE_FILES = (
    "moons/moons.json", "stars/gaia_bright.json", "stars/iau_named_stars.json",
    "constellations/constellation_guides.json",
    "constellations/iau_boundary_vertices_j2000.json",
)
OBSERVER = {"latitude_deg": 0, "longitude_deg": 0, "utc": "2024-04-08T18:00:00Z"}


@pytest.fixture
def catalogue_root():
    # No large kernels are duplicated; fixtures are removed after each test.
    with TemporaryDirectory(prefix="orbis-catalogue-test-") as raw:
        root = Path(raw)
        for name in CATALOGUE_FILES:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(DATA_ROOT / name, target)
        yield root


def assert_data_unavailable(response, root):
    assert response.status_code == 503
    payload = response.json()
    assert payload["error"]["code"] == "CATALOG_DATA_UNAVAILABLE"
    assert payload["error"]["request_id"] == response.headers["X-Request-ID"]
    assert str(root) not in response.text
    assert "Traceback" not in response.text


def test_corruption_after_cache_warmup_invalidates_readiness_and_recovers(monkeypatch, catalogue_root):
    with TestClient(main.app) as client:
        # Keep the verified physical provider from startup; exercise a separate
        # catalogue root with the same approved files.
        monkeypatch.setattr(main, "DATA_ROOT", catalogue_root)
        initial = client.get("/api/catalogs/stars", params={"limit": 1})
        assert initial.status_code == 200
        assert client.get("/api/health/ready").status_code == 200
        target = catalogue_root / "stars/gaia_bright.json"
        original, stat = target.read_bytes(), target.stat()
        replacement = original.replace(b"Gaia DR3", b"Gaia BAD", 1)
        assert replacement != original and len(replacement) == len(original)
        target.write_bytes(replacement)
        os.utime(target, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        assert_data_unavailable(client.get("/api/catalogs/stars"), catalogue_root)
        assert client.get("/api/capabilities").json()["capabilities"]["catalogs"]["stars"] is False
        assert client.get("/api/health/ready").status_code == 503
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/reference/state").status_code == 200
        assert client.post("/api/sky", json=OBSERVER).status_code == 200
        target.write_bytes(original)
        os.utime(target, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        recovered = client.get("/api/catalogs/stars", params={"limit": 1})
        assert recovered.status_code == 200
        assert recovered.json()["items"] == initial.json()["items"]
        assert client.get("/api/health/ready").status_code == 200


@pytest.mark.parametrize("factory", [lambda: main.app, lambda: create_app("orbital")])
def test_missing_moons_is_not_a_successful_empty_catalogue(monkeypatch, catalogue_root, factory):
    with TestClient(factory()) as client:
        monkeypatch.setattr(main, "DATA_ROOT", catalogue_root)
        (catalogue_root / "moons/moons.json").unlink()
        assert_data_unavailable(client.get("/api/catalogs/moons"), catalogue_root)
        assert client.get("/api/catalogs/stars").status_code == 200
        assert client.get("/api/reference/state").status_code == 200
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/health/ready").status_code == 503


def test_boundaries_only_disable_observatory_not_catalogue_or_basic_sky(monkeypatch, catalogue_root):
    with TestClient(main.app) as client:
        monkeypatch.setattr(main, "DATA_ROOT", catalogue_root)
        assert client.get("/api/capabilities").json()["capabilities"]["sky_constellations"]["available"]
        target = catalogue_root / "constellations/iau_boundary_vertices_j2000.json"
        original = target.read_bytes()
        target.write_bytes(b"{}")
        caps = client.get("/api/capabilities").json()["capabilities"]
        assert caps["catalogs"]["available"]
        assert not caps["sky_constellations"]["available"]
        assert client.get("/api/health/ready").status_code == 503
        assert_data_unavailable(client.post("/api/sky/constellations",
                                            json={**OBSERVER, "constellation": "Ori"}), catalogue_root)
        assert client.get("/api/catalogs/constellations").status_code == 200
        assert client.post("/api/sky", json=OBSERVER).status_code == 200
        target.write_bytes(original)
        assert client.get("/api/health/ready").status_code == 200


def test_invalid_kernel_manifest_does_not_prevent_process_startup(monkeypatch, catalogue_root):
    manifest = catalogue_root / "manifests/kernels.json"
    manifest.parent.mkdir()
    manifest.write_bytes(b'{"files":[]}')
    monkeypatch.setattr(main, "DATA_ROOT", catalogue_root)
    with TestClient(main.app) as client:
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/health/ready").status_code == 503
        response = client.get("/api/reference/state")
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "KERNEL_INTEGRITY_FAILED"
        assert client.get("/api/catalogs/moons").status_code == 200
        assert client.post("/api/sky", json=OBSERVER).status_code == 200


def test_derived_gaia_cache_is_private_and_checks_bytes_before_lookup(catalogue_root):
    first, coordinates = _gaia_catalogue(data_root=catalogue_root)
    expected_ra = first[0]["ra_deg"]
    first[0]["ra_deg"] = -1
    coordinates.data.lon[0] = 0 * u.deg
    second, repeated_coordinates = _gaia_catalogue(data_root=catalogue_root)
    assert second[0]["ra_deg"] == expected_ra
    assert repeated_coordinates.ra.deg[0] == expected_ra

    target = catalogue_root / "stars/gaia_bright.json"
    original, stat = target.read_bytes(), target.stat()
    target.write_bytes(original.replace(b"Gaia DR3", b"Gaia BAD", 1))
    os.utime(target, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    with pytest.raises(CatalogDataError, match="unavailable"):
        _gaia_catalogue(data_root=catalogue_root)
