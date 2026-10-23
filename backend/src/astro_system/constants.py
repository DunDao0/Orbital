"""Measured gravitational parameters and display radii in SI units.

Values are traceable to the JPL DE440/NAIF generic-kernel family.  The N-body
mode uses GM directly, avoiding a spurious conversion through an assumed G.
"""
from __future__ import annotations

AU_M = 149_597_870_700.0
DAY_S = 86_400.0
G_SI = 6.67430e-11

# JPL DE440-compatible GM values (m^3 s^-2), adequate for the demonstrator's
# Newtonian point-mass model.  Values are metadata, never visual parameters.
BODY_CONSTANTS: dict[str, dict[str, float | int | str]] = {
    "Sun": {"naif_id": 10, "mu": 1.3271244004127942e20, "radius_m": 695_700_000.0, "color": "#ffd36b"},
    "Mercury": {"naif_id": 199, "mu": 2.2032e13, "radius_m": 2_439_700.0, "color": "#bcb5aa"},
    "Venus": {"naif_id": 299, "mu": 3.24858592e14, "radius_m": 6_051_800.0, "color": "#e6b16b"},
    "Earth": {"naif_id": 399, "mu": 3.98600435436e14, "radius_m": 6_371_008.4, "color": "#62a8ff"},
    "Moon": {"naif_id": 301, "mu": 4.902800118e12, "radius_m": 1_737_400.0, "color": "#d7dde8"},
    "Mars": {"naif_id": 499, "mu": 4.282837362e13, "radius_m": 3_389_500.0, "color": "#de745c"},
    "Jupiter": {"naif_id": 599, "mu": 1.266865349218008e17, "radius_m": 69_911_000.0, "color": "#d9a675"},
    "Saturn": {"naif_id": 699, "mu": 3.793120749865224e16, "radius_m": 58_232_000.0, "color": "#d9c487"},
    "Uranus": {"naif_id": 799, "mu": 5.793951322279009e15, "radius_m": 25_362_000.0, "color": "#98e5eb"},
    "Neptune": {"naif_id": 899, "mu": 6.836527100580398e15, "radius_m": 24_622_000.0, "color": "#4b77ee"},
}

PLANET_NAMES = tuple(name for name in BODY_CONSTANTS if name not in {"Sun", "Moon"})
