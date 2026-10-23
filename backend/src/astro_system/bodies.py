from __future__ import annotations

from dataclasses import dataclass

from .constants import BODY_CONSTANTS


@dataclass(frozen=True)
class Body:
    name: str
    naif_id: int
    mu_m3_s2: float
    radius_m: float
    color: str

    @classmethod
    def from_name(cls, name: str) -> "Body":
        item = BODY_CONSTANTS[name]
        return cls(name, int(item["naif_id"]), float(item["mu"]), float(item["radius_m"]), str(item["color"]))


@dataclass
class State:
    input_utc: str
    canonical_utc: str
    ephemeris_time_et_s: float
    state_time_scale: str
    names: tuple[str, ...]
    position_m: object
    velocity_m_s: object

    def copy(self) -> "State":
        return State(
            self.input_utc,
            self.canonical_utc,
            self.ephemeris_time_et_s,
            self.state_time_scale,
            self.names,
            [list(row) for row in self.position_m],
            [list(row) for row in self.velocity_m_s],
        )
