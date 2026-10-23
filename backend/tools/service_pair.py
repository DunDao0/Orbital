"""Owned, ephemeral loopback services. No Compose or pre-existing API is used."""
from collections import deque
from contextlib import contextmanager
from dataclasses import dataclass
import ctypes
import math
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import uuid


@dataclass(frozen=True)
class ProcessSample:
    pid: int
    parent_pid: int
    creation_id: int
    rss_bytes: int | None


def _windows_snapshot():
    """Toolhelp process ancestry + working set, without a psutil dependency."""
    from ctypes import wintypes as w

    class Entry(ctypes.Structure):
        _fields_ = [("size", w.DWORD), ("usage", w.DWORD), ("pid", w.DWORD),
                    ("heap", ctypes.c_size_t), ("module", w.DWORD), ("threads", w.DWORD),
                    ("parent", w.DWORD), ("priority", w.LONG), ("flags", w.DWORD),
                    ("exe", w.WCHAR * 260)]

    class Counters(ctypes.Structure):
        _fields_ = [("size", w.DWORD), ("faults", w.DWORD)] + [
            (name, ctypes.c_size_t) for name in
            ("peak", "rss", "paged_peak", "paged", "nonpaged_peak", "nonpaged",
             "pagefile", "pagefile_peak")]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [w.DWORD, w.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = w.HANDLE
    kernel.Process32FirstW.argtypes = kernel.Process32NextW.argtypes = [w.HANDLE, ctypes.POINTER(Entry)]
    kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    kernel.OpenProcess.restype = w.HANDLE
    kernel.GetProcessTimes.argtypes = [w.HANDLE] + [ctypes.POINTER(w.FILETIME)] * 4
    kernel.CloseHandle.argtypes = [w.HANDLE]
    psapi.GetProcessMemoryInfo.argtypes = [w.HANDLE, ctypes.POINTER(Counters), w.DWORD]
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == ctypes.c_void_p(-1).value:
        raise OSError("process_snapshot_unavailable")
    result = {}
    try:
        entry = Entry()
        entry.size = ctypes.sizeof(entry)
        found = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
        if not found:
            raise OSError("process_enumeration_unavailable")
        while found:
            handle = kernel.OpenProcess(0x0400 | 0x0010, False, entry.pid)
            if not handle:
                # Creation identity can still be readable without VM_READ access.
                handle = kernel.OpenProcess(0x1000, False, entry.pid)
            if handle:
                try:
                    stamps = [w.FILETIME() for _ in range(4)]
                    counters = Counters()
                    counters.size = ctypes.sizeof(counters)
                    if kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in stamps)):
                        created = (stamps[0].dwHighDateTime << 32) | stamps[0].dwLowDateTime
                        readable = psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.size)
                        result[entry.pid] = ProcessSample(
                            entry.pid, entry.parent, created, counters.rss if readable else None)
                finally:
                    kernel.CloseHandle(handle)
            found = kernel.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel.CloseHandle(snapshot)
    return result


def process_snapshot():
    if os.name == "nt":
        return _windows_snapshot()
    result = {}
    page_size = os.sysconf("SC_PAGE_SIZE")
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            text = (entry / "stat").read_text()
            fields = text[text.rfind(")") + 2:].split()
            if fields[0] != "Z":
                result[int(entry.name)] = ProcessSample(
                    int(entry.name), int(fields[1]), int(fields[19]), int(fields[21]) * page_size)
        except (OSError, ValueError, IndexError):
            continue  # A process may disappear during enumeration.
    return result


def owned_tree(snapshot, anchors):
    """Never adopt a reused PID or an unrelated process with an older birth time."""
    owned = {pid: item for pid, item in snapshot.items()
             if anchors.get(pid) == item.creation_id}
    while True:
        additions = {pid: item for pid, item in snapshot.items()
                     if pid not in owned and item.parent_pid in owned
                     and item.creation_id >= owned[item.parent_pid].creation_id}
        if not additions:
            return owned
        owned.update(additions)


