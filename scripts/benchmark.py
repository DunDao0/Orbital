from __future__ import annotations

import json
from pathlib import Path
import sys
from time import perf_counter
import random

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend/src"))
from astro_system.dynamics import velocity_verlet  # noqa: E402


def main() -> None:
    rng = random.Random(42)
    # Synthetic benchmark particles are only for performance, never catalog data.
    n = 128
    r = [[rng.gauss(0, 1.5e11) for _ in range(3)] for _ in range(n)]
    v = [[rng.gauss(0, 3e4) for _ in range(3)] for _ in range(n)]
    mu = [1e10] * n
    mu[0] = 1.3271244004127942e20
    start = perf_counter()
    velocity_verlet(r, v, mu, 3600, 20)
    elapsed = perf_counter() - start
    result = {"scene": "128 synthetic performance particles", "integrator": "velocity-Verlet", "steps": 20, "elapsed_s": elapsed, "step_ms": elapsed * 1000 / 20, "note": "This benchmark measures calculation only, not browser frame rate."}
    target = ROOT / "data/manifests/benchmark.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
