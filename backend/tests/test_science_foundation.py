from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
import logging
import math
from pathlib import Path
import shutil
import tempfile
from unittest import mock

from astropy.utils import iers
from astropy.time import Time
from fastapi.testclient import TestClient
import pytest

from astro_system.api.main import MAX_REQUEST_BODY_BYTES, app
from astro_system.coordinates import configure_iers_offline, current_iers_status, local_sky
from astro_system.ephemeris import ApplicationEphemerisProvider, STATE_TARGETS, SYSTEM_BARYCENTERS, epoch_metadata
from astro_system.ephemeris.spice_loader import SpiceEphemeris, spice
from astro_system.eclipses import local_solar_eclipse

ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = ROOT / "data"
HAS_KERNELS = all((DATA_ROOT / "kernels" / name).is_file() for name in ("naif0012.tls", "pck00011.tpc", "de442s.bsp"))


def observer_payload(**updates: object) -> dict[str, object]:
    value: dict[str, object] = {"latitude_deg": -23.5505, "longitude_deg": -46.6333, "elevation_m": 760, "utc": "2024-04-08T18:00:00Z"}
    value.update(updates)
    return value


def assert_envelope(response, capability: str) -> dict[str, object]:
    payload = response.json()
    assert payload["schema_version"] == 1
    assert payload["meta"]["capability"] == capability
    assert payload["meta"]["request_id"] == response.headers["X-Request-ID"]
    return payload


def test_success_request_ids_and_private_cache() -> None:
    with TestClient(app) as client:
        accepted = client.get("/api/health", headers={"X-Request-ID": "client.safe-123"})
        replaced = client.get("/api/health", headers={"X-Request-ID": "unsafe id with spaces"})
    assert_envelope(accepted, "health")
    assert accepted.headers["X-Request-ID"] == "client.safe-123"
    assert replaced.headers["X-Request-ID"] != "unsafe id with spaces"
    assert 1 <= len(replaced.headers["X-Request-ID"]) <= 64
    assert accepted.headers["Cache-Control"] == "private, no-store"


