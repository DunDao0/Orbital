import type { ScienceCapability, ScienceResource } from "./contracts.ts";
import { ScienceRequestError } from "./errors.ts";

export function currentScienceData<T>(resource: ScienceResource<T>): T | undefined {
  return resource.status === "ready" ? resource.data : "previous" in resource ? resource.previous : undefined;
}

export function loadingScienceResource<T>(resource: ScienceResource<T>): ScienceResource<T> {
  return { status: "loading", previous: currentScienceData(resource) };
}

export function resourceError<T>(error: unknown, fallbackCapability: ScienceCapability, previous?: T): ScienceResource<T> {
  if (error instanceof ScienceRequestError) {
    if (error.kind === "unavailable") return { status: "unavailable", capability: error.capability ?? fallbackCapability, message: error.message, previous };
    if (error.kind === "out-of-range") return { status: "out-of-range", message: error.message, validFromUtc: error.validFromUtc, validUntilUtc: error.validUntilUtc, previous };
    if (error.kind === "validation") return { status: "validation-error", message: error.message, previous };
    if (error.kind === "network") return { status: "network-error", message: error.message, previous };
    if (error.kind === "contract") return { status: "contract-error", message: error.message, requestId: error.requestId, previous };
    return { status: "server-error", message: error.message, requestId: error.requestId, previous };
  }
  return { status: "network-error", message: "Não foi possível concluir a consulta científica.", previous };
}

/** Keep the complete confirmed response, including its original input/provenance.
 * Callers must check request generation and signal at state-update time.
 */
export function settleScienceResource<T>(current: ScienceResource<T>, result: PromiseSettledResult<T>, capability: ScienceCapability, isCurrent: boolean): ScienceResource<T> {
  if (!isCurrent) return current;
  if (result.status === "fulfilled") return { status: "ready", data: result.value };
  const previous = currentScienceData(current);
  if (result.reason instanceof Error && result.reason.name === "AbortError") return previous === undefined ? { status: "idle" } : { status: "ready", data: previous };
  return resourceError(result.reason, capability, previous);
}
