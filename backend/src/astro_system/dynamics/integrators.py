from __future__ import annotations

from .gravity import accelerations


def velocity_verlet(position_m: object, velocity_m_s: object, mu_m3_s2: object, step_s: float, steps: int) -> tuple[list[list[float]], list[list[float]]]:
    """Time-reversible fixed-step velocity-Verlet integrator for a closed N-body system."""
    r = [[float(value) for value in row] for row in position_m]
    v = [[float(value) for value in row] for row in velocity_m_s]
    direction = 1.0 if steps >= 0 else -1.0
    h = abs(step_s) * direction
    for _ in range(abs(steps)):
        a0 = accelerations(r, mu_m3_s2)
        for i in range(len(r)):
            for k in range(3):
                r[i][k] += v[i][k] * h + 0.5 * a0[i][k] * h * h
        a1 = accelerations(r, mu_m3_s2)
        for i in range(len(v)):
            for k in range(3):
                v[i][k] += 0.5 * (a0[i][k] + a1[i][k]) * h
    return r, v


def dop853(position_m: object, velocity_m_s: object, mu_m3_s2: object, duration_s: float, *, rtol: float = 1e-11, atol: float = 1e-3) -> tuple[object, object]:
    """DOP853 when SciPy is installed; dependency absence is never hidden."""
    try:
        import numpy as np
        from scipy.integrate import solve_ivp
    except ImportError as error:
        raise RuntimeError("DOP853 requires the declared SciPy dependency") from error
    n = len(position_m)
    y0 = np.concatenate([np.asarray(position_m, dtype=float).ravel(), np.asarray(velocity_m_s, dtype=float).ravel()])

    def rhs(_: float, y: np.ndarray) -> np.ndarray:
        r, v = y[: 3 * n].reshape(n, 3), y[3 * n :].reshape(n, 3)
        return np.concatenate([v.ravel(), np.asarray(accelerations(r, mu_m3_s2), dtype=float).ravel()])

    result = solve_ivp(rhs, (0.0, duration_s), y0, method="DOP853", rtol=rtol, atol=atol)
    if not result.success:
        raise RuntimeError(result.message)
    y = result.y[:, -1]
    return y[: 3 * n].reshape(n, 3), y[3 * n :].reshape(n, 3)