def test_cors_allows_only_explicit_local_origins_without_credentials() -> None:
    with TestClient(app) as client:
        local = client.options("/api/sky", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-request-id"})
        foreign = client.options("/api/sky", headers={"Origin": "https://example.invalid", "Access-Control-Request-Method": "POST"})
    assert local.status_code == 200
    assert local.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
    assert "Access-Control-Allow-Credentials" not in local.headers
    assert foreign.status_code == 400
    assert "Access-Control-Allow-Origin" not in foreign.headers


@pytest.mark.parametrize("body", [
    {**observer_payload(), "unknown": 1},
    {**observer_payload(), "latitude_deg": float("inf")},
])
def test_validation_error_is_sanitized_and_forbids_extra_or_infinite(body: dict[str, object]) -> None:
    with TestClient(app) as client:
        response = client.post("/api/sky", content=json.dumps(body), headers={"Content-Type": "application/json"})
    payload = response.json()
    assert response.status_code == 422
    assert "detail" not in payload
    assert payload["error"]["code"] == "VALIDATION_ERROR"
    serialized = json.dumps(payload)
    assert str(ROOT) not in serialized
    assert "Traceback" not in serialized
    assert "-23.5505" not in serialized


def test_non_standard_nan_is_rejected() -> None:
    raw = b'{"latitude_deg":NaN,"longitude_deg":0,"elevation_m":0,"utc":"2024-01-01T00:00:00Z"}'
    with TestClient(app) as client:
        response = client.post("/api/sky", content=raw, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_body_limit_and_method_contracts() -> None:
    oversized = json.dumps({"padding": "x" * MAX_REQUEST_BODY_BYTES})
    with TestClient(app) as client:
        response = client.post("/api/sky", content=oversized, headers={"Content-Type": "application/json"})
        get_simulation = client.get("/api/simulate")
        options = client.options("/api/simulate")
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_BODY_TOO_LARGE"
    assert get_simulation.status_code == 405
    assert get_simulation.headers["Allow"] == "POST"
    assert options.status_code == 204
    assert options.headers["Allow"] == "POST, OPTIONS"


def test_application_logs_do_not_contain_observer_values(caplog: pytest.LogCaptureFixture) -> None:
    sentinel_latitude = 12.345678
    sentinel_longitude = -87.654321
    caplog.set_level(logging.INFO, logger="astro_system.api")
    with TestClient(app) as client:
        response = client.post("/api/sky", json=observer_payload(latitude_deg=sentinel_latitude, longitude_deg=sentinel_longitude))
    assert response.status_code == 200
    output = caplog.text
    assert str(sentinel_latitude) not in output
    assert str(sentinel_longitude) not in output
    assert "2024-04-08T18:00:00Z" not in output


def test_health_is_cheap_and_capabilities_are_structured() -> None:
    with TestClient(app) as client:
        provider = app.state.ephemeris_provider
        before = provider.provider.load_count
        first = client.get("/api/health")
        second = client.get("/api/health")
        capabilities = client.get("/api/capabilities")
        ready = client.get("/api/health/ready")
        after = provider.provider.load_count
    assert first.status_code == second.status_code == 200
    assert before == after == 1
    body = assert_envelope(capabilities, "capabilities")
    assert body["capabilities"]["catalogs"] == {"available": True, "moons": True, "stars": True, "constellations": True}
    assert body["limits"]["request_body_bytes"] == 64 * 1024
    assert ready.json()["kernel_integrity"]["checked_files"] == 3


def _copied_data_root(directory: Path) -> Path:
    data = directory / "data"
    (data / "manifests").mkdir(parents=True)
    (data / "kernels").mkdir(parents=True)
    shutil.copy2(DATA_ROOT / "manifests/kernels.json", data / "manifests/kernels.json")
    for name in ("naif0012.tls", "pck00011.tpc", "de442s.bsp"):
        shutil.copy2(DATA_ROOT / "kernels" / name, data / "kernels" / name)
    return data


def test_provider_detects_missing_and_corrupt_kernel_without_failing_catalogues() -> None:
    with tempfile.TemporaryDirectory() as raw:
        temp = Path(raw)
        missing = temp / "missing"
        (missing / "manifests").mkdir(parents=True)
        shutil.copy2(DATA_ROOT / "manifests/kernels.json", missing / "manifests/kernels.json")
        missing_provider = ApplicationEphemerisProvider(missing)
        assert not missing_provider.available
        assert missing_provider.verification.status == "failed"

        copied = _copied_data_root(temp / "corrupt")
        with (copied / "kernels/de442s.bsp").open("r+b") as target:
            target.seek(128)
            target.write(b"BAD")
        corrupt_provider = ApplicationEphemerisProvider(copied)
        assert not corrupt_provider.available
        assert corrupt_provider.verification.status == "failed"

    with TestClient(app) as client:
        original = app.state.ephemeris_provider
        app.state.ephemeris_provider = missing_provider
        try:
            capabilities = client.get("/api/capabilities").json()
            reference = client.get("/api/reference/state")
            moons = client.get("/api/catalogs/moons")
        finally:
            app.state.ephemeris_provider = original
    assert not capabilities["capabilities"]["reference_state"]["available"]
    assert capabilities["capabilities"]["catalogs"]["available"]
    assert reference.status_code == 503
    assert reference.json()["error"]["code"] == "KERNEL_INTEGRITY_FAILED"
    assert moons.status_code == 200


@pytest.mark.skipif(not HAS_KERNELS, reason="verified DE442s bundle absent")
def test_provider_reuses_one_reader_is_deterministic_and_closes() -> None:
    provider = ApplicationEphemerisProvider(DATA_ROOT)
    assert provider.available and provider.provider is not None
    try:
        assert provider.provider.load_count == 1
        expected = provider.state(("Earth", "Moon"), "2026-08-05T00:00:00Z")
        repeated = provider.state(("Earth", "Moon"), "2026-08-05T00:00:00Z")
        with ThreadPoolExecutor(max_workers=4) as pool:
            concurrent = list(pool.map(lambda _: provider.state(("Earth", "Moon"), "2026-08-05T00:00:00Z"), range(8)))
        assert provider.provider.load_count == 1
        assert repeated.position_m == expected.position_m
        assert all(item.position_m == expected.position_m and item.velocity_m_s == expected.velocity_m_s for item in concurrent)
        if spice is not None:
            with mock.patch.object(spice, "kclear", wraps=spice.kclear) as kclear:
                provider.state(("Earth",), "2026-08-05T00:00:00Z")
                assert not kclear.called
    finally:
        provider.close()
    assert provider.provider is not None
    assert provider.provider._reader is None
    assert not provider.provider._loaded


def test_time_conversion_normalizes_utc_offsets_and_leap_second() -> None:
    zulu = epoch_metadata("2024-04-08T18:00:00Z")
    no_offset = epoch_metadata("2024-04-08T18:00:00")
    offset = epoch_metadata("2024-04-08T15:00:00-03:00")
    old = epoch_metadata("1965-01-01T00:00:00Z")
    modern = epoch_metadata("2026-01-01T00:00:00Z")
    leap = epoch_metadata("2016-12-31T23:59:60Z")
    assert zulu.canonical_utc == no_offset.canonical_utc == offset.canonical_utc
    assert zulu.ephemeris_time_et_s == pytest.approx(offset.ephemeris_time_et_s, abs=1e-5)
    assert old.ephemeris_time_et_s != modern.ephemeris_time_et_s
    assert "23:59:60" in leap.canonical_utc
    assert zulu.state_time_scale == "TDB/ET" and "T" in zulu.canonical_utc
    with pytest.raises(ValueError):
        epoch_metadata("not-a-date")


@pytest.mark.skipif(spice is None, reason="SpiceyPy not installed; Astropy fallback remains covered")
def test_astropy_et_matches_spice_when_available() -> None:
    provider = SpiceEphemeris(DATA_ROOT / "kernels")
    provider.load()
    try:
        for utc in ("1965-01-01T00:00:00Z", "2000-01-01T12:00:00Z", "2026-08-05T00:00:00Z"):
            # Compare TT -> TDB at the SAME physical instant, including 1965.
            # SPICE's UTC parser uses a different pre-1972 convention.
            tt = Time(utc[:-1], scale="utc").tt
            tt_seconds = float(((tt.jd1 - 2451545.0) + tt.jd2) * 86400)
            expected = float(spice.unitim(tt_seconds, "TDT", "TDB"))
            assert epoch_metadata(utc).ephemeris_time_et_s == pytest.approx(expected, rel=0, abs=0.001)
            if utc >= "1972":
                assert epoch_metadata(utc).ephemeris_time_et_s == pytest.approx(float(spice.str2et(utc)), rel=0, abs=0.001)
        # Record the known convention difference, rather than hiding it by
        # increasing tolerance or deleting historical coverage.
        historical = epoch_metadata("1965-01-01T00:00:00Z")
        assert float(spice.str2et(historical.canonical_utc)) - historical.ephemeris_time_et_s == pytest.approx(5.4599, rel=0, abs=0.001)
    finally:
        provider.close()


@pytest.mark.skipif(spice is None, reason="SpiceyPy not installed")
@pytest.mark.parametrize("utc", ["1965-01-01T00:00:00Z", "1972-01-01T00:00:00Z", "2016-12-31T23:59:60Z", "2026-08-05T00:00:00Z"])
def test_both_ephemeris_readers_use_identical_physical_epoch(utc):
    provider = SpiceEphemeris(DATA_ROOT / "kernels")
    provider.load()
    try:
        with mock.patch.object(spice, "str2et", side_effect=AssertionError("UTC must not be reparsed")):
            native = provider.state(("Sun", "Earth", "Moon"), utc)
        with mock.patch("astro_system.ephemeris.spice_loader.spice", None):
            fallback = provider.state(("Sun", "Earth", "Moon"), utc)
        assert native.ephemeris_time_et_s == fallback.ephemeris_time_et_s == epoch_metadata(utc).ephemeris_time_et_s
        for actual, expected in zip(native.position_m, fallback.position_m):
            assert actual == pytest.approx(expected, rel=0, abs=0.001)
        for actual, expected in zip(native.velocity_m_s, fallback.velocity_m_s):
            assert actual == pytest.approx(expected, rel=0, abs=1e-6)
    finally:
        provider.close()


def test_iers_is_offline_and_reports_actual_status() -> None:
    configure_iers_offline()
    assert iers.conf.auto_download is False
    normal = current_iers_status()
    degraded = current_iers_status(["sentinel offline warning"])
    assert normal["mode"] == "offline" and normal["source"]
    assert normal["status"] in {"ok", "degraded", "out-of-range"}
    assert degraded["status"] == "degraded"
    assert "sentinel offline warning" in degraded["warning"]
    sky = local_sky(0, 0, 0, "2024-01-01T00:00:00Z")
    assert sky["iers"]["mode"] == "offline"


@pytest.mark.skipif(not HAS_KERNELS, reason="verified DE442s bundle absent")
def test_reference_identity_vectors_and_coverage() -> None:
    with TestClient(app) as client:
        response = client.get("/api/reference/state")
        outside = client.get("/api/reference/state", params={"utc": "2500-01-01T00:00:00Z"})
    body = assert_envelope(response, "reference_state")
    assert body["frame"] == "J2000"
    assert body["center"] == "Solar System Barycenter"
    assert body["time_scale"] == "TDB/ET"
    assert len(body["bodies"]) == 10
    for item in body["bodies"]:
        assert len(item["position_m"]) == len(item["velocity_m_s"]) == 3
        assert all(math.isfinite(value) for value in item["position_m"] + item["velocity_m_s"])
        assert item["state_target_naif_id"] == STATE_TARGETS[item["name"]]
        expected_kind = "system-barycenter" if item["name"] in SYSTEM_BARYCENTERS else "physical-center"
        assert item["state_kind"] == expected_kind
    assert outside.status_code == 422
    error = outside.json()["error"]
    assert error["code"] == "EPHEMERIS_OUT_OF_COVERAGE"
    assert error["valid_utc_from"] and error["valid_utc_until"]


@pytest.mark.skipif(not HAS_KERNELS, reason="verified DE442s bundle absent")
def test_simulation_post_validation_forward_backward_metrics_and_busy() -> None:
    base = {"utc": "2026-08-05T00:00:00Z", "bodies": ["Sun", "Earth"], "duration_s": 7200, "step_s": 3600}
    with TestClient(app) as client:
        forward = client.post("/api/simulate", json=base)
        backward = client.post("/api/simulate", json={**base, "duration_s": -7200})
        invalids = [
            ({**base, "bodies": ["Earth", "Earth"]}, "DUPLICATE_BODY"),
            ({**base, "bodies": ["Earth", "Unknown"]}, "UNKNOWN_BODY"),
            ({**base, "duration_s": 0}, "VALIDATION_ERROR"),
            ({**base, "step_s": 0}, "VALIDATION_ERROR"),
            ({**base, "step_s": -1}, "VALIDATION_ERROR"),
            ({**base, "duration_s": 7201}, "SIMULATION_DURATION_STEP_MISMATCH"),
            ({**base, "duration_s": 20_001, "step_s": 1}, "SIMULATION_STEP_LIMIT_EXCEEDED"),
            ({**base, "bodies": ["Sun", "Mercury", "Venus", "Earth", "Moon", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"]}, "VALIDATION_ERROR"),
        ]
        for payload, code in invalids:
            result = client.post("/api/simulate", json=payload)
            assert result.status_code == 422
            assert result.json()["error"]["code"] == code
        app.state.simulation_semaphore.acquire()
        try:
            busy = client.post("/api/simulate", json=base)
        finally:
            app.state.simulation_semaphore.release()
    for response, expected_duration in ((forward, 7200), (backward, -7200)):
        payload = assert_envelope(response, "simulate")
        assert response.headers["Cache-Control"] == "private, no-store"
        assert payload["execution"]["integrated_duration_s"] == expected_duration
        assert payload["execution"]["steps"] == 2
        assert set(payload["metrics"]) == {"initial", "final", "drift"}
        assert all(value is None or math.isfinite(value) for value in payload["metrics"]["drift"].values())
    assert busy.status_code == 429 and busy.json()["error"]["code"] == "SIMULATION_BUSY"


def test_sky_post_legacy_get_geometric_horizon_and_twilight() -> None:
    with TestClient(app) as client:
        post = client.post("/api/sky", json=observer_payload())
        changed_location = client.post("/api/sky", json=observer_payload(latitude_deg=40.7128, longitude_deg=-74.0060))
        legacy = client.get("/api/sky", params=observer_payload())
    payload = assert_envelope(post, "sky")
    assert post.headers["Cache-Control"] == "private, no-store"
    assert "Deprecation" not in post.headers
    assert legacy.headers["Deprecation"] == "true"
    assert payload["refraction"] == {"enabled": False, "pressure_hpa": 0.0}
    assert payload["iers"]["mode"] == "offline"
    assert payload["twilight"]["classification"] in {"day", "civil", "nautical", "astronomical", "night"}
    assert all("above_geometric_horizon" in item and item["above_horizon"] == item["above_geometric_horizon"] for item in payload["objects"])
    assert [item["altitude_deg"] for item in payload["objects"]] != [item["altitude_deg"] for item in changed_location.json()["objects"]]
    assert "visível" not in json.dumps(payload, ensure_ascii=False).lower()


def test_eclipse_semantic_contacts_for_total_partial_and_none() -> None:
    with TestClient(app) as client:
        total = client.post("/api/eclipses/local", json=observer_payload(latitude_deg=30.0474, longitude_deg=-99.1403, elevation_m=500, search_hours=18))
        legacy = client.get("/api/eclipses/local", params={**observer_payload(latitude_deg=30.0474, longitude_deg=-99.1403, elevation_m=500), "search_hours": 18})
    total_body = assert_envelope(total, "eclipses_local")
    assert [item["kind"] for item in total_body["contacts"]] == ["C1", "C2", "MAX", "C3", "C4"]
    assert [item["utc"] for item in total_body["contacts"]] == sorted(item["utc"] for item in total_body["contacts"])
    assert "operational" in total_body["precision_warning"]
    assert "observ" not in "".join(total_body.keys()).lower()
    assert legacy.headers["Deprecation"] == "true"

    partial = local_solar_eclipse(43.6532, -79.3832, 76, "2024-04-08T18:00:00Z", 18)
    none = local_solar_eclipse(-23.5505, -46.6333, 760, "2024-04-08T18:00:00Z", 18)
    assert partial["classification"] == "partial"
    assert [item["kind"] for item in partial["contacts"]] == ["C1", "MAX", "C4"]
    assert none["classification"] == "none" and none["contacts"] == []
    assert isinstance(total_body["sun_above_geometric_horizon_at_maximum"], bool)


def test_catalogue_inventory_filters_pagination_and_no_invented_moon_state() -> None:
    with TestClient(app) as client:
        moons = client.get("/api/catalogs/moons", params={"limit": 250})
        moon_page = client.get("/api/catalogs/moons", params={"query": "Ganymede", "offset": 0, "limit": 1})
        too_many = client.get("/api/catalogs/moons", params={"limit": 251})
        stars = client.get("/api/catalogs/stars", params={"max_magnitude": 2, "limit": 5})
        constellations = client.get("/api/catalogs/constellations", params={"limit": 88})
    assert moons.json()["total"] == 460 and moons.json()["returned"] == 250
    assert too_many.status_code == 422
    ganymede = moon_page.json()["items"][0]
    assert ganymede["name"] == "Ganymede" and ganymede["propagation_mode"] == "mean_elements_catalog_only"
    assert "position_m" not in ganymede
    assert stars.json()["catalogue_count"] == 10_000 and all(item["g_mag"] <= 2 for item in stars.json()["items"])
    abbreviations = constellations.json()["abbreviations"]
    assert constellations.json()["count"] == 88 and len(abbreviations) == len(set(abbreviations)) == 88


def test_fastapi_catalogue_and_reference_shapes_match_published_contracts() -> None:
    public_moons = json.loads((ROOT / "public/scientific/moons.json").read_text(encoding="utf-8"))
    public_stars = json.loads((ROOT / "public/scientific/gaia_bright.json").read_text(encoding="utf-8"))
    public_constellations = json.loads((ROOT / "public/scientific/constellation_guides.json").read_text(encoding="utf-8"))
    public_reference = json.loads((ROOT / "public/reference-snapshot.json").read_text(encoding="utf-8"))
    with TestClient(app) as client:
        moon = client.get("/api/catalogs/moons", params={"limit": 1}).json()
        star = client.get("/api/catalogs/stars", params={"limit": 1}).json()
        constellation = client.get("/api/catalogs/constellations", params={"limit": 1}).json()
        reference = client.get("/api/reference/state").json()
    assert moon["items"][0] == public_moons["moons"][0]
    assert star["items"][0] == public_stars["stars"][0]
    expected_constellation = {**public_constellations["items"][0], "boundary_source": "IAU boundaries via Astropy / Roman 1987", "cultural_lines": "not bundled"}
    assert constellation["items"][0] == expected_constellation
    assert constellation["source"] == public_constellations["source"]
    assert constellation["catalogue_epoch"] == public_constellations["catalogue_epoch"]
    required_body_keys = {"name", "naif_id", "body_naif_id", "state_target_naif_id", "state_center_naif_id", "state_kind", "state_target_name", "mu_m3_s2", "radius_m", "position_m", "velocity_m_s"}
    assert required_body_keys <= set(reference["bodies"][0])
    assert required_body_keys <= set(public_reference["bodies"][0])
