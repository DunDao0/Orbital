from __future__ import annotations

from math import sqrt


def accelerations(position_m: object, mu_m3_s2: object) -> list[list[float]]:
    """Newtonian mutual gravity without softening; coincident bodies are an error."""
    positions = [[float(value) for value in row] for row in position_m]
    mus = [float(value) for value in mu_m3_s2]
    output = [[0.0, 0.0, 0.0] for _ in positions]
    for i, origin in enumerate(positions):
        for j, target in enumerate(positions):
            if i == j:
                continue
            delta = [target[k] - origin[k] for k in range(3)]
            distance2 = sum(value * value for value in delta)
            if distance2 == 0.0:
                raise ValueError("collision/singularity: coincident centers")
            inv_r3 = 1.0 / (sqrt(distance2) * distance2)
            for k in range(3):
                output[i][k] += mus[j] * delta[k] * inv_r3
    return output


def collision_pairs(position_m: object, radii_m: object) -> list[tuple[int, int]]:
    hits: list[tuple[int, int]] = []
    for i in range(len(position_m)):
        for j in range(i + 1, len(position_m)):
            distance = sqrt(sum((float(position_m[j][axis]) - float(position_m[i][axis])) ** 2 for axis in range(3)))
            if distance <= float(radii_m[i]) + float(radii_m[j]):
                hits.append((i, j))
    return hits
