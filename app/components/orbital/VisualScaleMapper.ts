import * as THREE from "three";

export type VisualMode = "real" | "visual" | "focus";

export type VisualScaleSettings = {
  mode: VisualMode;
  compression: number;
  orbitExtent: number;
  minimumOrbitSpacing: number;
  focusBody: string;
};

export type PhysicalBody = {
  name: string;
  radius_m: number;
  position_m: number[];
};

export const AU = 149_597_870_700;

/** Presentation-only sizes; not physical radii or a second ephemeris. */
export const BODY_VISUAL_SCALE = {
  earthRadius: 0.28,
  earthRadiusM: 6_371_000,
  radiusExponent: 0.45,
  sunRadius: 0.95,
  focusMagnification: 2,
  neighbourBudget: 0.72,
  saturnRingExtent: 2.1,
  moonDistanceScale: 450 / AU,
};

export const DEFAULT_VISUAL_SCALE: VisualScaleSettings = {
  mode: "visual",
  compression: 0.68,
  orbitExtent: 32,
  minimumOrbitSpacing: 2.2,
  focusBody: "Earth",
};

function readAxis(values: number[], axis: number): number {
  const value = values[axis] ?? 0;
  return Number.isFinite(value) ? value : 0;
}

/** Converts J2000 XYZ into the scene's XZY convention without changing the source data. */
export function toSceneAxes(values: number[]): THREE.Vector3 {
  return new THREE.Vector3(readAxis(values, 0), readAxis(values, 2), readAxis(values, 1));
}

export function physicalDistanceAu(from: number[], to: number[]): number {
  return toSceneAxes(from).sub(toSceneAxes(to)).length() / AU;
}

/**
 * Pure visual adapter. It never mutates physical bodies and it preserves every
 * direction vector; only its rendered radius is changed for legibility.
 */
export class VisualScaleMapper {
  readonly settings: VisualScaleSettings;
  private readonly sun: PhysicalBody | undefined;
  private readonly focus: PhysicalBody | undefined;
  private readonly radialRank: Map<string, number>;
  private readonly furthestDistanceAu: number;
  private readonly bodies: PhysicalBody[];

  constructor(bodies: PhysicalBody[], settings: VisualScaleSettings) {
    this.settings = settings;
    this.bodies = bodies;
    this.sun = bodies.find((body) => body.name === "Sun");
    this.focus = bodies.find((body) => body.name === settings.focusBody);
    const ranked = bodies
      .filter((body) => body.name !== "Sun" && body.name !== "Moon")
      .map((body) => ({ name: body.name, distance: this.distanceFromSunAu(body) }))
      .filter((entry) => Number.isFinite(entry.distance) && entry.distance > 0)
      .sort((left, right) => left.distance - right.distance);
    this.radialRank = new Map(ranked.map((entry, index) => [entry.name, index + 1]));
    this.furthestDistanceAu = Math.max(1, ...ranked.map((entry) => entry.distance));
  }

  private distanceFromSunAu(body: PhysicalBody): number {
    if (!this.sun) return toSceneAxes(body.position_m).length() / AU;
    return physicalDistanceAu(body.position_m, this.sun.position_m);
  }

  private visualRadius(distanceAu: number, bodyName: string): number {
    const normalized = THREE.MathUtils.clamp(distanceAu / this.furthestDistanceAu, 0, 1);
    if (this.settings.mode === "real") return normalized * this.settings.orbitExtent;
    const logarithmic = Math.log1p(distanceAu) / Math.log1p(this.furthestDistanceAu);
    const compressed = THREE.MathUtils.lerp(normalized, logarithmic, this.settings.compression);
    const rankRadius = (this.radialRank.get(bodyName) ?? 0) * this.settings.minimumOrbitSpacing;
    return Math.max(compressed * this.settings.orbitExtent, rankRadius);
  }

