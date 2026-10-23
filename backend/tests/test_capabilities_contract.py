"""Complete capability declarations and exact JSON schema-version contracts."""
from copy import deepcopy
import json
import logging

from fastapi.testclient import TestClient
import httpx
import pytest
from pydantic import ValidationError

from astro_system.api import main
from astro_system.api.contracts import (
    GenericScienceResponse, OrbitalCapabilitiesResponse, OrbitalResponse, ReferenceBody, ScienceErrorEnvelope,
)
from astro_system.api.services import MAX_ORBITAL_JSON_DEPTH, _strict_json_payload, create_app

META = {
    "request_id": "contract-test", "generated_at_utc": "2026-10-20T12:00:00Z",
    "service": "native", "software_version": "test", "capability": "capabilities",
}


@pytest.mark.parametrize("model", [GenericScienceResponse, OrbitalResponse, ScienceErrorEnvelope])
@pytest.mark.parametrize("version", [True, False, 1.0, "1", 0, 2, None, "missing"])
def test_wire_schema_version_is_a_required_exact_integer(model, version):
    payload = {"meta": META, "error": {"code": "NOT_IMPLEMENTED", "message": "Unavailable",
                                      "request_id": "contract-test"}}
    if version != "missing":
        payload["schema_version"] = version
    with pytest.raises(ValidationError):
        model.model_validate(payload)
    payload["schema_version"] = 1
    assert model.model_validate(payload).schema_version == 1


def test_zero_center_identifier_does_not_accept_a_boolean():
    body = {
        "name": "Earth", "naif_id": 399, "body_naif_id": 399, "mu_m3_s2": 1.0,
        "position_m": [1.0, 2.0, 3.0], "velocity_m_s": [1.0, 2.0, 3.0],
        "state_target_naif_id": 399, "state_kind": "physical-center", "state_center_naif_id": False,
        "state_target_name": "Earth", "radius_m": 1.0, "color": "#ffffff",
    }
    with pytest.raises(ValidationError):
        ReferenceBody.model_validate(body)
    body["state_center_naif_id"] = 0
    ReferenceBody.model_validate(body)


@pytest.fixture(scope="module")
def valid_orbital_capabilities():
    with TestClient(create_app("orbital")) as client:
        response = client.get("/api/capabilities")
    assert response.status_code == 200
    payload = response.json()
    OrbitalCapabilitiesResponse.model_validate(payload)
    return payload


@pytest.fixture(scope="module")
def valid_orbital_simulation():
    with TestClient(create_app("orbital")) as client:
        response = client.post("/api/simulate", json={})
    assert response.status_code == 200
    return response.json()


def _transport(payload, status=200):
    def handler(request):
        result = deepcopy(payload)
        target = result["meta"] if status == 200 else result["error"]
        target["request_id"] = request.headers["X-Request-ID"]
        return httpx.Response(status, json=result)
    return httpx.MockTransport(handler)


@pytest.mark.parametrize("factory", [lambda: main.app, lambda: create_app("orbital")])
def test_native_capabilities_follow_the_complete_contract(factory):
    with TestClient(factory()) as client:
        response = client.get("/api/capabilities")
    payload = OrbitalCapabilitiesResponse.model_validate(response.json())
    assert payload.meta.capability == "capabilities"
    assert payload.capabilities.sky_constellations.canonical_method == "POST"


