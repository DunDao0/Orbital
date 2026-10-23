"""Build a searchable moon catalog from JPL SSD public satellite tables.

Unknown data is retained as null; this script deliberately never generates an
orbit from a name.  The resulting catalog's scope is stated in its metadata.
"""
from __future__ import annotations

from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
URL = "https://ssd.jpl.nasa.gov/sats/phys_par/"
ELEMENTS_URL = "https://ssd.jpl.nasa.gov/sats/elem/"


class Tables(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.heading = ""
        self.in_heading = False
        self.in_cell = False
        self.cell = ""
        self.row: list[str] = []
        self.rows: list[tuple[str, list[str]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"h2", "h3"}:
            self.in_heading = True
            self.heading = ""
        if tag in {"td", "th"}:
            self.in_cell = True
            self.cell = ""
        if tag == "tr":
            self.row = []

    def handle_data(self, data: str) -> None:
        if self.in_heading:
            self.heading += data
        if self.in_cell:
            self.cell += data

    def handle_endtag(self, tag: str) -> None:
        if tag in {"h2", "h3"}:
            self.in_heading = False
        if tag in {"td", "th"}:
            self.in_cell = False
            self.row.append(" ".join(self.cell.split()))
        if tag == "tr" and self.row:
            self.rows.append((self.heading, self.row))


def number(text: str) -> float | None:
    match = re.search(r"[-+]?\d+(?:\.\d+)?", text.replace(",", ""))
    return float(match.group()) if match else None


def primary(heading: str) -> str | None:
    match = re.search(r"Satellites of ([A-Za-z]+)", heading)
    return match.group(1) if match else None


def main() -> None:
    with urlopen(URL, timeout=90) as response:
        document = response.read().decode("utf-8", errors="replace")
    physical: dict[int, dict] = {}
    # JPL's compact table omits some </td> end tags; use the next cell/tr start
    # as the delimiter rather than relying on a browser's HTML error recovery.
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", document, re.IGNORECASE | re.DOTALL):
        cells = re.findall(r"<t[dh][^>]*>(.*?)(?=<t[dh][^>]*>|</tr>)", row_html, re.IGNORECASE | re.DOTALL)
        row = [" ".join(re.sub(r"<[^>]+>", " ", cell).split()) for cell in cells]
        if len(row) < 9 or row[0] in {"Planet", "value"}:
            continue
        if not row[2].isdigit():
            continue
        physical[int(row[2])] = {"mu_m3_s2": (number(row[3]) * 1e9 if number(row[3]) is not None else None), "mean_radius_m": (number(row[6]) * 1000 if number(row[6]) is not None else None), "physical_source": URL}
    with urlopen(ELEMENTS_URL, timeout=90) as response:
        elements_document = response.read().decode("utf-8", errors="replace")
    moons = []
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", elements_document, re.IGNORECASE | re.DOTALL):
        cells = re.findall(r"<t[dh][^>]*>(.*?)(?=<t[dh][^>]*>|</tr>)", row_html, re.IGNORECASE | re.DOTALL)
        row = [" ".join(re.sub(r"<[^>]+>", " ", cell).replace("&nbsp;", " ").split()) for cell in cells]
        if len(row) < 14 or not row[0].isdigit() or not row[3].isdigit():
            continue
        code = int(row[3])
        details = physical.get(code, {})
        moons.append({"name": row[2], "designation": None, "primary": row[1], "naif_id": code, "mu_m3_s2": details.get("mu_m3_s2"), "mean_radius_m": details.get("mean_radius_m"), "orbit": {"a_m": (number(row[7]) * 1000 if number(row[7]) is not None else None), "e": number(row[8]), "argument_periapsis_deg": number(row[9]), "mean_anomaly_deg": number(row[10]), "inclination_deg": number(row[11]), "ascending_node_deg": number(row[12]), "period_days": number(row[13]), "epoch_tdb": row[6], "frame": row[5], "ephemeris": row[4]}, "propagation_mode": "mean_elements_catalog_only", "status": "JPL SSD listed", "source": ELEMENTS_URL, "physical_source": details.get("physical_source")})
    output = {"generated_utc": datetime.now(timezone.utc).isoformat(), "source": [URL, ELEMENTS_URL], "scope": "All  mean-element rows currently exposed by JPL SSD. Mean elements are catalog data only and are explicitly not used as high-fidelity visual ephemerides; use a named SPICE/Horizons source for any propagated minor moon.", "moons": moons}
    target = ROOT / "data/moons/moons.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {len(moons)} JPL satellite records")


if __name__ == "__main__":
    main()
