from __future__ import annotations

import math
from pathlib import Path
import unittest

from astro_system.constants import AU_M
from astro_system.ephemeris.de_kernel import DEKernel
from astro_system.ephemeris.spice_loader import SpiceEphemeris


ROOT = Path(__file__).resolve().parents[2]
KERNEL = ROOT / "data/kernels/de442s.bsp"


@unittest.skipUnless(KERNEL.exists(), "minimal DE442s bundle not downloaded")
class OfflineKernelTests(unittest.TestCase):
    def test_earth_state_is_solar_system_scale(self) -> None:
        state = SpiceEphemeris(ROOT / "data/kernels").state(("Sun", "Earth", "Moon"), "2026-08-05T00:00:00")
        distance = math.sqrt(sum(value * value for value in state.position_m[1]))
        self.assertGreater(distance / AU_M, 0.95)
        self.assertLess(distance / AU_M, 1.05)

    def test_reader_refuses_extrapolation(self) -> None:
        reader = DEKernel(KERNEL)
        with self.assertRaises(ValueError):
            reader.state(399, 9e10)


if __name__ == "__main__":
    unittest.main()
