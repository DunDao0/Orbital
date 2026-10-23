from concurrent.futures import ThreadPoolExecutor
import json
import logging
from pathlib import Path
import sys
from threading import Event
from unittest.mock import patch

import httpx
import numpy as np
import pytest
from astropy.time import Time
from fastapi.testclient import TestClient

from astro_system.api.services import create_app
from astro_system.coordinates.iers_status import IersDataError, require_iers_coverage
from astro_system.data_integrity import iers_bundle_status

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.service_pair import service_pair


def test_live_http_down_and_recovery():
    with service_pair() as pair, httpx.Client(base_url=pair.base, timeout=30, trust_env=False) as client:
        first = client.get("/api/reference/state", headers={"X-Request-ID": "network-test"})
        assert first.status_code == 200
        assert first.json()["meta"]["request_id"] == "network-test"
        assert client.post("/api/simulate", json={"duration_s": 600, "step_s": 600}).status_code == 200
        pair.stop("orbital")
        assert client.get("/api/reference/state").status_code == 503
        assert client.get("/api/health").status_code == 200
        assert client.get("/api/health/ready").status_code == 503
        assert client.post("/api/sky", json={"latitude_deg": 0, "longitude_deg": 0,
            "utc": "2024-04-08T18:00:00Z"}).status_code == 200
        pair.start("orbital")
        assert client.get("/api/health/ready").status_code == 200
        recovered = client.get("/api/reference/state").json()
        assert first.json()["bodies"] == recovered["bodies"]


def test_science_saturation_and_release(monkeypatch):
    entered, release = Event(), Event()
    from astro_system.api import main
    original = main.local_sky
    def slow(*args, **kwargs):
        entered.set()
        assert release.wait(10)
        return original(*args, **kwargs)
    monkeypatch.setattr(main, "local_sky", slow)
    body = {"latitude_deg": 0, "longitude_deg": 0, "utc": "2024-04-08T18:00:00Z"}
    with TestClient(create_app("science")) as client, ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(client.post, "/api/sky", json=body)
        try:
            assert entered.wait(10)
            busy = client.post("/api/sky", json=body)
            assert busy.status_code == 429
            assert busy.json()["error"]["code"] == "SCIENCE_BUSY"
            assert client.get("/api/health").status_code == 200
        finally:
            release.set()
        assert pending.result().status_code == 200
        assert client.post("/api/sky", json=body).status_code == 200


def test_iers_integrity_failure_is_explicit():
    assert iers_bundle_status()["integrity"] == "verified"
    with patch("astro_system.data_integrity._digest", return_value="corrupted"):
        with pytest.raises(IersDataError) as error:
            require_iers_coverage(Time("2024-04-08", scale="utc"))
        assert error.value.reason == "integrity-failed"
        with TestClient(create_app("science")) as client:
            response = client.post("/api/sky", json={"latitude_deg": 0, "longitude_deg": 0, "utc": "2024-04-08T18:00:00Z"})
            assert response.status_code == 503


@pytest.mark.parametrize("latitude", [-90, 90])
def test_poles_have_finite_geometric_coordinates(latitude):
    with TestClient(create_app("science")) as client:
        response = client.post("/api/sky", json={"latitude_deg": latitude, "longitude_deg": 0, "utc": "2024-04-08T18:00:00Z"})
    assert response.status_code == 200
    assert all(np.isfinite(item["altitude_deg"]) and np.isfinite(item["azimuth_deg"]) for item in response.json()["objects"])


def test_structured_logs_exclude_private_content(caplog):
    caplog.set_level(logging.INFO, logger="astro_system.api")
    with TestClient(create_app("science")) as client:
        client.post("/api/sky", json={"private": "secret-123"}, headers={"Authorization": "secret-token"})
        client.get("/secret-coordinate-123")
    records = [json.loads(record.message) for record in caplog.records if record.name == "astro_system.api"]
    assert records
    assert all({"request_id", "service", "operation", "status", "duration_ms", "error_category"} <= record.keys() for record in records)
    serialized = json.dumps(records)
    assert "secret" not in serialized
    assert records[0]["error_category"] == "VALIDATION_ERROR"
