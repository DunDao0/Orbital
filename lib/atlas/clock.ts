export type ClockStep = "second" | "minute" | "hour" | "day";
export type SimulationClockState = {
  utc: string;
  mode: "paused" | "playing";
  rate: number;
  step: ClockStep;
  validFromUtc?: string;
  validUntilUtc?: string;
};

const STEP_MS: Record<ClockStep, number> = { second: 1_000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };

export function intersectCoverage(coverages: Array<{ validFromUtc?: string; validUntilUtc?: string }>): { validFromUtc?: string; validUntilUtc?: string } {
  const starts = coverages.map((coverage) => coverage.validFromUtc).filter((value): value is string => Boolean(value));
  const ends = coverages.map((coverage) => coverage.validUntilUtc).filter((value): value is string => Boolean(value));
  return { validFromUtc: starts.sort().at(-1), validUntilUtc: ends.sort().at(0) };
}

export function clampClockUtc(utc: string, coverage: Pick<SimulationClockState, "validFromUtc" | "validUntilUtc">): string {
  const date = new Date(utc);
  const fallback = new Date("2026-08-05T00:00:00.000Z");
  const time = Number.isNaN(date.valueOf()) ? fallback.valueOf() : date.valueOf();
  const lower = coverage.validFromUtc ? new Date(coverage.validFromUtc).valueOf() : -Infinity;
  const upper = coverage.validUntilUtc ? new Date(coverage.validUntilUtc).valueOf() : Infinity;
  return new Date(Math.min(Math.max(time, lower), upper)).toISOString();
}

export function advanceClock(clock: SimulationClockState, direction = 1): SimulationClockState {
  return { ...clock, utc: clampClockUtc(new Date(new Date(clock.utc).valueOf() + STEP_MS[clock.step] * clock.rate * direction).toISOString(), clock) };
}
