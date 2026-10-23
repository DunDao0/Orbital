"""Request-boundary and private-gateway regressions; no public network needed."""
import asyncio
from copy import deepcopy
import json
import logging
from threading import BoundedSemaphore
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
import httpx
import pytest
from starlette.responses import JSONResponse

from astro_system.api import main
from astro_system.api.contracts import MoonRecord, StarRecord
from astro_system.api.services import create_app


@pytest.mark.parametrize("body,code", [
    ({"duration_s": 31_536_000, "step_s": 5e-324}, "SIMULATION_STEP_LIMIT_EXCEEDED"),
    ({"duration_s": 1e-12, "step_s": 86_400}, "SIMULATION_DURATION_STEP_MISMATCH"),
    ({"duration_s": -1e-12, "step_s": 86_400}, "SIMULATION_DURATION_STEP_MISMATCH"),
    ({"duration_s": 5e-324, "step_s": 86_400}, "SIMULATION_DURATION_STEP_MISMATCH"),
])
def test_simulation_numeric_boundaries_are_client_errors(body, code):
    with TestClient(create_app("orbital")) as client:
        response = client.post("/api/simulate", json=body)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code
    assert response.headers["X-Request-ID"] == response.json()["error"]["request_id"]


def _exercise_body_chunks(chunks, content_length=None):
    received = []
    forwarded = []
    messages = []
    application = FastAPI()

    async def receive():
        index = len(received)
        if index >= len(chunks):
            return {"type": "http.disconnect"}
        received.append(chunks[index])
        return {"type": "http.request", "body": chunks[index], "more_body": index + 1 < len(chunks)}

    async def endpoint(scope, body_receive, send):
        while True:
            message = await body_receive()
            forwarded.append(message["body"])
            if not message.get("more_body", False):
                break
        await JSONResponse({"bytes": sum(map(len, forwarded))})(scope, body_receive, send)

    async def send(message):
        messages.append(message)

    headers = [] if content_length is None else [(b"content-length", str(content_length).encode("latin-1"))]
    scope = {"type": "http", "http_version": "1.1", "method": "POST",
             "path": "/api/simulate", "raw_path": b"/api/simulate", "query_string": b"",
             "scheme": "http", "server": ("localhost", 8000), "client": ("127.0.0.1", 1),
             "headers": headers, "app": application}
    asyncio.run(main.RequestContextMiddleware(endpoint)(scope, receive, send))
    return received, forwarded, messages


def test_chunked_body_stops_receiving_as_soon_as_limit_is_crossed():
    received, forwarded, messages = _exercise_body_chunks([b"x" * 16_384] * 64)
    assert len(received) == 5  # 80 KiB observed, not the full 1 MiB upload.
    assert not forwarded
    assert messages[0]["status"] == 413
    assert json.loads(messages[1]["body"])["error"]["code"] == "REQUEST_BODY_TOO_LARGE"


def test_exact_body_limit_is_replayed_byte_for_byte():
    chunks = [b"a" * 32_768, b"b" * 32_768]
    received, forwarded, messages = _exercise_body_chunks(chunks)
    assert received == chunks
    assert b"".join(forwarded) == b"".join(chunks)
    assert messages[0]["status"] == 200
    assert json.loads(messages[1]["body"])["bytes"] == 65_536


def test_declared_oversized_body_is_not_received_or_forwarded():
    received, forwarded, messages = _exercise_body_chunks([b"x"], content_length=65_537)
    assert not received and not forwarded
    assert messages[0]["status"] == 413


@pytest.mark.parametrize("content_length,status", [
    ("9" * 5000, 413), ("-1", 400), ("not-an-integer", 400), ("\u00b2", 400),
])
def test_malformed_or_enormous_content_length_is_not_a_server_error(content_length, status):
    received, forwarded, messages = _exercise_body_chunks([b"x"], content_length=content_length)
    assert not received and not forwarded
    assert messages[0]["status"] == status


