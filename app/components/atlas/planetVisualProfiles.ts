export type AtlasQuality = "auto" | "low" | "medium" | "high";
export type ResolvedAtlasQuality = Exclude<AtlasQuality, "auto">;

export type AtlasQualityProfile = {
  sphereWidthSegments: number;
  sphereHeightSegments: number;
  surfacePatchSegments: number;
  cloudLayers: number;
  cloudShadows: boolean;
  pixelRatioCap: number;
};

export type PlanetSurfaceProfile = {
  /** Stable seed shared by global geometry, the close patch and shader noise. */
  seed: number;
  mode: "rock" | "banded" | "ice";
  macroFrequency: number;
  regionalFrequency: number;
  microFrequency: number;
  landBias: number;
  landDetailWeight: number;
  displacement: number;
  normalStrength: number;
  roughness: number;
  palette: [string, string, string, string];
  polarIce: number;
};

export type PlanetAtmosphereProfile = {
  planetRadius: number;
  atmosphereRadius: number;
  rayleighScattering: [number, number, number];
  /** Exponential density scale height, as a fraction of shell thickness. */
  rayleighScaleHeight: number;
  mieScattering: number;
  mieAbsorption: number;
  /** Exponential aerosol scale height, as a fraction of shell thickness. */
  mieScaleHeight: number;
  mieAnisotropy: number;
  absorption?: [number, number, number];
  sunIntensity: number;
  exposure: number;
};

export type PlanetOceanProfile = {
  radius: number;
  deepColor: string;
  shallowColor: string;
  roughness: number;
  waveStrength: number;
};

export type PlanetCloudProfile = {
  radius: number;
  color: string;
  coverage: number;
  opacity: number;
  scale: number;
  speedA: number;
  speedB: number;
  shadowStrength: number;
};

export type PlanetVisualProfile = {
  id: string;
  axialTilt?: number;
  surface: PlanetSurfaceProfile;
  atmosphere?: PlanetAtmosphereProfile;
  ocean?: PlanetOceanProfile;
  clouds?: PlanetCloudProfile;
};

export const ATLAS_QUALITY_PROFILES: Record<ResolvedAtlasQuality, AtlasQualityProfile> = {
  low: {
    sphereWidthSegments: 80,
    sphereHeightSegments: 56,
    surfacePatchSegments: 72,
    cloudLayers: 0,
    cloudShadows: false,
    pixelRatioCap: 1,
  },
  medium: {
    sphereWidthSegments: 112,
    sphereHeightSegments: 76,
    surfacePatchSegments: 108,
    cloudLayers: 1,
    cloudShadows: false,
    pixelRatioCap: 1.5,
  },
  high: {
    sphereWidthSegments: 152,
    sphereHeightSegments: 104,
    surfacePatchSegments: 156,
    cloudLayers: 2,
    cloudShadows: true,
    pixelRatioCap: 2,
  },
};

const earthAtmosphere: PlanetAtmosphereProfile = {
  planetRadius: 1,
  atmosphereRadius: 1.035,
  rayleighScattering: [0.52, 0.82, 1.38],
  rayleighScaleHeight: 0.19,
  mieScattering: 0.44,
  mieAbsorption: 0.08,
  mieScaleHeight: 0.055,
  mieAnisotropy: 0.72,
  absorption: [0.02, 0.015, 0.006],
  sunIntensity: 1,
  exposure: 1.03,
};

const rocky = (
  seed: number,
  palette: PlanetSurfaceProfile["palette"],
  overrides: Partial<PlanetSurfaceProfile> = {},
): PlanetSurfaceProfile => ({
  seed,
  mode: "rock",
  macroFrequency: 1.15,
  regionalFrequency: 4.2,
  microFrequency: 22,
  landBias: 0.46,
  landDetailWeight: 0.21,
  displacement: 0.014,
  normalStrength: 0.16,
  roughness: 0.78,
  palette,
  polarIce: 0.86,
  ...overrides,
});

const banded = (
  seed: number,
  palette: PlanetSurfaceProfile["palette"],
  overrides: Partial<PlanetSurfaceProfile> = {},
): PlanetSurfaceProfile => ({
  seed,
  mode: "banded",
  macroFrequency: 1.3,
  regionalFrequency: 5.6,
  microFrequency: 30,
  landBias: 0.5,
  landDetailWeight: 0.21,
  displacement: 0.003,
  normalStrength: 0.06,
  roughness: 0.57,
  palette,
  polarIce: 1.2,
  ...overrides,
});

