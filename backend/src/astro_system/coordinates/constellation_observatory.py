"""Native Astropy service for the local IAU constellation observatory.

No browser-side astronomy is used: Gaia catalogue coordinates remain explicitly
labelled J2016.0/ICRS and this module performs the request-time topocentric
AltAz transform with the observer, UTC and atmosphere configuration returned in
the response.
"""
from __future__ import annotations

from functools import lru_cache
from copy import deepcopy
from itertools import pairwise
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
from astropy import units as u
from astropy.coordinates import AltAz, EarthLocation, ICRS, SkyCoord, get_constellation, get_sun
from astropy.time import Time
from astropy.utils import iers

from ..catalogs.constellations import constellation_guide, constellation_guides
from ..catalog_data import CatalogDataError, load_catalog, load_catalog_snapshot, verified_catalog_digest
from ..ephemeris.time_conversion import epoch_metadata
from .iers_status import require_iers_coverage

ROOT = Path(__file__).resolve().parents[4]
GAIA_PATH = ROOT / "data" / "stars" / "gaia_bright.json"
BOUNDARY_PATH = ROOT / "data" / "constellations" / "iau_boundary_vertices_j2000.json"
NAMED_STARS_PATH = ROOT / "data" / "stars" / "iau_named_stars.json"

# Tests and local use must never make an IERS network request. Astropy will use
# its packaged/local table and reports the resulting limitation explicitly.
iers.conf.auto_download = False


def _rounded(value: float) -> float:
    return round(float(value), 6)


def _twilight(sun_altitude_deg: float) -> str:
    if sun_altitude_deg >= 0:
        return "day"
    if sun_altitude_deg >= -6:
        return "civil"
    if sun_altitude_deg >= -12:
        return "nautical"
    if sun_altitude_deg >= -18:
        return "astronomical"
    return "night"


def _altaz_row(coordinate: SkyCoord, frame: AltAz) -> dict[str, float | bool]:
    transformed = coordinate.transform_to(frame)
    return {
        "altitude_deg": _rounded(float(transformed.alt.deg)),
        "azimuth_deg": _rounded(float(transformed.az.deg)),
        "above_horizon": bool(transformed.alt.deg >= 0),
    }


def _motion_status(star: dict[str, Any]) -> dict[str, str]:
    has_tangent_motion = star.get("pmra_mas_yr") is not None and star.get("pmdec_mas_yr") is not None
    has_parallax = star.get("parallax_mas") is not None and float(star["parallax_mas"]) > 0
    if has_tangent_motion and has_parallax:
        return {"status": "not_applied_missing_radial_velocity", "message": "Catalogue proper motion and parallax exist, but no radial velocity is bundled; position remains at the declared catalogue epoch."}
    if has_tangent_motion:
        return {"status": "not_applied_incomplete_astrometry", "message": "Proper motion is present but the bundled astrometry is insufficient for a full propagated state."}
    return {"status": "unavailable", "message": "No usable proper-motion pair is bundled for this source."}


def _boundary_visibility(boundary_altaz: SkyCoord | None) -> str:
    if boundary_altaz is None or len(boundary_altaz) == 0:
        return "below-horizon"
    altitudes = np.asarray(boundary_altaz.alt.deg)
    if np.all(altitudes < 0):
        return "below-horizon"
    if np.all(altitudes >= 0):
        return "fully-above-horizon"
    return "partially-above-horizon"


def _circumpolar_state(latitude_deg: float, declination_deg: float) -> str:
    if latitude_deg >= 0:
        if declination_deg >= 90 - latitude_deg:
            return "circumpolar"
        if declination_deg <= -90 + latitude_deg:
            return "never-rises"
    else:
        if declination_deg <= -90 - latitude_deg:
            return "circumpolar"
        if declination_deg >= 90 + latitude_deg:
            return "never-rises"
    return "rises-and-sets"


