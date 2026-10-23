"""Complete offline scientific gate with explicit Linux/Windows environments."""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import re
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LINUX_PROFILES = ("runtime", "orbital", "tests", "build")
ENVIRONMENTS = ("linux-cp312", "windows-cp312")
PIN = re.compile(r"^([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+-]+) --hash=sha256:([a-f0-9]{64})$")


def normalized(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def load_pins(root, profiles):
    pins = {}
    for profile in profiles:
        selected = {}
        for line in (root / "locks" / f"{profile}.lock").read_text().splitlines():
            if not line or line.startswith("#"):
                continue
            match = PIN.fullmatch(line)
            if match is None:
                raise ValueError(f"Invalid hash pin in {profile}")
            name, version, sha = match.groups()
            name = normalized(name)
            if name in selected or (name in pins and pins[name] != version):
                raise ValueError(f"Duplicate/inconsistent pin: {name}")
            selected[name] = (version, sha)
            pins[name] = version
        artifacts = json.loads((root / "locks" / f"{profile}.artifacts.json").read_text())
        if not isinstance(artifacts, list) or len(artifacts) != len(selected):
            raise ValueError(f"Invalid artifacts in {profile}")
        seen = set()
        for artifact in artifacts:
            name = normalized(artifact["name"])
            if name in seen or selected.get(name) != (
                artifact["version"], artifact["archive_info"]["hashes"]["sha256"]
            ):
                raise ValueError(f"Artifact/lock mismatch in {profile}: {name}")
            seen.add(name)
        if seen != set(selected):
            raise ValueError(f"Incomplete artifacts in {profile}")
    return pins


def approved_pins(environment, root=ROOT):
    if environment not in ENVIRONMENTS:
        raise ValueError("Select an explicit approved environment")
    linux = load_pins(root, LINUX_PROFILES)
    windows = load_pins(root, ("windows-cp312",))
    expected_windows = {name: version for name, version in linux.items() if name != "uvloop"}
    expected_windows["colorama"] = "0.4.6"
    if windows != expected_windows:
        raise ValueError("Linux/Windows lock versions differ beyond approved platform adjustments")
    return linux if environment == "linux-cp312" else windows


def verify_environment(environment, root=ROOT):
    if environment not in ENVIRONMENTS:
        raise ValueError("Select an explicit approved environment")
    expected_system = "Linux" if environment == "linux-cp312" else "Windows"
    if (platform.system() != expected_system
            or platform.python_implementation() != "CPython"
            or sys.version_info[:2] != (3, 12)
            or platform.machine().lower() not in {"amd64", "x86_64"}
            or struct.calcsize("P") != 8):
        raise ValueError(f"{environment} requires {expected_system} AMD64 CPython 3.12 (64-bit)")
    pins = approved_pins(environment, root)
    for name, expected in pins.items():
        try:
            actual = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError as error:
            raise ValueError(f"Missing approved package: {name}") from error
        if actual != expected:
            raise ValueError(f"Unapproved version: {name} ({actual}; expected {expected})")
    return {
        "profile": environment, "status": "verified", "python": platform.python_version(),
        "system": platform.system(), "machine": platform.machine(), "packages": len(pins),
        "validates_docker_build_or_runtime": False,
    }


def verify_scientific_data():
    # Use the checkout copied/mounted into this runner, not another installed copy.
    sys.path.insert(0, str(ROOT / "src"))
    from astro_system.data_integrity import iers_bundle_status
    bundle = iers_bundle_status()
    if bundle["integrity"] != "verified":
        raise ValueError("IERS integrity failed")
    from astropy.time import Time
    from astro_system.coordinates.iers_status import require_iers_coverage
    # Fixtures test expired-data rejection independently. Promotion additionally
    # requires data usable NOW, not merely a correct checksum of an old bundle.
    current_coverage = require_iers_coverage(Time.now())
    return {"iers": bundle, "current_iers_coverage": current_coverage}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--environment", required=True, choices=ENVIRONMENTS)
    parser.add_argument("--check-only", action="store_true",
                        help="Verify environment/data only; does NOT claim the suite passed")
    args = parser.parse_args(argv)
    if not args.check_only and os.environ.get("PYTEST_ADDOPTS", "").strip():
        raise ValueError(
            "PYTEST_ADDOPTS must be empty for the complete gate; environment test "
            "selection/options could hide unexecuted regressions"
        )
    environment = verify_environment(args.environment)
    scientific = verify_scientific_data()
    child_env = {**os.environ, "PYTHONPATH": str(ROOT / "src"),
                 "PYTHONDONTWRITEBYTECODE": "1", "ORBIS_REQUIRE_COMPLETE_TESTS": "1"}
    print(json.dumps({"environment": environment, **scientific}), flush=True)
    for arguments in (["tools/data_inventory.py"], ["-m", "pip", "check"]):
        subprocess.run([sys.executable, "-B", *arguments], cwd=ROOT, env=child_env, check=True)
    if not args.check_only:
        subprocess.run([sys.executable, "-B", "-m", "pytest", "tests", "validation",
                        "-ra", "-p", "no:cacheprovider"],
                       cwd=ROOT, env=child_env, check=True)
    print(json.dumps({"profile": args.environment,
                      "result": "checks-only-passed" if args.check_only else "complete-gate-passed",
                      "suite_executed": not args.check_only}), flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Scientific gate failed: {error}") from error
