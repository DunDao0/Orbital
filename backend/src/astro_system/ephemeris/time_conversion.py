"""UTC parsing and UTC -> ET/TDB conversion without a fixed modern offset."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import re

from astropy.time import Time, TimeDelta

J2000_TDB_JD = 2_451_545.0


class InvalidUtcError(ValueError):
    """Syntactic UTC input failure, distinct from scientific calculation errors."""


@dataclass(frozen=True)
class EpochMetadata:
    input_utc: str
    canonical_utc: str
    ephemeris_time_et_s: float
    state_time_scale: str = "TDB/ET"

    def as_dict(self) -> dict[str, str | float]:
        return {
            "input_utc": self.input_utc,
            "canonical_utc": self.canonical_utc,
            "ephemeris_time_et_s": self.ephemeris_time_et_s,
            "state_time_scale": self.state_time_scale,
        }


def _parse_utc(utc: str) -> Time:
    if not isinstance(utc, str) or not utc.strip() or len(utc) > 64:
        raise InvalidUtcError("UTC inválido.")
    value = utc.strip()
    # Match the public edge contract; native Astropy additionally handles real
    # leap seconds, which cannot match the edge's fixed reference epoch.
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:[Zz]|[+-]\d{2}:\d{2})?", value):
        raise InvalidUtcError("UTC inválido.")
    try:
        if value.endswith(("Z", "z")):
            moment = Time(value[:-1], format="isot", scale="utc")
        else:
            suffix = value[10:] if len(value) > 10 else ""
            if "+" in suffix or "-" in suffix:
                # datetime normalizes oversized offset minutes; the public
                # contract requires an actual HH:MM offset instead.
                if int(value[-5:-3]) > 23 or int(value[-2:]) > 59:
                    raise InvalidUtcError("UTC inválido.")
                parsed = datetime.fromisoformat(value).astimezone(timezone.utc)
                moment = Time(parsed, scale="utc")
            else:
                moment = Time(value, format="isot", scale="utc")
    except Exception as error:
        raise InvalidUtcError("UTC inválido.") from error
    return moment


def _canonical_utc(moment: Time) -> str:
    # Public inputs support microseconds. Preserve them without changing legacy
    # millisecond strings or mutating the caller's Time formatting preferences.
    value = moment.utc.replicate()
    value.precision = 6
    seconds, fraction = value.isot.split(".")
    return seconds + "." + fraction.rstrip("0").ljust(3, "0") + "Z"


def epoch_metadata(utc: str) -> EpochMetadata:
    moment = _parse_utc(utc)
    tdb = moment.tdb
    # Never collapse the two-part JD before subtracting J2000: at modern dates
    # a single JD float discards tens of microseconds by cancellation.
    et_s = float(((tdb.jd1 - J2000_TDB_JD) + tdb.jd2) * 86_400.0)
    return EpochMetadata(utc, _canonical_utc(moment), et_s)


def et_to_utc(et_s: float) -> str:
    moment = Time(J2000_TDB_JD, float(et_s) / 86_400.0, format="jd", scale="tdb")
    return _canonical_utc(moment)


def advance_utc(utc: str, elapsed_s: float) -> str:
    """Add SI elapsed seconds, retaining leap seconds and public UTC precision."""
    return _canonical_utc(_parse_utc(utc) + TimeDelta(elapsed_s, format="sec"))
