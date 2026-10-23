"""Offline approval guards; never install packages, start Docker, or run the suite recursively."""
import importlib.util
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace

import pytest

SPEC = importlib.util.spec_from_file_location("scientific_gates", Path(__file__).parents[1] / "tools/run_gates.py")
gates = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gates)


def test_both_platform_locks_match_scientific_versions_and_artifacts():
    linux = gates.approved_pins("linux-cp312")
    windows = gates.approved_pins("windows-cp312")
    assert "uvloop" in linux and "uvloop" not in windows
    assert "colorama" in windows and "colorama" not in linux
    assert windows["spiceypy"] == linux["spiceypy"] == "7.0.0"
    assert len(windows) == len(linux) == 35


@pytest.mark.parametrize("profile,system", [("windows-cp312", "Windows"), ("linux-cp312", "Linux")])
def test_environment_guard_verifies_actual_versions(monkeypatch, profile, system):
    monkeypatch.setattr(gates.platform, "system", lambda: system)
    monkeypatch.setattr(gates.platform, "machine", lambda: "AMD64")
    monkeypatch.setattr(gates.platform, "python_implementation", lambda: "CPython")
    monkeypatch.setattr(gates.sys, "version_info", (3, 12, 14))
    monkeypatch.setattr(gates.struct, "calcsize", lambda _: 8)
    pins = gates.approved_pins(profile)
    monkeypatch.setattr(gates.importlib.metadata, "version", lambda name: pins[name])
    assert gates.verify_environment(profile)["status"] == "verified"
    monkeypatch.setattr(gates.importlib.metadata, "version", lambda name: "0.0.0")
    with pytest.raises(ValueError, match="Unapproved version"):
        gates.verify_environment(profile)


@pytest.mark.parametrize("system,machine,version,implementation,bits", [
    ("Linux", "AMD64", (3, 12, 14), "CPython", 8),
    ("Windows", "ARM64", (3, 12, 14), "CPython", 8),
    ("Windows", "AMD64", (3, 14, 2), "CPython", 8),
    ("Windows", "AMD64", (3, 12, 14), "PyPy", 8),
    ("Windows", "AMD64", (3, 12, 14), "CPython", 4),
])
def test_profile_rejects_wrong_platform(monkeypatch, system, machine, version, implementation, bits):
    monkeypatch.setattr(gates.platform, "system", lambda: system)
    monkeypatch.setattr(gates.platform, "machine", lambda: machine)
    monkeypatch.setattr(gates.platform, "python_implementation", lambda: implementation)
    monkeypatch.setattr(gates.sys, "version_info", version)
    monkeypatch.setattr(gates.struct, "calcsize", lambda _: bits)
    with pytest.raises(ValueError, match="requires Windows AMD64 CPython"):
        gates.verify_environment("windows-cp312")


def test_profile_rejects_missing_package(monkeypatch):
    monkeypatch.setattr(gates.platform, "system", lambda: "Windows")
    monkeypatch.setattr(gates.platform, "machine", lambda: "AMD64")
    monkeypatch.setattr(gates.platform, "python_implementation", lambda: "CPython")
    monkeypatch.setattr(gates.sys, "version_info", (3, 12, 14))
    monkeypatch.setattr(gates.struct, "calcsize", lambda _: 8)
    def missing(_):
        raise gates.importlib.metadata.PackageNotFoundError("controlled")
    monkeypatch.setattr(gates.importlib.metadata, "version", missing)
    with pytest.raises(ValueError, match="Missing approved package"):
        gates.verify_environment("windows-cp312")


def test_profile_is_required_and_unknown_profiles_are_refused():
    with pytest.raises(SystemExit):
        gates.main([])
    with pytest.raises(ValueError, match="explicit approved environment"):
        gates.approved_pins("automatic")


def test_cross_platform_version_drift_is_refused(monkeypatch):
    original = gates.load_pins
    def drift(root, profiles):
        pins = original(root, profiles)
        if profiles == ("windows-cp312",):
            pins["astropy"] = "0.0.0"
        return pins
    monkeypatch.setattr(gates, "load_pins", drift)
    with pytest.raises(ValueError, match="beyond approved platform adjustments"):
        gates.approved_pins("windows-cp312")


@pytest.mark.parametrize("invalid", ["demo>=1", "demo==1.0 --hash=sha256:invalid"])
def test_unhashed_and_floating_pins_are_refused(tmp_path, invalid):
    (tmp_path / "locks").mkdir()
    (tmp_path / "locks/test.lock").write_text(invalid)
    with pytest.raises(ValueError, match="Invalid hash pin"):
        gates.load_pins(tmp_path, ("test",))


