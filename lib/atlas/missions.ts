export type MissionMilestone = { utc: string; title: string; description: string };
/** A mission without a trajectory bundle has no spatial frame to render. */
export type MissionManifest = { id: string; name: string; agency: string; frame: "not-applicable/no-trajectory"; timeScale: "UTC"; launchUtc?: string; endUtc?: string; targetBodies: string[]; milestones: MissionMilestone[]; coverage: { validFromUtc: string; validUntilUtc: string }; sources: Array<{ name: string; href: string }> };

export type MissionTemporalState = "upcoming" | "active" | "completed" | "out-of-coverage";

export function validateMissionManifest(value: unknown): MissionManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const mission = value as Partial<MissionManifest>;
  if (!mission.id || !mission.name || !mission.agency || mission.frame !== "not-applicable/no-trajectory" || mission.timeScale !== "UTC" || !Array.isArray(mission.targetBodies) || !Array.isArray(mission.milestones) || !mission.coverage || !Array.isArray(mission.sources)) return null;
  if (!mission.targetBodies.every((body) => typeof body === "string") || !mission.milestones.every((milestone) => typeof milestone?.utc === "string" && !Number.isNaN(new Date(milestone.utc).valueOf()) && typeof milestone.title === "string" && typeof milestone.description === "string") || !mission.sources.every((source) => typeof source?.name === "string" && typeof source.href === "string")) return null;
  const start = new Date(mission.coverage.validFromUtc).valueOf(); const end = new Date(mission.coverage.validUntilUtc).valueOf();
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return null;
  return mission as MissionManifest;
}

export function missionTemporalState(mission: MissionManifest, utc: string): MissionTemporalState {
  const time = new Date(utc).valueOf(); const start = new Date(mission.coverage.validFromUtc).valueOf(); const end = new Date(mission.coverage.validUntilUtc).valueOf();
  if (Number.isNaN(time) || time < start || time > end) return "out-of-coverage";
  if (mission.launchUtc && time < new Date(mission.launchUtc).valueOf()) return "upcoming";
  if (mission.endUtc && time > new Date(mission.endUtc).valueOf()) return "completed";
  return "active";
}

export const ORBITAL_MISSIONS: MissionManifest[] = [{
  id: "apollo-11", name: "Apollo 11", agency: "NASA", frame: "not-applicable/no-trajectory", timeScale: "UTC", launchUtc: "1969-07-16T13:32:00Z", endUtc: "1969-07-24T16:50:35Z", targetBodies: ["Earth", "Moon"],
  milestones: [
    { utc: "1969-07-16T13:32:00Z", title: "Lançamento", description: "Início da missão Apollo 11." },
    { utc: "1969-07-20T20:17:40Z", title: "Pouso lunar", description: "Eagle pousa no Mar da Tranquilidade." },
    { utc: "1969-07-24T16:50:35Z", title: "Retorno", description: "Amerissagem e encerramento da missão." },
  ],
  coverage: { validFromUtc: "1969-07-16T13:32:00Z", validUntilUtc: "1969-07-24T16:50:35Z" },
  sources: [{ name: "NASA Apollo 11 Mission Overview", href: "https://www.nasa.gov/mission/apollo-11/" }],
}];
