"""Prepare and apply a reviewed IERS release; never download at API startup.

Preparation preserves the previous policy/locks byte-for-byte. Application is
offline and refuses unexpected local edits. Stop consumers before installing the
matching package and switching files; restarting a tested immutable Docker image
with its matching data is the production rollback mechanism.
"""
from __future__ import annotations

import argparse
from email.parser import BytesParser
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
POLICY = "src/astro_system/iers-policy.json"
LEGACY_PATHS = (POLICY, "locks/iers.lock", "locks/iers.artifacts.json",
                "locks/runtime.lock", "locks/runtime.artifacts.json")
PATHS = (*LEGACY_PATHS, "locks/windows-cp312.lock", "locks/windows-cp312.artifacts.json")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encoded(value) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode()


def fetch(url: str, limit: int) -> bytes:
    with urllib.request.urlopen(url, timeout=10) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Release resource exceeds the maintenance download limit")
    return data


def require_windows_lock_pair(root: Path) -> None:
    if not all((root / name).is_file() for name in PATHS[-2:]):
        raise ValueError("Windows lock/artifacts pair is incomplete or missing; no files were changed")


def prepare(version: str, destination: Path, root: Path = ROOT) -> dict:
    if not re.fullmatch(r"0\.\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+){3}", version):
        raise ValueError("Select an explicit astropy-iers-data release version")
    if destination.exists():
        raise ValueError("Output must be a NEW directory; preserve previous releases")
    require_windows_lock_pair(root)
    metadata_url = f"https://pypi.org/pypi/astropy-iers-data/{version}/json"
    metadata = json.loads(fetch(metadata_url, 2_000_000))
    wheels = [item for item in metadata["urls"]
              if item["filename"].endswith("-py3-none-any.whl") and not item["yanked"]]
    if len(wheels) != 1 or metadata["info"]["version"] != version:
        raise ValueError("Expected one non-yanked, platform-independent wheel")
    artifact = wheels[0]
    url = urllib.parse.urlsplit(artifact["url"])
    if url.scheme != "https" or url.netloc != "files.pythonhosted.org":
        raise ValueError("Unexpected artifact origin")
    wheel = fetch(artifact["url"], 8_000_000)
    sha = digest(wheel)
    if sha != artifact["digests"]["sha256"]:
        raise ValueError("Wheel checksum mismatch")
    old = {name: (root / name).read_bytes() for name in PATHS}
    old_policy = json.loads(old[POLICY])
    with zipfile.ZipFile(io.BytesIO(wheel)) as archive:
        meta = [name for name in archive.namelist() if name.endswith(".dist-info/METADATA")]
        if len(meta) != 1:
            raise ValueError("Unexpected wheel metadata")
        package = BytesParser().parsebytes(archive.read(meta[0]))
        if package["Name"].replace("_", "-").lower() != "astropy-iers-data" or package["Version"] != version:
            raise ValueError("Wheel identity mismatch")
        hashes = {name.removeprefix("astropy_iers_data/data/"): digest(archive.read(name))
                  for name in archive.namelist()
                  if name.startswith("astropy_iers_data/data/") and not name.endswith("/")}
    if set(hashes) != set(old_policy["files"]):
        raise ValueError("Data layout changed; review the package before promotion")
    entry = {"name": "astropy-iers-data", "version": version, "url": artifact["url"],
             "archive_info": {"hash": f"sha256={sha}", "hashes": {"sha256": sha}}}
    pin = f"astropy-iers-data=={version} --hash=sha256:{sha}"
    new = {
        POLICY: encoded({"version": version, "source": old_policy["source"], "files": hashes}),
        "locks/iers.lock": (f"# Approved universal IERS wheel; install with --require-hashes --only-binary=:all:.\n{pin}\n").encode(),
        "locks/iers.artifacts.json": encoded([entry]),
    }
    for profile in ("runtime", "windows-cp312"):
        lock_path, artifact_path = f"locks/{profile}.lock", f"locks/{profile}.artifacts.json"
        lock, count = re.subn(r"(?m)^astropy-iers-data==[^\r\n]+", pin, old[lock_path].decode())
        if count != 1:
            raise ValueError(f"Expected exactly one {profile} IERS pin")
        artifacts = json.loads(old[artifact_path])
        matches = [i for i, item in enumerate(artifacts)
                   if item["name"].replace("_", "-").lower() == "astropy-iers-data"]
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one {profile} IERS artifact")
        artifacts[matches[0]] = entry
        new[lock_path], new[artifact_path] = lock.encode(), encoded(artifacts)
    release = {"schema_version": 2, "previous_version": old_policy["version"],
               "version": version, "metadata_url": metadata_url, "wheel_sha256": sha,
               "files": {side: {name: digest(data) for name, data in content.items()}
                         for side, content in (("previous", old), ("candidate", new))}}
    destination.mkdir(parents=True, exist_ok=False)
    for side, content in (("previous", old), ("candidate", new)):
        for name, data in content.items():
            path = destination / side / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    # Keep the verified wheel for offline activation, not in the Docker context.
    (destination / artifact["filename"]).write_bytes(wheel)
    (destination / "release.json").write_bytes(encoded(release))
    cache_rollback(destination)
    return release


