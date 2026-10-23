"""Controlled inventory generation and verification; never downloads data."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path

import astropy_iers_data

ROOT = Path(__file__).resolve().parents[2]


def inventory():
    return {str(path.relative_to(ROOT)).replace("\\", "/"): {
        "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        for path in sorted((ROOT / "data").rglob("*")) if path.is_file()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture", action="store_true", help="Only for reviewed data updates; refuses overwrite")
    args = parser.parse_args()
    destination = ROOT / "backend/data-inventory.json"
    if args.capture:
        policy = ROOT / "backend/src/astro_system/iers-policy.json"
        if destination.exists() or policy.exists():
            raise SystemExit("Existing inventory/policy: preserve as a versioned release before a reviewed update")
        destination.write_text(json.dumps(inventory(), indent=2) + "\n")
        files = Path(astropy_iers_data.__file__).parent / "data"
        policy.write_text(json.dumps({"version": importlib.metadata.version("astropy-iers-data"),
            "source": "https://pypi.org/project/astropy-iers-data/", "files": {
                p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files.iterdir()) if p.is_file()}}, indent=2) + "\n")
    else:
        expected = json.loads(destination.read_text())
        current = inventory()
        changed = sorted(k for k in set(expected) | set(current) if expected.get(k) != current.get(k))
        print(json.dumps({"integrity": "failed" if changed else "verified", "files": len(current), "changed": changed}))
        if changed:
            raise SystemExit(1)
