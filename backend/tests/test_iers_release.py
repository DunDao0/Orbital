"""Offline release/rollback regressions; no package installs or network."""
import importlib.util
import io
import json
from pathlib import Path
import zipfile

import pytest

SPEC = importlib.util.spec_from_file_location("iers_release", Path(__file__).parents[1] / "tools/update_iers.py")
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


def fixture_release(tmp_path):
    root, archive = tmp_path / "backend", tmp_path / "release"
    manifest = {"schema_version": 2, "version": "new", "previous_version": "old", "files": {}}
    for side in ("previous", "candidate"):
        manifest["files"][side] = {}
        for name in release.PATHS:
            content = f"{side}:{name}".encode()
            path = archive / side / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            manifest["files"][side][name] = release.digest(content)
            if side == "previous":
                local = root / name
                local.parent.mkdir(parents=True, exist_ok=True)
                local.write_bytes(content)
    (archive / "release.json").write_text(json.dumps(manifest))
    return root, archive


def test_release_round_trip_preserves_previous_files(tmp_path):
    root, archive = fixture_release(tmp_path)
    assert release.activate(archive, root=root)["version"] == "new"
    assert release.activate(archive, root=root)["status"] == "already-active"
    assert release.activate(archive, root=root, rollback=True)["version"] == "old"
    for name in release.PATHS:
        assert (root / name).read_bytes() == (archive / "previous" / name).read_bytes()


def test_release_refuses_unrelated_local_edit(tmp_path):
    root, archive = fixture_release(tmp_path)
    (root / release.PATHS[-1]).write_bytes(b"user edit")
    before = {p: (root / p).read_bytes() for p in release.PATHS}
    with pytest.raises(ValueError, match="Local files changed"):
        release.activate(archive, root=root)
    assert before == {p: (root / p).read_bytes() for p in release.PATHS}


def test_activation_write_failure_recovers_every_previous_byte(tmp_path, monkeypatch):
    root, archive = fixture_release(tmp_path)
    previous = {name: (root / name).read_bytes() for name in release.PATHS}
    failure_path = root / release.PATHS[-1]
    original_write = Path.write_bytes
    injected = False
    def fail_once(path, data):
        nonlocal injected
        if path == failure_path and not injected:
            injected = True
            raise OSError("Controlled one-shot write failure")
        return original_write(path, data)
    monkeypatch.setattr(Path, "write_bytes", fail_once)
    with pytest.raises(OSError, match="Controlled one-shot write failure"):
        release.activate(archive, root=root)
    assert injected
    assert previous == {name: (root / name).read_bytes() for name in release.PATHS}


def test_release_refuses_corruption_and_unexpected_paths(tmp_path):
    root, archive = fixture_release(tmp_path)
    (archive / "candidate" / release.POLICY).write_bytes(b"corrupt")
    with pytest.raises(ValueError, match="checksum"):
        release.activate(archive, root=root)
    manifest = json.loads((archive / "release.json").read_text())
    manifest["files"]["candidate"]["../outside"] = "invalid"
    (archive / "release.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="paths"):
        release.activate(archive, root=root)


def test_active_iers_policy_and_lock_sets_are_coherent():
    root = Path(__file__).parents[1]
    policy = json.loads((root / release.POLICY).read_text())
    entries = []
    for profile in ("iers", "runtime", "windows-cp312"):
        artifacts = json.loads((root / f"locks/{profile}.artifacts.json").read_text())
        selected = [item for item in artifacts if item["name"].replace("_", "-").lower() == "astropy-iers-data"]
        assert len(selected) == 1
        entry = selected[0]
        assert entry["version"] == policy["version"]
        expected = f"astropy-iers-data=={entry['version']} --hash=sha256:{entry['archive_info']['hashes']['sha256']}"
        assert expected in (root / f"locks/{profile}.lock").read_text().splitlines()
        entries.append(entry)
    assert entries[0] == entries[1] == entries[2]


def test_legacy_release_is_preserved_and_refused_explicitly(tmp_path):
    root, archive = fixture_release(tmp_path)
    manifest = json.loads((archive / "release.json").read_text())
    manifest["schema_version"] = 1
    (archive / "release.json").write_text(json.dumps(manifest))
    before = {name: (root / name).read_bytes() for name in release.PATHS}
    with pytest.raises(ValueError, match="Legacy release lacks the Windows lock"):
        release.activate(archive, root=root)
    assert before == {name: (root / name).read_bytes() for name in release.PATHS}


@pytest.mark.parametrize("missing", [release.PATHS[-1:], release.PATHS[-2:-1], release.PATHS[-2:]])
def test_incomplete_windows_pair_is_refused_before_download_or_write(tmp_path, monkeypatch, missing):
    root, archive = fixture_release(tmp_path)
    for name in missing:
        (root / name).unlink()
    existing = {name: (root / name).read_bytes() for name in release.PATHS if name not in missing}
    def unexpected_download(*args):
        pytest.fail("Incomplete local profiles must fail before network access")
    monkeypatch.setattr(release, "fetch", unexpected_download)
    with pytest.raises(ValueError, match="Windows lock/artifacts pair"):
        release.prepare("0.2030.1.1.0.0.0", tmp_path / "new-release", root)
    with pytest.raises(ValueError, match="Windows lock/artifacts pair"):
        release.activate(archive, root=root)
    assert existing == {name: (root / name).read_bytes() for name in existing}
    assert not (tmp_path / "new-release").exists()


def test_prepare_updates_both_platforms_without_changing_other_pins(tmp_path, monkeypatch):
    root = tmp_path / "backend"
    source = Path(__file__).parents[1]
    for name in release.PATHS:
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((source / name).read_bytes())
    before = {name: (root / name).read_bytes() for name in release.PATHS}
    policy = json.loads(before[release.POLICY])
    version = "0.2030.1.1.0.0.0"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as wheel:
        wheel.writestr(f"astropy_iers_data-{version}.dist-info/METADATA",
                       f"Name: astropy-iers-data\nVersion: {version}\n")
        for name in policy["files"]:
            wheel.writestr(f"astropy_iers_data/data/{name}", b"controlled test fixture")
    wheel_bytes = buffer.getvalue()
    artifact = {"filename": f"astropy_iers_data-{version}-py3-none-any.whl",
                "yanked": False, "url": "https://files.pythonhosted.org/controlled.whl",
                "digests": {"sha256": release.digest(wheel_bytes)}}
    metadata = release.encoded({"info": {"version": version}, "urls": [artifact]})
    monkeypatch.setattr(release, "fetch", lambda url, limit: metadata if url.endswith("/json") else wheel_bytes)
    monkeypatch.setattr(release, "cache_rollback", lambda path: None)
    archive = tmp_path / "release-v2"
    manifest = release.prepare(version, archive, root)
    assert manifest["schema_version"] == 2
    assert set(manifest["files"]["candidate"]) == set(release.PATHS)
    for profile in ("runtime", "windows-cp312"):
        path = f"locks/{profile}.lock"
        previous = [line for line in before[path].decode().splitlines()
                    if not line.startswith("astropy-iers-data==")]
        candidate = (archive / "candidate" / path).read_text().splitlines()
        assert previous == [line for line in candidate if not line.startswith("astropy-iers-data==")]
        assert any(line.startswith(f"astropy-iers-data=={version} ") for line in candidate)
    assert before == {name: (root / name).read_bytes() for name in release.PATHS}
    release.activate(archive, root=root)
    release.activate(archive, rollback=True, root=root)
    assert before == {name: (root / name).read_bytes() for name in release.PATHS}
