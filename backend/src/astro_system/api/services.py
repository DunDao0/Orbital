"""Two process-isolated roles sharing the existing scientific implementations.

The science entry point is also a fixed-route gateway, not an alternate source
of orbital truth. The standalone main:app remains supported.
"""
from contextlib import asynccontextmanager
import json
import os
import math
from threading import BoundedSemaphore
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse
from fastapi.routing import APIRoute
from pydantic import ValidationError

from . import main
from .contracts import (
    OrbitalCapabilitiesResponse, OrbitalConstellationCatalogue, OrbitalMoonCatalogue, OrbitalReferenceResponse,
    OrbitalResponse, OrbitalSimulationResponse, OrbitalStarCatalogue,
    ScienceErrorEnvelope, SimulationInput,
)
from .errors import ScienceApiError

ORBITAL_PATHS = {
    "/api/reference/state", "/api/simulate", "/api/catalogs/moons",
    "/api/catalogs/stars", "/api/catalogs/constellations",
}
SCIENCE_PATHS = {"/api/sky", "/api/sky/constellations", "/api/eclipses/local"}
# Count nested JSON containers, including the root, independently of the
# interpreter's recursion budget. Existing scientific payloads are much flatter.
MAX_ORBITAL_JSON_DEPTH = 128


def _strict_json_payload(content: bytes):
    """Reject non-finite, ambiguous, or excessively deep JSON without rewriting."""
    def finite_float(value):
        parsed = float(value)
        if not math.isfinite(parsed):
            raise ValueError("Non-finite JSON number")
        return parsed

    def reject_constant(value):
        raise ValueError("Non-standard JSON constant")

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON object key")
            result[key] = value
        return result

    payload = json.loads(content, parse_float=finite_float, parse_constant=reject_constant,
                         object_pairs_hook=unique_object)
    pending = [(payload, 1)]
    while pending:
        value, depth = pending.pop()
        if not isinstance(value, (dict, list)):
            continue
        if depth > MAX_ORBITAL_JSON_DEPTH:
            raise ValueError("JSON nesting exceeds the orbital response limit")
        children = value.values() if isinstance(value, dict) else value
        pending.extend((child, depth + 1) for child in children if isinstance(child, (dict, list)))
    return payload


def _validate_body_identity(bodies):
    for body in bodies:
        expected = main.Body.from_name(body.name)
        if (body.naif_id != expected.naif_id or
                body.state_target_naif_id != main.STATE_TARGETS[body.name] or
                body.state_kind != ("system-barycenter" if body.name in main.SYSTEM_BARYCENTERS else "physical-center")):
            raise ValueError("Inconsistent physical identity")
        if hasattr(body, "body_naif_id") and body.body_naif_id != expected.naif_id:
            raise ValueError("Inconsistent physical center")


