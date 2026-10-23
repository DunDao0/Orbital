import type {
  ConstellationCatalogue,
  ConstellationSkyResponse,
  EclipseInput,
  LocalEclipseResponse,
  MoonCatalogue,
  ObserverInput,
  ReferenceSnapshot,
  ScienceCapabilities,
  SimulationInput,
  SimulationResponse,
  SkyResponse,
  StarCatalogue,
} from "./contracts.ts";
import {
  ContractDecodeError,
  decodeConstellationCatalogue,
  decodeConstellationSkyResponse,
  decodeLocalEclipseResponse,
  decodeMoonCatalogue,
  decodeReferenceSnapshot,
  decodeScienceCapabilities,
  decodeSimulationResponse,
  decodeSkyResponse,
  decodeStarCatalogue,
} from "./decoders.ts";
import { scienceErrorFromResponse, ScienceRequestError } from "./errors.ts";

type Decoder<T> = (payload: unknown) => T;
type Fetcher = typeof fetch;

export type ReferenceStateInput = { utc?: string; bodies?: string[] };
export type MoonCatalogueInput = { query?: string; primary?: string; offset?: number; limit?: number };
export type StarCatalogueInput = { query?: string; maxMagnitude?: number; offset?: number; limit?: number };

export type ScienceGateway = {
  getCapabilities(signal?: AbortSignal): Promise<ScienceCapabilities>;
  getReferenceState(input?: ReferenceStateInput, signal?: AbortSignal): Promise<ReferenceSnapshot>;
  getMoonCatalogue(input?: MoonCatalogueInput, signal?: AbortSignal): Promise<MoonCatalogue>;
  getStarCatalogue(input?: StarCatalogueInput, signal?: AbortSignal): Promise<StarCatalogue>;
  getConstellations(signal?: AbortSignal): Promise<ConstellationCatalogue>;
  calculateSky(input: ObserverInput, signal?: AbortSignal): Promise<SkyResponse>;
  calculateConstellationSky(input: ObserverInput & { constellation: string; max_g_magnitude?: number }, signal?: AbortSignal): Promise<ConstellationSkyResponse>;
  calculateEclipse(input: EclipseInput, signal?: AbortSignal): Promise<LocalEclipseResponse>;
  simulate(input: SimulationInput, signal?: AbortSignal): Promise<SimulationResponse>;
};

type GatewayOptions = { fetcher?: Fetcher; localNativeOrigin?: string; browserOrigin?: string; browserHostname?: string };

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError" || error instanceof Error && error.name === "AbortError";
}

function params(input: Record<string, string | number | undefined>): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined) result.set(key, String(value));
  return result;
}

