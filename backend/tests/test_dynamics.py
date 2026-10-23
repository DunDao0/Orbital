from __future__ import annotations

import math
import unittest

from astro_system.catalogs.constellations import IAU_ABBREVIATIONS
from astro_system.constants import AU_M, DAY_S
from astro_system.dynamics import conservation_metrics, velocity_verlet
from astro_system.dynamics.gravity import accelerations, collision_pairs


MU_SUN = 1.3271244004127942e20
MU_EARTH = 3.98600435436e14


def earth_sun_state() -> tuple[list[list[float]], list[list[float]], list[float]]:
    q = MU_EARTH / MU_SUN
    velocity = math.sqrt((MU_SUN + MU_EARTH) / AU_M)
    positions = [[-q * AU_M / (1 + q), 0.0, 0.0], [AU_M / (1 + q), 0.0, 0.0]]
    velocities = [[0.0, -q * velocity / (1 + q), 0.0], [0.0, velocity / (1 + q), 0.0]]
    return positions, velocities, [MU_SUN, MU_EARTH]


class NBodyTests(unittest.TestCase):
    def test_two_body_period_and_energy_conservation(self) -> None:
        r0, v0, mus = earth_sun_state()
        initial = conservation_metrics(r0, v0, mus)
        r1, v1 = velocity_verlet(r0, v0, mus, 6 * 3600.0, int(round(365.256 * 4)))
        final = conservation_metrics(r1, v1, mus)
        orbital_error = math.dist(r1[1], r0[1]) / AU_M
        energy_error = abs((final["total_j"] - initial["total_j"]) / initial["total_j"])
        self.assertLess(orbital_error, 3e-4)
        self.assertLess(energy_error, 3e-8)

    def test_forward_then_backward_is_time_reversible(self) -> None:
        r0, v0, mus = earth_sun_state()
        r1, v1 = velocity_verlet(r0, v0, mus, 3600.0, 24 * 30)
        r2, v2 = velocity_verlet(r1, v1, mus, 3600.0, -(24 * 30))
        self.assertLess(math.dist(r2[1], r0[1]) / AU_M, 2e-12)
        self.assertLess(math.dist(v2[1], v0[1]), 1e-6)

    def test_no_softening_singularity_is_visible(self) -> None:
        with self.assertRaises(ValueError):
            accelerations([[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]], [1.0, 1.0])

    def test_collision_detection(self) -> None:
        self.assertEqual(collision_pairs([[0, 0, 0], [1, 0, 0]], [1, 1]), [(0, 1)])

    def test_barycenter_remains_near_origin(self) -> None:
        r0, v0, mus = earth_sun_state()
        r1, v1 = velocity_verlet(r0, v0, mus, 3600.0, 400)
        metrics = conservation_metrics(r1, v1, mus)
        self.assertLess(math.sqrt(sum(value * value for value in metrics["barycenter_m"])), 1e-3)


class CatalogTests(unittest.TestCase):
    def test_official_iau_abbreviation_inventory_has_88_records(self) -> None:
        self.assertEqual(len(IAU_ABBREVIATIONS), 88)
        self.assertEqual(len(set(IAU_ABBREVIATIONS)), 88)


if __name__ == "__main__":
    unittest.main()
