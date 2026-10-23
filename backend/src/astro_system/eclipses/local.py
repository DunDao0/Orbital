"""Topocentric apparent-disc eclipse contacts with explicit precision limits."""
from __future__ import annotations

from datetime import timedelta

from astropy import units as u
from astropy.coordinates import AltAz, EarthLocation, get_body
from astropy.time import Time
import numpy as np
from scipy.optimize import brentq, minimize_scalar

from ..ephemeris.time_conversion import epoch_metadata
from ..coordinates.iers_status import require_iers_coverage

SUN_RADIUS_M = 695_700_000.0
MOON_RADIUS_M = 1_737_400.0


def _geometry(moment: Time, location: EarthLocation) -> tuple[float, float, float]:
    sun, moon = get_body("sun", moment, location), get_body("moon", moment, location)
    separation = float(sun.separation(moon).rad)
    sun_radius = float(np.arcsin(SUN_RADIUS_M / sun.distance.to_value(u.m)))
    moon_radius = float(np.arcsin(MOON_RADIUS_M / moon.distance.to_value(u.m)))
    return separation, sun_radius, moon_radius


def _circle_overlap_fraction(sun_radius: float, moon_radius: float, separation: float) -> float:
    if separation >= sun_radius + moon_radius:
        return 0.0
    if separation <= abs(sun_radius - moon_radius):
        return min(1.0, (min(sun_radius, moon_radius) / sun_radius) ** 2)
    sun_area = sun_radius**2 * np.arccos(np.clip((separation**2 + sun_radius**2 - moon_radius**2) / (2 * separation * sun_radius), -1.0, 1.0))
    moon_area = moon_radius**2 * np.arccos(np.clip((separation**2 + moon_radius**2 - sun_radius**2) / (2 * separation * moon_radius), -1.0, 1.0))
    triangle = 0.5 * np.sqrt(max(0.0, (-separation + sun_radius + moon_radius) * (separation + sun_radius - moon_radius) * (separation - sun_radius + moon_radius) * (separation + sun_radius + moon_radius)))
    return float(np.clip((sun_area + moon_area - triangle) / (np.pi * sun_radius**2), 0.0, 1.0))


def _disc_difference(moment: Time, location: EarthLocation, internal: bool) -> float:
    separation, sun_radius, moon_radius = _geometry(moment, location)
    return separation - (abs(sun_radius - moon_radius) if internal else sun_radius + moon_radius)


def _contact_roots(samples: Time, values: list[float], location: EarthLocation, *, internal: bool = False) -> list[tuple[str, Time]]:
    """Label actual crossings, including a single contact in a clipped window."""
    ingress, egress = ("C2", "C3") if internal else ("C1", "C4")
    roots: list[tuple[str, Time]] = []
    for index, value in enumerate(values):
        following = values[index + 1] if index + 1 < len(values) else None
        if value == 0:
            previous = values[index - 1] if index else None
            # A sampled tangency is not a crossing; do not invent two contacts.
            if previous is None or following is None or previous * following < 0:
                increasing = following > 0 if following is not None else previous < 0
                roots.append((egress if increasing else ingress, samples[index]))
        if following is not None and value * following < 0:
            start, end = samples[index], samples[index + 1]
            offset = brentq(
                lambda seconds: _disc_difference(start + seconds * u.s, location, internal),
                0.0, (end - start).to_value(u.s), xtol=0.05,
            )
            roots.append((ingress if value > 0 else egress, start + offset * u.s))
    return roots


def _minimum_time(left: Time, right: Time, location: EarthLocation) -> Time:
    # SciPy bounded also uses a relative tolerance proportional to abs(x).
    # Relative seconds avoid tens-of-seconds tolerance at modern Unix epochs.
    span_s = (right - left).to_value(u.s)
    minimum = minimize_scalar(
        lambda seconds: _geometry(left + seconds * u.s, location)[0],
        bounds=(0.0, span_s), method="bounded", options={"xatol": 0.05},
    )
    if not minimum.success:
        raise RuntimeError("Eclipse minimum refinement failed")
    candidates = [left, left + minimum.x * u.s, right]
    return min(candidates, key=lambda moment: _geometry(moment, location)[0])


def _sun_position(moment: Time, location: EarthLocation) -> dict[str, float | bool]:
    frame = AltAz(obstime=moment, location=location, pressure=0 * u.hPa)
    altaz = get_body("sun", moment, location).transform_to(frame)
    altitude = round(float(altaz.alt.deg), 5)
    return {
        "sun_altitude_deg": altitude,
        "sun_azimuth_deg": round(float(altaz.az.deg), 5),
        "sun_above_geometric_horizon": altitude > 0,
    }