@pytest.mark.parametrize("role", ["science", "orbital"])
def test_internal_errors_keep_correlation_cors_and_private_structured_log(role, caplog):
    caplog.set_level(logging.INFO, logger="astro_system.api")
    application = create_app(role)

    @application.get("/api/audit-crash")
    def fail():
        raise RuntimeError("private-observer-and-credential-value")

    headers = {"X-Request-ID": "audit-internal-error", "Origin": "http://localhost:3000"}
    with TestClient(application) as client:
        response = client.get("/api/audit-crash", headers=headers)
        oversized = client.post("/api/simulate", content=b"x" * 65_537, headers=headers)
    for result, status in ((response, 500), (oversized, 413)):
        assert result.status_code == status
        assert result.headers["X-Request-ID"] == "audit-internal-error"
        assert result.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
        assert result.headers["Cache-Control"] == "private, no-store"
        assert result.json()["error"]["request_id"] == "audit-internal-error"
    records = [json.loads(record.message) for record in caplog.records if record.name == "astro_system.api"]
    failure = next(record for record in records if record.get("status") == 500)
    assert failure["operation"] == "/api/audit-crash"
    assert failure["error_category"] == "INTERNAL_ERROR"
    assert failure["duration_ms"] >= 0
    assert "private-observer-and-credential-value" not in json.dumps(records) + response.text


def test_science_slot_is_held_until_the_entire_response_finishes():
    async def exercise():
        response_started, finish = asyncio.Event(), asyncio.Event()
        semaphore = BoundedSemaphore(1)
        application = SimpleNamespace(state=SimpleNamespace(science_semaphore=semaphore))

        async def endpoint(scope, receive, send):
            await send({"type": "http.response.start", "status": 200, "headers": []})
            response_started.set()
            await finish.wait()
            await send({"type": "http.response.body", "body": b"{}", "more_body": False})

        async def receive():
            return {"type": "http.request", "body": b"{}", "more_body": False}

        async def send(message):
            pass

        scope = {"type": "http", "http_version": "1.1", "method": "POST",
                 "path": "/api/sky", "raw_path": b"/api/sky", "query_string": b"",
                 "scheme": "http", "server": ("localhost", 8000), "client": ("127.0.0.1", 1),
                 "headers": [], "app": application}
        task = asyncio.create_task(main.RequestContextMiddleware(endpoint)(scope, receive, send))
        await response_started.wait()
        assert not semaphore.acquire(blocking=False)
        finish.set()
        await task
        assert semaphore.acquire(blocking=False)
        semaphore.release()

    asyncio.run(exercise())


@pytest.fixture(scope="module")
def real_orbital_payloads():
    with TestClient(create_app("orbital")) as client:
        payloads = {
            "/api/reference/state": client.get("/api/reference/state").json(),
            "/api/simulate": client.post("/api/simulate", json={}).json(),
        }
        for path in ("/api/catalogs/moons", "/api/catalogs/stars", "/api/catalogs/constellations"):
            response = client.get(path)
            assert response.status_code == 200
            payloads[path] = response.json()
    return payloads


def _gateway_result(path, payload, *, params=None):
    recorded = []

    def handler(request):
        returned = deepcopy(payload)
        returned["meta"]["request_id"] = request.headers["X-Request-ID"]
        response = httpx.Response(200, json=returned)
        recorded.append(response.content)
        return response

    with TestClient(create_app("science", transport=httpx.MockTransport(handler))) as client:
        result = client.post(path, json={}) if path == "/api/simulate" else client.get(path, params=params)
    assert len(recorded) == 1
    return result, recorded[0]


@pytest.mark.parametrize("path", [
    "/api/reference/state", "/api/simulate", "/api/catalogs/moons",
    "/api/catalogs/stars", "/api/catalogs/constellations",
])
def test_gateway_preserves_valid_scientific_payload_bytes(path, real_orbital_payloads):
    response, original_bytes = _gateway_result(path, real_orbital_payloads[path])
    assert response.status_code == 200, response.text
    assert response.content == original_bytes


