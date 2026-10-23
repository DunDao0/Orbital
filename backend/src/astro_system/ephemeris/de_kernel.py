"""Small read-only evaluator for SPK type-2 DE planetary segments.

This is intentionally narrow: it evaluates the DE442s type-2 Chebyshev
segments bundled by this project, follows center chains to the Solar-System
barycenter, and rejects any time outside a segment.  SpiceyPy remains the
preferred general SPICE path; this parser makes the offline minimal bundle
usable when the optional native binding cannot be installed.
"""
from __future__ import annotations

from dataclasses import dataclass
from math import floor
from pathlib import Path
import struct

from .time_conversion import epoch_metadata, et_to_utc


@dataclass(frozen=True)
class Segment:
    target: int
    center: int
    start_et: float
    end_et: float
    kind: int
    initial_address: int
    final_address: int


class DEKernel:
    def __init__(self, path: Path):
        self.path = path
        self.data = path.read_bytes()
        if self.data[:8] != b"DAF/SPK ":
            raise ValueError(f"not a DAF/SPK kernel: {path}")
        self.nd, self.ni = struct.unpack_from("<ii", self.data, 8)
        self.forward_record = struct.unpack_from("<i", self.data, 76)[0]
        if (self.nd, self.ni) != (2, 6):
            raise ValueError("this minimal reader expects DAF ND=2, NI=6")
        self.segments = self._segments()

    def _segments(self) -> list[Segment]:
        record = self.forward_record
        output: list[Segment] = []
        summary_size = self.nd + (self.ni + 1) // 2
        while record:
            offset = (record - 1) * 1024
            next_record, _, count = struct.unpack_from("<ddd", self.data, offset)
            for index in range(int(count)):
                start, end = struct.unpack_from("<dd", self.data, offset + 24 + index * summary_size * 8)
                target, center, _, kind, initial, final = struct.unpack_from("<6i", self.data, offset + 24 + index * summary_size * 8 + 16)
                output.append(Segment(target, center, start, end, kind, initial, final))
            record = int(next_record)
        return output

    @staticmethod
    def et_from_utc(utc: str) -> float:
        return epoch_metadata(utc).ephemeris_time_et_s

    def _coverage_et(self, target: int, seen: set[int] | None = None) -> tuple[float, float]:
        if target == 0:
            return float("-inf"), float("inf")
        visited = set() if seen is None else seen
        if target in visited:
            raise ValueError("cyclic SPK center chain")
        visited.add(target)
        segments = [segment for segment in self.segments if segment.target == target]
        if not segments:
            raise ValueError(f"no DE442s segment for target {target}")
        start = min(segment.start_et for segment in segments)
        end = max(segment.end_et for segment in segments)
        centers = {segment.center for segment in segments}
        for center in centers:
            center_start, center_end = self._coverage_et(center, set(visited))
            start, end = max(start, center_start), min(end, center_end)
        if start > end:
            raise ValueError(f"no shared DE442s coverage for target {target}")
        return start, end

    def coverage(self, targets: tuple[int, ...]) -> dict[str, str | float]:
        ranges = [self._coverage_et(target) for target in targets]
        start = max(item[0] for item in ranges)
        end = min(item[1] for item in ranges)
        if start > end:
            raise ValueError("requested DE442s targets do not share coverage")
        return {
            "start_et_s": start,
            "end_et_s": end,
            "valid_utc_from": et_to_utc(start),
            "valid_utc_until": et_to_utc(end),
        }

    def close(self) -> None:
        self.data = b""

    def _segment(self, target: int, et: float) -> Segment:
        candidates = [item for item in self.segments if item.target == target and item.start_et <= et <= item.end_et]
        if not candidates:
            raise ValueError(f"no DE442s segment for target {target} at ET {et}; extrapolation refused")
        return candidates[-1]

    def _state_relative(self, segment: Segment, et: float) -> tuple[list[float], list[float]]:
        if segment.kind != 2:
            raise ValueError(f"unsupported SPK type {segment.kind}; use SpiceyPy")
        initial, interval, record_size, record_count = struct.unpack_from("<4d", self.data, (segment.final_address - 4) * 8)
        index = min(int(record_count) - 1, max(0, int(floor((et - initial) / interval))))
        address = segment.initial_address + index * int(record_size)
        record = struct.unpack_from(f"<{int(record_size)}d", self.data, (address - 1) * 8)
        midpoint, radius = record[:2]
        coefficient_count = (int(record_size) - 2) // 3
        x = (et - midpoint) / radius
        chebyshev = [1.0, x]
        derivative = [0.0, 1.0]
        for _ in range(2, coefficient_count):
            chebyshev.append(2 * x * chebyshev[-1] - chebyshev[-2])
            derivative.append(2 * chebyshev[-2] + 2 * x * derivative[-1] - derivative[-2])
        position, velocity = [], []
        for axis in range(3):
            coefficients = record[2 + axis * coefficient_count : 2 + (axis + 1) * coefficient_count]
            position.append(sum(c * t for c, t in zip(coefficients, chebyshev)))
            velocity.append(sum(c * t for c, t in zip(coefficients, derivative)) / radius)
        return position, velocity

    def state(self, target: int, et: float, _seen: set[int] | None = None) -> tuple[list[float], list[float]]:
        if target == 0:
            return [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]
        seen = set() if _seen is None else _seen
        if target in seen:
            raise ValueError("cyclic SPK center chain")
        seen.add(target)
        segment = self._segment(target, et)
        position, velocity = self._state_relative(segment, et)
        center_position, center_velocity = self.state(segment.center, et, seen)
        return ([position[i] + center_position[i] for i in range(3)], [velocity[i] + center_velocity[i] for i in range(3)])
