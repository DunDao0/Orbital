"""Process-safe, reusable DE442s/SPICE provider implementation."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from threading import RLock

try:
    import spiceypy as spice
except ImportError:  # the verified read-only DE442s fallback remains available
    spice = None

from ..bodies import State
from ..constants import BODY_CONSTANTS
from .de_kernel import DEKernel
from .time_conversion import epoch_metadata


class KernelUnavailable(RuntimeError):
    pass


STATE_TARGETS: dict[str, int] = {
    "Sun": 10,
    "Mercury": 199,
    "Venus": 299,
    "Earth": 399,
    "Moon": 301,
    "Mars": 4,
    "Jupiter": 5,
    "Saturn": 6,
    "Uranus": 7,
    "Neptune": 8,
}
SYSTEM_BARYCENTERS = {"Mars", "Jupiter", "Saturn", "Uranus", "Neptune"}
_SPICE_LOCK = RLock()


@dataclass
class SpiceEphemeris:
    kernel_dir: Path
    _loaded: bool = field(default=False, init=False)
    _reader: DEKernel | None = field(default=None, init=False)
    load_count: int = field(default=0, init=False)

    @property
    def provider_id(self) -> str:
        return "spiceypy-de442s" if spice is not None else "de442s-readonly-fallback"

    def _paths(self) -> list[Path]:
        return [self.kernel_dir / name for name in ("naif0012.tls", "pck00011.tpc", "de442s.bsp")]

    def load(self) -> None:
        if self._loaded:
            return
        paths = self._paths()
        missing = [path.name for path in paths if not path.exists()]
        if missing:
            raise KernelUnavailable("missing SPICE kernels: " + ", ".join(missing))
        with _SPICE_LOCK:
            if self._loaded:
                return
            if spice is not None:
                spice.kclear()
                for path in paths:
                    spice.furnsh(str(path))
            self._reader = DEKernel(self.kernel_dir / "de442s.bsp")
            self._loaded = True
            self.load_count += 1

    def _validate_names(self, names: tuple[str, ...]) -> None:
        unknown = [name for name in names if name not in STATE_TARGETS]
        if unknown:
            raise KeyError(unknown[0])

    def coverage(self, names: tuple[str, ...]) -> dict[str, str | float]:
        self._validate_names(names)
        self.load()
        assert self._reader is not None
        return self._reader.coverage(tuple(STATE_TARGETS[name] for name in names))

    def state(self, names: tuple[str, ...], utc: str) -> State:
        self._validate_names(names)
        self.load()
        epoch = epoch_metadata(utc)
        coverage = self.coverage(names)
        if not float(coverage["start_et_s"]) <= epoch.ephemeris_time_et_s <= float(coverage["end_et_s"]):
            from ..api.errors import EphemerisCoverageError

            raise EphemerisCoverageError(str(coverage["valid_utc_from"]), str(coverage["valid_utc_until"]))

        vectors: list[list[float]] = []
        if spice is not None:
            with _SPICE_LOCK:
                # UTC is interpreted once by Astropy/ERFA for both providers.
                # SPICE's pre-1972 UTC convention differs; reparsing the string
                # here would change the physical instant after coverage checks.
                et_s = epoch.ephemeris_time_et_s
                for name in names:
                    target = STATE_TARGETS[name]
                    state_km, _ = spice.spkezr(str(target), et_s, "J2000", "NONE", "0")
                    vectors.append([float(value) * 1000.0 for value in state_km])
        else:
            assert self._reader is not None
            for name in names:
                position_km, velocity_km_s = self._reader.state(STATE_TARGETS[name], epoch.ephemeris_time_et_s)
                vectors.append([value * 1000.0 for value in position_km + velocity_km_s])
        return State(
            epoch.input_utc,
            epoch.canonical_utc,
            epoch.ephemeris_time_et_s,
            epoch.state_time_scale,
            names,
            [item[:3] for item in vectors],
            [item[3:] for item in vectors],
        )

    def snapshot_payload(self, utc: str, names: tuple[str, ...]) -> dict[str, object]:
        state = self.state(names, utc)
        coverage = self.coverage(names)
        return {
            "epoch": state.canonical_utc,
            "epoch_metadata": {
                "input_utc": state.input_utc,
                "canonical_utc": state.canonical_utc,
                "ephemeris_time_et_s": state.ephemeris_time_et_s,
                "state_time_scale": state.state_time_scale,
                "utc_to_tdb_provider": "Astropy/ERFA",
                "utc_policy": "Astropy UTC history; numeric TDB passed unchanged to ephemeris provider",
            },
            "frame": "J2000",
            "center": "Solar System Barycenter",
            "time_scale": "TDB/ET",
            "source": "NAIF SPICE DE442s",
            "origin": "SPICE" if spice is not None else "verified DE442s read-only fallback",
            "provider": self.provider_id,
            "coverage": {
                "valid_utc_from": coverage["valid_utc_from"],
                "valid_utc_until": coverage["valid_utc_until"],
            },
            "bodies": [
                {
                    "name": name,
                    "naif_id": BODY_CONSTANTS[name]["naif_id"],
                    "body_naif_id": BODY_CONSTANTS[name]["naif_id"],
                    "state_target_naif_id": STATE_TARGETS[name],
                    "state_center_naif_id": 0,
                    "state_kind": "system-barycenter" if name in SYSTEM_BARYCENTERS else "physical-center",
                    "state_target_name": f"{name} system barycenter" if name in SYSTEM_BARYCENTERS else name,
                    "mu_m3_s2": BODY_CONSTANTS[name]["mu"],
                    "radius_m": BODY_CONSTANTS[name]["radius_m"],
                    "color": BODY_CONSTANTS[name]["color"],
                    "position_m": list(state.position_m[index]),
                    "velocity_m_s": list(state.velocity_m_s[index]),
                    "center_note": "planetary system barycenter state" if name in SYSTEM_BARYCENTERS else "physical-body state",
                }
                for index, name in enumerate(names)
            ],
        }

    def close(self) -> None:
        if not self._loaded:
            return
        with _SPICE_LOCK:
            if spice is not None:
                spice.kclear()
            if self._reader is not None:
                self._reader.close()
            self._reader = None
            self._loaded = False
