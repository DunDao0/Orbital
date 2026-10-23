"""Application-scoped ephemeris provider and kernel-integrity gate."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re
from typing import Protocol

from ..bodies import State
from .spice_loader import KernelUnavailable, SpiceEphemeris

APPROVED_INVENTORY_PATH = Path(__file__).resolve().parents[3] / "data-inventory.json"
REQUIRED_KERNELS = ("naif0012.tls", "pck00011.tpc", "de442s.bsp")


class EphemerisProvider(Protocol):
    provider_id: str

    def state(self, names: tuple[str, ...], utc: str) -> State: ...
    def snapshot_payload(self, utc: str, names: tuple[str, ...]) -> dict[str, object]: ...
    def coverage(self, names: tuple[str, ...]) -> dict[str, str | float]: ...
    def close(self) -> None: ...


@dataclass(frozen=True)
class KernelVerification:
    status: str
    checked_files: int
    failed_names: tuple[str, ...] = ()


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1 << 20):
            digest.update(block)
    return digest.hexdigest()


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def _invalid_json_constant(_: str) -> None:
    raise ValueError("non-finite JSON constant")


def _strict_json(raw: bytes) -> dict[str, object]:
    value = json.loads(raw, object_pairs_hook=_unique_json_object, parse_constant=_invalid_json_constant)
    if not isinstance(value, dict):
        raise ValueError("JSON object required")
    return value


def _inventory_entry(inventory: dict[str, object], name: str) -> tuple[int, str]:
    entry = inventory[name]
    if not isinstance(entry, dict):
        raise ValueError("invalid inventory entry")
    size, digest = entry["bytes"], entry["sha256"]
    if type(size) is not int or size <= 0 or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ValueError("invalid inventory size or digest")
    return size, digest


def _within_data_root(path: Path, data_root: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_relative_to(data_root):
        raise ValueError("data path outside approved root")
    return resolved


def verify_kernel_manifest(data_root: Path, *, inventory_path: Path | None = None) -> KernelVerification:
    """Verify the manifest against the packaged inventory, never against itself."""
    try:
        inventory = _strict_json((inventory_path or APPROVED_INVENTORY_PATH).read_bytes())
        manifest_size, manifest_digest = _inventory_entry(inventory, "data/manifests/kernels.json")
        expected_kernels = {name: _inventory_entry(inventory, f"data/kernels/{name}") for name in REQUIRED_KERNELS}
    except (OSError, ValueError, TypeError, KeyError, RuntimeError):
        return KernelVerification("failed", 0, ("data-inventory.json",))
    try:
        root = data_root.resolve()
        manifest_path = _within_data_root(root / "manifests" / "kernels.json", root)
        with manifest_path.open("rb") as source:
            raw = source.read(manifest_size + 1)
        if len(raw) != manifest_size or hashlib.sha256(raw).hexdigest() != manifest_digest:
            return KernelVerification("failed", 0, ("kernels.json",))
        manifest = _strict_json(raw)
        if type(manifest.get("schema")) is not int or manifest["schema"] != 1:
            raise ValueError("unsupported kernel manifest schema")
        entries = manifest["files"]
        if not isinstance(entries, list) or len(entries) != len(REQUIRED_KERNELS):
            raise ValueError("incomplete kernel manifest")
        if any(not isinstance(entry, dict) or not isinstance(entry.get("name"), str) for entry in entries):
            raise ValueError("invalid kernel manifest entry")
        names = [entry["name"] for entry in entries]
        if len(set(names)) != len(names) or set(names) != set(REQUIRED_KERNELS):
            raise ValueError("unexpected, duplicate or unsafe kernel name")
        for entry in entries:
            expected_size, expected_digest = expected_kernels[entry["name"]]
            if (type(entry.get("size_bytes")) is not int or entry["size_bytes"] != expected_size
                    or entry.get("sha256") != expected_digest):
                raise ValueError("kernel manifest disagrees with approved inventory")
    except (OSError, ValueError, KeyError, TypeError, RuntimeError):
        return KernelVerification("failed", 0, ("kernels.json",))

    failures: list[str] = []
    for name in REQUIRED_KERNELS:
        try:
            path = _within_data_root(root / "kernels" / name, root)
            expected_size, expected_digest = expected_kernels[name]
            if not path.is_file() or path.stat().st_size != expected_size or _sha256(path) != expected_digest:
                failures.append(name)
        except (OSError, ValueError, RuntimeError):
            failures.append(name)
    return KernelVerification("ok" if not failures else "failed", len(REQUIRED_KERNELS), tuple(failures))


class ApplicationEphemerisProvider:
    def __init__(self, data_root: Path, *, inventory_path: Path | None = None):
        self.data_root = data_root
        self.verification = verify_kernel_manifest(data_root, inventory_path=inventory_path)
        self.provider: SpiceEphemeris | None = None
        self.initialization_error: str | None = None
        if self.verification.status != "ok":
            self.initialization_error = "kernel_integrity_failed" if self.verification.status == "failed" else "kernel_unavailable"
            return
        candidate = SpiceEphemeris(data_root / "kernels")
        try:
            candidate.load()
            self.provider = candidate
        except KernelUnavailable:
            self.initialization_error = "kernel_unavailable"
        except Exception:
            self.initialization_error = "kernel_initialization_failed"

    @property
    def provider_id(self) -> str:
        return self.provider.provider_id if self.provider else "unavailable"

    @property
    def available(self) -> bool:
        return self.provider is not None

    def _required(self) -> SpiceEphemeris:
        if self.provider is None:
            raise KernelUnavailable(self.initialization_error or "kernel unavailable")
        return self.provider

    def state(self, names: tuple[str, ...], utc: str) -> State:
        return self._required().state(names, utc)

    def snapshot_payload(self, utc: str, names: tuple[str, ...]) -> dict[str, object]:
        return self._required().snapshot_payload(utc, names)

    def coverage(self, names: tuple[str, ...]) -> dict[str, str | float]:
        return self._required().coverage(names)

    def close(self) -> None:
        if self.provider is not None:
            self.provider.close()
