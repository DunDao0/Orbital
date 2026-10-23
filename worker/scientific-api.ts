import { decodeScienceCapabilities } from "../lib/science/decoders.ts";
import type { ScienceCapabilities } from "../lib/science/contracts.ts";

type AssetFetcher = { fetch(request: Request): Promise<Response> };

export type ApiEnvironment = {
  ASSETS: AssetFetcher;
  CUSTOMER_HTTP_SCIENCE_API?: AssetFetcher;
};

type SnapshotBody = { name: string; [key: string]: unknown };
type ReferenceSnapshot = { epoch: string; frame: string; time_scale: string; source: string; bodies: SnapshotBody[]; [key: string]: unknown };
type MoonCatalogueAsset = { source: string[]; scope: string; moons: Array<{ name: string; primary: string; designation?: string | null; [key: string]: unknown }> };
type StarCatalogueAsset = { source: string; count: number; stars: Array<{ gaia_dr3_source_id: string; g_mag: number | null; [key: string]: unknown }> };
type ConstellationGuide = { iau_abbreviation: string; name: string; aliases?: string[]; [key: string]: unknown };
type ConstellationCatalogueAsset = { items: ConstellationGuide[]; source: string; catalogue_epoch?: string; limitations?: string[] };
type DynamicCapability = "sky" | "eclipses_local" | "simulate";

type RouteDefinition = {
  methods: readonly string[];
  canonicalMethod: "GET" | "POST";
  dynamic?: DynamicCapability;
  legacyGet?: boolean;
};

const ROUTES: Record<string, RouteDefinition> = {
  "/api/health": { methods: ["GET"], canonicalMethod: "GET" },
  "/api/capabilities": { methods: ["GET"], canonicalMethod: "GET" },
  "/api/reference/state": { methods: ["GET"], canonicalMethod: "GET" },
  "/api/catalogs/moons": { methods: ["GET"], canonicalMethod: "GET" },
  "/api/catalogs/stars": { methods: ["GET"], canonicalMethod: "GET" },
  "/api/catalogs/constellations": { methods: ["GET"], canonicalMethod: "GET" },
  "/api/sky": { methods: ["POST", "GET"], canonicalMethod: "POST", dynamic: "sky", legacyGet: true },
  "/api/sky/constellations": { methods: ["POST", "GET"], canonicalMethod: "POST", dynamic: "sky", legacyGet: true },
  "/api/eclipses/local": { methods: ["POST", "GET"], canonicalMethod: "POST", dynamic: "eclipses_local", legacyGet: true },
  "/api/simulate": { methods: ["POST"], canonicalMethod: "POST", dynamic: "simulate" },
};

const SCHEMA_VERSION = 1;
const SOFTWARE_VERSION = "0.1.0";
const MAX_REQUEST_BODY_BYTES = 64 * 1024;
const PUBLIC_CACHE = "public, max-age=3600";
const PRIVATE_CACHE = "private, no-store";
const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

function requestId(request: Request): string {
  const incoming = request.headers.get("X-Request-ID") ?? "";
  return REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}

function meta(id: string, capability: string) {
  return { request_id: id, generated_at_utc: new Date().toISOString(), service: "edge", software_version: SOFTWARE_VERSION, capability };
}

function json(payload: unknown, id: string, init: ResponseInit = {}, cache = PRIVATE_CACHE): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", cache);
  headers.set("X-Request-ID", id);
  return new Response(JSON.stringify(payload), { ...init, headers });
}

function success(payload: Record<string, unknown>, id: string, capability: string, cache = PRIVATE_CACHE): Response {
  return json({ schema_version: SCHEMA_VERSION, meta: meta(id, capability), ...payload }, id, {}, cache);
}

function problem(status: number, code: string, message: string, id: string, capability?: DynamicCapability, extra: Record<string, unknown> = {}, headers?: HeadersInit): Response {
  const error: Record<string, unknown> = { code, message, request_id: id, ...extra };
  if (capability) error.capability = capability;
  return json({ schema_version: SCHEMA_VERSION, error }, id, { status, headers }, PRIVATE_CACHE);
}

