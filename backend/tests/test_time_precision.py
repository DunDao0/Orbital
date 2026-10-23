"""Microsecond UTC transport and one physical epoch through both DE442s readers."""
import math
from pathlib import Path
from unittest import mock

from astropy.time import Time
from fastapi.testclient import TestClient
import httpx
import pytest

from astro_system.api.services import create_app
from astro_system.ephemeris.spice_loader import SpiceEphemeris, spice
from astro_system.ephemeris.time_conversion import advance_utc, epoch_metadata, et_to_utc

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("utc,canonical", [
    ("2026-08-05T00:00:00Z", "2026-08-05T00:00:00.000Z"),
    ("2026-08-05T00:00:00.000000Z", "2026-08-05T00:00:00.000Z"),
    ("2026-08-05T00:00:00.123000Z", "2026-08-05T00:00:00.123Z"),
    ("2026-08-05T00:00:00.123400z", "2026-08-05T00:00:00.1234Z"),
    ("2026-08-05T00:00:00.000499Z", "2026-08-05T00:00:00.000499Z"),
    ("2026-08-05T00:00:00.999999", "2026-08-05T00:00:00.999999Z"),
    ("2026-08-04T21:00:00.000499-03:00", "2026-08-05T00:00:00.000499Z"),
    ("2026-08-05T05:30:00.000499+05:30", "2026-08-05T00:00:00.000499Z"),
    ("2016-12-31T23:59:60.123456Z", "2016-12-31T23:59:60.123456Z"),
])
def test_utc_canonicalization_preserves_input_resolution_and_legacy_strings(utc, canonical):
    result = epoch_metadata(utc)
    assert result.input_utc == utc
    assert result.canonical_utc == canonical
    assert result.ephemeris_time_et_s == epoch_metadata(canonical).ephemeris_time_et_s


@pytest.mark.parametrize("utc", [
    "1965-01-01T00:00:00.000499Z", "2000-01-01T12:00:00.123456Z",
    "2016-12-31T23:59:60.123456Z", "2026-08-05T00:00:00.000499Z",
])
def test_two_part_jd_round_trip_does_not_discard_submillisecond_time(utc):
    result = epoch_metadata(utc)
    original = Time(utc, scale="utc")
    numeric = Time(2451545.0, result.ephemeris_time_et_s / 86400, format="jd", scale="tdb")
    # ET is a float, and public UTC serialization is at most six decimals.
    # This bounded numerical tolerance is below the old JD cancellation error.
    tolerance_s = max(1e-6, 4 * math.ulp(result.ephemeris_time_et_s))
    assert abs((numeric - original).to_value("sec")) <= tolerance_s
    returned = Time(et_to_utc(result.ephemeris_time_et_s), scale="utc")
    assert abs((returned - original).to_value("sec")) <= tolerance_s


def test_distinct_microsecond_inputs_remain_distinct_numeric_epochs():
    first = epoch_metadata("2026-08-05T00:00:00.000499Z")
    second = epoch_metadata("2026-08-05T00:00:00.000500Z")
    assert first.canonical_utc != second.canonical_utc
    assert second.ephemeris_time_et_s > first.ephemeris_time_et_s
    assert second.ephemeris_time_et_s - first.ephemeris_time_et_s == pytest.approx(
        1e-6, rel=0, abs=2 * math.ulp(first.ephemeris_time_et_s))


@pytest.mark.parametrize("utc,elapsed,expected", [
    ("2026-08-05T00:00:00.000499Z", 0.000501, "2026-08-05T00:00:00.001Z"),
    ("2026-08-05T05:30:00.000499+05:30", 1, "2026-08-05T00:00:01.000499Z"),
    ("2016-12-31T23:59:59.999499Z", 1, "2016-12-31T23:59:60.999499Z"),
    ("2016-12-31T23:59:59.999499Z", 2, "2017-01-01T00:00:00.999499Z"),
    ("2017-01-01T00:00:00.999499Z", -2, "2016-12-31T23:59:59.999499Z"),
])
def test_final_epoch_adds_si_seconds_without_dropping_microseconds(utc, elapsed, expected):
    assert advance_utc(utc, elapsed) == expected


