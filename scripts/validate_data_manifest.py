"""Offline integrity and inventory validation for every scientific artifact."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1 << 20):
            value.update(block)
    return value.hexdigest()


def load(relative: str) -> dict[str, object]:
    path = ROOT / relative
    if not path.is_file():
        raise ValueError(f"ausente: {relative}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError(f"JSON inválido: {relative}") from error
    if not isinstance(value, dict):
        raise ValueError(f"raiz JSON inválida: {relative}")
    return value


def finite_vector(value: object, label: str) -> None:
    if not isinstance(value, list) or len(value) != 3 or not all(isinstance(item, (int, float)) and math.isfinite(float(item)) for item in value):
        raise ValueError(f"vetor físico inválido: {label}")


def validate_kernels() -> int:
    manifest = load("data/manifests/kernels.json")
    entries = manifest.get("files")
    if not isinstance(entries, list) or len(entries) != 3:
        raise ValueError("o manifesto deve declarar exatamente três kernels")
    expected_names = {"naif0012.tls", "pck00011.tpc", "de442s.bsp"}
    if {entry.get("name") for entry in entries if isinstance(entry, dict)} != expected_names:
        raise ValueError("inventário de kernels inesperado")
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("entrada de kernel inválida")
        path = ROOT / "data/kernels" / str(entry.get("name", ""))
        if not path.is_file() or path.stat().st_size != entry.get("size_bytes") or sha256(path) != entry.get("sha256"):
            raise ValueError(f"kernel inválido: {entry.get('name', 'sem nome')}")
    return len(entries)


def validate_catalogues_and_copies() -> tuple[int, int, int, int]:
    manifest = load("data/manifests/offline_catalogs.json")
    entries = manifest.get("entries")
    if not isinstance(entries, list):
        raise ValueError("manifesto de catálogos sem entradas")
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("entrada de catálogo inválida")
        source = ROOT / str(entry.get("source_path", ""))
        public = ROOT / str(entry.get("public_path", ""))
        if not source.is_file() or not public.is_file():
            raise ValueError(f"origem ou cópia pública ausente: {entry.get('source_path')}")
        origin_hash = sha256(source)
        if origin_hash != entry.get("sha256") or sha256(public) != origin_hash or entry.get("public_sha256") != origin_hash:
            raise ValueError(f"hash de origem/cópia pública divergiu: {entry.get('source_path')}")

    moons = load("data/moons/moons.json")
    moon_items = moons.get("moons")
    if not isinstance(moon_items, list) or len(moon_items) != 460:
        raise ValueError("o catálogo deve conter 460 luas")
    stars = load("data/stars/gaia_bright.json")
    star_items = stars.get("stars")
    if stars.get("count") != 10_000 or not isinstance(star_items, list) or len(star_items) != 10_000:
        raise ValueError("o catálogo Gaia deve conter 10.000 estrelas")
    boundaries = load("data/constellations/iau_boundaries.json")
    if boundaries.get("count") != 88:
        raise ValueError("o catálogo IAU deve declarar 88 constelações")
    guides = load("data/constellations/constellation_guides.json")
    guide_items = guides.get("items")
    if not isinstance(guide_items, list) or len(guide_items) != 88:
        raise ValueError("o catálogo de guias deve conter 88 constelações")
    abbreviations = [item.get("iau_abbreviation") for item in guide_items if isinstance(item, dict)]
    if len(abbreviations) != 88 or len(set(abbreviations)) != 88 or any(not isinstance(item, str) or len(item) != 3 for item in abbreviations):
        raise ValueError("abreviações IAU ausentes, repetidas ou inválidas")
    return len(moon_items), len(star_items), int(boundaries["count"]), len(entries)


def validate_snapshot() -> int:
    snapshot = load("public/reference-snapshot.json")
    bodies = snapshot.get("bodies")
    if not isinstance(bodies, list) or len(bodies) != 10:
        raise ValueError("o snapshot deve conter 10 corpos")
    if snapshot.get("frame") != "J2000" or snapshot.get("center") != "Solar System Barycenter" or snapshot.get("time_scale") != "TDB/ET":
        raise ValueError("referencial, centro ou escala temporal do snapshot inválidos")
    for body in bodies:
        if not isinstance(body, dict):
            raise ValueError("corpo inválido no snapshot")
        name = str(body.get("name", "sem nome"))
        finite_vector(body.get("position_m"), f"{name}.position_m")
        finite_vector(body.get("velocity_m_s"), f"{name}.velocity_m_s")
        for field in ("mu_m3_s2", "radius_m"):
            value = body.get(field)
            if not isinstance(value, (int, float)) or not math.isfinite(float(value)):
                raise ValueError(f"campo físico inválido: {name}.{field}")
        for field in ("body_naif_id", "state_target_naif_id", "state_center_naif_id", "state_kind", "state_target_name"):
            if field not in body:
                raise ValueError(f"identidade de alvo ausente: {name}.{field}")
    return len(bodies)


def main() -> None:
    try:
        kernels = validate_kernels()
        moons, stars, constellations, copies = validate_catalogues_and_copies()
        bodies = validate_snapshot()
    except ValueError as error:
        raise SystemExit(f"integridade científica inválida: {error}") from error
    print(f"verified offline: kernels={kernels}, moons={moons}, stars={stars}, constellations={constellations}, snapshot_bodies={bodies}, manifest_entries={copies}")


if __name__ == "__main__":
    main()