@pytest.mark.parametrize("mutation", [
    "partial", "snapshot", "limits", "status", "mode", "catalogue_flags",
    "simulate_limits", "reference_limits", "negative_limit", "boolean_limit",
    "missing_observatory", "unavailable_reference_mode", "missing_snapshot_provenance",
    "reversed_coverage", "schema_bool", "schema_missing",
])
def test_invalid_orbital_capabilities_degrade_without_false_readiness(valid_orbital_capabilities, mutation):
    payload = deepcopy(valid_orbital_capabilities)
    caps = payload["capabilities"]
    if mutation == "partial":
        payload.update(snapshot={}, limits={}, capabilities={
            name: {"available": True} for name in ("reference_state", "simulate", "catalogs")})
    elif mutation == "snapshot":
        payload["snapshot"] = {}
    elif mutation == "limits":
        payload["limits"] = {}
    elif mutation == "status":
        caps["reference_state"]["status"] = "unavailable"
    elif mutation == "mode":
        caps["reference_state"]["mode"] = "unavailable"
    elif mutation == "catalogue_flags":
        caps["catalogs"]["stars"] = False
    elif mutation == "simulate_limits":
        del payload["limits"]["simulate"]
    elif mutation == "reference_limits":
        payload["limits"]["reference_state"] = {"valid_utc_from": None, "valid_utc_until": None}
    elif mutation == "negative_limit":
        payload["limits"]["simulate"]["max_steps"] = -1
    elif mutation == "boolean_limit":
        payload["limits"]["request_body_bytes"] = True
    elif mutation == "missing_observatory":
        del caps["sky_constellations"]
    elif mutation == "unavailable_reference_mode":
        caps["reference_state"].update(available=False, status="unavailable", mode="dynamic-de442s")
    elif mutation == "missing_snapshot_provenance":
        payload["snapshot"] = {"available": True, "fixed_epoch": True}
    elif mutation == "reversed_coverage":
        payload["limits"]["reference_state"] = {
            "valid_utc_from": "2027-01-01T00:00:00Z", "valid_utc_until": "2024-01-01T00:00:00Z"}
    elif mutation == "schema_bool":
        payload["schema_version"] = True
    elif mutation == "schema_missing":
        del payload["schema_version"]
    with TestClient(create_app("science", transport=_transport(payload))) as client:
        result = client.get("/api/capabilities")
        ready = client.get("/api/health/ready")
        assert client.get("/api/health").status_code == 200
    assert result.status_code == 200  # Installed local capabilities remain inspectable.
    contract = OrbitalCapabilitiesResponse.model_validate(result.json())
    assert not contract.capabilities.reference_state.available
    assert not contract.capabilities.simulate.available
    assert contract.capabilities.sky.available
    assert contract.capabilities.sky_constellations.available
    assert contract.limits.reference_state is None and contract.limits.simulate is None
    assert ready.status_code == 503 and ready.json()["ready"] is False


def test_gateway_complete_capabilities_preserve_orbital_fields(valid_orbital_capabilities):
    with TestClient(create_app("science", transport=_transport(valid_orbital_capabilities))) as client:
        response = client.get("/api/capabilities")
        assert client.get("/api/health/ready").status_code == 200
    payload = response.json()
    OrbitalCapabilitiesResponse.model_validate(payload)
    for key in ("snapshot", "limits"):
        assert payload[key] == valid_orbital_capabilities[key]
    for key in ("reference_state", "catalogs", "simulate"):
        assert payload["capabilities"][key] == valid_orbital_capabilities["capabilities"][key]


def test_gateway_simulation_unavailable_prevents_full_readiness(valid_orbital_capabilities):
    payload = deepcopy(valid_orbital_capabilities)
    payload["capabilities"]["simulate"].update(available=False, status="unavailable")
    with TestClient(create_app("science", transport=_transport(payload))) as client:
        assert client.get("/api/health/ready").status_code == 503
        assert client.get("/api/capabilities").json()["capabilities"]["reference_state"]["available"]


@pytest.mark.parametrize("version", [True, 1.0, "1", None, "missing"])
def test_malformed_501_envelopes_are_rejected_not_normalized(version):
    payload = {"error": {"code": "NOT_IMPLEMENTED", "message": "Unavailable", "request_id": "unused"}}
    if version != "missing":
        payload["schema_version"] = version
    with TestClient(create_app("science", transport=_transport(payload, 501))) as client:
        response = client.post("/api/simulate", json={})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "ORBITAL_INVALID_RESPONSE"


def test_valid_501_envelope_bytes_are_preserved_without_retry():
    calls = []

    def handler(request):
        response = httpx.Response(501, json={"schema_version": 1, "error": {
            "code": "NOT_IMPLEMENTED", "message": "Unavailable",
            "request_id": request.headers["X-Request-ID"]}})
        calls.append(response.content)
        return response

    with TestClient(create_app("science", transport=httpx.MockTransport(handler))) as client:
        response = client.post("/api/simulate", json={})
    assert response.status_code == 501 and calls == [response.content]


