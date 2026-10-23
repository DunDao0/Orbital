from __future__ import annotations

from pathlib import Path

from ..catalog_data import load_catalog

def load_star_catalog(path: Path) -> dict[str, object]:
    return load_catalog(path, "stars")


def star_records(path: Path, query: str = "", max_magnitude: float | None = None) -> tuple[dict[str, object], list[dict[str, object]]]:
    catalogue = load_star_catalog(path)
    needle = query.strip().lower()
    records = [
        item for item in catalogue.get("stars", [])
        if (not needle or needle in str(item.get("gaia_dr3_source_id", "")).lower())
        and (max_magnitude is None or (isinstance(item.get("g_mag"), (int, float)) and float(item["g_mag"]) <= max_magnitude))
    ]
    return catalogue, records
