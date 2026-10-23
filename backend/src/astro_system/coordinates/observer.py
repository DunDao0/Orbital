"""Topocentric AltAz calculations with explicit offline IERS state."""
from __future__ import annotations

import warnings

from astropy import units as u
from astropy.coordinates import AltAz, EarthLocation, SkyCoord, UnitSphericalRepresentation, get_body, get_constellation
from astropy.time import Time

from ..ephemeris.time_conversion import epoch_metadata
from .iers_status import current_iers_status, require_iers_coverage


def _apparent_constellation(coordinate: SkyCoord) -> str:
    # Keep the observer's apparent direction and all GCRS frame attributes.
    # Transforming the finite-distance body to ICRS first changes the origin
    # to the Solar-System barycenter, not just the orientation of the sky.
    direction = coordinate.frame.realize_frame(coordinate.data.represent_as(UnitSphericalRepresentation))
    return str(get_constellation(SkyCoord(direction), short_name=True))


def local_sky(latitude_deg: float, longitude_deg: float, elevation_m: float, utc: str) -> dict[str, object]:
    epoch = epoch_metadata(utc)
    observer = EarthLocation.from_geodetic(longitude_deg * u.deg, latitude_deg * u.deg, elevation_m * u.m)
    moment = Time(epoch.canonical_utc, scale="utc")
    require_iers_coverage(moment)
    frame = AltAz(obstime=moment, location=observer, pressure=0 * u.hPa)
    warning_messages: list[str] = []
    rows: list[dict[str, object]] = []
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        coordinates = {
            name: get_body(name.lower(), moment, observer)
            for name in ("Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune")
        }
        for name, coordinate in coordinates.items():
            altaz = coordinate.transform_to(frame)
            above = bool(float(altaz.alt.deg) > 0)
            rows.append({
                "name": name,
                "altitude_deg": round(float(altaz.alt.deg), 5),
                "azimuth_deg": round(float(altaz.az.deg), 5),
                "above_geometric_horizon": above,
                "above_horizon": above,
                "constellation": _apparent_constellation(coordinate),
            })
        warning_messages = [str(item.message) for item in captured]
    sun_alt = float(next(row["altitude_deg"] for row in rows if row["name"] == "Sun"))
    twilight = "day" if sun_alt >= 0 else "civil" if sun_alt >= -6 else "nautical" if sun_alt >= -12 else "astronomical" if sun_alt >= -18 else "night"
    return {
        "input": {
            "latitude_deg": latitude_deg,
            "longitude_deg": longitude_deg,
            "elevation_m": elevation_m,
            "utc": epoch.canonical_utc,
        },
        "input_scale": "UTC",
        "coordinate_pipeline": ["ICRS", "GCRS", "ITRS", "local AltAz"],
        "frame": "ICRS → GCRS/ITRS → local AltAz",
        "refraction": {"enabled": False, "pressure_hpa": 0},
        "ephemeris": {"provider": "Astropy builtin solar-system ephemeris", "is_de442s_reference_state": False},
        "iers": current_iers_status(warning_messages),
        "twilight": {"classification": twilight, "solar_altitude_deg": sun_alt},
        "objects": rows,
        "limitations": [
            "Horizonte geométrico não garante visibilidade.",
            "Clima, nuvens, poluição luminosa, relevo, obstruções, equipamento e capacidade visual não são modelados.",
            "Refração atmosférica está desabilitada (pressão 0 hPa).",
        ],
    }
