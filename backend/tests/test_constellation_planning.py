from datetime import datetime, timezone
from unittest.mock import patch
from types import SimpleNamespace

import numpy as np
import pytest
from astropy import units as u
from astropy.coordinates import EarthLocation, SkyCoord

from astro_system.coordinates.constellation_observatory import _plan_window


def test_incomplete_annual_window_is_rejected_not_filled():
    from astropy.time import Time
    from astro_system.coordinates.constellation_observatory import _annual_plan
    from astro_system.coordinates.iers_status import IersDataError
    def limited_window(*args):
        if args[3].month >= 7:
            raise IersDataError("out-of-coverage", {"valid_until_utc": "2024-07-01T00:00:00Z"})
        return {"classification": "unavailable"}
    with patch("astro_system.coordinates.constellation_observatory._plan_window", side_effect=limited_window):
        with pytest.raises(IersDataError) as caught:
            _annual_plan(None, None, None, Time("2024-01-01", scale="utc"), 80)
    assert caught.value.reason == "out-of-coverage"


@pytest.mark.parametrize("altitudes,sun,rises,sets,classification", [
    ([-10, 0, 60], -30, True, False, "favorable"),
    ([60, 0, -10], -30, False, True, "favorable"),
    ([60, 61, 60], -30, False, False, "favorable"),
    ([-60, -61, -60], -30, False, False, "unavailable"),
    ([60, 61, 60], 10, False, False, "unavailable"),
])
def test_adjacent_horizon_samples(altitudes, sun, rises, sets, classification):
    target = SimpleNamespace(dec=SimpleNamespace(deg=80), transform_to=lambda frame: SimpleNamespace(alt=SimpleNamespace(deg=np.array(altitudes))))
    solar = SimpleNamespace(transform_to=lambda frame: SimpleNamespace(alt=SimpleNamespace(deg=np.array([sun] * 3))))
    with patch("astro_system.coordinates.constellation_observatory.get_sun", return_value=solar), patch("astro_system.coordinates.constellation_observatory.require_iers_coverage"):
        result = _plan_window(EarthLocation.from_geodetic(0, 80), target, SkyCoord([], [], unit=u.deg), datetime(2024, 4, 8, tzinfo=timezone.utc), 720, 80)
    assert result["rises_in_window"] is rises
    assert result["sets_in_window"] is sets
    assert result["classification"] == classification
    assert result["circumpolar_state"] == "circumpolar"


def test_umi_circumpolar_endpoint_daily_and_annual():
    from astropy.utils import iers
    from fastapi.testclient import TestClient
    from astro_system.api.main import app
    # Definitive bundled B data have no predictive wall-clock expiry.
    with iers.earth_orientation_table.set(iers.IERS_B.open(iers.IERS_B_FILE)), TestClient(app) as client:
        response = client.post("/api/sky/constellations", json=dict(latitude_deg=80, longitude_deg=0, elevation_m=0, utc="2024-04-08T00:00:00Z", constellation="UMi"))
    assert response.status_code == 200
    planning = response.json()["planning"]
    assert len(planning["monthly"]) == 12
    for window in [planning["current_utc_day"], *planning["monthly"]]:
        assert window["circumpolar_state"] == "circumpolar"
        assert not window["rises_in_window"] and not window["sets_in_window"]
    assert any(not window["astronomical_night"] for window in planning["monthly"])
