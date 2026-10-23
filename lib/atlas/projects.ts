import type { OrbitalSceneStateV1 } from "./scene/contracts";
import { validateSceneState } from "./scene/state.ts";

export type OrbitalAnnotation = { id: string; kind: "marker" | "path" | "area" | "note"; text: string; targetId?: string };
export type OrbitalProject = { schemaVersion: 1; title: string; description?: string; scenes: OrbitalSceneStateV1[]; annotations: OrbitalAnnotation[]; createdAtUtc: string };
export const MAX_PROJECT_BYTES = 500_000;
export const PROJECT_STORAGE_KEY = "orbis.project.v1";

export function sanitizeProjectText(value: string, maxLength = 600): string { return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength); }

export function validateProject(value: unknown): OrbitalProject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1 || typeof raw.title !== "string" || !Array.isArray(raw.scenes) || !Array.isArray(raw.annotations)) return null;
  const scenes = raw.scenes.map(validateSceneState).filter((scene): scene is OrbitalSceneStateV1 => Boolean(scene));
  if (!scenes.length || scenes.length !== raw.scenes.length) return null;
  const annotations = raw.annotations.flatMap((item): OrbitalAnnotation[] => {
    if (!item || typeof item !== "object") return [];
    const annotation = item as Record<string, unknown>;
    if (!["marker", "path", "area", "note"].includes(annotation.kind as string) || typeof annotation.text !== "string") return [];
    return [{ id: typeof annotation.id === "string" ? annotation.id : crypto.randomUUID(), kind: annotation.kind as OrbitalAnnotation["kind"], text: sanitizeProjectText(annotation.text), targetId: typeof annotation.targetId === "string" ? annotation.targetId : undefined }];
  });
  if (annotations.length !== raw.annotations.length) return null;
  return { schemaVersion: 1, title: sanitizeProjectText(raw.title, 120) || "Projeto sem título", description: typeof raw.description === "string" ? sanitizeProjectText(raw.description) : undefined, scenes, annotations, createdAtUtc: typeof raw.createdAtUtc === "string" && !Number.isNaN(new Date(raw.createdAtUtc).valueOf()) ? new Date(raw.createdAtUtc).toISOString() : new Date().toISOString() };
}

export function parseProjectText(text: string): OrbitalProject | null {
  if (new TextEncoder().encode(text).length > MAX_PROJECT_BYTES) return null;
  try { return validateProject(JSON.parse(text)); } catch { return null; }
}

export function newProject(scene: OrbitalSceneStateV1): OrbitalProject { return { schemaVersion: 1, title: "Cena Orbital", scenes: [scene], annotations: [], createdAtUtc: new Date().toISOString() }; }

type ProjectReadResult = { status: "ready"; project: OrbitalProject } | { status: "missing" | "invalid" | "unavailable" };
type ProjectWriteResult = { status: "saved"; project: OrbitalProject } | { status: "invalid" | "unavailable" };

/** Reads never repair, replace or remove saved user data. Recovery is explicit. */
export function readStoredProject(storage: Pick<Storage, "getItem">): ProjectReadResult {
  try {
    const text = storage.getItem(PROJECT_STORAGE_KEY);
    if (text === null) return { status: "missing" };
    const project = parseProjectText(text);
    return project ? { status: "ready", project } : { status: "invalid" };
  } catch { return { status: "unavailable" }; }
}

export function writeStoredProject(storage: Pick<Storage, "setItem">, project: OrbitalProject): ProjectWriteResult {
  try {
    const validated = parseProjectText(JSON.stringify(project));
    if (!validated) return { status: "invalid" };
    storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(validated));
    return { status: "saved", project: validated };
  } catch { return { status: "unavailable" }; }
}
