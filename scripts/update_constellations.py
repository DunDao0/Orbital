"""Build offline IAU constellation artefacts from installed source data.

The command is deliberately offline. Astropy distributes the Roman (1987)
table used by ``get_constellation`` and the IAU name list; the project already
contains a bounded Gaia DR3 subset acquired in a separate reproducible step.
The boundary map contains the exact shared edges of the partition induced by
every Roman-table breakpoint, transformed from B1875 to ICRS/J2000 for display.
It is never a cultural stick figure.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
from astropy import units as u
from astropy.coordinates import ICRS, PrecessedGeocentric, SkyCoord, get_constellation
from astropy.time import Time

ROOT = Path(__file__).resolve().parents[1]
ASTROPY_DATA = ROOT / "backend" / ".venv" / "Lib" / "site-packages" / "astropy" / "coordinates" / "data"

# Search-only Portuguese glossary. These aliases are editorial navigation aids,
# not a second authority for the IAU names or the formal Roman geometry.
PORTUGUESE_ALIASES = {
    "And": ["Andrômeda"], "Ant": ["Máquina Pneumática"], "Aps": ["Ave do Paraíso"], "Aqr": ["Aquário"], "Aql": ["Águia"], "Ara": ["Altar"], "Ari": ["Áries"], "Aur": ["Cocheiro"], "Boo": ["Boieiro"], "Cae": ["Buril"], "Cam": ["Girafa"], "Cnc": ["Câncer", "Caranguejo"], "CVn": ["Cães de Caça"], "CMa": ["Cão Maior"], "CMi": ["Cão Menor"], "Cap": ["Capricórnio"], "Car": ["Quilha"], "Cas": ["Cassiopeia"], "Cen": ["Centauro"], "Cep": ["Cefeu"], "Cet": ["Baleia"], "Cha": ["Camaleão"], "Cir": ["Compasso"], "Col": ["Pomba"], "Com": ["Cabeleira de Berenice"], "CrA": ["Coroa Austral"], "CrB": ["Coroa Boreal"], "Crv": ["Corvo"], "Crt": ["Taça"], "Cru": ["Cruzeiro do Sul"], "Cyg": ["Cisne"], "Del": ["Golfinho"], "Dor": ["Dourado"], "Dra": ["Dragão"], "Equ": ["Potro"], "Eri": ["Erídano"], "For": ["Fornalha"], "Gem": ["Gêmeos"], "Gru": ["Grou"], "Her": ["Hércules"], "Hor": ["Relógio"], "Hya": ["Hidra"], "Hyi": ["Hidro"], "Ind": ["Índio"], "Lac": ["Lagarto"], "Leo": ["Leão"], "LMi": ["Leão Menor"], "Lep": ["Lebre"], "Lib": ["Libra", "Balança"], "Lup": ["Lobo"], "Lyn": ["Lince"], "Lyr": ["Lira"], "Men": ["Mesa"], "Mic": ["Microscópio"], "Mon": ["Unicórnio"], "Mus": ["Mosca"], "Nor": ["Esquadro"], "Oct": ["Oitante"], "Oph": ["Serpentário"], "Ori": ["Órion"], "Pav": ["Pavão"], "Peg": ["Pégaso"], "Per": ["Perseu"], "Phe": ["Fênix"], "Pic": ["Pintor"], "Psc": ["Peixes"], "PsA": ["Peixe Austral"], "Pup": ["Popa"], "Pyx": ["Bússola"], "Ret": ["Retículo"], "Sge": ["Flecha"], "Sgr": ["Sagitário"], "Sco": ["Escorpião"], "Scl": ["Escultor"], "Sct": ["Escudo"], "Ser": ["Serpente"], "Sex": ["Sextante"], "Tau": ["Touro"], "Tel": ["Telescópio"], "Tri": ["Triângulo"], "TrA": ["Triângulo Austral"], "Tuc": ["Tucano"], "UMa": ["Ursa Maior"], "UMi": ["Ursa Menor"], "Vel": ["Vela"], "Vir": ["Virgem"], "Vol": ["Peixe Voador"], "Vul": ["Raposa"],
}


def read_names() -> dict[str, str]:
    names: dict[str, str] = {}
    for line in (ASTROPY_DATA / "constellation_names.dat").read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        abbreviation, full_name = line[:3], line[4:].strip()
        names[abbreviation] = full_name
    if len(names) != 88:
        raise RuntimeError(f"expected 88 IAU names, received {len(names)}")
    if set(PORTUGUESE_ALIASES) != set(names):
        raise RuntimeError("Portuguese lookup glossary must cover every IAU abbreviation")
    return names


def read_roman_rows() -> list[tuple[float, float, float, str]]:
    rows: list[tuple[float, float, float, str]] = []
    for line in (ASTROPY_DATA / "constellation_data_roman87.dat").read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        lower, upper, declination, abbreviation = line.split()
        rows.append((float(lower), float(upper), float(declination), abbreviation))
    if len(rows) != 357:
        raise RuntimeError(f"expected 357 Roman rows, received {len(rows)}")
    return rows


def classify_cell(ra_hours: float, dec_deg: float, rows: list[tuple[float, float, float, str]]) -> str:
    for lower, upper, declination, abbreviation in rows:
        if lower < ra_hours < upper and dec_deg > declination:
            return abbreviation
    raise RuntimeError(f"Roman partition did not classify {ra_hours}h {dec_deg}°")


def icrs_points(points: list[tuple[float, float]]) -> list[dict[str, float]]:
    """Transform endpoints in one Astropy operation, not one operation/star."""
    source = SkyCoord(
        ra=np.asarray([point[0] for point in points]) * u.hourangle,
        dec=np.asarray([point[1] for point in points]) * u.deg,
        frame=PrecessedGeocentric(equinox=Time("B1875")),
    ).transform_to(ICRS())
    return [{"ra_deg": round(float(ra), 8), "dec_deg": round(float(dec), 8)} for ra, dec in zip(source.ra.deg, source.dec.deg, strict=True)]


def merge_intervals(items: list[tuple[float, float, tuple[str, str]]]) -> list[tuple[float, float, tuple[str, str]]]:
    merged: list[tuple[float, float, tuple[str, str]]] = []
    for start, end, pair in sorted(items, key=lambda item: (item[2], item[0], item[1])):
        if merged and pair == merged[-1][2] and abs(start - merged[-1][1]) < 1e-9:
            merged[-1] = (merged[-1][0], end, pair)
        else:
            merged.append((start, end, pair))
    return merged


def build_boundary_segments(rows: list[tuple[float, float, float, str]]) -> list[dict[str, Any]]:
    """Turn the Roman decision table into a non-overlapping shared-edge map."""
    ra_edges = sorted({0.0, 24.0, *(value for row in rows for value in row[:2])})
    dec_edges = sorted({-90.0, 90.0, *(row[2] for row in rows)})
    cells: list[list[str]] = []
    for dec_index in range(len(dec_edges) - 1):
        dec_mid = (dec_edges[dec_index] + dec_edges[dec_index + 1]) / 2
        cells.append([classify_cell((ra_edges[ra_index] + ra_edges[ra_index + 1]) / 2, dec_mid, rows) for ra_index in range(len(ra_edges) - 1)])

    horizontal: dict[float, list[tuple[float, float, tuple[str, str]]]] = defaultdict(list)
    for dec_index in range(1, len(dec_edges) - 1):
        for ra_index in range(len(ra_edges) - 1):
            below, above = cells[dec_index - 1][ra_index], cells[dec_index][ra_index]
            if below != above:
                horizontal[dec_edges[dec_index]].append((ra_edges[ra_index], ra_edges[ra_index + 1], tuple(sorted((below, above)))))

    vertical: dict[float, list[tuple[float, float, tuple[str, str]]]] = defaultdict(list)
    for ra_index in range(1, len(ra_edges) - 1):
        for dec_index in range(len(dec_edges) - 1):
            left, right = cells[dec_index][ra_index - 1], cells[dec_index][ra_index]
            if left != right:
                vertical[ra_edges[ra_index]].append((dec_edges[dec_index], dec_edges[dec_index + 1], tuple(sorted((left, right)))))

    raw_segments: list[tuple[tuple[float, float], tuple[float, float], tuple[str, str]]] = []
    for declination, intervals in horizontal.items():
        for start, end, pair in merge_intervals(intervals):
            raw_segments.append(((start, declination), (end, declination), pair))
    for right_ascension, intervals in vertical.items():
        for start, end, pair in merge_intervals(intervals):
            raw_segments.append(((right_ascension, start), (right_ascension, end), pair))
    transformed = icrs_points([point for segment in raw_segments for point in segment[:2]])
    segments = [{"start": transformed[index * 2], "end": transformed[index * 2 + 1], "constellations": list(segment[2])} for index, segment in enumerate(raw_segments)]
    return sorted(segments, key=lambda segment: (segment["constellations"], segment["start"]["ra_deg"], segment["start"]["dec_deg"]))


def representative_coordinates(rows: list[tuple[float, float, float, str]]) -> dict[str, dict[str, float]]:
    """Stable interior navigation labels, never observed-object positions."""
    samples: dict[str, list[tuple[float, float]]] = defaultdict(list)
    ra_edges = sorted({0.0, 24.0, *(value for row in rows for value in row[:2])})
    dec_edges = sorted({-90.0, 90.0, *(row[2] for row in rows)})
    for dec_index in range(len(dec_edges) - 1):
        dec_mid = (dec_edges[dec_index] + dec_edges[dec_index + 1]) / 2
        for ra_index in range(len(ra_edges) - 1):
            ra_mid = (ra_edges[ra_index] + ra_edges[ra_index + 1]) / 2
            samples[classify_cell(ra_mid, dec_mid, rows)].append((ra_mid, dec_mid))
    raw_points: list[tuple[float, float]] = []
    abbreviations: list[str] = []
    for abbreviation, values in sorted(samples.items()):
        radians = np.deg2rad([ra * 15 for ra, _ in values])
        average_ra = float(np.rad2deg(np.arctan2(np.sin(radians).mean(), np.cos(radians).mean())) % 360)
        average_dec = float(np.mean([dec for _, dec in values]))
        abbreviations.append(abbreviation)
        raw_points.append((average_ra / 15, average_dec))
    return dict(zip(abbreviations, icrs_points(raw_points), strict=True))


def gaia_summary() -> tuple[dict[str, int], dict[str, list[dict[str, Any]]]]:
    catalog = json.loads((ROOT / "data" / "stars" / "gaia_bright.json").read_text(encoding="utf-8"))
    stars = catalog.get("stars", [])
    coordinates = SkyCoord(ra=np.asarray([star["ra_deg"] for star in stars]) * u.deg, dec=np.asarray([star["dec_deg"] for star in stars]) * u.deg, frame="icrs")
    assigned = get_constellation(coordinates, short_name=True)
    counts: dict[str, int] = defaultdict(int)
    brightest: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for star, abbreviation in zip(stars, assigned, strict=True):
        counts[str(abbreviation)] += 1
        brightest[str(abbreviation)].append({
            "gaia_dr3_source_id": star["gaia_dr3_source_id"], "g_mag": star["g_mag"],
            "ra_deg": star["ra_deg"], "dec_deg": star["dec_deg"], "epoch": star["epoch"], "source": star["source"],
            "name_status": "unavailable_no_official_wgsn_cross_match",
        })
    return dict(counts), {abbreviation: sorted(items, key=lambda star: float(star["g_mag"]) if star["g_mag"] is not None else float("inf"))[:5] for abbreviation, items in brightest.items()}


def boundary_extent(boundaries: list[dict[str, Any]], abbreviation: str) -> tuple[float, float]:
    values = [point["dec_deg"] for segment in boundaries if abbreviation in segment["constellations"] for point in (segment["start"], segment["end"])]
    if not values:
        raise RuntimeError(f"missing boundary extent for {abbreviation}")
    return min(values), max(values)


def hemisphere_label(minimum_declination: float, maximum_declination: float) -> str:
    if minimum_declination > 5:
        return "northern"
    if maximum_declination < -5:
        return "southern"
    return "crosses-equator"


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    names = read_names()
    rows = read_roman_rows()
    source_bytes = (ASTROPY_DATA / "constellation_data_roman87.dat").read_bytes()
    source_sha256 = hashlib.sha256(source_bytes).hexdigest()
    generated_utc = datetime.now(timezone.utc).isoformat()
    abbreviations = tuple(names)
    representatives = representative_coordinates(rows)
    counts, brightest = gaia_summary()
    boundaries = build_boundary_segments(rows)
    guides = {
        "schema": 1, "generated_utc": generated_utc,
        "source": "IAU names as distributed with Astropy; Delporte boundaries via Roman 1987 (CDS VI/42)",
        "catalogue_epoch": "J2016.0",
        "items": [{
            "iau_abbreviation": abbreviation, "name": names[abbreviation], "aliases": [abbreviation, names[abbreviation], *PORTUGUESE_ALIASES[abbreviation]],
            "portuguese_aliases": PORTUGUESE_ALIASES[abbreviation], "editorial_alias_source": "Orbis Scientia Portuguese lookup glossary; aliases do not alter IAU names or formal geometry.",
            "representative_icrs_j2000": representatives[abbreviation],
            "representative_note": "Interior navigation point of the IAU Roman/Delporte partition; not a star or an observed position.",
            "gaia_subset_count": counts.get(abbreviation, 0), "brightest_gaia_stars": brightest.get(abbreviation, []),
            "declination_extent_deg": {"min": round(boundary_extent(boundaries, abbreviation)[0], 6), "max": round(boundary_extent(boundaries, abbreviation)[1], 6)},
            "hemisphere": hemisphere_label(*boundary_extent(boundaries, abbreviation)),
            "potential_latitude_visibility_deg": {"min": round(max(-90, boundary_extent(boundaries, abbreviation)[0] - 90), 6), "max": round(min(90, boundary_extent(boundaries, abbreviation)[1] + 90), 6), "method": "Derived only from the IAU region declination extent; it is geometric potential, not a weather, terrain or continent guarantee."},
            "continents": {"status": "unavailable", "message": "No licensed geographic latitude-intersection dataset is bundled in this version."},
            "history": {"status": "unavailable", "message": "Conteúdo histórico curado não está incluído nesta distribuição offline."},
            "notable_stars": [],
        } for abbreviation in abbreviations],
        "limitations": [
            "The Gaia DR3 subset is magnitude-limited (G <= 6.5) and does not contain a complete stellar census.",
            "Names and geometry identify official IAU regions; cultural line drawings are deliberately not bundled.",
            "Representative coordinates are navigation labels, not physical objects or astrometric measurements.",
        ],
    }
    geometry = {
        "schema": 1, "generated_utc": generated_utc,
        "source": "Roman 1987 / Delporte IAU boundary table via Astropy (CDS VI/42)", "source_sha256": source_sha256,
        "source_coordinate_frame": "PrecessedGeocentric equinox B1875.0", "coordinate_frame": "ICRS", "coordinate_epoch": "J2000.0",
        "boundary_method": "Shared edges of the exact partition induced by all Roman table breakpoints; transformed from B1875 to ICRS/J2000.",
        "segment_count": len(boundaries), "segments": boundaries,
        "limitations": ["This is formal IAU region geometry, not an artistic asterism map.", "The source table defines classification in B1875; ICRS/J2000 values are a deterministic coordinate transform for rendering."],
    }
    named_stars = {
        "schema": 1, "generated_utc": generated_utc,
        "source": "No IAU Working Group on Star Names cross-match is bundled in this offline distribution.", "status": "unavailable", "items": [],
        "limitations": ["The Gaia DR3 subset has no star-name field, so no names are inferred from identifiers or positions."],
    }
    inventory = {
        "count": len(abbreviations), "source": "IAU constellation boundaries via Astropy's Roman 1987 dataset",
        "boundary_representation": "coordinate classification; detailed geometry is in iau_boundary_vertices_j2000.json; cultural line drawings are deliberately separate", "abbreviations": abbreviations,
    }
    target = ROOT / "data" / "constellations"
    write_json(target / "constellation_guides.json", guides)
    write_json(target / "iau_boundary_vertices_j2000.json", geometry)
    write_json(ROOT / "data" / "stars" / "iau_named_stars.json", named_stars)
    write_json(target / "iau_boundaries.json", inventory)
    print(f"wrote {len(abbreviations)} guides, {len(boundaries)} boundary segments and an explicit empty named-star cross-match")


if __name__ == "__main__":
    main()
