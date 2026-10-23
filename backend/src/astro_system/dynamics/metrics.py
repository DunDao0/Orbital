from __future__ import annotations

from math import sqrt


def conservation_metrics(position_m: object, velocity_m_s: object, mu_m3_s2: object) -> dict[str, float | list[float]]:
    """Closed-system invariants, using m=mu/G only for displayed momentum."""
    positions = [[float(value) for value in row] for row in position_m]
    velocities = [[float(value) for value in row] for row in velocity_m_s]
    mus = [float(value) for value in mu_m3_s2]
    masses = [value / 6.67430e-11 for value in mus]
    kinetic = 0.5 * sum(masses[i] * sum(value * value for value in velocities[i]) for i in range(len(masses)))
    potential = 0.0
    for i in range(len(positions)):
        for j in range(i + 1, len(positions)):
            distance = sqrt(sum((positions[j][axis] - positions[i][axis]) ** 2 for axis in range(3)))
            potential -= masses[i] * mus[j] / distance
    momentum = [sum(masses[i] * velocities[i][axis] for i in range(len(masses))) for axis in range(3)]
    angular = [sum(masses[i] * (positions[i][1] * velocities[i][2] - positions[i][2] * velocities[i][1]) for i in range(len(masses))), sum(masses[i] * (positions[i][2] * velocities[i][0] - positions[i][0] * velocities[i][2]) for i in range(len(masses))), sum(masses[i] * (positions[i][0] * velocities[i][1] - positions[i][1] * velocities[i][0]) for i in range(len(masses)))]
    total_mass = sum(masses)
    barycenter = [sum(masses[i] * positions[i][axis] for i in range(len(masses))) / total_mass for axis in range(3)]
    return {"kinetic_j": float(kinetic), "potential_j": float(potential), "total_j": float(kinetic + potential), "linear_momentum": momentum, "angular_momentum": angular, "barycenter_m": barycenter}