def _plan_window(
    observer: EarthLocation,
    target: SkyCoord,
    bright_coordinates: SkyCoord,
    start: datetime,
    cadence_minutes: int,
    latitude_deg: float,
) -> dict[str, Any]:
    samples = [start + timedelta(minutes=offset) for offset in range(0, 24 * 60 + 1, cadence_minutes)]
    times = Time(samples, scale="utc")
    require_iers_coverage(times)
    frame = AltAz(obstime=times, location=observer, pressure=0 * u.hPa)
    target_altitudes = np.asarray(target.transform_to(frame).alt.deg)
    sun_altitudes = np.asarray(get_sun(times).transform_to(frame).alt.deg)
    dark = sun_altitudes <= -18
    rises = any(first < 0 <= second for first, second in pairwise(target_altitudes))
    sets = any(first >= 0 > second for first, second in pairwise(target_altitudes))
    result: dict[str, Any] = {
        "reference_utc_day": start.date().isoformat(),
        "cadence_minutes": cadence_minutes,
        "astronomical_night": bool(np.any(dark)),
        "circumpolar_state": _circumpolar_state(latitude_deg, float(target.dec.deg)),
        "rises_in_window": rises,
        "sets_in_window": sets,
    }
    if not np.any(dark):
        return {**result, "classification": "unavailable", "reason": "No astronomical-dark sample (Sun altitude <= -18°) in this UTC reference day."}
    eligible = np.where(dark)[0]
    best_index = int(eligible[np.argmax(target_altitudes[eligible])])
    best_time = times[best_index]
    best_frame = AltAz(obstime=best_time, location=observer, pressure=0 * u.hPa)
    bright_above = 0
    if len(bright_coordinates):
        bright_above = int(np.sum(np.asarray(bright_coordinates.transform_to(best_frame).alt.deg) >= 0))
    maximum = float(target_altitudes[best_index])
    classification = "unavailable" if maximum < 0 else "low" if maximum < 20 else "reasonable" if maximum < 45 else "favorable"
    return {
        **result,
        "classification": classification,
        "maximum_altitude_deg": _rounded(maximum),
        "best_utc": best_time.utc.isot,
        "bright_stars_above_horizon": bright_above,
        "criterion": "Representative coordinate maximum during samples with Sun altitude <= -18°; geometric horizon and pressure=0 hPa.",
    }


def _annual_plan(observer: EarthLocation, target: SkyCoord, bright_coordinates: SkyCoord, moment: Time, latitude_deg: float) -> dict[str, Any]:
    year = int(moment.utc.datetime.year)
    monthly = [_plan_window(observer, target, bright_coordinates, datetime(year, month, 15, tzinfo=timezone.utc), 30, latitude_deg) | {"month": month} for month in range(1, 13)]
    tonight = _plan_window(observer, target, bright_coordinates, datetime.combine(moment.utc.datetime.date(), datetime.min.time(), tzinfo=timezone.utc), 10, latitude_deg)
    return {
        "method": "Each month uses the 15th UTC day sampled every 30 minutes; the current UTC day uses 10-minute samples. This is an educational geometric planning screen, not a weather or observing guarantee.",
        "monthly": monthly,
        "current_utc_day": tonight,
        "limitations": ["Cloud, light pollution, local obstructions, terrain, equipment and visual sky brightness are not modelled.", "Calendar windows use UTC reference days and a discrete cadence, so displayed best times have only the stated sampling resolution."],
    }


def _now_observing(records: tuple[dict[str, Any], ...], coordinates: SkyCoord, frame: AltAz, twilight: str, *, data_root: Path | None = None) -> list[dict[str, Any]]:
    """Rank only geometric, magnitude-limited candidates at the supplied UTC."""
    transformed = coordinates.transform_to(frame)
    groups: dict[str, list[tuple[float, float]]] = {}
    for record, altitude in zip(records, transformed.alt.deg, strict=True):
        magnitude = record.get("g_mag")
        if magnitude is None or float(magnitude) > 4.5 or altitude < 0:
            continue
        groups.setdefault(str(record["iau_abbreviation"]), []).append((float(altitude), float(magnitude)))
    names = {str(guide["iau_abbreviation"]): str(guide["name"]) for guide in constellation_guides(data_root=data_root)}
    candidates = []
    for abbreviation, stars in groups.items():
        highest = max(altitude for altitude, _ in stars)
        score = highest + len(stars) * 8
        candidates.append({
            "iau_abbreviation": abbreviation,
            "name": names[abbreviation],
            "bright_stars_above_horizon": len(stars),
            "highest_bright_star_altitude_deg": _rounded(highest),
            "criterion": "Ranked by bright Gaia-subset stars (G <= 4.5) geometrically above the horizon at the supplied UTC; no weather or light-pollution model.",
            "light_condition": twilight,
            "score": _rounded(score),
        })
    return sorted(candidates, key=lambda row: (-float(row["score"]), row["iau_abbreviation"]))[:8]


