from .moon_catalog import MoonCatalog
from .stars import load_star_catalog, star_records


def constellation_records(query: str = "", abbreviation: str | None = None, *, data_root=None):
    from .constellations import constellation_records as records
    return records(query, abbreviation, data_root=data_root)


__all__ = ["MoonCatalog", "constellation_records", "load_star_catalog", "star_records"]
