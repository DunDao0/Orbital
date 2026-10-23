from __future__ import annotations

import math
import unittest


def eclipse_kind(separation_rad: float, sun_radius_rad: float, moon_radius_rad: float) -> str:
    if separation_rad >= sun_radius_rad + moon_radius_rad:
        return "none"
    if separation_rad < abs(sun_radius_rad - moon_radius_rad):
        return "total" if moon_radius_rad >= sun_radius_rad else "annular"
    return "partial"


class EclipseGeometryTests(unittest.TestCase):
    def test_artificial_disc_configurations(self) -> None:
        self.assertEqual(eclipse_kind(math.radians(1.2), math.radians(.27), math.radians(.25)), "none")
        self.assertEqual(eclipse_kind(math.radians(.2), math.radians(.27), math.radians(.25)), "partial")
        self.assertEqual(eclipse_kind(0.0, math.radians(.27), math.radians(.28)), "total")
        self.assertEqual(eclipse_kind(0.0, math.radians(.27), math.radians(.25)), "annular")


if __name__ == "__main__":
    unittest.main()