@lru_cache(maxsize=4)
def _derived_gaia(path: str, approved_digest: str) -> tuple[tuple[dict[str, Any], ...], SkyCoord]:
    payload, digest = load_catalog_snapshot(Path(path), "stars")
    if digest != approved_digest:
        raise CatalogDataError("integrity-failed", "stars")
    stars = payload.get("stars", [])
    coordinates = SkyCoord(
        ra=np.asarray([star["ra_deg"] for star in stars]) * u.deg,
        dec=np.asarray([star["dec_deg"] for star in stars]) * u.deg,
        frame=ICRS(),
    )
    abbreviations = get_constellation(coordinates, short_name=True)
    records = tuple({**star, "iau_abbreviation": str(abbreviation)} for star, abbreviation in zip(stars, abbreviations, strict=True))
    return records, coordinates


def _gaia_catalogue(*, data_root: Path | None = None) -> tuple[tuple[dict[str, Any], ...], SkyCoord]:
    path = data_root / "stars/gaia_bright.json" if data_root is not None else GAIA_PATH
    # Verify bytes BEFORE consulting the derived cache, even if stat metadata
    # is unchanged. Do not expose mutable cached records or coordinate arrays.
    digest = verified_catalog_digest(path, "stars")
    records, coordinates = _derived_gaia(str(path.resolve()), digest)
    return deepcopy(records), coordinates.copy()


def _boundary_segments(*, data_root: Path | None = None) -> tuple[dict[str, Any], ...]:
    path = data_root / "constellations/iau_boundary_vertices_j2000.json" if data_root is not None else BOUNDARY_PATH
    payload = load_catalog(path, "boundaries")
    return tuple(payload.get("segments", []))


def _named_star_status(*, data_root: Path | None = None) -> dict[str, Any]:
    path = data_root / "stars/iau_named_stars.json" if data_root is not None else NAMED_STARS_PATH
    return load_catalog(path, "named_stars")


