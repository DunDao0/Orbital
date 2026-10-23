import httpx
import pytest
from fastapi.testclient import TestClient

from astro_system.api import main
from astro_system.api.services import create_app


def test_roles_reject_unknown_role():
    with pytest.raises(ValueError):
        create_app("unknown")


def test_science_does_not_load_kernels(monkeypatch):
    def forbidden(*args):
        raise AssertionError("Science process must not initialize orbital kernels")
    monkeypatch.setattr(main, "ApplicationEphemerisProvider", forbidden)
    def offline(request):
        raise httpx.ConnectError("offline")
    with TestClient(create_app("science", transport=httpx.MockTransport(offline))) as client:
        assert client.get("/api/health").json()["role"] == "science"
        result = client.get("/api/reference/state")
        assert result.status_code == 503
        assert result.json()["error"]["code"] == "ORBITAL_UNAVAILABLE"
        caps = client.get("/api/capabilities").json()["capabilities"]
        assert caps["sky"]["available"] is True
        assert caps["reference_state"]["available"] is False
        assert caps["reference_state"]["mode"] == "unavailable"
        assert caps["catalogs"]["stars"] is False
        assert client.get("/api/health/ready").status_code == 503
        assert client.post("/api/sky", json={}).status_code == 422
        sky = client.post("/api/sky", json={
            "latitude_deg": 0, "longitude_deg": 0, "elevation_m": 0,
            "utc": "2024-04-08T18:00:00Z",
        })
        assert sky.status_code == 200
        assert sky.json()["objects"]


def test_orbital_has_no_observer_routes():
    with TestClient(create_app("orbital")) as client:
        assert client.post("/api/sky", json={}).status_code == 404
        caps = client.get("/api/capabilities").json()
        assert caps["capabilities"]["sky"]["available"] is False
        assert client.get("/api/reference/state").status_code == 200


def test_gateway_preserves_real_state_and_simulation():
    orbital = create_app("orbital")
    with TestClient(orbital) as direct:
        with TestClient(create_app("science", transport=httpx.ASGITransport(app=orbital))) as gateway:
            params = {"utc": "2024-04-08T18:00:00Z", "bodies": "Sun,Earth,Moon"}
            expected = direct.get("/api/reference/state", params=params).json()
            result = gateway.get("/api/reference/state", params=params, headers={"X-Request-ID": "test-state"})
            actual = result.json()
            assert result.status_code == 200
            assert actual.pop("meta")["request_id"] == "test-state"
            expected.pop("meta")
            assert actual == expected
            simulation = gateway.post("/api/simulate", json={"duration_s": 3600, "step_s": 600})
            assert simulation.status_code == 200
            assert gateway.get("/api/health/ready").status_code == 200
            assert gateway.options("/api/simulate").status_code == 204


@pytest.mark.parametrize("status,code", [(501, "NOT_IMPLEMENTED"), (429, "SIMULATION_BUSY"), (422, "EPHEMERIS_OUT_OF_COVERAGE")])
def test_gateway_preserves_errors_without_retry_or_fallback(status, code):
    calls = []
    def handler(request):
        calls.append(request)
        assert "authorization" not in request.headers
        assert "cookie" not in request.headers
        return httpx.Response(status, json={"schema_version": 1, "error": {
            "code": code, "message": "Unavailable", "request_id": request.headers["X-Request-ID"],
        }}, headers={"Retry-After": "1"})
    with TestClient(create_app("science", transport=httpx.MockTransport(handler))) as client:
        result = client.post("/api/simulate", json={}, headers={"Authorization": "ignored", "Cookie": "ignored"})
        assert result.status_code == status
        assert result.json()["error"]["code"] == code
        assert result.headers["Retry-After"] == "1"
        assert len(calls) == 1


@pytest.mark.parametrize("mode,expected", [("timeout", 504), ("html", 502), ("redirect", 502)])
def test_gateway_rejects_invalid_upstream(mode, expected):
    def handler(request):
        if mode == "timeout":
            raise httpx.ReadTimeout("internal detail")
        return httpx.Response(302 if mode == "redirect" else 200, text="internal detail")
    with TestClient(create_app("science", transport=httpx.MockTransport(handler))) as client:
        result = client.get("/api/reference/state")
        assert result.status_code == expected
        assert "internal detail" not in result.text


def test_gateway_rejects_large_body_before_forwarding():
    def handler(request):
        raise AssertionError("Must not forward oversized payload")
    with TestClient(create_app("science", transport=httpx.MockTransport(handler))) as client:
        assert client.post("/api/simulate", content="x" * 65537).status_code == 413


def test_gateway_rejects_envelope_without_physical_payload():
    def handler(request):
        return httpx.Response(200, json={"schema_version": 1, "meta": {
            "request_id": request.headers["X-Request-ID"], "generated_at_utc": "2024-01-01T00:00:00Z",
            "service": "native", "software_version": "test", "capability": "reference_state"}})
    with TestClient(create_app("science", transport=httpx.MockTransport(handler))) as client:
        assert client.get("/api/reference/state").status_code == 502


def test_timeout_does_not_retry_post_and_next_call_recovers():
    calls = []
    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ReadTimeout("private details")
        return httpx.Response(501, json={"schema_version": 1, "error": {
            "request_id": request.headers["X-Request-ID"], "code": "NOT_IMPLEMENTED", "message": "Not available"}})
    with TestClient(create_app("science", transport=httpx.MockTransport(handler))) as client:
        assert client.post("/api/simulate", json={}).status_code == 504
        assert len(calls) == 1
        assert client.post("/api/simulate", json={}).status_code == 501
        assert len(calls) == 2