@pytest.mark.parametrize("token", ["NaN", "Infinity", "-Infinity", "1e999", '{"same":1,"same":2}'])
@pytest.mark.parametrize("status", [200, 501])
def test_gateway_rejects_nonstandard_or_ambiguous_json_even_in_unmodeled_fields(
        token, status, real_orbital_payloads):
    calls = []

    def handler(request):
        calls.append(request)
        if status == 200:
            payload = deepcopy(real_orbital_payloads["/api/reference/state"])
            payload["meta"]["request_id"] = request.headers["X-Request-ID"]
            payload["additional_metadata"] = "invalid-json-placeholder"
        else:
            payload = {"schema_version": 1, "error": {
                "code": "NOT_IMPLEMENTED", "message": "Unavailable",
                "request_id": request.headers["X-Request-ID"],
                "details": {"invalid": "invalid-json-placeholder"},
            }}
        content = json.dumps(payload).replace('"invalid-json-placeholder"', token).encode("utf-8")
        return httpx.Response(status, content=content, headers={"Content-Type": "application/json"})

    with TestClient(create_app("science", transport=httpx.MockTransport(handler))) as client:
        result = client.get("/api/reference/state") if status == 200 else client.post("/api/simulate", json={})
    assert result.status_code == 502
    assert result.json()["error"]["code"] == "ORBITAL_INVALID_RESPONSE"
    assert len(calls) == 1  # Invalid upstream POSTs are never replayed.


def test_catalogue_contracts_preserve_all_existing_metadata():
    for path, key, model in [
        (main.DATA_ROOT / "moons/moons.json", "moons", MoonRecord),
        (main.DATA_ROOT / "stars/gaia_bright.json", "stars", StarRecord),
    ]:
        for item in json.loads(path.read_text(encoding="utf-8"))[key]:
            model.model_validate(item)


@pytest.mark.parametrize("path,field,value", [
    ("/api/reference/state", ("epoch",), None),
    ("/api/reference/state", ("epoch_metadata",), {}),
    ("/api/reference/state", ("epoch_metadata", "ephemeris_time_et_s"), 0),
    ("/api/reference/state", ("frame",), ""),
    ("/api/reference/state", ("source",), ""),
    ("/api/reference/state", ("bodies", 0, "mu_m3_s2"), -1),
    ("/api/reference/state", ("bodies", 0, "name"), "Earth"),
    ("/api/reference/state", ("bodies", 0, "state_target_naif_id"), 399),
    ("/api/reference/state", ("bodies", 0, "velocity_m_s"), [True, 0, 0]),
    ("/api/reference/state", ("meta", "capability"), "wrong"),
    ("/api/reference/state", ("meta", "generated_at_utc"), "not-a-date"),
    ("/api/simulate", ("state", "epoch_utc"), "2000-01-01T00:00:00Z"),
    ("/api/simulate", ("state", "bodies", 0, "source_initial_state"), ""),
    ("/api/simulate", ("execution", "steps"), 0),
    ("/api/simulate", ("execution", "integrated_duration_s"), 0),
    ("/api/simulate", ("metrics", "initial", "linear_momentum"), [0]),
    ("/api/catalogs/moons", ("items",), [{}]),
    ("/api/catalogs/moons", ("items", 0, "position_m"), [1, 2, 3]),
    ("/api/catalogs/moons", ("provenance",), ""),
    ("/api/catalogs/stars", ("items", 0, "ra_deg"), 400),
    ("/api/catalogs/stars", ("returned",), 0),
    ("/api/catalogs/constellations", ("items", 0, "iau_abbreviation"), "Bad"),
    ("/api/catalogs/constellations", ("abbreviations",), ["And"] * 88),
])
def test_gateway_rejects_partial_or_inconsistent_scientific_data(path, field, value, real_orbital_payloads):
    payload = deepcopy(real_orbital_payloads[path])
    target = payload
    for part in field[:-1]:
        target = target[part]
    target[field[-1]] = value
    response, _ = _gateway_result(path, payload)
    assert response.status_code == 502, response.text
    assert response.json()["error"]["code"] == "ORBITAL_INVALID_RESPONSE"


def test_gateway_rejects_state_for_a_different_requested_epoch(real_orbital_payloads):
    response, _ = _gateway_result("/api/reference/state", real_orbital_payloads["/api/reference/state"],
                                   params={"utc": "2024-04-08T18:00:00Z"})
    assert response.status_code == 502


def test_gateway_preserves_supported_fixed_step_rounding_tolerance():
    orbital = create_app("orbital")
    with TestClient(orbital), TestClient(create_app(
        "science", transport=httpx.ASGITransport(app=orbital),
    )) as client:
        response = client.post("/api/simulate", json={"duration_s": 3600.000001, "step_s": 3600})
    assert response.status_code == 200, response.text
    assert response.json()["execution"]["integrated_duration_s"] == 3600
