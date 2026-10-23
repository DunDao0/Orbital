"""Offline catalogue trust gate: approved bytes before versioned parsed caches."""
from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
import re

from .api.contracts import MoonRecord, StarRecord


APPROVED_INVENTORY_PATH = Path(__file__).resolve().parents[2] / "data-inventory.json"
CATALOG_PATHS = {
    "moons": "moons/moons.json",
    "stars": "stars/gaia_bright.json",
    "constellations": "constellations/constellation_guides.json",
    "boundaries": "constellations/iau_boundary_vertices_j2000.json",
    "named_stars": "stars/iau_named_stars.json",
}


class CatalogDataError(RuntimeError):
    def __init__(self, reason: str, kind: str):
        self.reason = reason
        self.kind = kind if kind in CATALOG_PATHS else "unknown"
        super().__init__("Scientific catalogue data unavailable")


def _object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def _invalid_constant(_):
    raise ValueError("non-finite constant")


def _finite_tree(value):
    # JSON 1e999 becomes float infinity without invoking parse_constant.
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("non-finite number")
    if isinstance(value, dict):
        for child in value.values():
            _finite_tree(child)
    elif isinstance(value, list):
        for child in value:
            _finite_tree(child)


def _json(raw: bytes) -> dict:
    value = json.loads(raw, object_pairs_hook=_object, parse_constant=_invalid_constant)
    if not isinstance(value, dict):
        raise ValueError("object required")
    _finite_tree(value)
    return value