export function createScienceGateway(options: GatewayOptions = {}): ScienceGateway {
  const fetcher = options.fetcher ?? fetch;
  const localOrigin = options.localNativeOrigin ?? "http://127.0.0.1:8000";
  const activeControllers = new Map<string, AbortController>();

  function environment() {
    if (options.browserOrigin && options.browserHostname) return { origin: options.browserOrigin, hostname: options.browserHostname };
    if (typeof window !== "undefined") return { origin: window.location.origin, hostname: window.location.hostname };
    return { origin: "http://orbis.local", hostname: "orbis.local" };
  }

  function url(path: string, preferLocalNative: boolean, query?: URLSearchParams): URL {
    const current = environment();
    const isLocal = new Set(["localhost", "127.0.0.1", "::1"]).has(current.hostname);
    const target = new URL(path, preferLocalNative && isLocal ? localOrigin : current.origin);
    if (query) target.search = query.toString();
    return target;
  }

  function latestSignal(key: string, external?: AbortSignal): AbortSignal {
    activeControllers.get(key)?.abort();
    const controller = new AbortController();
    activeControllers.set(key, controller);
    if (external) {
      if (external.aborted) controller.abort();
      else external.addEventListener("abort", () => controller.abort(), { once: true });
    }
    return controller.signal;
  }

  async function send<T>(path: string, decoder: Decoder<T>, config: { method?: "GET" | "POST"; query?: URLSearchParams; body?: unknown; signal?: AbortSignal; preferLocalNative?: boolean; latestKey?: string } = {}): Promise<T> {
    const method = config.method ?? "GET";
    const signal = config.latestKey ? latestSignal(config.latestKey, config.signal) : config.signal;
    const headers = new Headers({ Accept: "application/json", "X-Request-ID": crypto.randomUUID() });
    if (method === "POST") headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await fetcher(url(path, config.preferLocalNative ?? false, method === "GET" ? config.query : undefined), { method, signal, headers, body: method === "POST" ? JSON.stringify(config.body) : undefined });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new ScienceRequestError("network", "Não foi possível alcançar o serviço científico.");
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw scienceErrorFromResponse(response.status, payload, `HTTP ${response.status}`);
    try {
      return decoder(payload);
    } catch (error) {
      if (error instanceof ContractDecodeError) throw new ScienceRequestError("contract", error.message, response.status);
      throw error;
    }
  }

  async function reference(input: ReferenceStateInput = {}, signal?: AbortSignal): Promise<ReferenceSnapshot> {
    const query = params({ utc: input.utc, bodies: input.bodies?.join(",") });
    const current = environment();
    const local = new Set(["localhost", "127.0.0.1", "::1"]).has(current.hostname);
    if (local) {
      try { return await send("/api/reference/state", decodeReferenceSnapshot, { query, signal, preferLocalNative: true }); }
      catch (error) { if (isAbort(error)) throw error; }
    }
    return send("/api/reference/state", decodeReferenceSnapshot, { query, signal, preferLocalNative: false });
  }

  async function capabilities(signal?: AbortSignal): Promise<ScienceCapabilities> {
    const current = environment();
    const local = new Set(["localhost", "127.0.0.1", "::1"]).has(current.hostname);
    if (local) {
      try { return await send("/api/capabilities", decodeScienceCapabilities, { signal, preferLocalNative: true }); }
      catch (error) { if (isAbort(error)) throw error; }
    }
    return send("/api/capabilities", decodeScienceCapabilities, { signal });
  }

  async function dynamic<T>(path: string, decoder: Decoder<T>, body: unknown, capabilityKey: string, signal?: AbortSignal): Promise<T> {
    const current = environment();
    const local = new Set(["localhost", "127.0.0.1", "::1"]).has(current.hostname);
    if (local) {
      try { return await send(path, decoder, { method: "POST", body, signal, preferLocalNative: true, latestKey: capabilityKey }); }
      catch (error) {
        if (isAbort(error)) throw error;
        if (!(error instanceof ScienceRequestError) || error.kind !== "network") throw error;
      }
    }
    return send(path, decoder, { method: "POST", body, signal, latestKey: capabilityKey });
  }

  return {
    getCapabilities: capabilities,
    getReferenceState: reference,
    getMoonCatalogue: (input = {}, signal) => send("/api/catalogs/moons", decodeMoonCatalogue, { query: params({ query: input.query, primary: input.primary, offset: input.offset, limit: input.limit }), signal }),
    getStarCatalogue: (input = {}, signal) => send("/api/catalogs/stars", decodeStarCatalogue, { query: params({ query: input.query, max_magnitude: input.maxMagnitude, offset: input.offset, limit: input.limit }), signal }),
    getConstellations: (signal) => send("/api/catalogs/constellations", decodeConstellationCatalogue, { query: params({ limit: 88 }), signal }),
    calculateSky: (input, signal) => dynamic("/api/sky", decodeSkyResponse, input, "sky", signal),
    calculateConstellationSky: (input, signal) => dynamic("/api/sky/constellations", decodeConstellationSkyResponse, input, "sky-constellations", signal),
    calculateEclipse: (input, signal) => dynamic("/api/eclipses/local", decodeLocalEclipseResponse, input, "eclipse", signal),
    simulate: (input, signal) => dynamic("/api/simulate", decodeSimulationResponse, input, "simulate", signal),
  };
}

export const scienceGateway = createScienceGateway();

export function useFixedSnapshotEpoch(capabilities: ScienceCapabilities): string | undefined {
  return capabilities.snapshot.fixed_epoch ? capabilities.snapshot.epoch_utc : undefined;
}
