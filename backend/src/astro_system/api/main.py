from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import logging
import json
import math
from pathlib import Path
import re
from threading import BoundedSemaphore
import time
import uuid

from fastapi import FastAPI, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .contracts import ConstellationObserverInput, EclipseInput, GenericScienceResponse, ObserverInput, SimulationInput
from .errors import EphemerisCoverageError, ScienceApiError
from ..bodies import Body
from ..catalog_data import CatalogDataError, catalogue_availability, observatory_availability
from ..catalogs import MoonCatalog, constellation_records, star_records
from ..catalogs.constellations import IAU_ABBREVIATIONS
from ..coordinates import configure_iers_offline, constellation_sky, current_iers_status, local_sky
from ..coordinates.iers_status import IersDataError
from ..ephemeris.time_conversion import InvalidUtcError, advance_utc
from ..dynamics import conservation_metrics, velocity_verlet
from ..ephemeris import ApplicationEphemerisProvider, KernelUnavailable, STATE_TARGETS, SYSTEM_BARYCENTERS, epoch_metadata
from ..eclipses import local_solar_eclipse

ROOT = Path(__file__).resolve().parents[4]
DATA_ROOT = ROOT / "data"
SOFTWARE_VERSION = "0.1.0"
SCHEMA_VERSION = 1
MAX_REQUEST_BODY_BYTES = 64 * 1024
MAX_SIMULATION_STEPS = 20_000
DEFAULT_BODIES = ("Sun", "Mercury", "Venus", "Earth", "Moon", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
LOGGER = logging.getLogger("astro_system.api")
LOGGER.setLevel(logging.INFO)
if not LOGGER.handlers:
    LOGGER.addHandler(logging.StreamHandler())


def _catalogue_availability() -> dict[str, bool]:
    return catalogue_availability(DATA_ROOT)


def _local_science_capabilities(iers_status: dict[str, object] | None = None, *, enabled: bool = True) -> dict[str, dict[str, object]]:
    """Report installed capabilities, without promising any requested date.

    Stale predictions leave observed history usable. Missing/unverified tables
    are different: they cannot support even a historical scientific query.
    Orbital processes do not load or depend on these observer prerequisites.
    """
    if not enabled:
        return {name: {"available": False, "status": "unavailable", "canonical_method": "POST"}
                for name in ("sky", "sky_constellations", "eclipses_local")}
    iers_status = current_iers_status() if iers_status is None else iers_status
    bundle = iers_status.get("bundle")
    usable = (isinstance(bundle, dict) and bundle.get("integrity") == "verified" and
              bool(iers_status.get("valid_from_utc")) and bool(iers_status.get("valid_until_utc")))
    status = ("degraded" if iers_status.get("status") == "degraded" else "available") if usable else "unavailable"
    output = {
        name: {"available": usable, "status": status, "canonical_method": "POST",
               "requires_valid_iers_for_requested_epoch": True}
        for name in ("sky", "eclipses_local")
    }
    observatory_available = usable and observatory_availability(DATA_ROOT)
    output["sky_constellations"] = {
        "available": observatory_available,
        "status": status if observatory_available else "unavailable", "canonical_method": "POST",
        "requires_valid_iers_for_requested_epoch": True,
    }
    return output


@asynccontextmanager
async def lifespan(application: FastAPI):
    configure_iers_offline()
    application.state.ephemeris_provider = ApplicationEphemerisProvider(DATA_ROOT)
    application.state.simulation_semaphore = BoundedSemaphore(1)
    application.state.catalogues = _catalogue_availability()
    yield
    application.state.ephemeris_provider.close()


app = FastAPI(title="Orbis Scientia API", version=SOFTWARE_VERSION, lifespan=lifespan)


def _request_id(request: Request) -> str:
    value = getattr(request.state, "request_id", None)
    return value if isinstance(value, str) else str(uuid.uuid4())


def _meta(request: Request, capability: str) -> dict[str, str]:
    return {
        "request_id": _request_id(request),
        "generated_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "service": "native",
        "software_version": SOFTWARE_VERSION,
        "capability": capability,
    }


def _success(request: Request, capability: str, payload: dict[str, object]) -> dict[str, object]:
    return {"schema_version": SCHEMA_VERSION, "meta": _meta(request, capability), **payload}


def _error_payload(request: Request, error: ScienceApiError) -> dict[str, object]:
    body: dict[str, object] = {
        "code": error.code,
        "message": error.message,
        "request_id": _request_id(request),
    }
    if error.capability:
        body["capability"] = error.capability
    if error.details:
        body["details"] = error.details
    if error.valid_utc_from:
        body["valid_utc_from"] = error.valid_utc_from
    if error.valid_utc_until:
        body["valid_utc_until"] = error.valid_utc_until
    return {"schema_version": SCHEMA_VERSION, "error": body}


def _error_response(request: Request, error: ScienceApiError) -> JSONResponse:
    request.state.error_code = error.code
    headers = {"Cache-Control": "private, no-store", **error.headers, "X-Request-ID": _request_id(request)}
    return JSONResponse(_error_payload(request, error), status_code=error.status_code, headers=headers)


class RequestContextMiddleware:
    """Bound HTTP input before parsing and observe the complete ASGI response.

    Buffering is limited to 64 KiB. Accepted input is replayed through ASGI's
    receive interface, without relying on Starlette's private Request caches.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        request = Request(scope, receive)
        incoming = request.headers.get("X-Request-ID", "")
        request.state.request_id = incoming if REQUEST_ID_PATTERN.fullmatch(incoming) else str(uuid.uuid4())
        started = time.perf_counter()
        status = 500
        response_started = False
        semaphore = None

        async def send_observed(message: Message):
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request.state.request_id
                if request.url.path.startswith("/api/"):
                    headers.setdefault("Cache-Control", "private, no-store")
            await send(message)

        try:
            downstream_receive = receive
            dynamic_post = request.method == "POST" and request.url.path in {
                "/api/sky", "/api/sky/constellations", "/api/eclipses/local", "/api/simulate",
            }
            if dynamic_post:
                content_length = request.headers.get("content-length")
                if content_length is not None and not re.fullmatch(r"[0-9]+", content_length):
                    response = _error_response(request, ScienceApiError(
                        400, "VALIDATION_ERROR", "O cabeçalho Content-Length é inválido."))
                    await response(scope, receive, send_observed)
                    return
                # Compare digit counts before int(): hostile lengths must not
                # trigger Python's integer-string limit or allocate big ints.
                declared = (content_length or "0").lstrip("0") or "0"
                oversized = (len(declared) > len(str(MAX_REQUEST_BODY_BYTES)) or
                             int(declared) > MAX_REQUEST_BODY_BYTES)
                body = bytearray()
                while not oversized:
                    message = await receive()
                    if message["type"] == "http.disconnect":
                        status = 499
                        request.state.error_code = "CLIENT_DISCONNECTED"
                        return
                    chunk = message.get("body", b"")
                    if len(body) + len(chunk) > MAX_REQUEST_BODY_BYTES:
                        oversized = True
                        break
                    body.extend(chunk)
                    if not message.get("more_body", False):
                        break
                if oversized:
                    response = _error_response(request, ScienceApiError(
                        413, "REQUEST_BODY_TOO_LARGE",
                        "O corpo da solicitação ultrapassa o limite de 64 KiB."))
                    await response(scope, receive, send_observed)
                    return
                buffered_body = bytes(body)
                replayed = False

                async def replay_receive():
                    nonlocal replayed
                    if not replayed:
                        replayed = True
                        return {"type": "http.request", "body": buffered_body, "more_body": False}
                    return await receive()

                downstream_receive = replay_receive
            guarded = request.url.path in {
                "/api/sky", "/api/sky/constellations", "/api/eclipses/local",
            } and request.method in {"GET", "POST"}
            candidate = getattr(request.app.state, "science_semaphore", None)
            if guarded and candidate is not None:
                if not candidate.acquire(blocking=False):
                    response = _error_response(request, ScienceApiError(
                        429, "SCIENCE_BUSY", "O serviço científico atingiu o limite de concorrência.",
                        headers={"Retry-After": "1"}))
                    await response(scope, receive, send_observed)
                    return
                semaphore = candidate
            # Keep the concurrency slot until calculation AND response complete.
            await self.app(scope, downstream_receive, send_observed)
        except Exception as error:
            if response_started:
                request.state.error_code = "RESPONSE_STREAM_FAILED"
                raise
            response = await internal_error_handler(request, error)
            await response(scope, receive, send_observed)
        finally:
            if semaphore is not None:
                semaphore.release()
            LOGGER.info(json.dumps({
                "event": "science_request", "request_id": request.state.request_id,
                "service": getattr(request.app.state, "role", "monolith"),
                "method": request.method,
                "operation": getattr(scope.get("route"), "path", "unmatched"),
                "status": status, "duration_ms": round((time.perf_counter() - started) * 1000, 3),
                "error_category": getattr(request.state, "error_code", None),
            }))


app.add_middleware(RequestContextMiddleware)
# CORS also wraps errors generated by the request-boundary middleware.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Accept", "Content-Type", "X-Request-ID"],
)


@app.exception_handler(ScienceApiError)
async def science_error_handler(request: Request, error: ScienceApiError):
    return _error_response(request, error)


@app.exception_handler(IersDataError)
async def iers_error_handler(request: Request, error: IersDataError):
    capability = "eclipses_local" if request.url.path == "/api/eclipses/local" else "sky"
    reason = {
        "missing": "A tabela IERS local está ausente ou ilegível.",
        "expired-prediction": "As previsões da tabela IERS local estão vencidas.",
        "out-of-coverage": "O intervalo do cálculo está fora da cobertura IERS local.",
        "incomplete": "A tabela IERS local possui valores insuficientes.",
        "integrity-failed": "A integridade ou versão do pacote IERS não foi aprovada.",
    }.get(error.reason, "Não foi possível interpolar a tabela IERS local.")
    return _error_response(request, ScienceApiError(
        503, "IERS_DATA_UNAVAILABLE",
        reason + " Consulte a cobertura e atualize os dados pelo procedimento offline controlado.",
        capability, details={"reason": error.reason, "iers": error.provenance},
        valid_utc_from=error.provenance.get("valid_from_utc"),
        valid_utc_until=error.provenance.get("valid_until_utc"),
    ))


@app.exception_handler(CatalogDataError)
async def catalogue_error_handler(request: Request, error: CatalogDataError):
    capability = "sky" if request.url.path.startswith("/api/sky") else "catalogs"
    return _error_response(request, ScienceApiError(
        503, "CATALOG_DATA_UNAVAILABLE",
        "O conjunto de dados local está ausente, inválido ou não aprovado.",
        capability, details={"reason": error.reason, "catalogue": error.kind},
    ))


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, error: RequestValidationError):
    fields = [".".join(str(part) for part in item.get("loc", ())[1:]) for item in error.errors()]
    return _error_response(request, ScienceApiError(422, "VALIDATION_ERROR", "A solicitação científica possui campos inválidos.", details={"fields": fields}))


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, error: StarletteHTTPException):
    code = "METHOD_NOT_ALLOWED" if error.status_code == 405 else "NOT_FOUND" if error.status_code == 404 else "VALIDATION_ERROR"
    message = "Método HTTP não permitido para esta rota." if error.status_code == 405 else "Rota científica não encontrada." if error.status_code == 404 else "A solicitação não pôde ser processada."
    headers = dict(error.headers or {})
    return _error_response(request, ScienceApiError(error.status_code, code, message, headers=headers))


@app.exception_handler(Exception)
async def internal_error_handler(request: Request, error: Exception):
    LOGGER.error(json.dumps({"event": "science_internal_error", "request_id": _request_id(request),
                            "service": getattr(request.app.state, "role", "monolith"), "error_category": error.__class__.__name__}))
    return _error_response(request, ScienceApiError(500, "INTERNAL_ERROR", "O serviço científico encontrou um erro interno."))


def _provider(request: Request) -> ApplicationEphemerisProvider:
    return request.app.state.ephemeris_provider


def _require_provider(request: Request, capability: str) -> ApplicationEphemerisProvider:
    provider = _provider(request)
    if not provider.available:
        code = "KERNEL_INTEGRITY_FAILED" if provider.verification.status == "failed" else "KERNEL_UNAVAILABLE"
        raise ScienceApiError(503, code, "A efeméride DE442s não está disponível nesta instalação.", capability)
    return provider


def _provider_call(request: Request, capability: str, callback):
    try:
        return callback(_require_provider(request, capability))
    except EphemerisCoverageError as error:
        raise ScienceApiError(422, "EPHEMERIS_OUT_OF_COVERAGE", "A época solicitada está fora da cobertura do DE442s.", capability, valid_utc_from=error.valid_from_utc, valid_utc_until=error.valid_until_utc) from error
    except KeyError as error:
        raise ScienceApiError(422, "UNKNOWN_BODY", "A solicitação contém um corpo desconhecido.", capability, details={"field": "bodies"}) from error
    except KernelUnavailable as error:
        raise ScienceApiError(503, "KERNEL_UNAVAILABLE", "A efeméride DE442s não está disponível nesta instalação.", capability) from error
    except ValueError as error:
        raise ScienceApiError(422, "VALIDATION_ERROR", "A época ou os alvos solicitados são inválidos.", capability) from error


def _set_legacy_headers(response: Response) -> None:
    response.headers["Deprecation"] = "true"
    response.headers["Warning"] = '299 - "GET com coordenadas e legado; use POST com corpo JSON."'


@app.get("/api/health", response_model=GenericScienceResponse)
def health(request: Request) -> dict[str, object]:
    provider = _provider(request)
    return _success(request, "health", {
        "status": "ok",
        "api": "orbis-local-scientific-api",
        "service": "native",
        "provider": provider.provider_id,
        "kernels_available": provider.available,
        "si_units": True,
    })


@app.get("/api/health/ready", response_model=GenericScienceResponse)
def readiness(request: Request, response: Response) -> dict[str, object]:
    provider = _provider(request)
    catalogues = _catalogue_availability()
    iers_status = current_iers_status()
    observer_capabilities = _local_science_capabilities(iers_status)
    observatory_available = observer_capabilities["sky_constellations"]["available"]
    unavailable = ([] if provider.available else ["reference_state", "simulate"])
    if not all(catalogues.values()):
        unavailable.append("catalogs")
    unavailable.extend(name for name, capability in observer_capabilities.items() if not capability["available"])
    ready = not unavailable
    if not ready:
        response.status_code = 503
    return _success(request, "readiness", {
        "status": "ready" if ready else "degraded",
        "ready": ready,
        "provider": provider.provider_id,
        "kernel_integrity": {
            "status": provider.verification.status,
            "checked_files": provider.verification.checked_files,
            "failed": list(provider.verification.failed_names),
        },
        "catalogues": catalogues,
        "constellation_observatory_available": observatory_available,
        "iers": iers_status,
        "unavailable_capabilities": unavailable,
        "coverage_is_request_specific": True,
        "software_version": SOFTWARE_VERSION,
    })


@app.get("/api/capabilities", response_model=GenericScienceResponse)
def capabilities(request: Request) -> dict[str, object]:
    provider = _provider(request)
    coverage: dict[str, object] = {}
    if provider.available:
        coverage = provider.coverage(DEFAULT_BODIES)
    snapshot_path = ROOT / "public" / "reference-snapshot.json"
    catalogues = _catalogue_availability()
    observer_capabilities = _local_science_capabilities(
        enabled=getattr(request.app.state, "role", "monolith") != "orbital")
    return _success(request, "capabilities", {
        "snapshot": {"available": snapshot_path.exists(), "fixed_epoch": True, "epoch_utc": "2026-08-05T00:00:00Z", "source": "NAIF SPICE DE442s"},
        "capabilities": {
            "reference_state": {"available": provider.available, "status": "available" if provider.available else "unavailable", "mode": "dynamic-de442s" if provider.available else "unavailable"},
            "catalogs": {"available": all(catalogues.values()), **catalogues},
            **observer_capabilities,
            "simulate": {"available": provider.available, "status": "available" if provider.available else "unavailable", "canonical_method": "POST"},
        },
        "limits": {
            "reference_state": {"valid_utc_from": coverage.get("valid_utc_from"), "valid_utc_until": coverage.get("valid_utc_until")},
            "simulate": {"max_bodies": 10, "max_steps": MAX_SIMULATION_STEPS, "max_duration_s": 31_536_000, "max_step_s": 86_400},
            "request_body_bytes": MAX_REQUEST_BODY_BYTES,
        },
    })


@app.get("/api/reference/state", response_model=GenericScienceResponse)
def reference_state(
    request: Request,
    utc: str = Query("2026-08-05T00:00:00Z", min_length=1, max_length=64),
    bodies: str = Query(",".join(DEFAULT_BODIES), min_length=1, max_length=512),
) -> dict[str, object]:
    names = tuple(item.strip() for item in bodies.split(",") if item.strip())
    if len(names) != len(set(names)):
        raise ScienceApiError(422, "DUPLICATE_BODY", "A lista contém corpos duplicados.", "reference_state")
    payload = _provider_call(request, "reference_state", lambda provider: provider.snapshot_payload(utc, names))
    return _success(request, "reference_state", payload)


def _relative_drift(initial: float, final: float) -> float | None:
    if not math.isfinite(initial) or not math.isfinite(final):
        return None
    return (final - initial) / initial if abs(initial) > 1e-30 else final - initial


def _vector_norm(values: object) -> float:
    return math.sqrt(sum(float(item) ** 2 for item in values))


@app.post("/api/simulate", response_model=GenericScienceResponse)
def simulate(request: Request, body: SimulationInput) -> dict[str, object]:
    if len(body.bodies) != len(set(body.bodies)):
        raise ScienceApiError(422, "DUPLICATE_BODY", "A lista contém corpos duplicados.", "simulate")
    unknown = [name for name in body.bodies if name not in STATE_TARGETS]
    if unknown:
        raise ScienceApiError(422, "UNKNOWN_BODY", "A solicitação contém um corpo desconhecido.", "simulate", details={"field": "bodies"})
    ratio = abs(body.duration_s) / body.step_s
    if not math.isfinite(ratio) or ratio > MAX_SIMULATION_STEPS:
        raise ScienceApiError(422, "SIMULATION_STEP_LIMIT_EXCEEDED", "A solicitação ultrapassa o limite de passos desta versão.", "simulate", details={"max_steps": MAX_SIMULATION_STEPS})
    nearest = round(ratio)
    if nearest < 1 or not math.isclose(ratio, nearest, rel_tol=1e-12, abs_tol=1e-9):
        raise ScienceApiError(422, "SIMULATION_DURATION_STEP_MISMATCH", "A duração deve ser um múltiplo inteiro do passo fixo.", "simulate")
    semaphore: BoundedSemaphore = request.app.state.simulation_semaphore
    if not semaphore.acquire(blocking=False):
        raise ScienceApiError(429, "SIMULATION_BUSY", "Já existe uma simulação científica em execução.", "simulate", headers={"Retry-After": "1"})
    started = time.perf_counter()
    try:
        state = _provider_call(request, "simulate", lambda provider: provider.state(tuple(body.bodies), body.utc))
        body_data = [Body.from_name(name) for name in body.bodies]
        mus = [item.mu_m3_s2 for item in body_data]
        initial_metrics = conservation_metrics(state.position_m, state.velocity_m_s, mus)
        signed_steps = nearest if body.duration_s > 0 else -nearest
        try:
            positions, velocities = velocity_verlet(state.position_m, state.velocity_m_s, mus, body.step_s, signed_steps)
        except ValueError as error:
            raise ScienceApiError(422, "COLLISION_OR_SINGULARITY", "A integração encontrou centros coincidentes ou uma singularidade.", "simulate") from error
        if not all(math.isfinite(value) for rows in (positions, velocities) for row in rows for value in row):
            raise ScienceApiError(422, "COLLISION_OR_SINGULARITY", "A integração não produziu um estado finito.", "simulate")
        final_metrics = conservation_metrics(positions, velocities, mus)
        integrated_duration = signed_steps * body.step_s
        final_epoch = advance_utc(state.canonical_utc, integrated_duration)
        drift = {
            "energy_relative": _relative_drift(float(initial_metrics["total_j"]), float(final_metrics["total_j"])),
            "linear_momentum_delta": _vector_norm([float(b) - float(a) for a, b in zip(initial_metrics["linear_momentum"], final_metrics["linear_momentum"])]),
            "angular_momentum_delta": _vector_norm([float(b) - float(a) for a, b in zip(initial_metrics["angular_momentum"], final_metrics["angular_momentum"])]),
            "barycenter_displacement_m": _vector_norm([float(b) - float(a) for a, b in zip(initial_metrics["barycenter_m"], final_metrics["barycenter_m"])]),
        }
        rows = [{
            "name": item.name,
            "naif_id": item.naif_id,
            "mu_m3_s2": item.mu_m3_s2,
            "position_m": list(positions[index]),
            "velocity_m_s": list(velocities[index]),
            "source_initial_state": "NAIF SPICE DE442s",
            "state_target_naif_id": STATE_TARGETS[item.name],
            "state_kind": "system-barycenter" if item.name in SYSTEM_BARYCENTERS else "physical-center",
        } for index, item in enumerate(body_data)]
        return _success(request, "simulate", {
            "input": {"utc": state.canonical_utc, "bodies": list(body.bodies), "integrator": body.integrator, "duration_s": body.duration_s, "step_s": body.step_s},
            "execution": {"steps": nearest, "integrated_duration_s": integrated_duration, "computation_ms": (time.perf_counter() - started) * 1000, "fixed_step_s": body.step_s},
            "state": {"epoch_utc": final_epoch, "frame": "J2000", "center": "Solar System Barycenter", "bodies": rows},
            "metrics": {"initial": initial_metrics, "final": final_metrics, "drift": drift},
            "model": {"gravity": "Newtonian point masses", "excluded_effects": ["J2", "relativity", "tides", "radiation pressure", "hierarchical moon substeps"]},
            "limitations": ["Velocity-Verlet usa passo fixo.", "A integração não substitui a efeméride JPL."],
        })
    finally:
        semaphore.release()


def _sky(request: Request, body: ObserverInput) -> dict[str, object]:
    try:
        payload = local_sky(body.latitude_deg, body.longitude_deg, body.elevation_m, body.utc)
    except InvalidUtcError as error:
        raise ScienceApiError(422, "VALIDATION_ERROR", "O UTC do observador é inválido.", "sky") from error
    return _success(request, "sky", payload)


@app.post("/api/sky", response_model=GenericScienceResponse)
def sky_post(request: Request, body: ObserverInput) -> dict[str, object]:
    return _sky(request, body)


@app.get("/api/sky", response_model=GenericScienceResponse)
def sky_legacy(
    request: Request,
    response: Response,
    latitude_deg: float = Query(..., ge=-90, le=90),
    longitude_deg: float = Query(..., ge=-180, le=180),
    elevation_m: float = Query(0, ge=-500, le=10_000),
    utc: str = Query("2026-08-05T00:00:00Z", min_length=1, max_length=64),
) -> dict[str, object]:
    _set_legacy_headers(response)
    return _sky(request, ObserverInput(latitude_deg=latitude_deg, longitude_deg=longitude_deg, elevation_m=elevation_m, utc=utc))


def _constellation_sky(request: Request, body: ConstellationObserverInput) -> dict[str, object]:
    try:
        payload = constellation_sky(body.latitude_deg, body.longitude_deg, body.elevation_m, body.utc, body.constellation, body.max_g_magnitude, data_root=DATA_ROOT)
    except KeyError as error:
        raise ScienceApiError(404, "VALIDATION_ERROR", "Constelação IAU não encontrada.", "sky") from error
    except InvalidUtcError as error:
        raise ScienceApiError(422, "VALIDATION_ERROR", "O UTC do observador é inválido.", "sky") from error
    return _success(request, "sky", payload)


@app.post("/api/sky/constellations", response_model=GenericScienceResponse)
def sky_constellations_post(request: Request, body: ConstellationObserverInput) -> dict[str, object]:
    return _constellation_sky(request, body)


@app.get("/api/sky/constellations", response_model=GenericScienceResponse)
def sky_constellations_legacy(
    request: Request,
    response: Response,
    latitude_deg: float = Query(..., ge=-90, le=90),
    longitude_deg: float = Query(..., ge=-180, le=180),
    elevation_m: float = Query(0, ge=-500, le=10_000),
    utc: str = Query("2026-08-05T00:00:00Z", min_length=1, max_length=64),
    constellation: str = Query(..., min_length=3, max_length=3),
    max_g_mag: float = Query(5.5, ge=-2, le=6.5),
    max_g_magnitude: float | None = Query(None, ge=-2, le=6.5),
) -> dict[str, object]:
    _set_legacy_headers(response)
    return _constellation_sky(request, ConstellationObserverInput(latitude_deg=latitude_deg, longitude_deg=longitude_deg, elevation_m=elevation_m, utc=utc, constellation=constellation, max_g_magnitude=max_g_magnitude if max_g_magnitude is not None else max_g_mag))


def _eclipse(request: Request, body: EclipseInput) -> dict[str, object]:
    try:
        payload = local_solar_eclipse(body.latitude_deg, body.longitude_deg, body.elevation_m, body.utc, body.search_hours)
    except InvalidUtcError as error:
        raise ScienceApiError(422, "VALIDATION_ERROR", "Os parâmetros da busca de eclipse são inválidos.", "eclipses_local") from error
    return _success(request, "eclipses_local", payload)


@app.post("/api/eclipses/local", response_model=GenericScienceResponse)
def eclipse_post(request: Request, body: EclipseInput) -> dict[str, object]:
    return _eclipse(request, body)


@app.get("/api/eclipses/local", response_model=GenericScienceResponse)
def eclipse_legacy(
    request: Request,
    response: Response,
    latitude_deg: float = Query(..., ge=-90, le=90),
    longitude_deg: float = Query(..., ge=-180, le=180),
    elevation_m: float = Query(0, ge=-500, le=10_000),
    utc: str = Query("2024-04-08T18:00:00Z", min_length=1, max_length=64),
    search_hours: float = Query(18, ge=1, le=36),
) -> dict[str, object]:
    _set_legacy_headers(response)
    return _eclipse(request, EclipseInput(latitude_deg=latitude_deg, longitude_deg=longitude_deg, elevation_m=elevation_m, utc=utc, search_hours=search_hours))


@app.get("/api/catalogs/moons", response_model=GenericScienceResponse)
def moons(
    request: Request,
    query: str = Query("", max_length=128),
    primary: str | None = Query(None, max_length=32),
    offset: int = Query(0, ge=0),
    limit: int = Query(80, ge=1, le=250),
) -> dict[str, object]:
    catalog = MoonCatalog(DATA_ROOT / "moons" / "moons.json")
    matches = catalog.search(query, primary)
    items = matches[offset:offset + limit]
    return _success(request, "catalogs", {
        "items": items,
        "total": len(matches),
        "returned": len(items),
        "offset": offset,
        "limit": limit,
        "counts": catalog.counts(),
        "source": ["https://ssd.jpl.nasa.gov/sats/phys_par/", "https://ssd.jpl.nasa.gov/sats/elem/"],
        "provenance": "JPL SSD generated offline catalogue",
        "propagation_notice": "Mean elements are catalogue metadata only. No position is displayed as an ephemeris without a named state source.",
    })


@app.get("/api/catalogs/stars", response_model=GenericScienceResponse)
def stars(
    request: Request,
    query: str = Query("", max_length=128),
    max_magnitude: float | None = Query(None, ge=-5, le=30, allow_inf_nan=False),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
) -> dict[str, object]:
    catalogue, matches = star_records(DATA_ROOT / "stars" / "gaia_bright.json", query, max_magnitude)
    items = matches[offset:offset + limit]
    return _success(request, "catalogs", {
        "catalogue_count": int(catalogue.get("count", 0)),
        "total": len(matches),
        "returned": len(items),
        "offset": offset,
        "limit": limit,
        "source": catalogue.get("source"),
        "provenance": "ESA Gaia Archive DR3 TAP offline subset",
        "items": items,
    })


@app.get("/api/catalogs/constellations", response_model=GenericScienceResponse)
def constellations(
    request: Request,
    query: str = Query("", max_length=128),
    abbreviation: str | None = Query(None, min_length=3, max_length=3),
    offset: int = Query(0, ge=0),
    limit: int = Query(88, ge=1, le=88),
) -> dict[str, object]:
    records = constellation_records(query, abbreviation, data_root=DATA_ROOT)
    items = records[offset:offset + limit]
    return _success(request, "catalogs", {
        "items": items,
        "total": len(records),
        "returned": len(items),
        "count": 88,
        "offset": offset,
        "limit": limit,
        "abbreviations": list(IAU_ABBREVIATIONS),
        "source": "IAU names as distributed with Astropy; Delporte boundaries via Roman 1987 (CDS VI/42)",
        "catalogue_epoch": "J2016.0",
        "boundary_note": "Official IAU boundaries are coordinate classifications; cultural stick figures are not substituted.",
        "boundary_representation": "formal Roman/Delporte inventory; detailed J2000 geometry is a separate artifact",
        "limitations": [],
    })


def _options(response: Response, allow: str) -> Response:
    response.status_code = 204
    response.headers["Allow"] = allow
    return response


@app.options("/api/sky")
def sky_options(response: Response) -> Response:
    return _options(response, "POST, GET, OPTIONS")


@app.options("/api/sky/constellations")
def constellation_sky_options(response: Response) -> Response:
    return _options(response, "POST, GET, OPTIONS")


@app.options("/api/eclipses/local")
def eclipse_options(response: Response) -> Response:
    return _options(response, "POST, GET, OPTIONS")


@app.options("/api/simulate")
def simulate_options(response: Response) -> Response:
    return _options(response, "POST, OPTIONS")