def _validate_success_payload(path: str, payload: dict, request: Request, request_body: bytes):
    envelope = OrbitalResponse.model_validate(payload)
    expected_capability = {
        "/api/reference/state": "reference_state", "/api/simulate": "simulate",
        "/api/capabilities": "capabilities",
    }.get(path, "catalogs")
    if envelope.meta.capability != expected_capability:
        raise ValueError("Mismatched capability")
    if envelope.meta.request_id != main._request_id(request):
        raise ValueError("Mismatched request ID")
    if path == "/api/capabilities":
        OrbitalCapabilitiesResponse.model_validate(payload)
    elif path == "/api/reference/state":
        result = OrbitalReferenceResponse.model_validate(payload)
        names = [item.strip() for item in request.query_params.get(
            "bodies", ",".join(main.DEFAULT_BODIES)).split(",") if item.strip()]
        requested_utc = request.query_params.get("utc", "2026-08-05T00:00:00Z")
        requested_epoch = main.epoch_metadata(requested_utc)
        if ([body.name for body in result.bodies] != names or
                result.epoch != requested_epoch.canonical_utc or
                result.epoch_metadata.ephemeris_time_et_s != requested_epoch.ephemeris_time_et_s or
                result.epoch_metadata.input_utc != requested_utc):
            raise ValueError("Reference state does not match the requested epoch or targets")
        _validate_body_identity(result.bodies)
    elif path == "/api/simulate":
        result = OrbitalSimulationResponse.model_validate(payload)
        expected_input = SimulationInput.model_validate_json(request_body)
        expected_input.utc = main.epoch_metadata(expected_input.utc).canonical_utc
        if result.input.model_dump() != expected_input.model_dump():
            raise ValueError("Simulation does not match the requested input")
        if [body.name for body in result.state.bodies] != expected_input.bodies:
            raise ValueError("Simulation targets do not match the request")
        ratio = abs(expected_input.duration_s) / expected_input.step_s
        if (not math.isfinite(ratio) or ratio > main.MAX_SIMULATION_STEPS or
                not math.isclose(ratio, result.execution.steps, rel_tol=1e-12, abs_tol=1e-9)):
            raise ValueError("Simulation duration does not match the request")
        expected_epoch = main.advance_utc(expected_input.utc, result.execution.integrated_duration_s)
        if result.state.epoch_utc != expected_epoch:
            raise ValueError("Simulation final epoch is inconsistent")
        _validate_body_identity(result.state.bodies)
    elif path in {"/api/catalogs/moons", "/api/catalogs/stars", "/api/catalogs/constellations"}:
        model, default_limit = {
            "/api/catalogs/moons": (OrbitalMoonCatalogue, 80),
            "/api/catalogs/stars": (OrbitalStarCatalogue, 50),
            "/api/catalogs/constellations": (OrbitalConstellationCatalogue, 88),
        }[path]
        result = model.model_validate(payload)
        if (result.offset != int(request.query_params.get("offset", "0")) or
                result.limit != int(request.query_params.get("limit", str(default_limit)))):
            raise ValueError("Catalogue pagination does not match the request")
        if path == "/api/catalogs/stars" and result.total > result.catalogue_count:
            raise ValueError("Catalogue total exceeds its inventory")
        if path == "/api/catalogs/constellations":
            if (len(set(result.abbreviations)) != 88 or
                    set(result.abbreviations) != set(main.IAU_ABBREVIATIONS) or
                    any(item.iau_abbreviation not in result.abbreviations for item in result.items)):
                raise ValueError("Constellation identifiers are inconsistent")