def _text(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("nonempty text required")


def _list(value):
    if not isinstance(value, list):
        raise ValueError("list required")
    return value


def _point(value):
    for key, lower, upper in (("ra_deg", 0, 360), ("dec_deg", -90, 90)):
        number = value[key]
        if type(number) not in (int, float) or not lower <= number <= upper or (key == "ra_deg" and number == 360):
            raise ValueError("invalid sky coordinate")


def _schema(payload: dict, kind: str):
    source = payload["source"]
    for item in source if isinstance(source, list) else [source]:
        _text(item)
    if isinstance(source, list) and not source:
        raise ValueError("source required")
    if kind == "stars":
        rows = _list(payload["stars"])
        if type(payload["count"]) is not int or payload["count"] != len(rows) or not rows:
            raise ValueError("star count mismatch")
        identifiers = set()
        for row in rows:
            StarRecord.model_validate(row)
            if row["epoch"] != "J2016.0" or row["gaia_dr3_source_id"] in identifiers:
                raise ValueError("unexpected epoch or duplicate star")
            identifiers.add(row["gaia_dr3_source_id"])
    elif kind == "moons":
        rows = _list(payload["moons"])
        if not rows:
            raise ValueError("empty moon catalogue")
        for row in rows:
            MoonRecord.model_validate(row)
    elif kind in {"constellations", "boundaries"}:
        # Imported after initialization to avoid coupling catalogue loaders back
        # into this module while their package is being imported.
        from .catalogs.constellations import IAU_ABBREVIATIONS
        iau = set(IAU_ABBREVIATIONS)
        if type(payload.get("schema")) is not int or payload["schema"] != 1:
            raise ValueError("unsupported schema")
        if kind == "constellations":
            rows = _list(payload["items"])
            if len(rows) != 88 or {row["iau_abbreviation"] for row in rows} != iau:
                raise ValueError("incomplete constellation catalogue")
            if payload["catalogue_epoch"] != "J2016.0":
                raise ValueError("unexpected catalogue epoch")
            for row in rows:
                _text(row["name"])
                for alias in _list(row["aliases"]):
                    _text(alias)
                _point(row["representative_icrs_j2000"])
        else:
            rows = _list(payload["segments"])
            if type(payload["segment_count"]) is not int or payload["segment_count"] != len(rows) or not rows:
                raise ValueError("boundary count mismatch")
            if payload["coordinate_frame"] != "ICRS" or payload["coordinate_epoch"] != "J2000.0":
                raise ValueError("unexpected boundary frame or epoch")
            for row in rows:
                _point(row["start"])
                _point(row["end"])
                names = _list(row["constellations"])
                if not names or any(name not in iau for name in names):
                    raise ValueError("unknown boundary constellation")
    elif kind == "named_stars":
        if type(payload.get("schema")) is not int or payload["schema"] != 1:
            raise ValueError("unsupported named-star schema")
        rows = _list(payload["items"])
        if payload["status"] == "unavailable":
            if rows:
                raise ValueError("unavailable names cannot contain inferred entries")
        elif payload["status"] == "available":
            for row in rows:
                _text(row["name"])
        else:
            raise ValueError("invalid names availability")


@lru_cache(maxsize=16)
def _parsed(root: str, kind: str, digest: str, raw: bytes) -> dict:
    """The immutable content bytes and SHA, not only a Path, identify this cache."""
    payload = _json(raw)
    _schema(payload, kind)
    return payload


def _verified_snapshot(path: Path, kind: str, *, inventory_path: Path | None = None) -> tuple[dict, str]:
    if kind not in CATALOG_PATHS:
        raise CatalogDataError("unsupported-catalogue", kind)
    try:
        inventory = _json((inventory_path or APPROVED_INVENTORY_PATH).read_bytes())
        entry = inventory[f"data/{CATALOG_PATHS[kind]}"]
        size, digest = entry["bytes"], entry["sha256"]
        if type(size) is not int or size <= 0 or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("invalid approved inventory entry")
    except (OSError, ValueError, KeyError, TypeError, RecursionError):
        raise CatalogDataError("inventory-unavailable", kind) from None
    try:
        path = Path(path).absolute()
        relative = Path(CATALOG_PATHS[kind])
        root = path.parents[len(relative.parts) - 1].resolve()
        if path.name != relative.name or path.parent.name != relative.parent.name:
            raise ValueError("unexpected catalogue path")
        resolved = path.resolve()
        if not resolved.is_relative_to(root):
            raise ValueError("catalogue path outside data root")
    except (OSError, ValueError, IndexError, RuntimeError):
        raise CatalogDataError("outside-root", kind) from None
    try:
        with resolved.open("rb") as source:
            raw = source.read(size + 1)
    except OSError:
        raise CatalogDataError("missing-or-unreadable", kind) from None
    if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
        raise CatalogDataError("integrity-failed", kind)
    try:
        # Verify current bytes before cache lookup, even with identical stat
        # metadata. Validation and parsing consume these exact same bytes.
        payload = _parsed(str(root), kind, digest, raw)
    except (ValueError, KeyError, TypeError, AttributeError, RecursionError):
        raise CatalogDataError("invalid-schema", kind) from None
    return payload, digest


def load_catalog_snapshot(path: Path, kind: str, *, inventory_path: Path | None = None) -> tuple[dict, str]:
    payload, digest = _verified_snapshot(path, kind, inventory_path=inventory_path)
    return deepcopy(payload), digest


def load_catalog(path: Path, kind: str, *, inventory_path: Path | None = None) -> dict:
    return load_catalog_snapshot(path, kind, inventory_path=inventory_path)[0]


def verified_catalog_digest(path: Path, kind: str) -> str:
    """Verify current bytes without exposing or copying the cached payload."""
    return _verified_snapshot(path, kind)[1]


def _available(data_root: Path, kind: str) -> bool:
    try:
        # Status checks must verify the bytes, but need not copy a 10k-star
        # payload that they will never return or modify.
        _verified_snapshot(data_root / CATALOG_PATHS[kind], kind)
        return True
    except CatalogDataError:
        return False


def catalogue_availability(data_root: Path) -> dict[str, bool]:
    return {kind: _available(data_root, kind) for kind in ("moons", "stars", "constellations")}


def observatory_availability(data_root: Path) -> bool:
    return all(_available(data_root, kind) for kind in ("stars", "constellations", "boundaries", "named_stars"))
