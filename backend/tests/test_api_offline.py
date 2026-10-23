from __future__ import annotations

from pathlib import Path
import unittest

from fastapi.testclient import TestClient

from astro_system.api.main import app


ROOT = Path(__file__).resolve().parents[2]
HAS_REFERENCE_BUNDLE = all(
    (ROOT / "data" / "kernels" / name).exists()
    for name in ("naif0012.tls", "pck00011.tpc", "de442s.bsp")
)


class ConstellationObservatoryTests(unittest.TestCase):
    """These catalog and AltAz checks intentionally need no SPICE kernel/network."""

    def test_catalogue_search_and_native_altaz_response_are_explicit(self) -> None:
        with TestClient(app) as client:
            catalogue = client.get("/api/catalogs/constellations", params={"query": "Órion", "limit": 2})
            first = client.get("/api/sky/constellations", params={"latitude_deg": -23.5505, "longitude_deg": -46.6333, "elevation_m": 760, "utc": "2024-04-08T18:00:00", "constellation": "Ori", "max_g_mag": 4.0})
            later = client.get("/api/sky/constellations", params={"latitude_deg": -23.5505, "longitude_deg": -46.6333, "elevation_m": 760, "utc": "2024-04-08T22:00:00", "constellation": "Ori", "max_g_mag": 6.5})
            partial = client.get("/api/sky/constellations", params={"latitude_deg": -23.5505, "longitude_deg": -46.6333, "elevation_m": 760, "utc": "2024-04-08T02:00:00", "constellation": "Ori"})
            below = client.get("/api/sky/constellations", params={"latitude_deg": -23.5505, "longitude_deg": -46.6333, "elevation_m": 760, "utc": "2024-04-08T04:00:00", "constellation": "Ori"})

        self.assertEqual(catalogue.status_code, 200)
        self.assertEqual(catalogue.json()["total"], 1)
        self.assertEqual(catalogue.json()["items"][0]["iau_abbreviation"], "Ori")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(later.status_code, 200)
        first_payload, later_payload = first.json(), later.json()
        self.assertEqual(first_payload["frame"], "ICRS → GCRS/ITRS → local AltAz")
        self.assertEqual(first_payload["catalogue_epoch"], "J2016.0")
        self.assertEqual(first_payload["constellation"]["iau_abbreviation"], "Ori")
        self.assertGreater(len(first_payload["boundaries"]), 0)
        self.assertLessEqual(len(first_payload["stars"]), len(later_payload["stars"]))
        self.assertNotEqual(first_payload["sun"]["altitude_deg"], later_payload["sun"]["altitude_deg"])
        self.assertEqual(first_payload["named_stars"]["status"], "unavailable")
        self.assertEqual(len(first_payload["planning"]["monthly"]), 12)
        self.assertEqual(first_payload["planning"]["current_utc_day"]["cadence_minutes"], 10)
        self.assertEqual(partial.json()["selected"]["boundary_visibility"], "partially-above-horizon")
        self.assertEqual(below.json()["selected"]["boundary_visibility"], "below-horizon")


@unittest.skipUnless(HAS_REFERENCE_BUNDLE, "reference data bundle not downloaded")
class OfflineApiTests(unittest.TestCase):
    def test_health_reference_and_catalog_inventory(self) -> None:
        with TestClient(app) as client:
            health = client.get("/api/health")
            reference = client.get("/api/reference/state")
            moons = client.get("/api/catalogs/moons")
            constellations = client.get("/api/catalogs/constellations")

        self.assertEqual(health.status_code, 200)
        self.assertTrue(health.json()["kernels_available"])
        self.assertEqual(reference.status_code, 200)
        self.assertEqual(len(reference.json()["bodies"]), 10)
        self.assertEqual(moons.status_code, 200)
        self.assertEqual(moons.json()["total"], 460)
        self.assertEqual(len(moons.json()["items"]), 80)
        self.assertEqual(constellations.status_code, 200)
        self.assertEqual(constellations.json()["count"], 88)

    def test_live_observer_endpoints_change_with_time_and_identify_totality(self) -> None:
        with TestClient(app) as client:
            morning = client.get("/api/sky", params={"latitude_deg": -23.5505, "longitude_deg": -46.6333, "elevation_m": 760, "utc": "2024-04-08T12:00:00"})
            afternoon = client.get("/api/sky", params={"latitude_deg": -23.5505, "longitude_deg": -46.6333, "elevation_m": 760, "utc": "2024-04-08T18:00:00"})
            eclipse = client.get("/api/eclipses/local", params={"latitude_deg": 30.0474, "longitude_deg": -99.1403, "elevation_m": 500, "utc": "2024-04-08T18:00:00"})

        self.assertEqual(morning.status_code, 200)
        self.assertEqual(afternoon.status_code, 200)
        morning_sun = next(item for item in morning.json()["objects"] if item["name"] == "Sun")
        afternoon_sun = next(item for item in afternoon.json()["objects"] if item["name"] == "Sun")
        self.assertNotEqual(morning_sun["altitude_deg"], afternoon_sun["altitude_deg"])
        self.assertEqual(eclipse.status_code, 200)
        result = eclipse.json()
        self.assertEqual(result["classification"], "total")
        self.assertTrue(result["sun_above_geometric_horizon_at_maximum"])
        self.assertEqual([contact["kind"] for contact in result["contacts"]], ["C1", "C2", "MAX", "C3", "C4"])
        self.assertEqual(len(result["contacts_utc"]), 4)
        self.assertEqual(len(result["internal_contacts_utc"]), 2)

    def test_moon_catalogue_search_is_paginated_without_inventing_states(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/catalogs/moons", params={"query": "Ganymede", "primary": "Jupiter", "limit": 1})

        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["items"][0]["name"], "Ganymede")
        self.assertEqual(result["items"][0]["propagation_mode"], "mean_elements_catalog_only")
        self.assertIn("No position is displayed", result["propagation_notice"])
