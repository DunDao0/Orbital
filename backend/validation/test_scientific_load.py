"""Explicit bounded load checks; not part of routine tests/ collection.

Run in science-tests, never against the user's running HTTP API.
These check repeatability and capacity boundaries, not ephemeris accuracy.
"""
from concurrent.futures import ThreadPoolExecutor
import math
from pathlib import Path
import time

from fastapi.testclient import TestClient

from astro_system.api.main import DEFAULT_BODIES, MAX_SIMULATION_STEPS
from astro_system.api.services import create_app
from astro_system.ephemeris import ApplicationEphemerisProvider


def test_concurrent_reference_repeatability():
    provider = ApplicationEphemerisProvider(Path(__file__).resolve().parents[2] / "data")
    assert provider.available
    try:
        expected = provider.state(DEFAULT_BODIES, "2024-04-08T18:00:00Z")
        started = time.perf_counter()
        with ThreadPoolExecutor(max_workers=4) as pool:
            states = list(pool.map(
                lambda _: provider.state(DEFAULT_BODIES, "2024-04-08T18:00:00Z"), range(128)))
        assert all(state.position_m == expected.position_m and
                   state.velocity_m_s == expected.velocity_m_s for state in states)
        assert provider.provider.load_count == 1
        print(f"128 reference requests / 4 threads: {time.perf_counter() - started:.3f}s")
    finally:
        provider.close()


def test_maximum_supported_integration_load():
    with TestClient(create_app("orbital")) as client:
        started = time.perf_counter()
        response = client.post("/api/simulate", json={
            "utc": "2024-04-08T18:00:00Z", "bodies": list(DEFAULT_BODIES),
            "duration_s": MAX_SIMULATION_STEPS, "step_s": 1,
        })
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["execution"]["steps"] == MAX_SIMULATION_STEPS
        assert len(payload["state"]["bodies"]) == 10
        for body in payload["state"]["bodies"]:
            assert all(math.isfinite(value) for value in body["position_m"] + body["velocity_m_s"])
        assert all(value is None or math.isfinite(value) for value in payload["metrics"]["drift"].values())
        print(f"10 bodies / {MAX_SIMULATION_STEPS} steps: {time.perf_counter() - started:.3f}s")