  private focusPosition(body: PhysicalBody): THREE.Vector3 | null {
    if (!this.focus) return null;
    if (body.name === this.focus.name) return new THREE.Vector3();
    // The only satellite state delivered in the reference snapshot is the Moon.
    // It remains an exact relative vector in focus mode; unknown moons are not invented.
    if (this.focus.name === "Earth" && body.name === "Moon") {
      const relative = toSceneAxes(body.position_m).sub(toSceneAxes(this.focus.position_m));
      return relative.multiplyScalar(1100 / AU);
    }
    return null;
  }

  mapBody(body: PhysicalBody): THREE.Vector3 | null {
    if (this.settings.mode === "focus") return this.focusPosition(body);
    if (body.name === "Sun") return new THREE.Vector3();
    // Local lunar separation is amplified only in the readable overview.
    // Its direction still comes exclusively from the supplied Earth/Moon state.
    if (body.name === "Moon" && this.settings.mode === "visual") {
      const earth = this.bodies.find((candidate) => candidate.name === "Earth");
      if (earth) {
        const relative = toSceneAxes(body.position_m).sub(toSceneAxes(earth.position_m));
        return this.mapBody(earth)!.add(relative.multiplyScalar(BODY_VISUAL_SCALE.moonDistanceScale));
      }
    }
    const origin = this.sun ? toSceneAxes(this.sun.position_m) : new THREE.Vector3();
    const relative = toSceneAxes(body.position_m).sub(origin);
    const distanceAu = relative.length() / AU;
    if (!Number.isFinite(distanceAu) || distanceAu < 1e-12) return new THREE.Vector3();
    return relative.normalize().multiplyScalar(this.visualRadius(distanceAu, body.name));
  }

  mapOrbitPoint(position_m: number[], bodyName: string): THREE.Vector3 | null {
    if (this.settings.mode === "focus") return null;
    const origin = this.sun ? toSceneAxes(this.sun.position_m) : new THREE.Vector3();
    const relative = toSceneAxes(position_m).sub(origin);
    const distanceAu = relative.length() / AU;
    if (!Number.isFinite(distanceAu) || distanceAu < 1e-12) return new THREE.Vector3();
    return relative.normalize().multiplyScalar(this.visualRadius(distanceAu, bodyName));
  }

  private nominalRadius(body: PhysicalBody): number {
    const nominal = body.name === "Sun" ? BODY_VISUAL_SCALE.sunRadius
      : BODY_VISUAL_SCALE.earthRadius * Math.pow(Math.max(body.radius_m, 1) / BODY_VISUAL_SCALE.earthRadiusM, BODY_VISUAL_SCALE.radiusExponent);
    return nominal * (this.settings.mode === "focus" ? BODY_VISUAL_SCALE.focusMagnification : 1);
  }

  displayRadius(body: PhysicalBody): number {
    const nominal = this.nominalRadius(body);
    let radius = nominal;
    const position = this.mapBody(body);
    if (!position) return radius;
    // Reserve room for rings and selection outlines, including in real mode.
    // No positive floor: very close physical states must not grow into each other.
    const extent = body.name === "Saturn" ? BODY_VISUAL_SCALE.saturnRingExtent : 1.3;
    for (const neighbour of this.bodies) {
      if (neighbour.name === body.name) continue;
      const other = this.mapBody(neighbour);
      if (other) {
        const otherExtent = neighbour.name === "Saturn" ? BODY_VISUAL_SCALE.saturnRingExtent : 1.3;
        const occupied = nominal * extent + this.nominalRadius(neighbour) * otherExtent;
        radius = Math.min(radius, position.distanceTo(other) * BODY_VISUAL_SCALE.neighbourBudget * nominal / occupied);
      }
    }
    return radius;
  }

  get displayExtent(): number {
    return this.settings.mode === "focus" ? 7 : this.settings.orbitExtent;
  }

  get focusHasExactSatelliteState(): boolean {
    return this.focus?.name === "Earth";
  }
}
