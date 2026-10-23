"""Inspectable, offline-only IERS configuration and status reporting."""
from __future__ import annotations

from astropy.time import Time
from astropy.utils import iers
import numpy as np
from ..data_integrity import iers_bundle_status


class IersDataError(RuntimeError):
    def __init__(self, reason: str, provenance: dict[str, object]):
        super().__init__("IERS data unavailable")
        self.reason = reason
        self.provenance = provenance


def _table_metadata(table) -> dict[str, object]:
    mjd = np.asarray(table["MJD"], dtype=float)
    prediction = table.meta.get("predictive_mjd")
    payload: dict[str, object] = {
        "mode": "offline", "source": table.__class__.__name__,
        "valid_from_utc": Time(mjd[0], format="mjd").isot + "Z",
        "valid_until_utc": Time(mjd[-1], format="mjd").isot + "Z",
    }
    if prediction is not None:
        now = table.time_now if hasattr(table, "time_now") else Time.now()
        age = float(now.mjd - prediction)
        max_age = iers.conf.auto_max_age
        payload.update(prediction_from_utc=Time(prediction, format="mjd").isot + "Z",
                       prediction_age_days=age,
                       max_prediction_age_days=max_age,
                       prediction_usable_now=max_age is not None and age <= max_age,
                       refresh_recommended=max_age is None or age >= max_age - 5,
                       prediction_expires_utc=(Time(prediction + max_age, format="mjd").isot + "Z")
                       if max_age is not None else None)
    return payload


def require_iers_coverage(moment: Time) -> dict[str, object]:
    """Reject missing/outside/stale data before Astropy can clamp or extrapolate.

    Observed historical data remain usable when predictions age. Neither this
    function nor its callers disable Astropy's prediction-age protection.
    """
    configure_iers_offline()
    bundle = iers_bundle_status()
    if bundle["integrity"] != "verified":
        raise IersDataError("integrity-failed", {"mode": "offline", "bundle": bundle})
    try:
        table = iers.earth_orientation_table.get()
        metadata = _table_metadata(table)
    except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError) as error:
        raise IersDataError("missing", {"mode": "offline", "source": "unavailable"}) from error
    mjd = np.asarray(table["MJD"], dtype=float)
    requested = np.asarray(moment.utc.mjd)
    if np.any(requested < mjd[0]) or np.any(requested >= mjd[-1]):
        raise IersDataError("out-of-coverage", metadata)
    prediction = table.meta.get("predictive_mjd")
    if prediction is not None and np.any(requested >= prediction):
        max_age = iers.conf.auto_max_age
        if max_age is None or metadata["prediction_age_days"] > max_age:
            raise IersDataError("expired-prediction", metadata)
    try:
        ut1, ut1_status = table.ut1_utc(moment, return_status=True)
        x, y, polar_status = table.pm_xy(moment, return_status=True)
        if any(np.any(np.asarray(status) < 0) for status in (ut1_status, polar_status)):
            raise IersDataError("out-of-coverage", metadata)
        if any(not np.all(np.isfinite(value)) for value in (ut1, x, y)):
            raise IersDataError("incomplete", metadata)
    except (ValueError, iers.IERSRangeError) as error:
        raise IersDataError("interpolation-unavailable", metadata) from error
    return {**metadata, "bundle": bundle}


def configure_iers_offline() -> None:
    iers.conf.auto_download = False


def current_iers_status(warning_messages: list[str] | None = None) -> dict[str, object]:
    configure_iers_offline()
    warnings = [item for item in (warning_messages or []) if item]
    bundle = iers_bundle_status()
    try:
        table = iers.earth_orientation_table.get()
        metadata = _table_metadata(table)
        if metadata.get("prediction_age_days", 0) > (iers.conf.auto_max_age or 0):
            warnings.append("Previsões IERS locais envelhecidas; datas observadas continuam disponíveis.")
        if bundle["integrity"] != "verified":
            warnings.append("Integridade do pacote IERS não verificada.")
        status = "degraded" if warnings else "ok"
        payload = {
            **metadata,
            "status": status,
            "bundle": bundle,
        }
        if warnings:
            payload["warning"] = " | ".join(warnings)[:500]
        return payload
    except Exception:
        return {
            "mode": "offline",
            "source": "Astropy earth_orientation_table unavailable",
            "status": "degraded",
            "warning": "A tabela IERS local não pôde ser identificada; nenhuma tentativa de rede foi feita.",
        }