def cache_rollback(release_dir: Path) -> dict:
    """Retain the previous verified wheel so local rollback also works offline."""
    release = json.loads((release_dir / "release.json").read_bytes())
    path = release_dir / "previous/locks/iers.artifacts.json"
    if digest(path.read_bytes()) != release["files"]["previous"]["locks/iers.artifacts.json"]:
        raise ValueError("Previous artifact manifest checksum mismatch")
    artifacts = json.loads(path.read_bytes())
    if len(artifacts) != 1 or artifacts[0]["version"] != release["previous_version"]:
        raise ValueError("Unexpected previous package")
    artifact = artifacts[0]
    url = urllib.parse.urlsplit(artifact["url"])
    name = url.path.rsplit("/", 1)[-1]
    if (url.scheme != "https" or url.netloc != "files.pythonhosted.org"
            or name != f"astropy_iers_data-{release['previous_version']}-py3-none-any.whl"):
        raise ValueError("Unexpected rollback wheel origin")
    destination = release_dir / name
    data = destination.read_bytes() if destination.exists() else fetch(artifact["url"], 8_000_000)
    if digest(data) != artifact["archive_info"]["hashes"]["sha256"]:
        raise ValueError("Rollback wheel checksum mismatch")
    if not destination.exists():
        destination.write_bytes(data)
    return {"status": "rollback-wheel-verified", "version": release["previous_version"]}


def activate(release_dir: Path, *, rollback: bool = False, root: Path = ROOT) -> dict:
    release = json.loads((release_dir / "release.json").read_bytes())
    target, expected = ("previous", "candidate") if rollback else ("candidate", "previous")
    if release.get("schema_version") == 1:
        raise ValueError(
            "Legacy release lacks the Windows lock. Preserve this archive and prepare "
            "a NEW schema-2 release for the desired version before activation/rollback."
        )
    if release.get("schema_version") != 2 or set(release["files"]) != {"previous", "candidate"}:
        raise ValueError("Unsupported release")
    require_windows_lock_pair(root)
    for side in ("previous", "candidate"):
        if set(release["files"][side]) != set(PATHS):
            raise ValueError("Unexpected release paths")
        for name, sha in release["files"][side].items():
            if digest((release_dir / side / name).read_bytes()) != sha:
                raise ValueError(f"Release checksum mismatch: {side}/{name}")
    current = {name: (root / name).read_bytes() for name in PATHS}
    if all(digest(current[name]) == release["files"][target][name] for name in PATHS):
        return {"status": "already-active", "side": target}
    if any(digest(current[name]) != release["files"][expected][name] for name in PATHS):
        raise ValueError("Local files changed since preparation; no files were overwritten")
    try:
        for name in PATHS:
            (root / name).write_bytes((release_dir / target / name).read_bytes())
    except OSError:
        for name, data in current.items():
            (root / name).write_bytes(data)
        raise
    return {"status": "activated", "side": target,
            "version": release["previous_version"] if rollback else release["version"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare")
    prep.add_argument("--version", required=True)
    prep.add_argument("--output", type=Path, required=True)
    apply = commands.add_parser("activate")
    apply.add_argument("--release", type=Path, required=True)
    apply.add_argument("--rollback", action="store_true")
    cache = commands.add_parser("cache-rollback")
    cache.add_argument("--release", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "prepare":
        result = prepare(args.version, args.output)
    elif args.command == "cache-rollback":
        result = cache_rollback(args.release)
    else:
        result = activate(args.release, rollback=args.rollback)
    print(json.dumps(result, indent=2))