def safe_diagnostic(line):
    """Allowlist categories only. Never retain raw URLs, coordinates or secrets."""
    worker = re.search(r"Started server process \[(\d{1,10})\]", line)
    if worker:
        return f"worker_started:{worker.group(1)}"
    if "Application startup complete" in line:
        return "startup_complete"
    if "Address already in use" in line or "10048" in line:
        return "address_in_use"
    # Never echo an arbitrary token merely because it ends in "Error".
    for name in ("ValueError", "TypeError", "RuntimeError", "OSError", "ImportError",
                 "ModuleNotFoundError", "PermissionError", "FileNotFoundError",
                 "TimeoutError", "MemoryError"):
        if re.search(rf"\b{name}\b", line):
            return f"exception:{name}"
    return "log_line_redacted"


def _terminate_windows(sample):
    """Check creation identity on the same handle used to terminate (no PID race)."""
    from ctypes import wintypes as w
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    kernel.OpenProcess.restype = w.HANDLE
    kernel.GetProcessTimes.argtypes = [w.HANDLE] + [ctypes.POINTER(w.FILETIME)] * 4
    kernel.TerminateProcess.argtypes = [w.HANDLE, w.UINT]
    kernel.CloseHandle.argtypes = [w.HANDLE]
    handle = kernel.OpenProcess(0x1000 | 1, False, sample.pid)
    if not handle:
        return
    try:
        stamps = [w.FILETIME() for _ in range(4)]
        if kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in stamps)):
            created = (stamps[0].dwHighDateTime << 32) | stamps[0].dwLowDateTime
            if created == sample.creation_id:
                kernel.TerminateProcess(handle, 1)
    finally:
        kernel.CloseHandle(handle)


class _WindowsJob:
    """Kill-on-close contains descendants, including the Windows venv launcher."""
    def __init__(self, process):
        from ctypes import wintypes as w

        class Basic(ctypes.Structure):
            _fields_ = [("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
                        ("flags", w.DWORD), ("min_ws", ctypes.c_size_t),
                        ("max_ws", ctypes.c_size_t), ("active", w.DWORD),
                        ("affinity", ctypes.c_size_t), ("priority", w.DWORD),
                        ("scheduling", w.DWORD)]

        class Extended(ctypes.Structure):
            _fields_ = [("basic", Basic), ("io", ctypes.c_ulonglong * 6),
                        ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                        ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]

        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, w.LPCWSTR]
        self.kernel.CreateJobObjectW.restype = w.HANDLE
        self.kernel.SetInformationJobObject.argtypes = [w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD]
        self.kernel.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        self.kernel.CloseHandle.argtypes = [w.HANDLE]
        self.handle = self.kernel.CreateJobObjectW(None, None)
        info = Extended()
        info.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.handle:
            raise OSError("job_unavailable")
        if not self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(info), ctypes.sizeof(info)):
            self.close()
            raise OSError("job_configuration_failed")
        if not self.kernel.AssignProcessToJobObject(self.handle, int(process._handle)):
            self.close()
            raise OSError("job_assignment_failed")

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def create_probe_app():
    """Private validation factory; production API factories are unchanged."""
    from astro_system.api.services import create_app
    token = os.environ.get("ORBIS_BENCHMARK_INSTANCE", "")
    if re.fullmatch(r"[a-f0-9]{32}", token) is None:
        raise RuntimeError("missing validation instance")
    app = create_app()

    @app.middleware("http")
    async def identify_instance(request, call_next):
        response = await call_next(request)
        response.headers["X-Orbis-Benchmark-Instance"] = token
        return response
    return app


def owned_health(response, token):
    return response.status == 200 and response.headers.get("X-Orbis-Benchmark-Instance") == token


