from __future__ import annotations

import json
from pathlib import Path
import unittest

from astro_system.catalogs.constellations import IAU_ABBREVIATIONS, constellation_at

ROOT = Path(__file__).resolve().parents[2]


class OfflineCatalogTests(unittest.TestCase):
    def test_moon_catalog_is_searchable_source_data_not_a_fixed_count(self) -> None:
        catalog = json.loads((ROOT / "data/moons/moons.json").read_text(encoding="utf-8"))
        names = {entry["name"] for entry in catalog["moons"]}
        self.assertIn("Moon", names)
        self.assertIn("Triton", names)
        self.assertGreater(len(names), 400)
        self.assertTrue(all(entry["propagation_mode"] == "mean_elements_catalog_only" for entry in catalog["moons"]))

    def test_gaia_subset_has_provenance_and_motion_fields(self) -> None:
        catalog = json.loads((ROOT / "data/stars/gaia_bright.json").read_text(encoding="utf-8"))
        self.assertEqual(catalog["count"], 10_000)
        self.assertIn("Gaia", catalog["source"])
        self.assertIn("pmra_mas_yr", catalog["stars"][0])

    def test_constellation_guides_and_boundary_geometry_are_distinct_artifacts(self) -> None:
        guides = json.loads((ROOT / "data/constellations/constellation_guides.json").read_text(encoding="utf-8"))
        boundaries = json.loads((ROOT / "data/constellations/iau_boundary_vertices_j2000.json").read_text(encoding="utf-8"))
        names = json.loads((ROOT / "data/stars/iau_named_stars.json").read_text(encoding="utf-8"))
        self.assertEqual(len(guides["items"]), 88)
        self.assertEqual(len({item["iau_abbreviation"] for item in guides["items"]}), 88)
        self.assertEqual(boundaries["coordinate_frame"], "ICRS")
        self.assertGreater(boundaries["segment_count"], 100)
        self.assertEqual(names["status"], "unavailable")
        self.assertEqual(constellation_at(83.822, -5.391), "Ori")
        self.assertTrue(all(item["iau_abbreviation"] in IAU_ABBREVIATIONS for item in guides["items"]))
        self.assertTrue(all("brightest_gaia_stars" in item and "declination_extent_deg" in item for item in guides["items"]))


if __name__ == "__main__":
    unittest.main()
