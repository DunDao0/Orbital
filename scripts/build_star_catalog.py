"""Build a browser-sized, real Gaia DR3 catalog; never synthesize star positions."""
from __future__ import annotations

import csv
from datetime import datetime, timezone
import io
import json
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
ADQL = "SELECT TOP 10000 source_id,ra,dec,phot_g_mean_mag,pmra,pmdec,parallax FROM gaiadr3.gaia_source WHERE phot_g_mean_mag <= 6.5 ORDER BY phot_g_mean_mag ASC"
BASE_URL = "https://gea.esac.esa.int/tap-server/tap/sync"


def nullable(value: str | None) -> float | None:
    return float(value) if value not in {None, "", "null"} else None


def main() -> None:
    query = urlencode({"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": ADQL})
    with urlopen(BASE_URL + "?" + query, timeout=180) as response:
        text = response.read().decode("utf-8")
    rows = []
    for row in csv.DictReader(io.StringIO(text)):
        rows.append({"gaia_dr3_source_id": row["source_id"], "ra_deg": nullable(row["ra"]), "dec_deg": nullable(row["dec"]), "g_mag": nullable(row["phot_g_mean_mag"]), "pmra_mas_yr": nullable(row["pmra"]), "pmdec_mas_yr": nullable(row["pmdec"]), "parallax_mas": nullable(row["parallax"]), "epoch": "J2016.0", "source": "Gaia DR3"})
    target = ROOT / "data/stars/gaia_bright.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps({"generated_utc": datetime.now(timezone.utc).isoformat(), "source": "ESA Gaia Archive DR3 TAP", "adql": ADQL, "count": len(rows), "stars": rows}, indent=2), encoding="utf-8")
    print(f"wrote {len(rows)} Gaia DR3 stars")


if __name__ == "__main__":
    main()