def create_app(role: str | None = None, *, transport=None) -> FastAPI:
    role = role or os.environ.get("ORBIS_SERVICE_ROLE", "science")
    if role not in {"science", "orbital"}:
        raise ValueError("ORBIS_SERVICE_ROLE must be science or orbital")
    origin = os.environ.get("ORBIS_ORBITAL_URL", "http://orbital:8000")
    parsed = urlsplit(origin)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"}):
        raise ValueError("ORBIS_ORBITAL_URL must be an HTTP origin without credentials")
    timeout_s = float(os.environ.get("ORBIS_ORBITAL_TIMEOUT_SECONDS", "120"))
    if not 1 <= timeout_s <= 3600:
        raise ValueError("ORBIS_ORBITAL_TIMEOUT_SECONDS must be between 1 and 3600")
    science_concurrency = int(os.environ.get("ORBIS_SCIENCE_CONCURRENCY", "1"))
    if not 1 <= science_concurrency <= 32:
        raise ValueError("ORBIS_SCIENCE_CONCURRENCY must be between 1 and 32")

    @asynccontextmanager
    async def lifespan(application):
        application.state.role = role
        if role == "orbital":
            async with main.lifespan(application):
                yield
        else:
            main.configure_iers_offline()
            application.state.catalogues = main._catalogue_availability()
            application.state.science_semaphore = BoundedSemaphore(science_concurrency)
            async with httpx.AsyncClient(
                base_url=origin.rstrip("/"), transport=transport,
                timeout=httpx.Timeout(timeout_s, connect=5, pool=5),
                follow_redirects=False, trust_env=False,
                limits=httpx.Limits(max_connections=32, max_keepalive_connections=8),
            ) as client:
                application.state.orbital_client = client
                yield

    application = FastAPI(
        title=f"Orbis Scientia — {role}", version=main.SOFTWARE_VERSION,
        lifespan=lifespan, middleware=list(main.app.user_middleware),
        exception_handlers=dict(main.app.exception_handlers),
    )
    owned = ORBITAL_PATHS if role == "orbital" else SCIENCE_PATHS
    for route in main.app.routes:
        if isinstance(route, APIRoute) and route.path in owned:
            application.router.routes.append(route)

    async def upstream(request: Request, path: str) -> httpx.Response:
        request_body = await request.body() if request.method == "POST" else b""
        try:
            response = await request.app.state.orbital_client.request(
                request.method if path != "/api/capabilities" else "GET", path,
                params=request.query_params if path != "/api/capabilities" else None,
                content=request_body if request.method == "POST" else None,
                headers={"X-Request-ID": main._request_id(request),
                         "Content-Type": "application/json"},
                timeout=httpx.Timeout(3, connect=2) if path == "/api/capabilities" else httpx.Timeout(timeout_s, connect=5, pool=5),
            )
        except httpx.TimeoutException as error:
            raise ScienceApiError(504, "ORBITAL_TIMEOUT", "O serviço orbital excedeu o tempo limite.") from error
        except httpx.RequestError as error:
            raise ScienceApiError(503, "ORBITAL_UNAVAILABLE", "O serviço orbital está indisponível.") from error
        if request.method == "OPTIONS" and response.status_code == 204:
            return response
        try:
            payload = _strict_json_payload(response.content)
            if 200 <= response.status_code < 300:
                if response.status_code != 200:
                    raise ValueError("Unexpected upstream success status")
                _validate_success_payload(path, payload, request, request_body)
            elif 400 <= response.status_code < 600:
                ScienceErrorEnvelope.model_validate(payload)
                if payload["error"]["request_id"] != main._request_id(request):
                    raise ValueError("Mismatched request ID")
            else:
                raise ValueError("Unexpected upstream status")
        except (ValueError, ValidationError, KeyError, TypeError, RecursionError) as error:
            raise ScienceApiError(502, "ORBITAL_INVALID_RESPONSE", "Resposta inválida do serviço orbital.") from error
        return response

    async def proxy(request: Request):
        response = await upstream(request, request.url.path)
        if response.status_code >= 400:
            code = response.json()["error"]["code"]
            request.state.error_code = code if main.REQUEST_ID_PATTERN.fullmatch(code) else "UPSTREAM_ERROR"
        # Preserve the original scientific JSON bytes, including typed 501 errors.
        headers = {key: value for key, value in response.headers.items()
                   if key.lower() in {"retry-after", "allow", "deprecation", "warning"}}
        return Response(response.content, status_code=response.status_code,
                        media_type="application/json", headers=headers)

    if role == "science":
        for path in sorted(ORBITAL_PATHS):
            methods = ["POST", "OPTIONS"] if path == "/api/simulate" else ["GET"]
            application.add_api_route(path, proxy, methods=methods)

    @application.get("/api/health")
    def health(request: Request):
        return main._success(request, "health", {
            "status": "ok", "service": "native", "role": role, "si_units": True,
        })

    @application.get("/api/capabilities")
    async def capabilities(request: Request):
        if role == "orbital":
            result = main.capabilities(request)
            for name in ("sky", "sky_constellations", "eclipses_local"):
                result["capabilities"][name] = {"available": False, "status": "unavailable", "canonical_method": "POST"}
        else:
            try:
                response = await upstream(request, "/api/capabilities")
                if response.status_code != 200:
                    raise ValueError("Unavailable capabilities")
                result = response.json()
            except (ScienceApiError, KeyError, TypeError, ValueError):
                result = {
                    "snapshot": {"available": False, "fixed_epoch": True},
                    "limits": {"request_body_bytes": main.MAX_REQUEST_BODY_BYTES},
                    "capabilities": {
                        "reference_state": {"available": False, "status": "unavailable", "mode": "unavailable"},
                        "simulate": {"available": False, "status": "unavailable", "canonical_method": "POST"},
                        "catalogs": {"available": False, "moons": False, "stars": False, "constellations": False},
                    },
                }
            result = main._success(request, "capabilities", {
                key: result[key] for key in ("snapshot", "limits", "capabilities")})
            result["capabilities"].update(main._local_science_capabilities())
        result["role"] = role
        return result

    @application.get("/api/health/ready")
    async def readiness(request: Request):
        caps = await capabilities(request)
        if role == "orbital":
            ready = all(caps["capabilities"][key]["available"]
                        for key in ("reference_state", "simulate", "catalogs"))
        else:
            ready = all(
                caps["capabilities"][key]["available"]
                for key in ("reference_state", "simulate", "catalogs", "sky", "sky_constellations", "eclipses_local"))
        # Readiness does not promise IERS coverage for arbitrary request dates.
        return JSONResponse(main._success(request, "readiness", {
            "ready": ready, "status": "ready" if ready else "degraded", "role": role,
            "iers": main.current_iers_status() if role == "science" else None,
            "coverage_is_request_specific": True,
        }), status_code=200 if ready else 503)

    return application
