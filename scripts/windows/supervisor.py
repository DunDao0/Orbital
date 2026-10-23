"""Local process owner. Stop requests affect only children created by this process."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]


def retry_state_io(operation, timeout=5.0):
    """Readers/security scanners can briefly prevent replacement on Windows."""
    deadline = time.monotonic() + timeout
    while True:
        try:
            return operation()
        except PermissionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.05)


def save_state(state_file, state):
    temporary = state_file.with_suffix(".tmp")

    def replace():
        state["heartbeat"] = time.time()
        temporary.write_text(json.dumps(state), encoding="utf-8")
        temporary.replace(state_file)

    retry_state_io(replace)


class ChildJob:
    """Windows job kills owned grandchildren (workerd included), never other apps."""
    def __init__(self):
        self.handle = None
        if os.name != "nt":
            return
        import ctypes as c
        from ctypes import wintypes as w
        class Limits(c.Structure):
            _fields_ = [("process_time", c.c_int64), ("job_time", c.c_int64),
                        ("flags", w.DWORD), ("min_ws", c.c_size_t), ("max_ws", c.c_size_t),
                        ("active", w.DWORD), ("affinity", c.c_size_t),
                        ("priority", w.DWORD), ("scheduling", w.DWORD)]
        class Counters(c.Structure):
            _fields_ = [(name, c.c_uint64) for name in ("reads", "writes", "other", "read_bytes", "write_bytes", "other_bytes")]
        class Extended(c.Structure):
            _fields_ = [("basic", Limits), ("io", Counters), ("process_memory", c.c_size_t),
                        ("job_memory", c.c_size_t), ("peak_process", c.c_size_t), ("peak_job", c.c_size_t)]
        self.api = c.WinDLL("kernel32", use_last_error=True)
        self.api.CreateJobObjectW.restype = w.HANDLE
        self.api.CreateJobObjectW.argtypes = [c.c_void_p, w.LPCWSTR]
        self.api.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
        self.api.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        self.api.CloseHandle.argtypes = [w.HANDLE]
        self.handle = self.api.CreateJobObjectW(None, None)
        limits = Extended()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.handle or not self.api.SetInformationJobObject(self.handle, 9, c.byref(limits), c.sizeof(limits)):
            self.close()
            raise OSError("Nao foi possivel criar o grupo isolado de processos.")

    def add(self, child):
        if self.handle and not self.api.AssignProcessToJobObject(self.handle, int(child._handle)):
            raise OSError("Nao foi possivel isolar os processos. Inicializacao cancelada.")

    def close(self):
        if self.handle:
            self.api.CloseHandle(self.handle)
            self.handle = None


def response(url: str):
    try:
        with urlopen(url, timeout=3) as reply:
            return reply.status, json.load(reply)
    except HTTPError as error:
        try:
            return error.code, json.load(error)
        except ValueError:
            return error.code, {}
    except (URLError, TimeoutError, OSError, ValueError):
        return 0, {}


def free_port(port: int):
    with socket.socket() as probe:
        if os.name == "nt":
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        probe.bind(("127.0.0.1", port))


def run(node: str) -> int:
    local = ROOT / ".orbis"
    logs = local / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    # OS lock is released on crash and prevents two launchers owning the same ports.
    lock = (local / "supervisor.lock").open("a+b")
    if os.name == "nt":
        import msvcrt
        lock.seek(0)
        lock.write(b"0")
        lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            lock.close()
            return 1
    state = {"root": str(ROOT), "session": uuid.uuid4().hex, "pid": os.getpid(),
             "status": "starting", "heartbeat": time.time(), "warning": None}
    state_file = local / "state.json"

    def save():
        save_state(state_file, state)

    children, handles, job = [], [], None
    try:
        job = ChildJob()
        free_port(3000)
        free_port(8000)
        environment = dict(os.environ, PYTHONUNBUFFERED="1", WRANGLER_SEND_METRICS="false", NODE_ENV="development")
        environment.pop("ORBIS_SERVICE_ROLE", None)
        environment.pop("ORBIS_ORBITAL_URL", None)
        commands = [
            ("backend", [sys.executable, "-m", "uvicorn", "astro_system.api.main:app",
                         "--app-dir", str(ROOT / "backend/src"), "--host", "127.0.0.1",
                         "--port", "8000", "--no-access-log"]),
            ("frontend", [node, str(ROOT / "scripts/windows/start-frontend.mjs")]),
        ]
        for name, command in commands:
            output = (logs / f"{name}.log").open("ab", buffering=0)
            handles.append(output)
            children.append(subprocess.Popen(
                command, cwd=ROOT, env=environment, stdout=output, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            ))
            job.add(children[-1])
        state["children"] = [child.pid for child in children]
        save()
        deadline = time.monotonic() + 230
        while True:
            request = local / "stop.request"
            if request.is_file() and request.read_text(encoding="utf-8").strip() == state["session"]:
                break
            if any(child.poll() is not None for child in children):
                raise RuntimeError("Um servico encerrou. Consulte backend.log e frontend.log em .orbis/logs.")
            if state["status"] != "ready":
                backend_code, health = response("http://127.0.0.1:8000/api/health")
                front_code, front = response("http://127.0.0.1:3000/__orbis/health")
                if backend_code == 200 and health.get("api") == "orbis-local-scientific-api" and health.get("status") == "ok" and front_code == 200 and front.get("api") == "orbis-local-frontend":
                    # Compile the initial page before declaring it ready.
                    try:
                        with urlopen("http://127.0.0.1:3000", timeout=5) as page:
                            page_ok = page.status == 200 and b"html" in page.read(2048).lower()
                    except (URLError, OSError, TimeoutError):
                        page_ok = False
                    if page_ok:
                        _, readiness = response("http://127.0.0.1:8000/api/health/ready")
                        if not readiness.get("ready"):
                            state["warning"] = "Site aberto; parte dos dados cientificos esta indisponivel. Veja os avisos de cobertura na interface."
                        state["status"] = "ready"
                if time.monotonic() > deadline:
                    raise RuntimeError("Tempo limite ao abrir o site. Consulte .orbis/logs.")
            save()
            time.sleep(1)
    except Exception as error:
        state.update(status="error", error=str(error))
        print(str(error), file=sys.stderr, flush=True)
        try:
            save()
        except OSError as state_error:
            print(f"Nao foi possivel registrar o estado: {state_error}", file=sys.stderr, flush=True)
        return 1
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
        for handle in handles:
            handle.close()
        if job:
            job.close()
        try:
            if state["status"] != "error":
                retry_state_io(lambda: state_file.unlink(missing_ok=True))
        finally:
            lock.close()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--node", required=True)
    raise SystemExit(run(parser.parse_args().node))