class ServicePair:
    def __init__(self, *, startup_timeout=60, shutdown_timeout=10, orbital_timeout=60,
                 science_concurrency=1, workers=1, windows_job=True):
        for value in (startup_timeout, shutdown_timeout, orbital_timeout):
            if not math.isfinite(value) or value <= 0:
                raise ValueError("timeouts must be finite and positive")
        if any(type(value) is not int or value < 1 for value in (science_concurrency, workers)):
            raise ValueError("concurrency and workers must be positive integers")
        self.startup_timeout, self.shutdown_timeout = startup_timeout, shutdown_timeout
        self.orbital_timeout = orbital_timeout
        self.science_concurrency, self.workers = science_concurrency, workers
        self.windows_job = windows_job
        self.orbital_port, self.science_port = free_port(), free_port()
        while self.science_port == self.orbital_port:
            self.science_port = free_port()
        self.base = f"http://127.0.0.1:{self.science_port}"
        self.processes, self._anchors, self._jobs, self._readers = {}, {}, {}, {}
        self.logs, self.worker_pids, self.startup_seconds = {}, {}, {}
        self._lock = threading.Lock()

    def _drain(self, role, stream):
        try:
            while line := stream.readline(1024):
                category = safe_diagnostic(line)
                with self._lock:
                    self.logs[role].append(category)
                    if category.startswith("worker_started:"):
                        self.worker_pids[role].add(int(category.split(":")[1]))
        finally:
            stream.close()

    def samples(self):
        snapshot = process_snapshot()
        with self._lock:
            result = {}
            for role, anchors in self._anchors.items():
                result[role] = owned_tree(snapshot, anchors)
                anchors.update({pid: row.creation_id for pid, row in result[role].items()})
            return result

    def start(self, role):
        if role not in ("orbital", "science"):
            raise ValueError("unknown service role")
        if role in self.processes:
            raise RuntimeError("service already started")
        port = self.orbital_port if role == "orbital" else self.science_port
        token = uuid.uuid4().hex
        env = {**os.environ, "ORBIS_SERVICE_ROLE": role,
               "ORBIS_BENCHMARK_INSTANCE": token,
               "ORBIS_ORBITAL_URL": f"http://127.0.0.1:{self.orbital_port}",
               "ORBIS_ORBITAL_TIMEOUT_SECONDS": str(self.orbital_timeout),
               "ORBIS_SCIENCE_CONCURRENCY": str(self.science_concurrency),
               "PYTHONDONTWRITEBYTECODE": "1", "OMP_NUM_THREADS": "1",
               "OPENBLAS_NUM_THREADS": "1"}
        backend = Path(__file__).resolve().parents[1]
        env["PYTHONPATH"] = os.pathsep.join((str(backend / "src"), str(backend)))
        self.logs[role], self.worker_pids[role] = deque(maxlen=40), set()
        started = time.monotonic()
        process = subprocess.Popen(
            [sys.executable, "-B", "-m", "uvicorn", "tools.service_pair:create_probe_app",
             "--factory", "--host", "127.0.0.1", "--port", str(port), "--no-access-log",
             "--no-use-colors", "--workers", str(self.workers),
             "--timeout-graceful-shutdown", str(max(1, int(self.shutdown_timeout / 2)))],
            env=env, cwd=backend, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, errors="replace", start_new_session=os.name != "nt",
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0)
        self.processes[role] = process
        self._anchors[role] = {}
        self._readers[role] = None
        reason = "startup_check_failed"
        try:
            if os.name == "nt" and self.windows_job:
                try:
                    self._jobs[role] = _WindowsJob(process)
                except OSError:
                    self.logs[role].append("job_unavailable_identity_fallback")
            snapshot = process_snapshot()
            if process.pid not in snapshot:
                reason = "launcher_identity_unavailable"
                raise RuntimeError("launcher_identity_unavailable")
            self._anchors[role][process.pid] = snapshot[process.pid].creation_id
            reader = threading.Thread(target=self._drain, args=(role, process.stdout), daemon=True)
            self._readers[role] = reader
            reader.start()
            # No system proxy: these URLs always belong to this pair.
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            deadline = started + self.startup_timeout
            while time.monotonic() < deadline:
                self.samples()  # Discover launcher descendants before any early failure.
                if process.poll() is not None:
                    reason = "process_exited"
                    raise RuntimeError("process_exited")
                try:
                    with opener.open(f"http://127.0.0.1:{port}/api/health", timeout=1) as response:
                        if owned_health(response, token):
                            self.startup_seconds[role] = time.monotonic() - started
                            return
                        reason = "instance_mismatch"
                        time.sleep(.1)
                except OSError:
                    time.sleep(.1)
            if reason != "instance_mismatch":
                reason = "startup_timeout"
            raise RuntimeError(reason)
        except Exception as error:
            with self._lock:
                diagnostic = ";".join(self.logs[role])
            try:
                self.stop(role)
            except Exception:
                diagnostic += ";cleanup_unconfirmed"
            raise RuntimeError(
                f"{role} startup failed: {reason}; exit={process.returncode}; "
                f"error={type(error).__name__}; {diagnostic}") from None

    def stop(self, role):
        process = self.processes.get(role)
        if process is None:
            return
        # Sampling is diagnostic and must never prevent closing our job/handle.
        snapshot_failed = False
        try:
            known = self.samples().get(role, {})
        except Exception:
            snapshot_failed = True
            known = {}
        job = self._jobs.pop(role, None)
        anchors = dict(self._anchors.get(role, {}))
        if os.name == "nt":
            # Last observed identities remain safe: termination rechecks on its handle.
            for pid, created in anchors.items():
                known.setdefault(pid, ProcessSample(pid, 0, created, 0))

        def signal_group(signum):
            # An unreaped live Popen prevents PID reuse. Once reaped, require a
            # currently verified member before touching the private group.
            alive = process.poll() is None
            if not alive and not any(
                _same_group(row, process.pid) for row in known.values()
            ):
                return
            try:
                os.killpg(process.pid, signum)
            except ProcessLookupError:
                pass

        try:
            if job:
                job.close()
            elif os.name == "nt":
                for sample in sorted(known.values(), key=lambda row: row.creation_id):
                    _terminate_windows(sample)
            else:
                signal_group(signal.SIGTERM)
            deadline = time.monotonic() + self.shutdown_timeout
            while time.monotonic() < deadline:
                process.poll()
                try:
                    known = self.samples().get(role, {})
                except Exception:
                    snapshot_failed = True
                    break
                if not known:
                    break
                time.sleep(.05)
            if known:
                if os.name == "nt":
                    for sample in known.values():
                        _terminate_windows(sample)
                else:
                    signal_group(signal.SIGKILL)
        finally:
            # Even a failed sampler/Job Object must not leak our launcher.
            try:
                if job:
                    job.close()
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=self.shutdown_timeout)
                reader = self._readers.get(role)
                if reader is not None and getattr(reader, "ident", True) is not None:
                    reader.join(timeout=2)
                elif process.stdout is not None:
                    process.stdout.close()
        try:
            remaining = self.samples().get(role, {})
        except Exception:
            snapshot_failed = True
            remaining = {}
        with self._lock:
            self._anchors.pop(role, None)
        self.processes.pop(role, None)
        if remaining or snapshot_failed:
            raise RuntimeError(f"{role} cleanup unconfirmed: "
                               f"{'owned process remains' if remaining else 'sampling unavailable'}")


def _same_group(sample, group):
    try:
        text = Path(f"/proc/{sample.pid}/stat").read_text()
        fields = text[text.rfind(")") + 2:].split()
        return (int(fields[19]) == sample.creation_id
                and fields[0] != "Z" and os.getpgid(sample.pid) == group)
    except (OSError, ValueError, IndexError):
        return False


@contextmanager
def service_pair(**kwargs):
    pair = ServicePair(**kwargs)
    try:
        pair.start("orbital")
        pair.start("science")
        yield pair
    finally:
        try:
            pair.stop("science")
        finally:
            pair.stop("orbital")