def constellation_sky(
    latitude_deg: float,
    longitude_deg: float,
    elevation_m: float,
    utc: str,
    abbreviation: str,
    max_g_mag: float,
    *,
    data_root: Path | None = None,
) -> dict[str, Any]:
    guide = constellation_guide(abbreviation, data_root=data_root)
    if guide is None:
        raise KeyError(abbreviation)
    records, coordinates = _gaia_catalogue(data_root=data_root)
    segments = _boundary_segments(data_root=data_root)
    named = _named_star_status(data_root=data_root)
    observer = EarthLocation.from_geodetic(longitude_deg * u.deg, latitude_deg * u.deg, elevation_m * u.m)
    moment = Time(epoch_metadata(utc).canonical_utc, scale="utc")
    require_iers_coverage(moment)
    frame = AltAz(obstime=moment, location=observer, pressure=0 * u.hPa)
    selected_indices = [
        index for index, star in enumerate(records)
        if star["iau_abbreviation"] == guide["iau_abbreviation"] and star.get("g_mag") is not None and float(star["g_mag"]) <= max_g_mag
    ]
    selected_coordinates = coordinates[selected_indices] if selected_indices else SkyCoord([], [], unit=u.deg, frame=ICRS())
    selected_altaz = selected_coordinates.transform_to(frame) if selected_indices else None
    bright_indices = [index for index in selected_indices if records[index].get("g_mag") is not None and float(records[index]["g_mag"]) <= min(4.5, max_g_mag)]
    bright_coordinates = coordinates[bright_indices] if bright_indices else SkyCoord([], [], unit=u.deg, frame=ICRS())
    stars = [
        {
            "gaia_dr3_source_id": records[index]["gaia_dr3_source_id"],
            "g_mag": records[index]["g_mag"],
            "ra_deg": records[index]["ra_deg"],
            "dec_deg": records[index]["dec_deg"],
            "epoch": records[index]["epoch"],
            "source": records[index]["source"],
            "iau_abbreviation": records[index]["iau_abbreviation"],
            "pmra_mas_yr": records[index].get("pmra_mas_yr"),
            "pmdec_mas_yr": records[index].get("pmdec_mas_yr"),
            "parallax_mas": records[index].get("parallax_mas"),
            "astrometric_motion": _motion_status(records[index]),
            "altitude_deg": _rounded(float(selected_altaz.alt[position].deg)),
            "azimuth_deg": _rounded(float(selected_altaz.az[position].deg)),
            "above_horizon": bool(selected_altaz.alt[position].deg >= 0),
        }
        for position, index in enumerate(selected_indices)
    ]
    chosen_segments = [segment for segment in segments if guide["iau_abbreviation"] in segment.get("constellations", [])]
    boundary_points = [point for segment in chosen_segments for point in (segment["start"], segment["end"])]
    boundary_coordinates = SkyCoord(
        ra=np.asarray([point["ra_deg"] for point in boundary_points]) * u.deg,
        dec=np.asarray([point["dec_deg"] for point in boundary_points]) * u.deg,
        frame=ICRS(),
    ) if boundary_points else SkyCoord([], [], unit=u.deg, frame=ICRS())
    boundary_altaz = boundary_coordinates.transform_to(frame) if boundary_points else None
    boundaries = [
        {
            "start": {"altitude_deg": _rounded(float(boundary_altaz.alt[index * 2].deg)), "azimuth_deg": _rounded(float(boundary_altaz.az[index * 2].deg))},
            "end": {"altitude_deg": _rounded(float(boundary_altaz.alt[index * 2 + 1].deg)), "azimuth_deg": _rounded(float(boundary_altaz.az[index * 2 + 1].deg))},
            "constellations": segment["constellations"],
        }
        for index, segment in enumerate(chosen_segments)
    ]
    representative = guide.get("representative_icrs_j2000")
    if not isinstance(representative, dict):
        raise RuntimeError("constellation guide has no representative coordinate")
    representative_coordinate = SkyCoord(ra=float(representative["ra_deg"]) * u.deg, dec=float(representative["dec_deg"]) * u.deg, frame=ICRS())
    representative_altaz = _altaz_row(representative_coordinate, frame)
    boundary_visibility = _boundary_visibility(boundary_altaz)
    planning = _annual_plan(observer, representative_coordinate, bright_coordinates, moment, latitude_deg)
    sun = _altaz_row(get_sun(moment), frame)
    now_observing = _now_observing(records, coordinates, frame, _twilight(float(sun["altitude_deg"])), data_root=data_root)
    return {
        "input": {"latitude_deg": latitude_deg, "longitude_deg": longitude_deg, "elevation_m": elevation_m, "utc": moment.utc.isot},
        "method": "Astropy ICRS catalogue coordinates transformed to topocentric AltAz at UTC; pressure=0 hPa; IERS auto-download disabled.",
        "frame": "ICRS → GCRS/ITRS → local AltAz",
        "input_scale": "UTC",
        "catalogue_epoch": "J2016.0",
        "refraction": "disabled (pressure=0 hPa)",
        "iers_warning": "Uses Astropy packaged/local IERS data only. UT1 uncertainty can affect future predictions.",
        "twilight": _twilight(float(sun["altitude_deg"])),
        "sun": sun,
        "now_observing": now_observing,
        "constellation": guide,
        "max_g_mag": max_g_mag,
        "stars": stars,
        "boundaries": boundaries,
        "selected": {
            "iau_abbreviation": guide["iau_abbreviation"],
            "representative_point": representative_altaz,
            "boundary_visibility": boundary_visibility,
            "bright_stars_above_horizon": int(sum(star["above_horizon"] for star in stars if star["g_mag"] <= min(4.5, max_g_mag))),
            "stars": stars,
            "boundary_segments": boundaries,
            "planning": planning,
        },
        "planning": planning,
        "provenance": [
            {"source": "ESA Gaia Archive DR3 TAP", "dataset": "project offline bright-star subset", "epoch": "J2016.0", "frame": "ICRS"},
            {"source": "Roman 1987 / Delporte via Astropy", "dataset": "formal IAU constellation boundaries", "source_frame": "B1875.0", "render_frame": "ICRS/J2000"},
        ],
        "named_stars": {"status": named.get("status"), "source": named.get("source"), "items": named.get("items", [])},
        "limitations": [
            "Gaia DR3 subset is magnitude-limited to G <= 6.5 and is not a complete star catalogue.",
            "Gaia G magnitude is not identical to human visual magnitude; point size and opacity are visual aids, not physical stellar size.",
            "Official IAU boundaries are regions; cultural asterism lines are not present.",
            "Catalogue positions preserve their J2016.0 source epoch; no browser propagation or approximation is used.",
        ],
    }
