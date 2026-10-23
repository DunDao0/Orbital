"""IAU catalogue access and formal-boundary lookup.

The compact catalogue remains available to every deployment. Detailed geometry
and local-sky transformations are consumed only by the native Astropy backend.
"""
from __future__ import annotations

from pathlib import Path
import unicodedata
from typing import Any

from ..catalog_data import load_catalog

# IAU three-letter identifiers, established from the Roman (1987) boundary set.
IAU_ABBREVIATIONS = ("And", "Ant", "Aps", "Aqr", "Aql", "Ara", "Ari", "Aur", "Boo", "Cae", "Cam", "Cnc", "CVn", "CMa", "CMi", "Cap", "Car", "Cas", "Cen", "Cep", "Cet", "Cha", "Cir", "Col", "Com", "CrA", "CrB", "Crv", "Crt", "Cru", "Cyg", "Del", "Dor", "Dra", "Equ", "Eri", "For", "Gem", "Gru", "Her", "Hor", "Hya", "Hyi", "Ind", "Lac", "Leo", "LMi", "Lep", "Lib", "Lup", "Lyn", "Lyr", "Men", "Mic", "Mon", "Mus", "Nor", "Oct", "Oph", "Ori", "Pav", "Peg", "Per", "Phe", "Pic", "Psc", "PsA", "Pup", "Pyx", "Ret", "Sge", "Sgr", "Sco", "Scl", "Sct", "Ser", "Sex", "Tau", "Tel", "Tri", "TrA", "Tuc", "UMa", "UMi", "Vel", "Vir", "Vol", "Vul")

ROOT = Path(__file__).resolve().parents[4]
GUIDES_PATH = ROOT / "data" / "constellations" / "constellation_guides.json"


def normalized(value: str) -> str:
    return "".join(character for character in unicodedata.normalize("NFKD", value).lower() if not unicodedata.combining(character)).strip()


def constellation_guides(*, data_root: Path | None = None) -> tuple[dict[str, Any], ...]:
    path = data_root / "constellations/constellation_guides.json" if data_root is not None else GUIDES_PATH
    payload = load_catalog(path, "constellations")
    items = payload.get("items", [])
    if len(items) != 88 or {item.get("iau_abbreviation") for item in items} != set(IAU_ABBREVIATIONS):
        raise RuntimeError("constellation guide catalogue is incomplete")
    return tuple(items)


def constellation_guide(abbreviation: str, *, data_root: Path | None = None) -> dict[str, Any] | None:
    canonical = abbreviation.casefold()
    return next((item for item in constellation_guides(data_root=data_root) if str(item["iau_abbreviation"]).casefold() == canonical), None)


def constellation_at(ra_deg: float, dec_deg: float) -> str:
    from astropy.coordinates import get_constellation, SkyCoord
    from astropy import units as u
    return str(get_constellation(SkyCoord(ra_deg * u.deg, dec_deg * u.deg, frame="icrs"), short_name=True))


def constellation_records(query: str = "", abbreviation: str | None = None, *, data_root: Path | None = None) -> list[dict[str, Any]]:
    requested = normalized(query)
    requested_abbreviation = normalized(abbreviation) if abbreviation else ""
    records: list[dict[str, Any]] = []
    for guide in constellation_guides(data_root=data_root):
        searchable = [str(guide["iau_abbreviation"]), str(guide["name"]), *(str(alias) for alias in guide.get("aliases", []))]
        if requested_abbreviation and normalized(str(guide["iau_abbreviation"])) != requested_abbreviation:
            continue
        if requested and not any(requested in normalized(value) for value in searchable):
            continue
        records.append({
            **guide,
            "boundary_source": "IAU boundaries via Astropy / Roman 1987",
            "cultural_lines": "not bundled",
        })
    return records