@pytest.mark.parametrize("status", [200, 501])
@pytest.mark.parametrize("total_depth", [
    MAX_ORBITAL_JSON_DEPTH - 1, MAX_ORBITAL_JSON_DEPTH, MAX_ORBITAL_JSON_DEPTH + 1, 10_000,
])
def test_orbital_json_depth_boundary_is_portable_and_preserves_valid_bytes(
        status, total_depth, caplog, valid_orbital_simulation):
    calls = []
    sentinel = "private-deep-upstream-content"
    # The extension is below the root for success, or root/error/details for 501.
    depth = total_depth - (1 if status == 200 else 3)
    nested = "[" * depth + json.dumps(sentinel) + "]" * depth
    caplog.set_level(logging.INFO, logger="astro_system.api")

    def handler(request):
        if status == 200:
            payload = deepcopy(valid_orbital_simulation)
            payload["meta"]["request_id"] = request.headers["X-Request-ID"]
            payload["additional_metadata"] = "nested-placeholder"
        else:
            payload = {"schema_version": 1, "error": {
                "code": "NOT_IMPLEMENTED", "message": "Unavailable",
                "request_id": request.headers["X-Request-ID"],
                "details": {"nested": "nested-placeholder"},
            }}
        content = json.dumps(payload).replace('"nested-placeholder"', nested).encode("utf-8")
        calls.append(content)
        return httpx.Response(status, content=content, headers={"Content-Type": "application/json"})

    with TestClient(create_app("science", transport=httpx.MockTransport(handler))) as client:
        response = client.post("/api/simulate", json={}, headers={"X-Request-ID": "deep-json-test"})
    if total_depth <= MAX_ORBITAL_JSON_DEPTH:
        assert response.status_code == status
        assert response.content == calls[0]  # No normalization or reserialization.
    else:
        assert response.status_code == 502
        assert response.json()["error"]["code"] == "ORBITAL_INVALID_RESPONSE"
        assert response.json()["error"]["request_id"] == "deep-json-test"
        assert sentinel not in response.text
    assert response.headers["X-Request-ID"] == "deep-json-test"
    assert sentinel not in caplog.text
    assert "RecursionError" not in response.text + caplog.text
    assert len(calls) == 1


@pytest.mark.parametrize("container", ["array", "object"])
@pytest.mark.parametrize("depth", [MAX_ORBITAL_JSON_DEPTH, MAX_ORBITAL_JSON_DEPTH + 1])
def test_json_depth_counts_arrays_and_objects_at_the_same_explicit_boundary(container, depth):
    prefix, suffix = ("[", "]") if container == "array" else ('{"nested":', "}")
    content = (prefix * depth + "null" + suffix * depth).encode("utf-8")
    if depth > MAX_ORBITAL_JSON_DEPTH:
        with pytest.raises(ValueError, match="JSON nesting"):
            _strict_json_payload(content)
    else:
        result = _strict_json_payload(content)
        assert isinstance(result, list if container == "array" else dict)


@pytest.mark.parametrize("role", ["monolith", "science"])
@pytest.mark.parametrize("state", ["missing", "unverified", "expired"])
def test_iers_prerequisites_are_consistent_and_date_coverage_is_not_overpromised(
    monkeypatch, valid_orbital_capabilities, role, state,
):
    status = {
        "source": "IERS_Auto", "mode": "offline", "status": "degraded",
        "bundle": {"integrity": "verified"},
        "valid_from_utc": "1973-01-02T00:00:00Z", "valid_until_utc": "2027-01-01T00:00:00Z",
        "prediction_usable_now": False,
    }
    if state == "missing":
        del status["valid_until_utc"]
    elif state == "unverified":
        status["bundle"]["integrity"] = "failed"
    monkeypatch.setattr(main, "current_iers_status", lambda: deepcopy(status))
    application = main.app if role == "monolith" else create_app(
        "science", transport=_transport(valid_orbital_capabilities))
    with TestClient(application) as client:
        response = client.get("/api/capabilities")
        ready = client.get("/api/health/ready")
        assert client.get("/api/health").status_code == 200
    payload = OrbitalCapabilitiesResponse.model_validate(response.json())
    for capability in (payload.capabilities.sky, payload.capabilities.sky_constellations,
                       payload.capabilities.eclipses_local):
        assert capability.available == (state == "expired")
        assert capability.status == ("degraded" if state == "expired" else "unavailable")
        assert capability.requires_valid_iers_for_requested_epoch
    assert ready.status_code == (200 if state == "expired" else 503)
    assert ready.json()["coverage_is_request_specific"] is True
    if role == "monolith" and state != "expired":
        assert {"sky", "sky_constellations", "eclipses_local"} <= set(ready.json()["unavailable_capabilities"])


def test_orbital_capabilities_and_readiness_do_not_require_iers(monkeypatch):
    def forbidden():
        raise AssertionError("Orbital capabilities do not depend on IERS")
    monkeypatch.setattr(main, "current_iers_status", forbidden)
    with TestClient(create_app("orbital")) as client:
        response = client.get("/api/capabilities")
        assert client.get("/api/health/ready").status_code == 200
    payload = OrbitalCapabilitiesResponse.model_validate(response.json())
    assert not payload.capabilities.sky.available
    assert not payload.capabilities.sky_constellations.available
