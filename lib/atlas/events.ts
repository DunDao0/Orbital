export type OrbitalEvent = { id: string; category: "astronomy" | "mission" | "earth"; title: string; startUtc: string; endUtc?: string; status?: string; targetIds?: string[]; source: { name: string; href: string }; limitations?: string[] };

export type OrbitalEventFilter = { category?: OrbitalEvent["category"] | "all"; dateFromUtc?: string; dateUntilUtc?: string; targetId?: string };

export function normalizeOrbitalEvent(value: unknown): OrbitalEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Partial<OrbitalEvent>;
  if (!event.id || !event.title || !["astronomy", "mission", "earth"].includes(event.category ?? "") || !event.startUtc || !event.source?.name || !event.source.href || Number.isNaN(new Date(event.startUtc).valueOf())) return null;
  if (event.endUtc && Number.isNaN(new Date(event.endUtc).valueOf())) return null;
  return { id: event.id, title: event.title, category: event.category as OrbitalEvent["category"], startUtc: new Date(event.startUtc).toISOString(), endUtc: event.endUtc ? new Date(event.endUtc).toISOString() : undefined, status: event.status, targetIds: event.targetIds?.filter((id): id is string => typeof id === "string"), source: { name: event.source.name, href: event.source.href }, limitations: event.limitations?.filter((item): item is string => typeof item === "string") };
}

export function filterOrbitalEvents(events: OrbitalEvent[], filter: OrbitalEventFilter): OrbitalEvent[] {
  const after = filter.dateFromUtc ? new Date(filter.dateFromUtc).valueOf() : -Infinity;
  const before = filter.dateUntilUtc ? new Date(filter.dateUntilUtc).valueOf() : Infinity;
  return events.filter((event) => (filter.category === undefined || filter.category === "all" || event.category === filter.category) && (!filter.targetId || event.targetIds?.some((id) => id.toLowerCase() === filter.targetId?.toLowerCase())) && new Date(event.startUtc).valueOf() >= after && new Date(event.startUtc).valueOf() <= before);
}

export const ORBITAL_EVENTS: OrbitalEvent[] = [
  { id: "apollo-11-launch", category: "mission", title: "Lançamento da Apollo 11", startUtc: "1969-07-16T13:32:00Z", targetIds: ["Earth", "Moon"], source: { name: "NASA Apollo 11", href: "https://www.nasa.gov/mission/apollo-11/" }, limitations: ["Evento histórico; não contém trajetória 3D neste MVP."] },
  { id: "earth-local-eclipse", category: "astronomy", title: "Consulta de eclipse local", startUtc: "2024-04-08T00:00:00Z", targetIds: ["Earth", "Moon", "Sun"], source: { name: "Serviço científico local", href: "/docs/validation.md" }, limitations: ["Resultados dependem de localização e UTC fornecidos explicitamente; não há geometria inferida no cliente."] },
];
