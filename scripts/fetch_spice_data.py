"""Acquire the pinned NAIF kernel bundle without accepting unreviewed bytes."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "data" / "kernels"
MANIFEST = ROOT / "data" / "manifests" / "kernels.json"
DOWNLOAD_TIMEOUT_S = 180

# Pins are intentionally code constants. A pin change must be reviewed; the
# downloader never learns a new hash from downloaded content.
PINNED_FILES = {
    "naif0012.tls": {
        "url": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls",
        "sha256": "678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b",
        "size_bytes": 5_257,
        "signature": b"KPL/LSK",
        "version": "naif0012.tls",
    },
    "pck00011.tpc": {
        "url": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc",
        "sha256": "3dff7b1dbeceaa01f25467767d3fa25816051c85d162d1edf04acb310ee28bb1",
        "size_bytes": 131_226,
        "signature": b"KPL/PCK",
        "version": "pck00011.tpc",
    },
    "de442s.bsp": {
        "url": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de442s.bsp",
        "sha256": "54d97562a5b094d298b1b8eafa5a2e17e3e010ce85e1a366d07f003ad159323c",
        "size_bytes": 32_701_440,
        "signature": b"DAF/SPK",
        "version": "DE442s",
    },
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1 << 20):
            value.update(block)
    return value.hexdigest()


def validate_file(path: Path, pin: dict[str, object]) -> None:
    if not path.is_file():
        raise ValueError("arquivo ausente")
    if path.stat().st_size != int(pin["size_bytes"]):
        raise ValueError("tamanho diferente do pin")
    with path.open("rb") as source:
        if source.read(16).lstrip()[:7] != bytes(pin["signature"]):
            raise ValueError("assinatura de kernel inválida")
    if digest(path) != pin["sha256"]:
        raise ValueError("SHA-256 diferente do pin")


def _previous_entries() -> dict[str, dict[str, object]]:
    try:
        payload = json.loads(MANIFEST.read_text(encoding="utf-8"))
        return {str(item["name"]): item for item in payload.get("files", [])}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def _atomic_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".part")
    try:
        temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _download_validated(path: Path, pin: dict[str, object]) -> None:
    temporary = path.with_suffix(path.suffix + ".part")
    temporary.unlink(missing_ok=True)
    try:
        with urlopen(str(pin["url"]), timeout=DOWNLOAD_TIMEOUT_S) as source, temporary.open("wb") as destination:
            while block := source.read(1 << 20):
                destination.write(block)
        validate_file(temporary, pin)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    previous = _previous_entries()
    entries: list[dict[str, object]] = []
    for name, pin in PINNED_FILES.items():
        path = TARGET / name
        downloaded = False
        try:
            validate_file(path, pin)
        except ValueError:
            print(f"baixando e verificando {name}")
            _download_validated(path, pin)
            downloaded = True
        verified_utc = utc_now()
        prior_obtained = previous.get(name, {}).get("obtained_utc")
        entries.append({
            "name": name,
            "version": pin["version"],
            "source": pin["url"],
            "obtained_utc": verified_utc if downloaded else prior_obtained,
            "verified_utc": verified_utc,
            "sha256": pin["sha256"],
            "size_bytes": pin["size_bytes"],
            "frame": "J2000 / SSB",
            "time_scale": "ET/TDB",
            "coverage": "extraída do SPK em runtime; não extrapolar",
            "license": "NASA/JPL NAIF public distribution",
            "producer": "scripts/fetch_spice_data.py",
        })
    payload = {"schema": 1, "manifest_generated_utc": utc_now(), "files": entries}
    _atomic_json(MANIFEST, payload)
    print(f"verificados {len(entries)} kernels fixados; manifesto atualizado atomicamente")


if __name__ == "__main__":
    main()
