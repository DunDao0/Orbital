import * as THREE from "three";

export type PlanetVisualProfile = {
  color: string;
  orbit: string;
  emissive?: string;
  roughness: number;
  marker: string;
};

const PROFILES: Record<string, PlanetVisualProfile> = {
  Sun: { color: "#ffd36b", orbit: "#f6c967", emissive: "#ff9c3d", roughness: 0.36, marker: "#ffe3a0" },
  Mercury: { color: "#a7a39c", orbit: "#aaa59b", roughness: 0.94, marker: "#d4d0c6" },
  Venus: { color: "#dca66c", orbit: "#d7a36c", roughness: 0.82, marker: "#f4c382" },
  Earth: { color: "#5ba8f2", orbit: "#69b6ff", roughness: 0.54, marker: "#8ccaff" },
  Moon: { color: "#d3d0ca", orbit: "#ced6e2", roughness: 0.97, marker: "#eff3fb" },
  Mars: { color: "#db7352", orbit: "#df7959", roughness: 0.9, marker: "#ff9b73" },
  Jupiter: { color: "#d6a26d", orbit: "#dea771", roughness: 0.76, marker: "#f1c08b" },
  Saturn: { color: "#d9c18b", orbit: "#e4cb94", roughness: 0.67, marker: "#f2dbac" },
  Uranus: { color: "#78c9d8", orbit: "#84d4e3", roughness: 0.42, marker: "#a6eff6" },
  Neptune: { color: "#557bcf", orbit: "#638bdc", roughness: 0.48, marker: "#84aaff" },
};

export function planetVisualProfile(name: string, fallback: string): PlanetVisualProfile {
  return PROFILES[name] ?? { color: fallback, orbit: new THREE.Color(fallback).lerp(new THREE.Color("#e5c884"), 0.35).getStyle(), roughness: 0.74, marker: fallback };
}
