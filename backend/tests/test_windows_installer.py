"""Offline installer regressions: approved bytes, conflicts and owned process cleanup."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]


def load_script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts/windows" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def bootstrap(tmp_path, monkeypatch):
    module = load_script("bootstrap_data")
    inventory = {}
    for relative, name in module.CATALOGUES.items():
        raw = json.dumps({"fixture": name}).encode()
        source = tmp_path / "public/scientific" / name
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(raw)
        inventory[relative] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    for name in ("kernels.json", "offline_catalogs.json", "benchmark.json"):
        raw = b'{"fixture":"approved manifest"}\n'
        source = tmp_path / "scripts/windows/manifests" / name
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(raw)
        inventory[f"data/manifests/{name}"] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    raw = b"approved kernel fixture"
    pin = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    inventory["data/kernels/test.bsp"] = pin
    (tmp_path / "backend").mkdir()
    (tmp_path / "backend/data-inventory.json").write_text(json.dumps(inventory))
    downloads = []

    def download(path, _):
        downloads.append(path)
        path.write_bytes(raw)

    fake = SimpleNamespace(PINNED_FILES={"test.bsp": {**pin, "size_bytes": len(raw)}}, _download_validated=download)
    monkeypatch.setattr(module.importlib.util, "spec_from_file_location",
                        lambda *args: SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _: None)))
    monkeypatch.setattr(module.importlib.util, "module_from_spec", lambda _: fake)
    return module, tmp_path, downloads


def test_installer_restores_exact_data_and_reuses_offline(bootstrap):
    module, root, downloads = bootstrap
    module.restore(root)
    assert len(downloads) == 1
    assert (root / "data/manifests/kernels.json").read_bytes() == (root / "scripts/windows/manifests/kernels.json").read_bytes()
    module.restore(root)
    module.restore(root, check_only=True)
    assert len(downloads) == 1


def test_installer_refuses_existing_different_data(bootstrap):
    module, root, downloads = bootstrap
    target = root / "data/moons/moons.json"
    target.parent.mkdir(parents=True)
    target.write_text("user data")
    with pytest.raises(ValueError, match="existentes"):
        module.restore(root)
    assert target.read_text() == "user data"
    assert downloads == []


def test_installer_rejects_tampered_public_catalogue(bootstrap):
    module, root, downloads = bootstrap
    (root / "public/scientific/moons.json").write_text("unapproved")
    with pytest.raises(ValueError, match="alterado"):
        module.restore(root)
    assert downloads == []


def test_installer_check_only_does_not_create_or_download(bootstrap):
    module, root, downloads = bootstrap
    with pytest.raises(ValueError, match="ausente"):
        module.restore(root, check_only=True)
    assert not (root / "data").exists()
    assert downloads == []


def test_installer_port_conflict_does_not_stop_owner():
    module = load_script("supervisor")
    with socket.socket() as owner:
        owner.bind(("127.0.0.1", 0))
        owner.listen()
        with pytest.raises(OSError):
            module.free_port(owner.getsockname()[1])
        assert owner.fileno() >= 0


@pytest.mark.skipif(os.name != "nt", reason="Windows job lifecycle")
def test_installer_job_closes_only_owned_child():
    module = load_script("supervisor")
    job = module.ChildJob()
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        job.add(child)
        job.close()
        child.wait(timeout=5)
        assert child.returncode is not None
    finally:
        job.close()
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=5)


def test_state_replacement_retries_and_keeps_previous_json(tmp_path, monkeypatch):
    module = load_script("supervisor")
    target = tmp_path / "state.json"
    target.write_text('{"status":"starting"}')
    replace = Path.replace
    attempts = []

    def briefly_locked(path, destination):
        attempts.append(1)
        if len(attempts) < 3:
            assert json.loads(target.read_text()) == {"status": "starting"}
            raise PermissionError("reader holds state.json")
        return replace(path, destination)

    monkeypatch.setattr(Path, "replace", briefly_locked)
    module.save_state(target, {"status": "ready", "session": "new"})
    assert len(attempts) == 3
    assert json.loads(target.read_text())["session"] == "new"
    assert not target.with_suffix(".tmp").exists()


def test_state_permanent_denial_is_bounded_and_other_errors_are_not_retried(monkeypatch):
    module = load_script("supervisor")
    ticks = iter([0, 0, 6])
    monkeypatch.setattr(module.time, "monotonic", lambda: next(ticks))
    monkeypatch.setattr(module.time, "sleep", lambda _: None)
    attempts = []

    def denied():
        attempts.append(1)
        raise PermissionError("permanent denial")

    with pytest.raises(PermissionError, match="permanent"):
        module.retry_state_io(denied)
    assert len(attempts) == 2
    monkeypatch.setattr(module.time, "monotonic", lambda: 0)
    with pytest.raises(OSError, match="disk full"):
        module.retry_state_io(lambda: (_ for _ in ()).throw(OSError("disk full")))


@pytest.mark.skipif(os.name != "nt", reason="Real Windows sharing violation")
def test_state_recovers_from_real_windows_reader_lock(tmp_path):
    import ctypes as c
    from ctypes import wintypes as w
    module = load_script("supervisor")
    target = tmp_path / "state.json"
    target.write_text('{"status":"starting"}')
    api = c.WinDLL("kernel32", use_last_error=True)
    api.CreateFileW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, c.c_void_p, w.DWORD, w.DWORD, w.HANDLE]
    api.CreateFileW.restype = w.HANDLE
    api.CloseHandle.argtypes = [w.HANDLE]
    # A reader without FILE_SHARE_DELETE reproduces the v0.1.1 failure.
    handle = api.CreateFileW(str(target), 0x80000000, 1, None, 3, 0, None)
    assert handle != c.c_void_p(-1).value
    temporary = target.with_suffix(".tmp")
    temporary.write_text("replacement")
    try:
        with pytest.raises(PermissionError):
            temporary.replace(target)
    except BaseException:
        api.CloseHandle(handle)
        raise
    release = threading.Timer(0.2, lambda: api.CloseHandle(handle))
    release.start()
    try:
        module.save_state(target, {"status": "ready"})
        assert json.loads(target.read_text())["status"] == "ready"
    finally:
        release.join()


def test_supervisor_reports_failure_even_when_state_is_unwritable(tmp_path, monkeypatch, capsys):
    module = load_script("supervisor")
    monkeypatch.setattr(module, "ROOT", tmp_path)
    events = []
    monkeypatch.setattr(module, "ChildJob", lambda: SimpleNamespace(close=lambda: events.append("closed")))
    monkeypatch.setattr(module, "free_port", lambda _: (_ for _ in ()).throw(RuntimeError("original startup failure")))
    monkeypatch.setattr(module, "save_state", lambda *_: (_ for _ in ()).throw(PermissionError("locked state")))
    assert module.run("unused-node") == 1
    assert events == ["closed"]
    errors = capsys.readouterr().err
    assert "original startup failure" in errors
    assert "locked state" in errors