def _contact(kind: str, moment: Time, location: EarthLocation) -> dict[str, object]:
    return {"kind": kind, "utc": moment.utc.isot + "Z", **_sun_position(moment, location)}


def local_solar_eclipse(latitude_deg: float, longitude_deg: float, elevation_m: float, utc: str, hours: float = 18.0) -> dict[str, object]:
    if not 1 <= hours <= 36:
        raise ValueError("search_hours must be between 1 and 36")
    epoch = epoch_metadata(utc)
    location = EarthLocation.from_geodetic(longitude_deg * u.deg, latitude_deg * u.deg, elevation_m * u.m)
    center = Time(epoch.canonical_utc, scale="utc")
    start, end = center - timedelta(hours=hours), center + timedelta(hours=hours)
    require_iers_coverage(Time([start, end]))
    samples = start + np.linspace(0, hours * 2, int(hours * 12) + 1) * u.hour
    geometries: list[tuple[float, float, float]] = []
    separations: list[float] = []
    for sample in samples:
        geometry = _geometry(sample, location)
        geometries.append(geometry)
        separation, sun_radius, moon_radius = geometry
        separations.append(separation)
    index = int(np.argmin(separations))
    maximum = _minimum_time(samples[max(0, index - 1)], samples[min(len(samples) - 1, index + 1)], location)
    separation, sun_radius, moon_radius = _geometry(maximum, location)
    obscuration = _circle_overlap_fraction(sun_radius, moon_radius, separation)
    # Totality or a grazing overlap can be shorter than the coarse 10-minute
    # spacing. Include the refined minimum before bracketing either boundary.
    offsets_s = (samples - start).to_value(u.s)
    maximum_offset_s = (maximum - start).to_value(u.s)
    if not np.any(np.isclose(offsets_s, maximum_offset_s, rtol=0, atol=1e-8)):
        insertion = int(np.searchsorted(offsets_s, maximum_offset_s))
        samples = Time([*samples[:insertion], maximum, *samples[insertion:]])
        geometries.insert(insertion, (separation, sun_radius, moon_radius))
    outer = [distance - (solar + lunar) for distance, solar, lunar in geometries]
    inner = [distance - abs(solar - lunar) for distance, solar, lunar in geometries]
    outer_contacts = _contact_roots(samples, outer, location)
    classification = "none" if obscuration == 0 else "partial"
    if separation < abs(sun_radius - moon_radius):
        classification = "total" if moon_radius >= sun_radius else "annular"
    inner_contacts = _contact_roots(samples, inner, location, internal=True) if classification in {"total", "annular"} else []

    contacts: list[dict[str, object]] = []
    if classification != "none":
        contacts.extend(_contact(kind, moment, location) for kind, moment in [*outer_contacts, *inner_contacts])
        contacts.append(_contact("MAX", maximum, location))
        contacts.sort(key=lambda item: Time(str(item["utc"]), scale="utc").unix)

    sun_at_maximum = _sun_position(maximum, location)
    return {
        "input": {
            "latitude_deg": latitude_deg,
            "longitude_deg": longitude_deg,
            "elevation_m": elevation_m,
            "utc": epoch.canonical_utc,
            "search_hours": hours,
        },
        "event_found": classification != "none",
        "search_window": {
            "half_width_hours": hours,
            "start_utc": start.utc.isot + "Z",
            "end_utc": end.utc.isot + "Z",
            "truncated": classification != "none" and len(outer_contacts) < 2,
        },
        "classification": classification,
        "maximum_utc": maximum.utc.isot + "Z",
        "contacts": contacts,
        "contacts_utc": [str(item["utc"]) for item in contacts if item["kind"] != "MAX"],
        "external_contacts_utc": [moment.utc.isot + "Z" for _, moment in outer_contacts],
        "internal_contacts_utc": [moment.utc.isot + "Z" for _, moment in inner_contacts],
        "obscuration_area_fraction": round(obscuration, 6),
        "solar_altitude_at_maximum_deg": sun_at_maximum["sun_altitude_deg"],
        "solar_azimuth_at_maximum_deg": sun_at_maximum["sun_azimuth_deg"],
        "sun_above_geometric_horizon_at_maximum": sun_at_maximum["sun_above_geometric_horizon"],
        "method": "Astropy builtin topocentric apparent discs + 10-minute brackets + Brent contact roots + bounded minimum",
        "precision_warning": "Candidate-screening calculation, not a Besselian DE442+IERS operational prediction. Validate operational results against JPL/NASA.",
        "limitations": [
            "Não é uma solução Besseliana operacional.",
            "Sol acima do horizonte geométrico não garante condições seguras ou práticas de observação.",
            "Clima, relevo e obstruções locais não são modelados.",
        ],
    }
