"""Scientific regressions from the backend audit (no network or new models)."""
from __future__ import annotations

from unittest.mock import patch

from astropy import units as u
from astropy.coordinates import EarthLocation, GCRS, SkyCoord, UnitSphericalRepresentation
from astropy.time import Time
import numpy as np
import pytest

from astro_system.coordinates.observer import _apparent_constellation, local_sky
from astro_system.coordinates.iers_status import configure_iers_offline
from astro_system.eclipses import local as eclipse


KERRVILLE = (30.0474, -99.1403, 500)


def test_constellation_uses_direction_without_relocating_observer():
    configure_iers_offline()
    moment = Time("2024-04-08T18:34:00", scale="utc")
    observer = EarthLocation.from_geodetic(-99.1403 * u.deg, 30.0474 * u.deg, 500 * u.m)
    position, velocity = observer.get_gcrs_posvel(moment)
    body = SkyCoord(ra=17.6 * u.deg, dec=7.47 * u.deg, distance=1 * u.au,
                    frame=GCRS(obstime=moment, obsgeoloc=position, obsgeovel=velocity))
    with patch("astro_system.coordinates.observer.get_constellation", return_value="Psc") as lookup:
        assert _apparent_constellation(body) == "Psc"
    direction = lookup.call_args.args[0]
    assert isinstance(direction.data, UnitSphericalRepresentation)
    assert direction.frame.is_equivalent_frame(body.frame)
    assert direction.ra == body.ra and direction.dec == body.dec


def test_sun_and_moon_share_observed_constellation_during_kerrville_eclipse():
    payload = local_sky(*KERRVILLE, "2024-04-08T18:34:00Z")
    rows = {row["name"]: row for row in payload["objects"]}
    # Regression: the finite-distance ICRS transform incorrectly returned Virgo.
    assert rows["Sun"]["constellation"] == rows["Moon"]["constellation"] == "Psc"
    assert rows["Mercury"]["constellation"] == rows["Venus"]["constellation"] == "Psc"
    assert rows["Mars"]["constellation"] == "Aqr"
    assert payload["refraction"] == {"enabled": False, "pressure_hpa": 0}
    assert payload["ephemeris"]["is_de442s_reference_state"] is False


@pytest.fixture(scope="module")
def full_eclipse():
    return eclipse.local_solar_eclipse(*KERRVILLE, "2024-04-08T18:30:00Z", 2)


@pytest.mark.parametrize("utc,kinds", [
    ("2024-04-08T19:30:00Z", ["C2", "MAX", "C3", "C4"]),
    ("2024-04-08T17:40:00Z", ["C1", "C2", "MAX", "C3"]),
    ("2024-04-08T19:34:00Z", ["MAX", "C3", "C4"]),
    ("2024-04-08T20:00:00Z", ["MAX", "C4"]),
])
def test_truncated_window_preserves_contact_identities(utc, kinds, full_eclipse):
    result = eclipse.local_solar_eclipse(*KERRVILLE, utc, 1)
    assert [item["kind"] for item in full_eclipse["contacts"]] == ["C1", "C2", "MAX", "C3", "C4"]
    assert full_eclipse["search_window"]["truncated"] is False
    assert [item["kind"] for item in result["contacts"]] == kinds
    assert result["search_window"]["truncated"] is True
    start = Time(result["search_window"]["start_utc"])
    end = Time(result["search_window"]["end_utc"])
    full_contacts = {item["kind"]: Time(item["utc"]) for item in full_eclipse["contacts"]}
    for contact in result["contacts"]:
        moment = Time(contact["utc"])
        assert start <= moment <= end
        if contact["kind"] != "MAX":
            assert abs((moment - full_contacts[contact["kind"]]).to_value(u.s)) < 0.1
    assert "not a Besselian" in result["precision_warning"]


@pytest.mark.parametrize("internal,labels", [(False, ["C1", "C4"]), (True, ["C2", "C3"])])
@pytest.mark.parametrize("values", [[0.0, -1.0, 0.0], [1.0, 0.0, -1.0, 0.0, 1.0]])
def test_exact_sample_and_window_boundary_contacts_are_not_lost_or_duplicated(internal, labels, values):
    samples = Time("2024-04-08T18:00:00") + np.arange(len(values)) * u.s
    roots = eclipse._contact_roots(samples, values, None, internal=internal)
    assert [kind for kind, _ in roots] == labels


@pytest.mark.parametrize("values,expected", [([1.0, 1.0], []), ([1.0, 0.0, 1.0], [])])
def test_contact_search_does_not_invent_crossings(values, expected):
    samples = Time("2024-04-08T18:00:00") + np.arange(len(values)) * u.s
    assert eclipse._contact_roots(samples, values, None) == expected


@pytest.mark.parametrize("utc", ["2000-01-01T12:00:00", "2024-04-08T18:00:00"])
def test_minimum_tolerance_does_not_grow_with_absolute_epoch(utc):
    left = Time(utc)
    target_s = 123.456

    def geometry(moment, _location):
        delta_s = float((moment - left).to_value(u.s)) - target_s
        return float(np.hypot(delta_s, 7.0)), 1.0, 1.0

    with patch.object(eclipse, "_geometry", side_effect=geometry):
        result = eclipse._minimum_time(left, left + 600 * u.s, None)
    assert (result - left).to_value(u.s) == pytest.approx(target_s, abs=0.05)


def test_minimum_returns_actual_boundary_when_event_maximum_is_outside_window():
    left = Time("2024-04-08T18:00:00")
    with patch.object(eclipse, "_geometry", side_effect=lambda moment, _: (1 + (moment - left).to_value(u.s), 1, 1)):
        result = eclipse._minimum_time(left, left + 600 * u.s, None)
    assert result == left
