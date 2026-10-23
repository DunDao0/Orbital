"""Export one labelled, exact-epoch DE442s state for the fixed Worker snapshot."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend/src"))
from astro_system.ephemeris import SpiceEphemeris  # noqa: E402

NAMES = ("Sun", "Mercury", "Venus", "Earth", "Moon", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune")
FIXED_EPOCH_UTC = "2026-08-05T00:00:00Z"


def main() -> None:
    target = ROOT / "public/reference-snapshot.json"
    temporary = target.with_suffix(target.suffix + ".part")
    provider = SpiceEphemeris(ROOT / "data/kernels")
    try:
        state = provider.snapshot_payload(FIXED_EPOCH_UTC, NAMES)
        state["fixed_epoch"] = True
        temporary.write_text(json.dumps(state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(temporary, target)
    finally:
        provider.close()
        temporary.unlink(missing_ok=True)
    print(f"wrote fixed reference snapshot for {FIXED_EPOCH_UTC}: {target}")


if __name__ == "__main__":
    main()
