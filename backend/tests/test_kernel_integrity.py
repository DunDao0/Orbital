"""Fail-closed kernel trust-chain regressions using isolated temporary bundles."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from astro_system.ephemeris.provider import (
    ApplicationEphemerisProvider,
    REQUIRED_KERNELS,
    verify_kernel_manifest,
)


def _record(raw: bytes) -> dict[str, object]:
    return {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


@pytest.fixture
def bundle(tmp_path):
    data_root = tmp_path / "data"
    (data_root / "kernels").mkdir(parents=True)
    (data_root / "manifests").mkdir()
    inventory = {}
    entries = []
    for name in REQUIRED_KERNELS:
        raw = f"isolated test fixture: {name}".encode()
        (data_root / "kernels" / name).write_bytes(raw)
        record = _record(raw)
        inventory[f"data/kernels/{name}"] = record
        entries.append({"name": name, "size_bytes": record["bytes"], "sha256": record["sha256"]})
    manifest = {"schema": 1, "files": entries}
    raw = json.dumps(manifest).encode()
    (data_root / "manifests" / "kernels.json").write_bytes(raw)
    inventory["data/manifests/kernels.json"] = _record(raw)
    inventory_path = tmp_path / "approved-inventory.json"
    inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
    return data_root, inventory_path, manifest, inventory


def _approved_fixture_manifest(bundle, raw):
    """Only test fixtures may approve alternate manifests to exercise schema checks."""
    data_root, inventory_path, _, inventory = bundle
    (data_root / "manifests" / "kernels.json").write_bytes(raw)
    inventory["data/manifests/kernels.json"] = _record(raw)
    inventory_path.write_text(json.dumps(inventory), encoding="utf-8")


def test_complete_fixture_manifest_verifies_exactly_three_files(bundle):
    data_root, inventory_path, _, _ = bundle
    result = verify_kernel_manifest(data_root, inventory_path=inventory_path)
    assert result.status == "ok" and result.checked_files == 3 and not result.failed_names


def test_real_bundle_uses_inventory_from_code_not_copied_data_directory():
    data_root = Path(__file__).resolve().parents[2] / "data"
    result = verify_kernel_manifest(data_root)
    assert result.status == "ok" and result.checked_files == 3


@pytest.mark.parametrize("mutation", [
    "empty", "incomplete", "duplicate", "traversal", "absolute", "backslash",
    "non_list", "non_object", "missing_schema", "boolean_schema", "wrong_hash", "wrong_size",
])
def test_invalid_manifest_schema_is_rejected_even_with_matching_inventory_hash(bundle, mutation):
    data_root, inventory_path, manifest, _ = bundle
    if mutation == "empty":
        manifest["files"] = []
    elif mutation == "incomplete":
        manifest["files"].pop()
    elif mutation == "duplicate":
        manifest["files"][1] = manifest["files"][0].copy()
    elif mutation == "traversal":
        manifest["files"][0]["name"] = "../../external.tls"
    elif mutation == "absolute":
        manifest["files"][0]["name"] = "/outside/naif0012.tls"
    elif mutation == "backslash":
        manifest["files"][0]["name"] = "..\\external.tls"
    elif mutation == "non_list":
        manifest["files"] = {}
    elif mutation == "non_object":
        manifest["files"][0] = "naif0012.tls"
    elif mutation == "missing_schema":
        del manifest["schema"]
    elif mutation == "boolean_schema":
        manifest["schema"] = True
    elif mutation == "wrong_hash":
        manifest["files"][0]["sha256"] = "0" * 64
    elif mutation == "wrong_size":
        manifest["files"][0]["size_bytes"] += 1
    _approved_fixture_manifest(bundle, json.dumps(manifest).encode())
    with patch("astro_system.ephemeris.provider.SpiceEphemeris") as candidate:
        provider = ApplicationEphemerisProvider(data_root, inventory_path=inventory_path)
    assert not provider.available
    assert provider.verification.status == "failed"
    assert provider.verification.failed_names == ("kernels.json",)
    assert provider.initialization_error == "kernel_integrity_failed"
    candidate.assert_not_called()


@pytest.mark.parametrize("raw", [
    b"{", b"[]", b'{"schema":1,"files":[],"files":[]}',
    b'{"schema":1,"files":[],"value":NaN}', b'{"schema":1,"files":[],"value":Infinity}',
])
def test_malformed_manifest_never_escapes_provider_startup(bundle, raw):
    data_root, inventory_path, _, _ = bundle
    _approved_fixture_manifest(bundle, raw)
    provider = ApplicationEphemerisProvider(data_root, inventory_path=inventory_path)
    assert not provider.available and provider.verification.status == "failed"
    provider.close()


def test_manifest_cannot_approve_itself_after_edit(bundle):
    data_root, inventory_path, _, _ = bundle
    (data_root / "manifests" / "kernels.json").write_text('{"schema":1,"files":[]}', encoding="utf-8")
    result = verify_kernel_manifest(data_root, inventory_path=inventory_path)
    assert result.status == "failed" and result.checked_files == 0


@pytest.mark.parametrize("missing", [False, True])
def test_missing_or_corrupted_kernel_fails_without_initializing_reader(bundle, missing):
    data_root, inventory_path, _, _ = bundle
    path = data_root / "kernels" / "de442s.bsp"
    if missing:
        path.unlink()
    else:
        raw = path.read_bytes()
        path.write_bytes(b"X" + raw[1:])  # identical length must still fail SHA-256
    with patch("astro_system.ephemeris.provider.SpiceEphemeris") as candidate:
        provider = ApplicationEphemerisProvider(data_root, inventory_path=inventory_path)
    assert not provider.available and provider.verification.status == "failed"
    assert provider.verification.failed_names == ("de442s.bsp",)
    candidate.assert_not_called()


@pytest.mark.parametrize("mutation", ["missing", "malformed", "empty", "bad_hash", "bad_size", "duplicates"])
def test_invalid_inventory_fails_closed(bundle, mutation):
    data_root, inventory_path, _, inventory = bundle
    if mutation == "missing":
        inventory_path.unlink()
    elif mutation == "malformed":
        inventory_path.write_text("{", encoding="utf-8")
    elif mutation == "empty":
        inventory_path.write_text("{}", encoding="utf-8")
    elif mutation == "duplicates":
        inventory_path.write_text('{"duplicate":1,"duplicate":2}', encoding="utf-8")
    else:
        inventory["data/kernels/de442s.bsp"]["sha256" if mutation == "bad_hash" else "bytes"] = "not-approved"
        inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
    provider = ApplicationEphemerisProvider(data_root, inventory_path=inventory_path)
    assert not provider.available and provider.verification.status == "failed"
    assert provider.verification.failed_names == ("data-inventory.json",)


def test_resolved_kernel_path_cannot_escape_data_root(bundle, tmp_path):
    data_root, inventory_path, _, _ = bundle
    target = data_root / "kernels" / "de442s.bsp"
    original_resolve = Path.resolve

    def resolve(path, *args, **kwargs):
        # Simulate a symlink without requiring Windows symlink privileges.
        return tmp_path / "outside.bsp" if path == target else original_resolve(path, *args, **kwargs)

    with patch.object(Path, "resolve", resolve):
        result = verify_kernel_manifest(data_root, inventory_path=inventory_path)
    assert result.status == "failed" and result.failed_names == ("de442s.bsp",)


def test_missing_or_unreadable_manifest_is_unavailable_not_startup_exception(bundle):
    data_root, inventory_path, _, _ = bundle
    (data_root / "manifests" / "kernels.json").unlink()
    provider = ApplicationEphemerisProvider(data_root, inventory_path=inventory_path)
    assert not provider.available and provider.verification.failed_names == ("kernels.json",)
