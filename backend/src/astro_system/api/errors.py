"""Stable, sanitized error vocabulary shared by all native routes."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ScienceApiError(Exception):
    status_code: int
    code: str
    message: str
    capability: str | None = None
    details: dict[str, object] = field(default_factory=dict)
    valid_utc_from: str | None = None
    valid_utc_until: str | None = None
    headers: dict[str, str] = field(default_factory=dict)

    def __str__(self) -> str:
        return self.code


class EphemerisCoverageError(RuntimeError):
    def __init__(self, valid_from_utc: str, valid_until_utc: str):
        super().__init__("requested epoch is outside provider coverage")
        self.valid_from_utc = valid_from_utc
        self.valid_until_utc = valid_until_utc


class KernelIntegrityError(RuntimeError):
    pass
