"""Reproducible HTTP measurements against services owned by this invocation.

No retries, remote URLs, downloads, API changes, or automatic capacity tuning.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
from importlib import metadata
import json
import math
import os
from pathlib import Path
import platform
import sys
import threading
import time

import httpx

try:
    from .service_pair import service_pair
except ImportError:  # python backend/tools/benchmark_services.py
    from service_pair import service_pair


UTC = "2024-04-08T18:00:00Z"
BODIES = ["Sun", "Mercury", "Venus", "Earth", "Moon", "Mars",
          "Jupiter", "Saturn", "Uranus", "Neptune"]
# Public fixed test location, not the user's observer coordinates.
OBSERVER = {"latitude_deg": 32.7767, "longitude_deg": -96.7970,
            "elevation_m": 0, "utc": UTC}
OPERATIONS = {
    "reference": ("GET", "/api/reference/state", {"utc": UTC}),
    "moons": ("GET", "/api/catalogs/moons", {}),
    "stars": ("GET", "/api/catalogs/stars", {"limit": 100}),
    "constellations_catalog": ("GET", "/api/catalogs/constellations", {}),
    "sky": ("POST", "/api/sky", OBSERVER),
    "constellation_sky": ("POST", "/api/sky/constellations",
                          {**OBSERVER, "constellation": "Ori", "max_g_magnitude": 5.5}),
    "eclipse": ("POST", "/api/eclipses/local", {**OBSERVER, "search_hours": 6}),
    "simulate_short": ("POST", "/api/simulate",
                       {"utc": UTC, "bodies": ["Sun", "Earth"], "duration_s": 3600, "step_s": 60}),
    "simulate_max": ("POST", "/api/simulate",
                     {"utc": UTC, "bodies": BODIES, "duration_s": 20_000, "step_s": 1}),
}


@dataclass(frozen=True)
class Observation:
    category: str
    elapsed_ms: float
    status: int | None = None
    response_bytes: int = 0


def nearest_rank(values, percentile):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[max(0, math.ceil(percentile * len(ordered)) - 1)]


def summarize(observations):
    groups = {}
    for category in ("success", "rejected_429", "http_error", "timeout", "transport_error"):
        rows = [row for row in observations if row.category == category]
        values = [row.elapsed_ms for row in rows]
        groups[category] = {
            "count": len(rows), "p50_ms": nearest_rank(values, .5),
            "p95_ms": nearest_rank(values, .95),
            "status_counts": dict(Counter(str(row.status) for row in rows if row.status is not None)),
        }
    return {"requests": len(observations), "groups": groups,
            "response_bytes": sum(row.response_bytes for row in observations)}


def request_once(client, operation):
    method, path, payload = OPERATIONS[operation]
    start = time.perf_counter()
    try:
        # Exactly one call; HTTPX has no configured retry transport.
        response = client.request(method, path, **({"params": payload} if method == "GET"
                                                   else {"json": payload}))
        category = ("success" if 200 <= response.status_code < 300 else
                    "rejected_429" if response.status_code == 429 else "http_error")
        return Observation(category, (time.perf_counter() - start) * 1000,
                           response.status_code, len(response.content))
    except httpx.TimeoutException:
        return Observation("timeout", (time.perf_counter() - start) * 1000)
    except httpx.TransportError:
        return Observation("transport_error", (time.perf_counter() - start) * 1000)


class MemorySampler:
    """RSS includes launchers and descendants; aggregate maxima use the same poll."""
    def __init__(self, pair, interval=.1):
        self.pair, self.interval = pair, interval
        self.stop_event = threading.Event()
        self.thread = None
        self.polls, self.complete_polls, self.failures, self.cost_seconds = 0, 0, 0, 0.0
        self.total_peak_bytes = None
        self.role_peak_bytes, self.process_peaks = {}, {}

    def sample(self):
        start = time.perf_counter()
        self.polls += 1
        try:
            roles = self.pair.samples()
            total = 0
            complete = bool(roles) and set(roles) == set(self.pair.processes)
            for role, processes in roles.items():
                workers = self.pair.worker_pids.get(role, set())
                # Missing workers or unreadable RSS must not become zero usage.
                role_complete = (bool(processes)
                                 and len(workers.intersection(processes)) >= getattr(self.pair, "workers", 1)
                                 and all(row.rss_bytes is not None for row in processes.values()))
                complete = complete and role_complete
                self.role_peak_bytes.setdefault(role, None)
                if role_complete:
                    role_total = sum(row.rss_bytes for row in processes.values())
                    total += role_total
                    self.role_peak_bytes[role] = max(self.role_peak_bytes[role] or 0, role_total)
                for row in processes.values():
                    key = (role, row.pid, row.creation_id)
                    old = self.process_peaks.get(key)
                    if (old is None or (row.rss_bytes is not None
                                       and row.rss_bytes > (old["peak_rss_bytes"] or 0))):
                        worker = row.pid in workers
                        launcher = row.pid == self.pair.processes[role].pid
                        self.process_peaks[key] = {
                            "role": role, "pid": row.pid, "creation_id": str(row.creation_id),
                            "kind": "worker" if worker else "launcher" if launcher else "child",
                            "peak_rss_bytes": row.rss_bytes,
                        }
            if complete:
                self.total_peak_bytes = max(self.total_peak_bytes or 0, total)
                self.complete_polls += 1
            else:
                self.failures += 1
        except (OSError, RuntimeError):
            self.failures += 1
        finally:
            self.cost_seconds += time.perf_counter() - start

    def _run(self):
        while not self.stop_event.wait(self.interval):
            self.sample()

    def __enter__(self):
        self.sample()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop_event.set()
        self.thread.join()
        self.sample()

    def report(self):
        return {
            "metric": "RSS/working set; shared pages may be counted in several processes",
            "poll_interval_s": self.interval, "polls": self.polls,
            "complete_polls": self.complete_polls, "failed_or_incomplete_polls": self.failures,
            "sampling_cost_s": self.cost_seconds, "total_peak_same_poll_bytes": self.total_peak_bytes,
            "role_peak_same_poll_bytes": self.role_peak_bytes,
            "processes": list(self.process_peaks.values()),
            "scope": "owned service trees only; excludes benchmark process and startup peak",
        }


def phase(client, pair, operation, *, concurrency, repetitions, sample_interval):
    observations = []
    started = time.perf_counter()
    with MemorySampler(pair, sample_interval) as memory:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            for _ in range(repetitions):
                # Waves bound simultaneous requests. There is no benchmark-side retry.
                futures = [pool.submit(request_once, client, operation) for _ in range(concurrency)]
                rows = [future.result() for future in futures]
                observations.extend(rows)
                if unsettled(rows):
                    break
    result = summarize(observations)
    result.update({"concurrency": concurrency, "repetitions_requested": repetitions,
                   "elapsed_s_including_sampling": time.perf_counter() - started,
                   "memory": memory.report(),
                   "observations": [asdict(row) for row in observations],
                   "possible_residual_work": unsettled(observations)})
    return result


def unsettled(rows):
    # A client/proxy timeout or disconnect does NOT cancel the backend CPU thread.
    return any(row.category in ("timeout", "transport_error") or row.status in (502, 504)
               for row in rows)


def metadata_report():
    backend = Path(__file__).resolve().parents[1]
    versions = {}
    for package in ("numpy", "scipy", "astropy", "astropy-iers-data",
                    "spiceypy", "jplephem", "fastapi", "pydantic", "httpx", "uvicorn"):
        try:
            versions[package] = metadata.version(package)
        except metadata.PackageNotFoundError:
            versions[package] = None
    paths = [backend / "data-inventory.json", backend / "src/astro_system/iers-policy.json",
             *sorted((backend / "src").rglob("*.py")),
             backend / "tools/service_pair.py", Path(__file__).resolve()]
    hashes = {str(path.relative_to(backend)).replace("\\", "/"):
              hashlib.sha256(path.read_bytes()).hexdigest() for path in paths if path.is_file()}
    return {"python": platform.python_version(), "implementation": platform.python_implementation(),
            "os": platform.system(), "os_release": platform.release(), "machine": platform.machine(),
            "logical_cpus": os.cpu_count(), "versions": versions, "sha256": hashes,
            "server_thread_env": {"OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"}}


@contextmanager
def new_report(path):
    """Atomic exclusive creation prevents overwriting previous measurement evidence."""
    with Path(path).open("x", encoding="utf-8") as stream:
        report = {"schema_version": 1, "complete": False, "operations": {}}
        try:
            yield report
        finally:
            json.dump(report, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")


def run(args, report):
    report.update({
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "environment": metadata_report(),
        "configuration": {key: value for key, value in vars(args).items() if key != "output"},
        "method": {
            "percentiles": "nearest-rank, computed separately for each outcome category",
            "cold": "first operation request after fresh pair startup; health and startup load already occurred",
            "warm": "same pair after cold request and one explicit priming request",
            "success": "HTTP 2xx only; correctness is covered by separate scientific tests",
            "timeout": "does not cancel CPU work; remaining phases of that operation are omitted",
            "location": "fixed public Dallas test point, not user input",
            "retries": 0,
        },
    })
    for operation in args.operations:
        record = {}
        report["operations"][operation] = record
        try:
            with service_pair(startup_timeout=args.startup_timeout,
                              orbital_timeout=args.orbital_timeout,
                              science_concurrency=args.science_concurrency,
                              workers=args.workers) as pair:
                record["startup_seconds"] = dict(pair.startup_seconds)
                with httpx.Client(base_url=pair.base, timeout=args.timeout, trust_env=False,
                                  limits=httpx.Limits(max_connections=max(args.concurrency),
                                                      max_keepalive_connections=max(args.concurrency))) as client:
                    record["cold"] = phase(client, pair, operation, concurrency=1, repetitions=1,
                                           sample_interval=args.sample_interval)
                    if record["cold"]["possible_residual_work"]:
                        record["omitted"] = "warm phases: possible residual work after timeout/disconnect"
                        continue
                    priming = request_once(client, operation)
                    record["warmup"] = asdict(priming)
                    if unsettled([priming]):
                        record["omitted"] = "warm phases: possible residual work after priming"
                        continue
                    record["warm"] = []
                    for concurrency in args.concurrency:
                        measured = phase(client, pair, operation, concurrency=concurrency,
                                         repetitions=args.repetitions, sample_interval=args.sample_interval)
                        record["warm"].append(measured)
                        if measured["possible_residual_work"]:
                            record["omitted"] = "remaining concurrency phases: possible residual work"
                            break
        except Exception as error:
            # Exception messages can contain local paths/URLs; only persist the class.
            record["failure"] = type(error).__name__
            report["complete"] = False
            raise
    report["complete"] = True
    report["finished_at_utc"] = datetime.now(timezone.utc).isoformat()


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--repetitions", type=int, default=3, help="waves per warm concurrency")
    result.add_argument("--concurrency", type=int, nargs="+", default=[1, 2, 4])
    result.add_argument("--operations", nargs="+", choices=list(OPERATIONS), default=list(OPERATIONS))
    result.add_argument("--workers", type=int, default=1, help="workers per role")
    result.add_argument("--science-concurrency", type=int, default=1, help="limit per worker")
    result.add_argument("--startup-timeout", type=float, default=60)
    result.add_argument("--orbital-timeout", type=float, default=60)
    result.add_argument("--timeout", type=float, default=120, help="HTTP client timeout in seconds")
    result.add_argument("--sample-interval", type=float, default=.1)
    result.add_argument("--output", required=True, type=Path, help="NEW JSON path; parent must exist")
    return result


def main(argv=None):
    argument_parser = parser()
    args = argument_parser.parse_args(argv)
    if any(value < 1 for value in [args.repetitions, args.workers, args.science_concurrency,
                                    *args.concurrency]):
        argument_parser.error("repetitions/concurrency/workers must be positive")
    if any(not math.isfinite(value) or value <= 0 for value in
           (args.startup_timeout, args.orbital_timeout, args.timeout, args.sample_interval)):
        argument_parser.error("timeouts and sample interval must be finite and positive")
    args.operations = list(dict.fromkeys(args.operations))
    args.concurrency = list(dict.fromkeys(args.concurrency))
    try:
        with new_report(args.output) as report:
            run(args, report)
    except FileExistsError:
        argument_parser.error("output already exists; choose a new path")
    except Exception as error:
        print(f"Benchmark failed: {type(error).__name__}; inspect the partial report.", file=sys.stderr)
        return 1
    print(f"Benchmark finished. Report: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
