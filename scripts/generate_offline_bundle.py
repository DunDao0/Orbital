"""Build deterministic public catalogue copies and their integrity manifest."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
MANIFEST = ROOT / "data" / "manifests" / "offline_catalogs.json"
ARTIFACTS = (
    (ROOT / "data/moons/moons.json", PUBLIC / "scientific/moons.json", "JPL SSD satellite physical-parameter and mean-elements pages"),
    (ROOT / "data/stars/gaia_bright.json", PUBLIC / "scientific/gaia_bright.json", "ESA Gaia Archive DR3 TAP"),
    (ROOT / "data/constellations/iau_boundaries.json", PUBLIC / "scientific/iau_boundaries.json", "IAU boundaries via Astropy/Roman 1987"),
    (ROOT / "data/constellations/constellation_guides.json", PUBLIC / "scientific/constellation_guides.json", "IAU names + Roman 1987/Delporte navigation guides"),
    (ROOT / "data/constellations/iau_boundary_vertices_j2000.json", PUBLIC / "scientific/iau_boundary_vertices_j2000.json", "Roman 1987/Delporte boundaries transformed to ICRS/J2000"),
    (ROOT / "data/stars/iau_named_stars.json", PUBLIC / "scientific/iau_named_stars.json", "IAU WGSN cross-match availability declaration"),
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1 << 20):
            value.update(block)
    return value.hexdigest()


def atomic_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".part")
    try:
        temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_copy(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".part")
    try:
        shutil.copyfile(source, temporary)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def previous_entries() -> dict[str, dict[str, object]]:
    try:
        payload = json.loads(MANIFEST.read_text(encoding="utf-8"))
        return {str(item["source_path"]): item for item in payload.get("entries", [])}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def main() -> None:
    previous = previous_entries()
    now = utc_now()
    entries: list[dict[str, object]] = []
    for source, public_copy, provenance in ARTIFACTS:
        if not source.is_file():
            raise SystemExit(f"artefato científico ausente: {rel(source)}")
        source_hash = digest(source)
        atomic_copy(source, public_copy)
        public_hash = digest(public_copy)
        if public_hash != source_hash:
            raise SystemExit(f"cópia pública divergiu da origem: {rel(source)}")
        prior = previous.get(rel(source), {})
        verified_utc = prior.get("verified_utc") if prior.get("sha256") == source_hash else now
        entries.append({
            "source_path": rel(source),
            "public_path": rel(public_copy),
            "source": provenance,
            "sha256": source_hash,
            "public_sha256": public_hash,
            "size_bytes": source.stat().st_size,
            "verified_utc": verified_utc or now,
            "units": "conforme metadados de cada registro",
            "precision_note": "Consulte a fonte e docs/limitations.md.",
        })

    snapshot_path = PUBLIC / "reference-snapshot.json"
    if not snapshot_path.is_file():
        raise SystemExit("snapshot de referência ausente")
    snapshot_hash = digest(snapshot_path)
    prior_snapshot = previous.get(rel(snapshot_path), {})
    entries.append({
        "source_path": rel(snapshot_path),
        "public_path": rel(snapshot_path),
        "source": "NAIF DE442s avaliado na época fixa declarada",
        "sha256": snapshot_hash,
        "public_sha256": snapshot_hash,
        "size_bytes": snapshot_path.stat().st_size,
        "verified_utc": prior_snapshot.get("verified_utc") if prior_snapshot.get("sha256") == snapshot_hash else now,
        "units": "SI por campo",
        "precision_note": "Estado de referência; não extrapolar além da cobertura do kernel.",
    })
    atomic_json(MANIFEST, {"schema": 1, "manifest_generated_utc": now, "entries": entries})

    moons = json.loads((ROOT / "data/moons/moons.json").read_text(encoding="utf-8"))
    stars = json.loads((ROOT / "data/stars/gaia_bright.json").read_text(encoding="utf-8"))
    boundaries = json.loads((ROOT / "data/constellations/iau_boundaries.json").read_text(encoding="utf-8"))
    guides = json.loads((ROOT / "data/constellations/constellation_guides.json").read_text(encoding="utf-8"))
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    kernels = json.loads((ROOT / "data/manifests/kernels.json").read_text(encoding="utf-8"))
    moon_counts: dict[str, int] = {}
    for moon in moons.get("moons", []):
        primary = str(moon.get("primary", "Unknown"))
        moon_counts[primary] = moon_counts.get(primary, 0) + 1
    public_status = {
        "schema": 1,
        "manifest_generated_utc": now,
        "reference_snapshot": {"epoch": snapshot.get("epoch"), "fixed_epoch": True, "source": snapshot.get("source"), "body_count": len(snapshot.get("bodies", [])), "sha256": snapshot_hash},
        "kernels": {"count": len(kernels.get("files", [])), "manifest": "data/manifests/kernels.json"},
        "catalogs": {
            "moons": {"count": len(moons.get("moons", [])), "by_primary": moon_counts, "source": moons.get("source")},
            "stars": {"count": stars.get("count", 0), "source": stars.get("source")},
            "constellations": {"count": boundaries.get("count", 0), "source": boundaries.get("source")},
            "constellation_guides": {"count": len(guides.get("items", [])), "source": "IAU/Roman offline guide catalogue"},
        },
        "provenance": "Checksums, public-copy relationships and verification timestamps are stored in data/manifests/offline_catalogs.json.",
    }
    atomic_json(PUBLIC / "data-status.json", public_status)
    print(f"verified and published {len(ARTIFACTS)} catalogue artifacts plus the fixed snapshot")


if __name__ == "__main__":
    main()