def test_artifact_hash_mismatch_is_refused(tmp_path):
    (tmp_path / "locks").mkdir()
    (tmp_path / "locks/test.lock").write_text("demo==1.0 --hash=sha256:" + "a" * 64)
    (tmp_path / "locks/test.artifacts.json").write_text(json.dumps([
        {"name": "demo", "version": "1.0", "archive_info": {"hashes": {"sha256": "b" * 64}}}
    ]))
    with pytest.raises(ValueError, match="Artifact/lock mismatch"):
        gates.load_pins(tmp_path, ("test",))


@pytest.mark.parametrize("check_only", [False, True])
def test_gate_runs_all_offline_checks_and_never_disguises_diagnostics(monkeypatch, capsys, check_only):
    monkeypatch.setattr(gates, "verify_environment", lambda profile: {"profile": profile})
    monkeypatch.setattr(gates, "verify_scientific_data", lambda: {"iers": "fixture"})
    calls = []
    monkeypatch.setattr(gates.subprocess, "run", lambda *args, **kwargs: calls.append((args, kwargs)))
    args = ["--environment", "windows-cp312"] + (["--check-only"] if check_only else [])
    assert gates.main(args) == 0
    assert len(calls) == (2 if check_only else 3)
    for arguments, options in calls:
        assert options["check"] is True
        assert options["env"]["ORBIS_REQUIRE_COMPLETE_TESTS"] == "1"
        assert options["env"]["PYTHONDONTWRITEBYTECODE"] == "1"
    if not check_only:
        assert {"tests", "validation", "no:cacheprovider"} <= set(calls[-1][0][0])
    summary = json.loads(capsys.readouterr().out.splitlines()[-1])
    assert summary["suite_executed"] is not check_only
    assert summary["result"] == ("checks-only-passed" if check_only else "complete-gate-passed")


def test_failed_inventory_or_suite_stops_gate(monkeypatch):
    monkeypatch.setattr(gates, "verify_environment", lambda profile: {"profile": profile})
    monkeypatch.setattr(gates, "verify_scientific_data", lambda: {})
    def failed(command, **kwargs):
        raise subprocess.CalledProcessError(1, command)
    monkeypatch.setattr(gates.subprocess, "run", failed)
    with pytest.raises(subprocess.CalledProcessError):
        gates.main(["--environment", "windows-cp312"])


@pytest.mark.parametrize("options", ["-k test_one", "--ignore=tests/test_time.py", "-m smoke"])
def test_complete_gate_refuses_environment_selection_before_any_checks(monkeypatch, options):
    monkeypatch.setenv("PYTEST_ADDOPTS", options)
    def unexpected(profile):
        pytest.fail("Refuse external selection before environment/science execution")
    monkeypatch.setattr(gates, "verify_environment", unexpected)
    with pytest.raises(ValueError, match="PYTEST_ADDOPTS must be empty"):
        gates.main(["--environment", "windows-cp312"])


@pytest.mark.parametrize("stats", [{"skipped": [object()]}, {"deselected": [object()]}])
def test_complete_suite_rejects_unexecuted_tests(monkeypatch, stats):
    spec = importlib.util.spec_from_file_location("complete_gate_hooks", Path(__file__).with_name("conftest.py"))
    hooks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hooks)
    messages = []
    reporter = SimpleNamespace(stats=stats, write_sep=lambda *args: messages.append(args))
    session = SimpleNamespace(exitstatus=0, config=SimpleNamespace(
        pluginmanager=SimpleNamespace(get_plugin=lambda name: reporter)))
    monkeypatch.setenv("ORBIS_REQUIRE_COMPLETE_TESTS", "1")
    hooks.pytest_sessionfinish(session, 0)
    assert session.exitstatus == 1
    assert messages


def test_complete_suite_rejects_missing_execution_statistics(monkeypatch):
    spec = importlib.util.spec_from_file_location("complete_gate_hooks", Path(__file__).with_name("conftest.py"))
    hooks = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hooks)
    session = SimpleNamespace(exitstatus=0, config=SimpleNamespace(
        pluginmanager=SimpleNamespace(get_plugin=lambda name: None)))
    monkeypatch.setenv("ORBIS_REQUIRE_COMPLETE_TESTS", "1")
    hooks.pytest_sessionfinish(session, 0)
    assert session.exitstatus == 1
