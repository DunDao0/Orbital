export type TerrainTileRequest = { z: number; x: number; y: number };
export type TerrainTile = { heightsM: Float32Array; width: number; height: number };
export type TerrainCoverage = { validFromUtc?: string; validUntilUtc?: string; description: string };
export interface TerrainProvider { id: string; getTile(request: TerrainTileRequest, signal: AbortSignal): Promise<TerrainTile | null>; getAttribution(): string; getCoverage(): TerrainCoverage; }

export const WGS84_EQUATORIAL_RADIUS_M = 6_378_137;

export const ellipsoidTerrainProvider: TerrainProvider = {
  id: "wgs84-ellipsoid-fallback",
  async getTile(_request, signal) { return signal.aborted ? null : null; },
  getAttribution() { return "Elipsoide WGS84 de fallback; sem elevação observada."; },
  getCoverage() { return { description: "Cobertura global elipsoidal, sem relevo externo aprovado." }; },
};

export class TerrainTileCache {
  private tiles = new Map<string, TerrainTile>();
  private readonly maximumEntries: number;
  constructor(maximumEntries = 32) { this.maximumEntries = maximumEntries; }
  get(key: string): TerrainTile | undefined { const value = this.tiles.get(key); if (value) { this.tiles.delete(key); this.tiles.set(key, value); } return value; }
  set(key: string, tile: TerrainTile) { this.tiles.delete(key); this.tiles.set(key, tile); while (this.tiles.size > this.maximumEntries) this.tiles.delete(this.tiles.keys().next().value as string); }
  dispose() { this.tiles.clear(); }
  get size() { return this.tiles.size; }
}

/** A renderer can enforce this before drawing so a close surface camera never enters the reference ellipsoid. */
export function isOutsideEllipsoid(cameraRadius: number, clearance = 1.001): boolean { return Number.isFinite(cameraRadius) && cameraRadius >= clearance; }