export const PLANET_VISUAL_PROFILES: Record<string, PlanetVisualProfile> = {
  mercury: {
    id: "mercury",
    surface: rocky(11, ["#2c2826", "#66584d", "#aa957d", "#e1d2bc"], {
      macroFrequency: 2.2,
      regionalFrequency: 8.2,
      microFrequency: 38,
      displacement: 0.018,
      roughness: 0.91,
    }),
  },
  venus: {
    id: "venus",
    surface: rocky(23, ["#4c2416", "#87502b", "#c98243", "#f1be6e"], {
      macroFrequency: 1.65,
      regionalFrequency: 5.8,
      displacement: 0.011,
      roughness: 0.84,
    }),
    atmosphere: {
      ...earthAtmosphere,
      atmosphereRadius: 1.08,
      rayleighScattering: [1.1, 0.55, 0.18],
      rayleighScaleHeight: 0.54,
      mieScattering: 1.25,
      mieAbsorption: 0.22,
      mieScaleHeight: 0.28,
      mieAnisotropy: 0.61,
      exposure: 0.76,
    },
    clouds: { radius: 1.05, color: "#e5b36a", coverage: 0.48, opacity: 0.36, scale: 2.3, speedA: 0.006, speedB: -0.004, shadowStrength: 0 },
  },
  earth: {
    id: "earth",
    surface: rocky(37, ["#103525", "#347c46", "#a08c4c", "#d8ddd1"], {
      macroFrequency: 0.96,
      regionalFrequency: 2.65,
      microFrequency: 35,
      landBias: 0.49,
      landDetailWeight: 0.24,
      displacement: 0.012,
      normalStrength: 0.2,
      roughness: 0.72,
      polarIce: 0.74,
    }),
    atmosphere: earthAtmosphere,
    // Mantém a lâmina d'água acima do deslocamento máximo da malha global.
    // A máscara no shader descarta essa casca sobre os continentes, sem cortes
    // de profundidade triangulares quando a câmera chega perto da costa.
    ocean: { radius: 1.014, deepColor: "#053464", shallowColor: "#2b95bc", roughness: 0.16, waveStrength: 0.24 },
    clouds: { radius: 1.018, color: "#f4f7ee", coverage: 0.7, opacity: 0.36, scale: 6.8, speedA: 0.013, speedB: -0.008, shadowStrength: 0.22 },
  },
  mars: {
    id: "mars",
    surface: rocky(47, ["#3f1714", "#7d2f22", "#bd5a34", "#d99a62"], {
      macroFrequency: 1.45,
      regionalFrequency: 6.9,
      microFrequency: 43,
      landBias: 0.4,
      displacement: 0.021,
      roughness: 0.89,
      polarIce: 0.7,
    }),
    atmosphere: {
      ...earthAtmosphere,
      atmosphereRadius: 1.018,
      rayleighScattering: [1.05, 0.42, 0.19],
      rayleighScaleHeight: 0.12,
      mieScattering: 0.72,
      mieAbsorption: 0.16,
      mieScaleHeight: 0.09,
      mieAnisotropy: 0.54,
      exposure: 0.82,
    },
  },
  jupiter: {
    id: "jupiter",
    surface: banded(59, ["#482019", "#9a4c32", "#d39a62", "#f0d5a3"], { macroFrequency: 2.1, regionalFrequency: 9.5, roughness: 0.49 }),
    atmosphere: { ...earthAtmosphere, atmosphereRadius: 1.042, rayleighScattering: [0.72, 0.39, 0.21], rayleighScaleHeight: 0.32, mieScattering: 0.92, mieAbsorption: 0.17, mieScaleHeight: 0.16, mieAnisotropy: 0.68, exposure: 0.88 },
    clouds: { radius: 1.01, color: "#ffe1bd", coverage: 0.38, opacity: 0.36, scale: 7.4, speedA: 0.025, speedB: -0.015, shadowStrength: 0.12 },
  },
  saturn: {
    id: "saturn",
    surface: banded(71, ["#5d4827", "#a88b56", "#d9bd7e", "#fff0bd"], { macroFrequency: 2.7, regionalFrequency: 10.5, roughness: 0.52 }),
    atmosphere: { ...earthAtmosphere, atmosphereRadius: 1.048, rayleighScattering: [0.9, 0.7, 0.33], rayleighScaleHeight: 0.37, mieScattering: 0.94, mieAbsorption: 0.16, mieScaleHeight: 0.18, mieAnisotropy: 0.7, exposure: 0.86 },
    clouds: { radius: 1.012, color: "#fff0c4", coverage: 0.31, opacity: 0.3, scale: 8.3, speedA: 0.019, speedB: -0.011, shadowStrength: 0.08 },
  },
  uranus: {
    id: "uranus",
    axialTilt: Math.PI * 0.48,
    surface: banded(83, ["#174e59", "#3f8992", "#77c6c9", "#d3ffff"], { macroFrequency: 1.25, regionalFrequency: 4.3, roughness: 0.49 }),
    atmosphere: { ...earthAtmosphere, atmosphereRadius: 1.038, rayleighScattering: [0.22, 0.9, 1.05], rayleighScaleHeight: 0.28, mieScattering: 0.58, mieAbsorption: 0.1, mieScaleHeight: 0.14, mieAnisotropy: 0.67, exposure: 0.84 },
    clouds: { radius: 1.01, color: "#ccffff", coverage: 0.16, opacity: 0.19, scale: 3.1, speedA: 0.01, speedB: -0.006, shadowStrength: 0 },
  },
  neptune: {
    id: "neptune",
    surface: banded(97, ["#071a56", "#173f9e", "#327ee3", "#b2e0ff"], { macroFrequency: 1.8, regionalFrequency: 7.5, roughness: 0.46 }),
    atmosphere: { ...earthAtmosphere, atmosphereRadius: 1.045, rayleighScattering: [0.15, 0.44, 1.45], rayleighScaleHeight: 0.31, mieScattering: 0.72, mieAbsorption: 0.12, mieScaleHeight: 0.16, mieAnisotropy: 0.72, exposure: 0.91 },
    clouds: { radius: 1.012, color: "#d9f4ff", coverage: 0.3, opacity: 0.42, scale: 6.4, speedA: 0.027, speedB: -0.017, shadowStrength: 0.1 },
  },
  pluto: {
    id: "pluto",
    surface: rocky(109, ["#372e32", "#6e5555", "#b5b9b4", "#ede0ce"], {
      mode: "ice",
      macroFrequency: 1.55,
      regionalFrequency: 6.2,
      microFrequency: 31,
      displacement: 0.022,
      normalStrength: 0.18,
      roughness: 0.66,
      polarIce: 0.58,
    }),
    atmosphere: { ...earthAtmosphere, atmosphereRadius: 1.014, rayleighScattering: [0.22, 0.54, 0.92], rayleighScaleHeight: 0.1, mieScattering: 0.22, mieAbsorption: 0.06, mieScaleHeight: 0.04, mieAnisotropy: 0.48, exposure: 0.78 },
  },
};