async function assetJson<T>(request: Request, env: ApiEnvironment, pathname: string): Promise<T> {
  let asset: Response | undefined;
  try {
    asset = await env.ASSETS.fetch(new Request(new URL(pathname, request.url)));
  } catch {
    asset = undefined;
  }
  const host = new URL(request.url).hostname;
  if (!asset?.ok && new Set(["localhost", "127.0.0.1", "::1"]).has(host)) {
    // Vinext dev serves public/ through its app handler rather than the
    // production ASSETS binding. This local-only retry reads that same-origin
    // artifact; production never falls back to a remote origin.
    asset = await fetch(new Request(new URL(pathname, request.url), { headers: { Accept: "application/json" } }));
  }
  if (!asset?.ok) throw new Error("asset unavailable");
  return asset.json() as Promise<T>;
}

function integer(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback;
}

function offset(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

function sameUtc(left: string, right: string): boolean {
  const a = utcMicroseconds(left);
  const b = utcMicroseconds(right);
  return a !== null && b !== null && a === b;
}

/** ISO UTC contract: seconds required, optional 1–6 decimals and Z/±HH:MM.
 * An absent zone means UTC. Leap seconds cannot equal the fixed snapshot.
 */
function utcMicroseconds(value: string): bigint | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|z|[+-]\d{2}:\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = "", zone = "Z"] = match;
  if (+hour > 23 || +minute > 59 || +second > 59) return null;
  const base = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const local = new Date(`${base}Z`);
  if (!Number.isFinite(local.valueOf()) || local.toISOString().slice(0, 19) !== base) return null;
  let offsetMinutes = 0;
  if (zone !== "Z" && zone !== "z") {
    const hours = +zone.slice(1, 3), minutes = +zone.slice(4);
    if (hours > 23 || minutes > 59) return null;
    offsetMinutes = (hours * 60 + minutes) * (zone[0] === "+" ? 1 : -1);
  }
  return BigInt(local.valueOf() - offsetMinutes * 60_000) * 1000n + BigInt(fraction.padEnd(6, "0"));
}

function allowHeader(route: RouteDefinition): string {
  return [...route.methods, "OPTIONS"].join(", ");
}

function deprecationHeaders(route: RouteDefinition, method: string): HeadersInit | undefined {
  return route.legacyGet && method === "GET" ? { Deprecation: "true", Warning: '299 - "GET with observer coordinates is deprecated; use POST JSON."' } : undefined;
}

async function boundedBody(request: Request, id: string, capability: DynamicCapability): Promise<ArrayBuffer | Response | undefined> {
  if (request.method !== "POST") return undefined;
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BODY_BYTES) {
    return problem(413, "REQUEST_BODY_TOO_LARGE", "O corpo da solicitação ultrapassa o limite de 64 KiB.", id, capability);
  }
  const body = await request.clone().arrayBuffer();
  return body.byteLength > MAX_REQUEST_BODY_BYTES
    ? problem(413, "REQUEST_BODY_TOO_LARGE", "O corpo da solicitação ultrapassa o limite de 64 KiB.", id, capability)
    : body;
}

