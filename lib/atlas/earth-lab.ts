import type { OrbitalLayerDefinition } from "./layers";

export type EarthTileRequest = { key: string; signal: AbortSignal };
export type EarthTile = { bytes: Uint8Array; receivedAtUtc: string };
export type EarthTemporalLayerManifest = {
  id: string;
  title: string;
  source: { name: string; attribution: string; license: string };
  dataUtc?: string;
  coverage: { description: string; validFromUtc?: string; validUntilUtc?: string };
  legend: string;
  resolution: string;
  temporal: boolean;
  featureFlag: boolean;
  limitations: string[];
};

export interface EarthTileLoader { id: string; load(request: EarthTileRequest): Promise<EarthTile | null>; dispose(): void; readonly size: number; }

/** External layers stay disabled until a permitted provider, licence and manifest are explicitly added. */
export const EARTH_LAB_FEATURE_FLAG = false;

export const EARTH_TEMPORAL_FIXTURE: EarthTemporalLayerManifest = {
  id: "earth-temporal-fixture", title: "Fixture temporal local", source: { name: "Fixture local de teste", attribution: "Sem fonte geográfica; exercita somente o contrato offline.", license: "Dados de teste internos" }, dataUtc: "2026-08-05T00:00:00Z", coverage: { description: "Uma chave sintética local; não representa uma imagem ou campo da Terra." }, legend: "Pixel vazio de fixture — não usar como dado.", resolution: "1 × 1 pixel de teste", temporal: true, featureFlag: EARTH_LAB_FEATURE_FLAG, limitations: ["Feature flag externa desativada.", "Sem tiles geográficos, meteorologia ou observação remota."]
};

export const EARTH_TEMPORAL_LAYER_DEFINITION: OrbitalLayerDefinition = { id: EARTH_TEMPORAL_FIXTURE.id, title: EARTH_TEMPORAL_FIXTURE.title, category: "scientific", kind: "raster-tiles", temporal: true, opacitySupported: true, source: { name: EARTH_TEMPORAL_FIXTURE.source.name, attribution: EARTH_TEMPORAL_FIXTURE.source.attribution }, status: "historical", limitations: EARTH_TEMPORAL_FIXTURE.limitations, enabled: EARTH_LAB_FEATURE_FLAG };

class LruCache<T> {
  private values = new Map<string, T>();
  private readonly maximumEntries: number;
  constructor(maximumEntries: number) { this.maximumEntries = maximumEntries; }
  get(key: string): T | undefined { const value = this.values.get(key); if (value !== undefined) { this.values.delete(key); this.values.set(key, value); } return value; }
  set(key: string, value: T) { this.values.delete(key); this.values.set(key, value); while (this.values.size > this.maximumEntries) this.values.delete(this.values.keys().next().value as string); }
  clear() { this.values.clear(); }
  get size() { return this.values.size; }
}

export function createFixtureTileLoader(maximumEntries = 8): EarthTileLoader {
  const cache = new LruCache<EarthTile>(Math.max(1, maximumEntries));
  let disposed = false;
  return {
    id: "local-fixture-lru",
    async load({ key, signal }) {
      if (disposed || signal.aborted) return null;
      const cached = cache.get(key); if (cached) return cached;
      await Promise.resolve();
      if (disposed || signal.aborted) return null;
      const tile = { bytes: new Uint8Array([0, 0, 0, 0]), receivedAtUtc: EARTH_TEMPORAL_FIXTURE.dataUtc ?? new Date().toISOString() };
      cache.set(key, tile); return tile;
    },
    dispose() { disposed = true; cache.clear(); },
    get size() { return cache.size; },
  };
}