export function resolveAtlasQuality(requested: AtlasQuality): ResolvedAtlasQuality {
  if (requested !== "auto") return requested;
  if (typeof navigator === "undefined") return "medium";
  const memory = "deviceMemory" in navigator ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0) : 0;
  if (navigator.hardwareConcurrency <= 2 || (memory > 0 && memory <= 2)) return "low";
  if (navigator.hardwareConcurrency >= 12 && window.devicePixelRatio <= 2) return "high";
  return "medium";
}

export function atlasNoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19);
  const x1 = Math.sin(x * 269.5 - y * 183.3 + z * 246.1 + seed * 7.13);
  return (x0 + x1) * 0.5;
}

export function proceduralSurfaceHeight(x: number, y: number, z: number, profile: PlanetSurfaceProfile): number {
  const broad = atlasNoise3(x * profile.macroFrequency, y * profile.macroFrequency, z * profile.macroFrequency, profile.seed);
  const regional = atlasNoise3(x * profile.regionalFrequency, y * profile.regionalFrequency, z * profile.regionalFrequency, profile.seed * 1.7);
  const detail = atlasNoise3(x * profile.microFrequency, y * profile.microFrequency, z * profile.microFrequency, profile.seed * 2.9);
  const bandModifier = profile.mode === "banded" ? Math.sin(y * 21 + regional * 2.3) * 0.16 : 0;
  return (broad * 0.72 + regional * 0.22 + detail * 0.06 + bandModifier) * profile.displacement;
}