async function verifiedNativeCapabilities(request: Request, env: ApiEnvironment): Promise<{ healthy: boolean; payload?: ScienceCapabilities }> {
  if (!env.CUSTOMER_HTTP_SCIENCE_API) return { healthy: false };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const headers = new Headers({ Accept: "application/json", "X-Request-ID": requestId(request) });
    const response = await env.CUSTOMER_HTTP_SCIENCE_API.fetch(new Request(new URL("/api/capabilities", request.url), { headers, signal: controller.signal }));
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return { healthy: false };
    const value: unknown = await response.json();
    const payload = decodeScienceCapabilities(value);
    if (payload.meta.service !== "native" || payload.meta.capability !== "capabilities") return { healthy: false };
    return { healthy: true, payload };
  } catch {
    return { healthy: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function proxyDynamic(request: Request, env: ApiEnvironment, route: RouteDefinition, id: string, body: ArrayBuffer | undefined): Promise<Response> {
  const capability = route.dynamic!;
  if (!env.CUSTOMER_HTTP_SCIENCE_API) {
    return problem(501, "SCIENCE_SERVICE_UNAVAILABLE", "Cálculos científicos ao vivo não estão disponíveis neste ambiente.", id, capability);
  }
  const sourceUrl = new URL(request.url);
  if (request.method === "POST") sourceUrl.search = "";
  const headers = new Headers();
  for (const name of ["Accept", "Content-Type"] as const) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("X-Request-ID", id);
  const upstreamRequest = new Request(sourceUrl, { method: request.method, headers, body: request.method === "POST" ? body : undefined });
  try {
    const upstream = await env.CUSTOMER_HTTP_SCIENCE_API.fetch(upstreamRequest);
    if (!upstream.headers.get("content-type")?.includes("application/json")) {
      return problem(502, "UPSTREAM_SCIENCE_SERVICE_UNAVAILABLE", "O serviço científico nativo retornou uma resposta inválida.", id, capability);
    }
    const text = await upstream.text();
    try { JSON.parse(text); } catch { return problem(502, "UPSTREAM_SCIENCE_SERVICE_UNAVAILABLE", "O serviço científico nativo retornou uma resposta inválida.", id, capability); }
    const responseHeaders = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": PRIVATE_CACHE, "X-Request-ID": upstream.headers.get("X-Request-ID") ?? id });
    for (const name of ["Deprecation", "Warning", "Allow", "Retry-After"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(text, { status: upstream.status, headers: responseHeaders });
  } catch {
    return problem(502, "UPSTREAM_SCIENCE_SERVICE_UNAVAILABLE", "O serviço científico nativo não respondeu.", id, capability);
  }
}

export async function handleScientificApi(request: Request, env: ApiEnvironment): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;
  const id = requestId(request);
  const route = ROUTES[url.pathname];
  if (!route) return problem(404, "NOT_FOUND", "Rota científica não encontrada.", id);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { Allow: allowHeader(route), "Cache-Control": PRIVATE_CACHE, "X-Request-ID": id } });
  if (!route.methods.includes(request.method)) return problem(405, "METHOD_NOT_ALLOWED", "Método HTTP não permitido para esta rota.", id, route.dynamic, {}, { Allow: allowHeader(route) });

  if (route.dynamic) {
    const bounded = await boundedBody(request, id, route.dynamic);
    if (bounded instanceof Response) return bounded;
    const response = await proxyDynamic(request, env, route, id, bounded);
    const legacy = deprecationHeaders(route, request.method);
    if (legacy) for (const [name, value] of Object.entries(legacy)) response.headers.set(name, value);
    return response;
  }

  try {
    if (url.pathname === "/api/health") {
      return success({ status: "ok", api: "orbis-edge-reference-api", service: "edge" }, id, "health");
    }
    if (url.pathname === "/api/capabilities") {
      const snapshot = await assetJson<ReferenceSnapshot>(request, env, "/reference-snapshot.json");
      const native = await verifiedNativeCapabilities(request, env);
      const nativeStatus = native.healthy ? "available" : env.CUSTOMER_HTTP_SCIENCE_API ? "configured-unverified" : "unavailable";
      const dynamicCapability = (key: DynamicCapability) => native.payload?.capabilities[key] ?? { available: false, status: nativeStatus, canonical_method: "POST" };
      return success({
        snapshot: { available: true, fixed_epoch: true, epoch_utc: snapshot.epoch, source: snapshot.source },
        capabilities: {
          reference_state: { available: true, status: "available", mode: "fixed-snapshot" },
          catalogs: { available: true, moons: true, stars: true, constellations: true },
          sky: dynamicCapability("sky"),
          eclipses_local: dynamicCapability("eclipses_local"),
          simulate: dynamicCapability("simulate"),
        },
        limits: {
          reference_state: { valid_utc_from: snapshot.epoch, valid_utc_until: snapshot.epoch },
          simulate: { max_bodies: 10, max_steps: 20_000, max_duration_s: 31_536_000, max_step_s: 86_400 },
          request_body_bytes: MAX_REQUEST_BODY_BYTES,
        },
      }, id, "capabilities");
    }
    if (url.pathname === "/api/reference/state") {
      const snapshot = await assetJson<ReferenceSnapshot>(request, env, "/reference-snapshot.json");
      const requested = url.searchParams.get("utc");
      if (requested && !sameUtc(requested, snapshot.epoch)) {
        return problem(422, "REFERENCE_EPOCH_UNAVAILABLE", "O Worker só expõe a época fixa do snapshot de referência.", id, undefined, { valid_utc_from: snapshot.epoch, valid_utc_until: snapshot.epoch });
      }
      const requestedBodies = url.searchParams.get("bodies")?.split(",").map((name) => normalized(name)).filter(Boolean);
      const bodies = requestedBodies?.length ? snapshot.bodies.filter((item) => requestedBodies.includes(normalized(item.name))) : snapshot.bodies;
      return success({ ...snapshot, bodies, fixed_epoch: true }, id, "reference_state", PUBLIC_CACHE);
    }
    if (url.pathname === "/api/catalogs/moons") {
      const catalogue = await assetJson<MoonCatalogueAsset>(request, env, "/scientific/moons.json");
      const primary = normalized(url.searchParams.get("primary") ?? "");
      const query = normalized(url.searchParams.get("query") ?? "");
      const matches = catalogue.moons.filter((moon) => (!primary || normalized(moon.primary) === primary) && (!query || [moon.name, moon.primary, moon.designation ?? ""].some((value) => normalized(value).includes(query))));
      const limit = integer(url.searchParams.get("limit"), 80, 250);
      const start = offset(url.searchParams.get("offset"));
      const items = matches.slice(start, start + limit);
      const counts = catalogue.moons.reduce<Record<string, number>>((output, moon) => ({ ...output, [moon.primary]: (output[moon.primary] ?? 0) + 1 }), {});
      return success({ items, total: matches.length, returned: items.length, offset: start, limit, counts, source: catalogue.source, provenance: "JPL SSD generated offline catalogue", propagation_notice: "Mean elements are catalogue metadata only. No position is displayed as an ephemeris without a named state source." }, id, "catalogs", PUBLIC_CACHE);
    }
    if (url.pathname === "/api/catalogs/stars") {
      const catalogue = await assetJson<StarCatalogueAsset>(request, env, "/scientific/gaia_bright.json");
      const query = normalized(url.searchParams.get("query") ?? "");
      const magnitude = Number.parseFloat(url.searchParams.get("max_magnitude") ?? "");
      const matches = catalogue.stars.filter((star) => (!query || normalized(star.gaia_dr3_source_id).includes(query)) && (!Number.isFinite(magnitude) || (star.g_mag !== null && star.g_mag <= magnitude)));
      const limit = integer(url.searchParams.get("limit"), 50, 100);
      const start = offset(url.searchParams.get("offset"));
      const items = matches.slice(start, start + limit);
      return success({ catalogue_count: catalogue.count, total: matches.length, returned: items.length, offset: start, limit, source: catalogue.source, provenance: "ESA Gaia Archive DR3 TAP offline subset", items }, id, "catalogs", PUBLIC_CACHE);
    }
    if (url.pathname === "/api/catalogs/constellations") {
      const catalogue = await assetJson<ConstellationCatalogueAsset>(request, env, "/scientific/constellation_guides.json");
      const query = normalized(url.searchParams.get("query") ?? "");
      const abbreviation = normalized(url.searchParams.get("abbreviation") ?? "");
      const matches = catalogue.items.filter((item) => (!abbreviation || normalized(item.iau_abbreviation) === abbreviation) && (!query || [item.iau_abbreviation, item.name, ...(item.aliases ?? [])].some((value) => normalized(value).includes(query))));
      const limit = integer(url.searchParams.get("limit"), 88, 88);
      const start = offset(url.searchParams.get("offset"));
      const items = matches.slice(start, start + limit).map((item) => ({ ...item, boundary_source: "IAU boundaries via Astropy / Roman 1987", cultural_lines: "not bundled" }));
      return success({ items, total: matches.length, returned: items.length, count: catalogue.items.length, offset: start, limit, abbreviations: catalogue.items.map((item) => item.iau_abbreviation), source: catalogue.source, boundary_note: "Official IAU boundaries are coordinate classifications; cultural stick figures are not substituted.", boundary_representation: "formal Roman/Delporte inventory; detailed J2000 geometry is a separate artifact", catalogue_epoch: catalogue.catalogue_epoch, limitations: catalogue.limitations ?? [] }, id, "catalogs", PUBLIC_CACHE);
    }
    return problem(404, "NOT_FOUND", "Rota científica não encontrada.", id);
  } catch {
    return problem(503, "CATALOGUE_UNAVAILABLE", "O catálogo científico publicado não está disponível nesta versão.", id);
  }
}
