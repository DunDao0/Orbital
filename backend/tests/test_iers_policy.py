from unittest.mock import patch

import numpy as np
import pytest
from astropy import units as u
from astropy.time import Time
from fastapi.testclient import TestClient

from astro_system.api.main import app
from astro_system.coordinates import iers_status


class LocalTable:
    meta = {"predictive_mjd": 61000.0}
    time_now = Time(61100, format="mjd")

    def __getitem__(self, key):
        assert key == "MJD"
        return np.array([60000, 62000]) * u.day

    def ut1_utc(self, times, return_status=False):
        return np.zeros(times.shape) * u.s, np.zeros(times.shape, dtype=int)

    def pm_xy(self, times, return_status=False):
        return np.zeros(times.shape) * u.arcsec, np.zeros(times.shape) * u.arcsec, np.zeros(times.shape, dtype=int)


@pytest.mark.parametrize("reason,table,moment", [
    ("missing", None, 60001),
    ("expired-prediction", LocalTable(), 61100),
    ("out-of-coverage", LocalTable(), 62001),
])
def test_iers_unavailable_is_scientific_error(reason, table, moment):
    from astro_system.coordinates.iers_status import IersDataError, require_iers_coverage
    with patch.object(iers_status.iers.earth_orientation_table, "get", return_value=table):
        with pytest.raises(IersDataError) as caught:
            require_iers_coverage(Time(moment, format="mjd"))
    assert caught.value.reason == reason


def test_observed_dates_remain_supported_when_predictions_expire():
    from astro_system.coordinates.iers_status import require_iers_coverage
    with patch.object(iers_status.iers.earth_orientation_table, "get", return_value=LocalTable()):
        require_iers_coverage(Time(60500, format="mjd"))


@pytest.mark.parametrize("mjd,accepted", [(59999.999, False), (60000, True), (61999.999, True), (62000, False)])
def test_iers_exact_interpolation_boundaries(mjd, accepted):
    table = LocalTable()
    table.meta = {}  # controlled observed-only fixture, independent of wall clock
    with patch.object(iers_status.iers.earth_orientation_table, "get", return_value=table):
        if accepted:
            iers_status.require_iers_coverage(Time(mjd, format="mjd"))
        else:
            with pytest.raises(iers_status.IersDataError):
                iers_status.require_iers_coverage(Time(mjd, format="mjd"))


def test_recent_predictions_and_incomplete_values():
    from astro_system.coordinates.iers_status import IersDataError, require_iers_coverage
    table = LocalTable()
    table.time_now = Time(61010, format="mjd")
    with patch.object(iers_status.iers.earth_orientation_table, "get", return_value=table):
        require_iers_coverage(Time(61020, format="mjd"))
        with patch.object(table, "ut1_utc", return_value=(np.nan * u.s, 0)):
            with pytest.raises(IersDataError, match="IERS") as caught:
                require_iers_coverage(Time(61020, format="mjd"))
        assert caught.value.reason == "incomplete"


def test_iers_status_warns_before_expiration_without_relaxing_policy():
    table = LocalTable()
    table.time_now = Time(61026, format="mjd")
    with patch.object(iers_status.iers.earth_orientation_table, "get", return_value=table):
        status = iers_status.current_iers_status()
        assert status["refresh_recommended"] is True
        assert status["prediction_usable_now"] is True
        assert status["prediction_expires_utc"] == Time(61030, format="mjd").isot + "Z"
        iers_status.require_iers_coverage(Time(61026, format="mjd"))
        table.time_now = Time(61031, format="mjd")
        assert iers_status.current_iers_status()["prediction_usable_now"] is False
        with pytest.raises(iers_status.IersDataError, match="IERS"):
            iers_status.require_iers_coverage(Time(61031, format="mjd"))
        iers_status.require_iers_coverage(Time(60500, format="mjd"))


def test_api_distinguishes_utc_iers_and_internal_failure():
    from astro_system.coordinates.iers_status import IersDataError
    body = dict(latitude_deg=-23.5505, longitude_deg=-46.6333, elevation_m=760, utc="2026-08-05T00:00:00Z")
    with TestClient(app, raise_server_exceptions=False) as client:
        invalid = client.post("/api/sky", json={**body, "utc": "not-a-date"})
        with patch("astro_system.api.main.local_sky", side_effect=IersDataError("expired-prediction", {"source": "fixture"})):
            unavailable = client.post("/api/sky", json=body)
        with patch("astro_system.api.main.local_sky", side_effect=ValueError("private sentinel")):
            internal = client.post("/api/sky", json=body)
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"
    assert unavailable.status_code == 503
    assert unavailable.json()["error"]["code"] == "IERS_DATA_UNAVAILABLE"
    assert unavailable.json()["error"]["details"]["reason"] == "expired-prediction"
    assert internal.status_code == 500
    assert internal.json()["error"]["code"] == "INTERNAL_ERROR"
    assert "private sentinel" not in internal.text


@pytest.mark.parametrize("utc", ["08/05/2026", "2026-08-05", "2026-08-05T24:00:00Z", "2026-02-30T00:00:00Z", "2026-08-05T00:00:00+00:60"])
def test_native_rejects_formats_rejected_by_fixed_snapshot(utc):
    from astro_system.ephemeris.time_conversion import InvalidUtcError, epoch_metadata
    with pytest.raises(InvalidUtcError):
        epoch_metadata(utc)


@pytest.mark.parametrize("utc", ["2026-08-04T21:00:00-03:00", "2026-08-05T05:30:00+05:30", "2026-08-05T00:00:00.000000Z", "2026-08-05T00:00:00", "2026-08-05T00:00:00z"])
def test_native_equivalent_offsets(utc):
    from astro_system.ephemeris.time_conversion import epoch_metadata
    assert epoch_metadata(utc).canonical_utc == "2026-08-05T00:00:00.000Z"
