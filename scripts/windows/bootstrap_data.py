"""Restore approved catalogue/manifest bytes; download only pinned NAIF kernels."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
CATALOGUES = {
    "data/moons/moons.json": "moons.json",
    "data/stars/gaia_bright.json": "gaia_bright.json",
    "data/stars/iau_named_stars.json": "iau_named_stars.json",
    "data/constellations/iau_boundaries.json": "iau_boundaries.json",
    "data/constellations/constellation_guides.json": "constellation_guides.json",
    "data/constellations/iau_boundary_vertices_j2000.json": "iau_boundary_vertices_j2000.json",
}


def matches(path: Path, pin: dict) -> bool:
    if not path.is_file() or path.stat().st_size != pin["bytes"]:
        return False
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest() == pin["sha256"]


def restore(root: Path, check_only: bool = False) -> None:
    inventory = json.loads((root / "backend/data-inventory.json").read_text(encoding="utf-8"))
    # Existing differing scientific files are never silently overwritten.
    sources = {key: root / "public/scientific" / value for key, value in CATALOGUES.items()}
    for name in ("kernels.json", "offline_catalogs.json", "benchmark.json"):
        sources[f"data/manifests/{name}"] = root / "scripts/windows/manifests" / name
    for relative, source in sources.items():
        destination, pin = root / relative, inventory[relative]
        if matches(destination, pin):
            continue
        if destination.exists():
            raise ValueError(f"Dados existentes diferem do pacote aprovado: {relative}. Preserve-os e revise manualmente.")
        if check_only:
            raise ValueError(f"Arquivo ausente: {relative}")
        if not matches(source, pin):
            raise ValueError(f"Pacote incompleto ou alterado: {source}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)

    spec = importlib.util.spec_from_file_location("pinned_kernels", root / "scripts/fetch_spice_data.py")
    downloader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(downloader)
    for name, pin in downloader.PINNED_FILES.items():
        destination = root / "data/kernels" / name
        approved = inventory[f"data/kernels/{name}"]
        if pin["sha256"] != approved["sha256"] or pin["size_bytes"] != approved["bytes"]:
            raise ValueError(f"Pins inconsistentes: {name}")
        if matches(destination, approved):
            continue
        if destination.exists():
            raise ValueError(f"Kernel existente nao aprovado: {name}. Nada foi sobrescrito.")
        if check_only:
            raise ValueError(f"Kernel ausente: {name}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        print(f"Baixando kernel verificado: {name}", flush=True)
        downloader._download_validated(destination, pin)
    print("Catalogos, kernels e manifestos verificados. Timestamps de origem preservados.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-only", action="store_true")
    restore(ROOT, parser.parse_args().check_only)
