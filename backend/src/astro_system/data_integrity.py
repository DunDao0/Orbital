"""Offline verification of the approved IERS bundle (no downloads)."""
from functools import lru_cache
from hashlib import sha256
from importlib.metadata import version
import json
from pathlib import Path

import astropy_iers_data


@lru_cache(maxsize=16)
def _digest(path: str, size: int, modified_ns: int) -> str:
    return sha256(Path(path).read_bytes()).hexdigest()


def iers_bundle_status() -> dict:
    try:
        policy = json.loads(Path(__file__).with_name("iers-policy.json").read_text())
        installed = version("astropy-iers-data")
        root = Path(astropy_iers_data.__file__).parent / "data"
        failures = []
        for name, expected in policy["files"].items():
            path = root / name
            stat = path.stat()
            if _digest(str(path), stat.st_size, stat.st_mtime_ns) != expected:
                failures.append(name)
        if installed != policy["version"]:
            failures.append("package-version")
        return {"package": "astropy-iers-data", "version": installed,
                "approved_version": policy["version"], "source": policy["source"],
                "sha256": policy["files"], "integrity": "failed" if failures else "verified",
                "failed_files": failures}
    except (OSError, ValueError, KeyError):
        return {"package": "astropy-iers-data", "integrity": "failed", "failed_files": ["bundle-unavailable"]}