@pytest.mark.skipif(spice is None, reason="SpiceyPy absent; both-reader precision gate requires native SPICE")
@pytest.mark.parametrize("utc", [
    "1965-01-01T00:00:00.000499Z", "2016-12-31T23:59:60.123456Z",
    "2026-08-05T05:30:00.000499+05:30",
])
def test_both_real_readers_share_the_microsecond_epoch(utc):
    provider = SpiceEphemeris(ROOT / "data/kernels")
    provider.load()
    try:
        with mock.patch.object(spice, "str2et", side_effect=AssertionError("Do not reparse UTC")):
            native = provider.state(("Sun", "Earth", "Moon"), utc)
        with mock.patch("astro_system.ephemeris.spice_loader.spice", None):
            readonly = provider.state(("Sun", "Earth", "Moon"), utc)
        metadata = epoch_metadata(utc)
        assert native.canonical_utc == readonly.canonical_utc == metadata.canonical_utc
        assert native.ephemeris_time_et_s == readonly.ephemeris_time_et_s == metadata.ephemeris_time_et_s
        for actual, expected in zip(native.position_m, readonly.position_m):
            assert actual == pytest.approx(expected, rel=0, abs=0.001)
        for actual, expected in zip(native.velocity_m_s, readonly.velocity_m_s):
            assert actual == pytest.approx(expected, rel=0, abs=1e-6)
    finally:
        provider.close()


@pytest.fixture(scope="module")
def direct_and_gateway():
    orbital = create_app("orbital")
    with TestClient(orbital) as direct:
        with TestClient(create_app("science", transport=httpx.ASGITransport(app=orbital))) as gateway:
            yield direct, gateway


def test_microsecond_utc_coverage_edges_still_refuse_extrapolation(direct_and_gateway):
    direct, gateway = direct_and_gateway
    coverage = direct.get("/api/reference/state", params={"bodies": "Earth"}).json()["coverage"]
    for boundary, direction in (("valid_utc_from", -1), ("valid_utc_until", 1)):
        utc = coverage[boundary]
        edge = gateway.get("/api/reference/state", params={"bodies": "Earth", "utc": utc})
        outside = gateway.get("/api/reference/state", params={
            "bodies": "Earth", "utc": advance_utc(utc, direction * 1e-6),
        })
        assert edge.status_code == 200, edge.text
        assert outside.status_code == 422, outside.text
        assert outside.json()["error"]["code"] == "EPHEMERIS_OUT_OF_COVERAGE"


@pytest.mark.parametrize("utc,duration,expected", [
    ("2026-08-05T00:00:00.000499Z", 0.000501, "2026-08-05T00:00:00.001Z"),
    ("2026-08-04T21:00:00.000499-03:00", 1, "2026-08-05T00:00:01.000499Z"),
    ("2016-12-31T23:59:59.999499Z", 1, "2016-12-31T23:59:60.999499Z"),
    ("2017-01-01T00:00:00.999499Z", -2, "2016-12-31T23:59:59.999499Z"),
])
def test_real_reference_and_simulation_keep_submillisecond_epoch_through_gateway(
        direct_and_gateway, utc, duration, expected):
    direct, gateway = direct_and_gateway
    params = {"utc": utc, "bodies": "Sun,Earth"}
    direct_reference = direct.get("/api/reference/state", params=params)
    proxied_reference = gateway.get("/api/reference/state", params=params)
    assert direct_reference.status_code == proxied_reference.status_code == 200
    assert direct_reference.json()["bodies"] == proxied_reference.json()["bodies"]
    metadata = epoch_metadata(utc)
    assert proxied_reference.json()["epoch"] == metadata.canonical_utc
    assert proxied_reference.json()["epoch_metadata"]["ephemeris_time_et_s"] == metadata.ephemeris_time_et_s
    body = {"utc": utc, "bodies": ["Sun", "Earth"], "duration_s": duration, "step_s": abs(duration)}
    direct_result = direct.post("/api/simulate", json=body)
    proxied_result = gateway.post("/api/simulate", json=body)
    assert direct_result.status_code == proxied_result.status_code == 200, proxied_result.text
    assert direct_result.json()["state"] == proxied_result.json()["state"]
    assert proxied_result.json()["input"]["utc"] == metadata.canonical_utc
    assert proxied_result.json()["state"]["epoch_utc"] == expected
