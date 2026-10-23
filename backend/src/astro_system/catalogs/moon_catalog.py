from __future__ import annotations

from pathlib import Path

from ..catalog_data import load_catalog

class MoonCatalog:
    def __init__(self, path: Path):
        self.path = path

    def all(self) -> list[dict]:
        return load_catalog(self.path, "moons")["moons"]

    def search(self, query: str = "", primary: str | None = None) -> list[dict]:
        normalized = query.casefold().strip()
        return [
            moon
            for moon in self.all()
            if (not primary or moon.get("primary") == primary)
            and (
                not normalized
                or normalized in (moon.get("name") or "").casefold()
                or normalized in (moon.get("designation") or "").casefold()
            )
        ]

    def counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for moon in self.all():
            counts[moon["primary"]] = counts.get(moon["primary"], 0) + 1
        return counts
