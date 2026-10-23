"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createAtlasPlanetMaterials, type AtlasPlanetMaterials } from "./atlas/planetMaterials";
import { ATLAS_QUALITY_PROFILES, PLANET_VISUAL_PROFILES, proceduralSurfaceHeight, resolveAtlasQuality, type AtlasQuality, type AtlasQualityProfile, type PlanetVisualProfile, type ResolvedAtlasQuality } from "./atlas/planetVisualProfiles";
import { altAzToWorld, clipAltAzSegmentToHorizon, fitObserverSky, observerDirection, observerFieldOfView, observerLightNotice, magnitudeToOpacity, magnitudeToPointSize } from "@/lib/atlas/constellations";
import { bindObserverControls } from "./atlas/observerControls";
import { AtlasCameraTransition } from "./atlas/cameraTransition";
import { addObserverBackdrop } from "./atlas/observerBackdrop";
import observerStyles from "./atlas/observerView.module.css";
import type { ConstellationSkyResponse } from "@/lib/science/contracts";

type Planet = {
  id: string;
  name: string;
  kind: "rochosos" | "gigantes gasosos" | "gigantes de gelo" | "planeta anão";
  color: string;
  accent: string;
  radiusKm: string;
  gravity: string;
  pressure: string;
  temperature: string;
  atmosphere: string;
  rotation: string;
  sunDistance: string;
  terrain: string;
  surfaceTitle: string;
  surfaceCopy: string;
  source: string;
  sourceUrl: string;
  conditions: string;
  hazards: string[];
  hasSurface: boolean;
  rings?: boolean;
  classification?: string;
};

const PLANETS: Planet[] = [
  { id: "mercury", name: "Mercúrio", kind: "rochosos", color: "#9a8775", accent: "#dcc8ac", radiusKm: "2.440 km", gravity: "3,70 m/s²", pressure: "exosfera · quase vácuo", temperature: "−180 a 430 °C", atmosphere: "exosfera: O, Na, H, He, K", rotation: "58,6 dias terrestres", sunDistance: "0,39 UA", terrain: "cratered", surfaceTitle: "Regolito, escarpas e bacias de impacto", surfaceCopy: "Não há atmosfera densa para redistribuir calor. A iluminação direta e as sombras permanentes criam um ambiente de contraste extremo.", source: "NASA Science · Mercury Facts", sourceUrl: "https://science.nasa.gov/mercury/facts/", conditions: "Extremos de dia e noite na superfície; pressão de superfície não é definida para a exosfera.", hazards: ["radiação solar intensa", "choque térmico extremo", "poeira e crateras"], hasSurface: true },
  { id: "venus", name: "Vênus", kind: "rochosos", color: "#d7a05d", accent: "#ffe0a2", radiusKm: "6.052 km", gravity: "8,87 m/s²", pressure: "≈ 93 bar", temperature: "≈ 467 °C", atmosphere: "CO₂ 96,5% · N₂ 3,5%", rotation: "243 dias · retrógrada", sunDistance: "0,72 UA", terrain: "volcanic", surfaceTitle: "Planícies vulcânicas sob nuvens opacas", surfaceCopy: "A superfície está sob uma atmosfera de CO₂ extremamente densa. A vista é uma interpretação do solo mapeado por radar; a luz visível não atravessa as nuvens permanentemente.", source: "NASA Science · Venus Facts", sourceUrl: "https://science.nasa.gov/venus/venus-facts/", conditions: "Temperatura e pressão na superfície; pressão comparável a cerca de 930 m sob a água na Terra.", hazards: ["calor que derrete chumbo", "pressão esmagadora", "CO₂ e ácido sulfúrico nas nuvens"], hasSurface: true },
  { id: "earth", name: "Terra", kind: "rochosos", color: "#3a82bf", accent: "#98dcff", radiusKm: "6.371 km", gravity: "9,81 m/s²", pressure: "1,013 bar ao nível do mar", temperature: "média global ≈ 15 °C", atmosphere: "N₂ 78% · O₂ 21%", rotation: "23 h 56 min", sunDistance: "1,00 UA", terrain: "earth", surfaceTitle: "Oceano, rocha e uma atmosfera dinâmica", surfaceCopy: "É o único planeta conhecido com água líquida estável em abundância na superfície e vida confirmada. As condições locais variam intensamente por latitude, altitude e clima.", source: "NASA Science · Earth Facts", sourceUrl: "https://science.nasa.gov/earth/facts/", conditions: "Pressão padrão ao nível médio do mar; temperatura média global de referência.", hazards: ["clima severo regional", "oceanos profundos", "vulcanismo e sismos"], hasSurface: true },
  { id: "mars", name: "Marte", kind: "rochosos", color: "#bd5a3d", accent: "#ffc08c", radiusKm: "3.390 km", gravity: "3,71 m/s²", pressure: "≈ 0,006 bar (≈ 600 Pa)", temperature: "média ≈ −63 °C", atmosphere: "CO₂ 95% · N₂ · Ar", rotation: "24 h 37 min", sunDistance: "1,52 UA", terrain: "mars", surfaceTitle: "Desertos frios, poeira e vulcões gigantes", surfaceCopy: "A baixa pressão não permite água líquida estável na maior parte do terreno atual. O solo marciano registra crateras, dunas, rochas e antigos canais.", source: "NASA Science · Mars Facts", sourceUrl: "https://science.nasa.gov/mars/facts/", conditions: "Média global aproximada; a superfície pode variar de cerca de −153 a 20 °C.", hazards: ["ar rarefeito irrespirável", "poeira abrasiva", "frio e radiação"], hasSurface: true },
  { id: "jupiter", name: "Júpiter", kind: "gigantes gasosos", color: "#c78b60", accent: "#ffe0a8", radiusKm: "69.911 km", gravity: "24,79 m/s²", pressure: "2 bar · nível de referência", temperature: "≈ −108 °C (165 K)", atmosphere: "H₂ ≈ 75% · He ≈ 24%", rotation: "≈ 9 h 56 min", sunDistance: "5,20 UA", terrain: "jupiter", surfaceTitle: "Topo de nuvens: não existe solo para pouso", surfaceCopy: "Júpiter é um gigante gasoso. A experiência leva ao topo de nuvens; pressão e temperatura crescem para valores destrutivos com a profundidade.", source: "NASA RTG environment table · Jupiter", sourceUrl: "https://science.nasa.gov/wp-content/uploads/2024/02/rtg-study-d-99657-final-report-june-2017-export-marking-updated1.pdf", conditions: "Referência de 2 bar do relatório NASA RTG; não é pressão de uma superfície.", hazards: ["sem solo", "ventos até 539 km/h", "pressão e calor crescentes"], hasSurface: false },
  { id: "saturn", name: "Saturno", kind: "gigantes gasosos", color: "#d5bb83", accent: "#fff1c1", radiusKm: "58.232 km", gravity: "10,44 m/s²", pressure: "2 bar · nível de referência", temperature: "≈ −139 °C (134 K)", atmosphere: "H₂ ≈ 75% · He ≈ 24%", rotation: "≈ 10 h 33 min", sunDistance: "9,58 UA", terrain: "saturn", surfaceTitle: "Nuvens pálidas sob o sistema de anéis", surfaceCopy: "A superfície visível é uma camada de nuvens. Os anéis são vastos discos de partículas de gelo e rocha, muito finos em relação à largura.", source: "NASA RTG environment table · Saturn", sourceUrl: "https://science.nasa.gov/wp-content/uploads/2024/02/rtg-study-d-99657-final-report-june-2017-export-marking-updated1.pdf", conditions: "Referência de 2 bar do relatório NASA RTG; Saturno não possui superfície sólida.", hazards: ["sem solo", "jatos até 500 m/s", "pressão que liquefaz gases"], hasSurface: false, rings: true },
  { id: "uranus", name: "Urano", kind: "gigantes de gelo", color: "#80c6cf", accent: "#d5ffff", radiusKm: "25.362 km", gravity: "8,69 m/s²", pressure: "1 bar · nível de referência", temperature: "≈ −197 °C (76 K)", atmosphere: "H₂ · He · CH₄", rotation: "≈ 17 h 14 min", sunDistance: "19,2 UA", terrain: "uranus", surfaceTitle: "Um gigante de gelo inclinado de lado", surfaceCopy: "Metano na atmosfera absorve luz vermelha e dá ao planeta seu tom azul-esverdeado. A atmosfera transita para fluidos comprimidos, sem um solo definido.", source: "NASA RTG environment table · Urano", sourceUrl: "https://science.nasa.gov/wp-content/uploads/2024/02/rtg-study-d-99657-final-report-june-2017-export-marking-updated1.pdf", conditions: "Referência de 1 bar do relatório NASA RTG; a atmosfera pode atingir mínimo de −224 °C.", hazards: ["sem solo", "mínimos de −224 °C", "ventos até 900 km/h"], hasSurface: false },
  { id: "neptune", name: "Netuno", kind: "gigantes de gelo", color: "#326bc8", accent: "#a4d6ff", radiusKm: "24.622 km", gravity: "11,15 m/s²", pressure: "1 bar · nível de referência", temperature: "≈ −201 °C (72 K)", atmosphere: "H₂ · He · CH₄", rotation: "≈ 16 h 6 min", sunDistance: "30,1 UA", terrain: "neptune", surfaceTitle: "Nuvens azul-profundo e ventos extremos", surfaceCopy: "Netuno não possui uma superfície sólida acessível. A cor resulta, em parte, do metano atmosférico; seus ventos estão entre os mais velozes do Sistema Solar.", source: "NASA RTG environment table · Netuno", sourceUrl: "https://science.nasa.gov/wp-content/uploads/2024/02/rtg-study-d-99657-final-report-june-2017-export-marking-updated1.pdf", conditions: "Referência de 1 bar do relatório NASA RTG; não é uma superfície sólida.", hazards: ["sem solo", "ventos acima de 2.000 km/h", "frio intenso e alta pressão"], hasSurface: false },
  { id: "pluto", name: "Plutão", kind: "planeta anão", color: "#a78274", accent: "#f0d6bf", radiusKm: "1.188 km", gravity: "0,62 m/s²", pressure: "≈ 1 Pa (≈ 10 µbar)", temperature: "média ≈ −232 °C", atmosphere: "N₂ · CH₄ · CO, muito tênue", rotation: "6,39 dias terrestres", sunDistance: "39,5 UA", terrain: "pluto", surfaceTitle: "Geleiras de nitrogênio, montanhas de gelo d'água e planícies", surfaceCopy: "O solo observado pela New Horizons mistura gelo de nitrogênio e metano com blocos de gelo d'água. A atmosfera fina pode congelar e cair de volta à superfície quando Plutão se afasta do Sol.", source: "NASA Science · Pluto Facts", sourceUrl: "https://science.nasa.gov/dwarf-planets/pluto/facts/", conditions: "Média aproximada; a superfície observada varia de cerca de −240 a −226 °C e a pressão varia com a órbita.", hazards: ["frio criogênico", "gravidade de 6% da Terra", "atmosfera que congela sazonalmente"], hasSurface: true, classification: "Em 2006, a IAU classificou Plutão como planeta anão: ele orbita o Sol e é quase redondo, mas não limpou a vizinhança da própria órbita no Cinturão de Kuiper. Não é uma perda de importância científica — é uma classificação orbital." },
];

const RENDER_REFERENCES: Record<string, { label: string; sourceUrl: string; description: string }> = {
  mercury: { label: "MESSENGER · crateras, escarpas e regolito", sourceUrl: "https://science.nasa.gov/photojournal/full-global-mercury-mosaic/", description: "O gerador enfatiza crateras de impacto, bordas elevadas e sombras duras, conforme os mosaicos da MESSENGER." },
  venus: { label: "Magellan · planícies vulcânicas e radar", sourceUrl: "https://science.nasa.gov/image-detail/venus-2/", description: "O modelo combina planícies basálticas, domos e neblina densa; a estrutura é guiada por características observadas no radar Magellan." },
  earth: { label: "NASA Earth Observatory · oceano, terreno e nuvens", sourceUrl: "https://science.nasa.gov/resource/blue-marble/", description: "O ambiente mistura oceano, costa, relevo e uma atmosfera azul úmida, sem usar uma imagem de fundo." },
  mars: { label: "Curiosity Mastcam · poeira, mesas e dunas", sourceUrl: "https://science.nasa.gov/photojournal/rovers-panorama-taken-amid-murray-buttes-on-mars/", description: "O gerador reproduz areia oxidada, dunas baixas, mesas erodidas e a névoa de poeira observadas por rovers." },
  jupiter: { label: "Voyager 2 · faixas e Grande Mancha Vermelha", sourceUrl: "https://science.nasa.gov/photojournal/jupiter/", description: "A camada de nuvens é um campo procedural de faixas, jatos e vórtices; não há uma superfície sólida representada." },
  saturn: { label: "Hubble/Cassini · faixas pálidas e névoa", sourceUrl: "https://science.nasa.gov/image-detail/hubble-saturn-visible-light/", description: "A renderização privilegia as bandas de baixo contraste, a névoa dourada e a sombra anelar, sem simular solo." },
  uranus: { label: "Voyager 2 · névoa azul-esverdeada", sourceUrl: "https://science.nasa.gov/photojournal/uranus/", description: "O aspecto quase uniforme e a calota polar são reproduzidos com nuvens muito suaves e névoa de metano." },
  neptune: { label: "Voyager 2 · nuvens altas e tempestades", sourceUrl: "https://science.nasa.gov/asset/webb/neptune-voyager-2/", description: "O topo atmosférico usa faixas azul-escuras, nuvens claras rápidas e um vórtice escuro, sem uma falsa superfície." },
  pluto: { label: "New Horizons · gelo de nitrogênio e montanhas", sourceUrl: "https://science.nasa.gov/photojournal/sputnik-planum-in-detail/", description: "O modelo constrói células de gelo, planícies claras e maciços de gelo d'água inspirados nos dados da New Horizons." },
};

type RenderStats = { calls: number; triangles: number; textures: number; frameMs: number };

export type EarthVisualLayers = {
  atmosphere: boolean;
  clouds: boolean;
  latitudeLongitudeGrid: boolean;
  observerMarker: boolean;
  atmosphereOpacity?: number;
  cloudsOpacity?: number;
  latitudeLongitudeGridOpacity?: number;
  observerMarkerOpacity?: number;
  observer?: { latitudeDeg: number; longitudeDeg: number };
};

/** The two side-by-side modes currently rendered by the single WebGL scene. */
export type AtlasComparisonMode = "none" | "real-size" | "visual-scale";
export type AtlasSceneView = "orbital" | "surface" | "observer";

export type ConstellationSkyLayers = {
  stars?: boolean;
  iauBoundaries?: boolean;
  selectedConstellation?: boolean;
  horizonGrid?: boolean;
  cardinalDirections?: boolean;
  culturalLines?: boolean;
};

const DEFAULT_CONSTELLATION_SKY_LAYERS: ConstellationSkyLayers = {};

export type PlanetSurfaceExplorerProps = {
  initialPlanetId?: string;
  onPlanetChange?: (planetId: string) => void;
  lockPlanet?: boolean;
  hideDetails?: boolean;
  earthVisualLayers?: EarthVisualLayers;
  requestedView?: AtlasSceneView;
  onViewChange?: (view: AtlasSceneView) => void;
  comparisonMode?: AtlasComparisonMode;
  /** Native AltAz values only; the renderer never derives them from RA/Dec. */
  constellationSky?: ConstellationSkyResponse;
  constellationSkyLayers?: ConstellationSkyLayers;
};

type SceneRuntime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  comparisonCamera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  root: THREE.Group;
  backgroundStars: THREE.Points;
  scientificSky: THREE.Group | null;
  observerActive: boolean;
  layers: THREE.Group | null;
  materialSet: AtlasPlanetMaterials | null;
  surfacePatch: THREE.Mesh | null;
  sun: THREE.DirectionalLight;
  cameraGoal: THREE.Vector3;
  cameraTransition: AtlasCameraTransition;
  targetGoal: THREE.Vector3;
  sunDirection: THREE.Vector3;
  minimumCameraRadius: number;
  elapsedSeconds: number;
  lastFrameTime: number;
  resize: (force?: boolean) => void;
};

const ORBIT_CAMERA = new THREE.Vector3(0, 0.3, 5.5);
const CLOSE_CAMERA = new THREE.Vector3(0, 0.18, 1.62);
const ORBIT_TARGET = new THREE.Vector3(0, 0, 0);
const CLOSE_TARGET = new THREE.Vector3(0, 0, 1.0);
const OBSERVER_CAMERA = new THREE.Vector3(0, 0, 0);
const OBSERVER_TARGET = new THREE.Vector3(0, 0, 1);
const QUALITY_ORDER: AtlasQuality[] = ["auto", "low", "medium", "high"];

function deterministicRandom(index: number, salt: number): number {
  return (Math.sin(index * 127.1 + salt * 311.7) + 1) * 0.5;
}

function starfield() {
  const positions = new Float32Array(1800 * 3);
  for (let index = 0; index < 1800; index += 1) {
    const radius = 32 + deterministicRandom(index, 1) * 60;
    const theta = deterministicRandom(index, 2) * Math.PI * 2;
    const z = deterministicRandom(index, 3) * 2 - 1;
    const around = Math.sqrt(1 - z * z);
    positions[index * 3] = radius * around * Math.cos(theta);
    positions[index * 3 + 1] = radius * z;
    positions[index * 3 + 2] = radius * around * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: "#dce8ff", size: 0.045, transparent: true, opacity: 0.82 }));
}

function createPlanetGeometry(profile: PlanetVisualProfile, quality: AtlasQualityProfile, useEllipsoidFallback = false): THREE.SphereGeometry {
  const geometry = new THREE.SphereGeometry(1, quality.sphereWidthSegments, quality.sphereHeightSegments);
  if (profile.surface.mode === "banded" || useEllipsoidFallback) return geometry;
  const positions = geometry.attributes.position;
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index).normalize();
    const height = proceduralSurfaceHeight(point.x, point.y, point.z, profile.surface);
    positions.setXYZ(index, point.x * (1 + height), point.y * (1 + height), point.z * (1 + height));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function createSurfacePatch(profile: PlanetVisualProfile, quality: AtlasQualityProfile, useEllipsoidFallback = false): THREE.BufferGeometry {
  const size = 1.08;
  const geometry = new THREE.PlaneGeometry(size, size, quality.surfacePatchSegments, quality.surfacePatchSegments);
  const positions = geometry.attributes.position;
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 1) {
    point.set(positions.getX(index), positions.getY(index), 1).normalize();
    const height = useEllipsoidFallback ? 0 : proceduralSurfaceHeight(point.x, point.y, point.z, profile.surface);
    positions.setXYZ(index, point.x * (1 + height + 0.0015), point.y * (1 + height + 0.0015), point.z * (1 + height + 0.0015));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

function addRings(group: THREE.Group) {
  const geometry = new THREE.RingGeometry(1.45, 2.5, 128, 2);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  const color = new THREE.Color("#e8d4a0");
  for (let index = 0; index < geometry.attributes.position.count; index += 1) {
    const brightness = 0.35 + deterministicRandom(index, 8) * 0.65;
    colors.set([color.r * brightness, color.g * brightness, color.b * brightness], index * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const rings = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.7, depthWrite: false }));
  rings.rotation.x = Math.PI * 0.48;
  group.add(rings);
}

function addEarthReferenceLayers(group: THREE.Group) {
  const points: number[] = [];
  const radius = 1.027;
  for (let latitude = -75; latitude <= 75; latitude += 15) {
    const lat = THREE.MathUtils.degToRad(latitude);
    for (let longitude = -180; longitude < 180; longitude += 4) {
      const lon = THREE.MathUtils.degToRad(longitude);
      const nextLon = THREE.MathUtils.degToRad(longitude + 4);
      points.push(
        radius * Math.cos(lat) * Math.cos(lon), radius * Math.sin(lat), radius * Math.cos(lat) * Math.sin(lon),
        radius * Math.cos(lat) * Math.cos(nextLon), radius * Math.sin(lat), radius * Math.cos(lat) * Math.sin(nextLon),
      );
    }
  }
  for (let longitude = -180; longitude < 180; longitude += 15) {
    const lon = THREE.MathUtils.degToRad(longitude);
    for (let latitude = -90; latitude < 90; latitude += 4) {
      const lat = THREE.MathUtils.degToRad(latitude);
      const nextLat = THREE.MathUtils.degToRad(latitude + 4);
      points.push(
        radius * Math.cos(lat) * Math.cos(lon), radius * Math.sin(lat), radius * Math.cos(lat) * Math.sin(lon),
        radius * Math.cos(nextLat) * Math.cos(lon), radius * Math.sin(nextLat), radius * Math.cos(nextLat) * Math.sin(lon),
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  const grid = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#8ac6ea", transparent: true, opacity: 0.34, depthWrite: false }));
  grid.name = "earth-latitude-longitude-grid";
  grid.renderOrder = 9;
  group.add(grid);

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.026, 16, 12),
    new THREE.MeshBasicMaterial({ color: "#ffe5a1", transparent: true, opacity: 0.95 }),
  );
  marker.name = "earth-observer-marker";
  marker.renderOrder = 10;
  group.add(marker);
}

function addObserverReference(group: THREE.Group, layers: ConstellationSkyLayers) {
  const radius = 14;
  if (layers.horizonGrid !== false) {
    const grid: number[] = [];
    for (let azimuth = 0; azimuth < 360; azimuth += 3) {
      const current = altAzToWorld({ altitude_deg: 0, azimuth_deg: azimuth }, radius);
      const next = altAzToWorld({ altitude_deg: 0, azimuth_deg: azimuth + 3 }, radius);
      grid.push(...current, ...next);
    }
    for (const altitude of [30, 60]) {
      for (let azimuth = 0; azimuth < 360; azimuth += 6) {
        grid.push(...altAzToWorld({ altitude_deg: altitude, azimuth_deg: azimuth }, radius), ...altAzToWorld({ altitude_deg: altitude, azimuth_deg: azimuth + 6 }, radius));
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(grid, 3));
    const horizon = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#2d5d78", transparent: true, opacity: 0.46, depthWrite: false }));
    horizon.name = "sky-horizon-grid";
    group.add(horizon);
  }
  if (layers.cardinalDirections !== false) {
    const ticks: number[] = [];
    for (const azimuth of [0, 90, 180, 270]) {
      ticks.push(...altAzToWorld({ altitude_deg: 0, azimuth_deg: azimuth }, radius), ...altAzToWorld({ altitude_deg: 7, azimuth_deg: azimuth }, radius));
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(ticks, 3));
    const directions = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#f4cc7e", transparent: true, opacity: 0.92, depthWrite: false }));
    directions.name = "sky-cardinal-directions";
    group.add(directions);
  }
}

function addScientificStars(group: THREE.Group, sky: ConstellationSkyResponse, layers: ConstellationSkyLayers, pixelRatio: number) {
  if (layers.stars === false) return;
  const visible = sky.stars.filter((star) => star.above_horizon);
  if (!visible.length) return;
  const positions = new Float32Array(visible.length * 3);
  const colors = new Float32Array(visible.length * 3);
  const sizes = new Float32Array(visible.length);
  const opacities = new Float32Array(visible.length);
  const color = new THREE.Color("#d8ecff");
  visible.forEach((star, index) => {
    positions.set(altAzToWorld(star, 14.1), index * 3);
    colors.set([color.r, color.g, color.b], index * 3);
    sizes[index] = magnitudeToPointSize(star.g_mag) * pixelRatio * 1.3;
    opacities[index] = Math.max(.65, magnitudeToOpacity(star.g_mag));
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aOpacity", new THREE.BufferAttribute(opacities, 1));
  const material = new THREE.ShaderMaterial({
    // Enables Three's color attribute declaration used by the vertex shader.
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    vertexShader: "attribute float aSize; attribute float aOpacity; varying vec3 vColor; varying float vOpacity; void main(){ vColor=color; vOpacity=aOpacity; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_PointSize=aSize; }",
    fragmentShader: "varying vec3 vColor; varying float vOpacity; void main(){ float d=length(gl_PointCoord-vec2(0.5)); if(d>0.5) discard; float core=1.0-smoothstep(0.06,0.25,d); float glow=(1.0-smoothstep(0.15,0.5,d))*0.45; gl_FragColor=vec4(mix(vColor,vec3(1.0),core),vOpacity*max(core,glow)); }",
  });
  const points = new THREE.Points(geometry, material);
  points.name = "sky-gaia-stars";
  group.add(points);
}

function addScientificBoundaries(group: THREE.Group, sky: ConstellationSkyResponse, layers: ConstellationSkyLayers) {
  if (layers.iauBoundaries === false || layers.selectedConstellation === false) return;
  const positions: number[] = [];
  for (const boundary of sky.boundaries) {
    const segment = clipAltAzSegmentToHorizon(boundary.start, boundary.end);
    if (segment) positions.push(...altAzToWorld(segment[0], 14), ...altAzToWorld(segment[1], 14));
  }
  if (!positions.length) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const boundary = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: "#74c8ff", transparent: true, opacity: 0.32, depthWrite: false }));
  boundary.name = "sky-iau-boundaries sky-selected-constellation";
  group.add(boundary);
}

function buildScientificSky(sky: ConstellationSkyResponse, layers: ConstellationSkyLayers, pixelRatio: number) {
  const group = new THREE.Group();
  group.name = "scientific-constellation-observer";
  // AltAz's east/north convention is left-handed; a camera with +Y up needs
  // this display reflection for east to appear on the right when facing north.
  group.scale.x = -1;
  addObserverBackdrop(group, sky.sun.altitude_deg, layers.cardinalDirections !== false);
  addObserverReference(group, layers);
  addScientificStars(group, sky, layers, pixelRatio);
  addScientificBoundaries(group, sky, layers);
  // Cultural line drawings are intentionally not created, even if a caller
  // requests them. This preserves the declared disabled/missing data state.
  return group;
}

function applyScientificSkyLayers(group: THREE.Group | null, layers: ConstellationSkyLayers) {
  group?.traverse((part) => {
    if (part.name === "sky-gaia-stars") part.visible = layers.stars !== false;
    if (part.name === "sky-iau-boundaries sky-selected-constellation") part.visible = layers.iauBoundaries !== false && layers.selectedConstellation !== false;
    if (part.name === "sky-horizon-grid") part.visible = layers.horizonGrid !== false;
    if (part.name === "sky-cardinal-directions" || part.name === "observer-cardinal-label") part.visible = layers.cardinalDirections !== false;
  });
}

function applyEarthVisualLayers(runtime: SceneRuntime, layers: EarthVisualLayers | undefined) {
  const sceneLayers = runtime.layers;
  if (!sceneLayers || !layers) return;
  const atmosphere = sceneLayers.getObjectByName("earth-atmosphere");
  const grid = sceneLayers.getObjectByName("earth-latitude-longitude-grid");
  const marker = sceneLayers.getObjectByName("earth-observer-marker");
  const opacity = (object: THREE.Object3D | undefined, value: number | undefined) => object?.traverse((part) => {
    if (!(part instanceof THREE.Mesh || part instanceof THREE.LineSegments)) return;
    const materials = Array.isArray(part.material) ? part.material : [part.material];
    materials.forEach((material) => {
      const base = typeof material.userData.orbitalBaseOpacity === "number" ? material.userData.orbitalBaseOpacity : material.opacity;
      material.userData.orbitalBaseOpacity = base;
      if (material instanceof THREE.ShaderMaterial && material.uniforms.uLayerOpacity) {
        material.uniforms.uLayerOpacity.value = value ?? 1;
      } else {
        const transparent = base < 1 || (value ?? 1) < 1;
        if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
        material.opacity = base * (value ?? 1);
      }
    });
  });
  atmosphere?.traverse((part) => { part.visible = layers.atmosphere; });
  opacity(atmosphere, layers.atmosphereOpacity);
  sceneLayers.children.filter((part) => part.name.startsWith("earth-cloud-")).forEach((cloud) => { cloud.visible = layers.clouds; opacity(cloud, layers.cloudsOpacity); });
  if (grid) { grid.visible = layers.latitudeLongitudeGrid; opacity(grid, layers.latitudeLongitudeGridOpacity); }
  if (marker) {
    marker.visible = layers.observerMarker && Boolean(layers.observer);
    opacity(marker, layers.observerMarkerOpacity);
    if (layers.observer) {
      const latitude = THREE.MathUtils.degToRad(layers.observer.latitudeDeg);
      const longitude = THREE.MathUtils.degToRad(layers.observer.longitudeDeg);
      const radius = 1.055;
      marker.position.set(
        radius * Math.cos(latitude) * Math.cos(longitude),
        radius * Math.sin(latitude),
        radius * Math.cos(latitude) * Math.sin(longitude),
      );
    }
  }
}

function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((part) => {
    if (part instanceof THREE.Sprite && part.name === "observer-cardinal-label") {
      part.material.map?.dispose();
      materials.add(part.material);
    }
    if (part instanceof THREE.Mesh || part instanceof THREE.Line || part instanceof THREE.Points) {
      geometries.add(part.geometry);
      const partMaterials = Array.isArray(part.material) ? part.material : [part.material];
      partMaterials.forEach((material) => materials.add(material));
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function clearPlanetLayers(runtime: SceneRuntime) {
  if (!runtime.layers) return;
  runtime.root.remove(runtime.layers);
  disposeObject(runtime.layers);
  runtime.layers = null;
  runtime.materialSet = null;
  runtime.surfacePatch = null;
}

function clearScientificSky(runtime: SceneRuntime) {
  if (!runtime.scientificSky) return;
  runtime.scene.remove(runtime.scientificSky);
  disposeObject(runtime.scientificSky);
  runtime.scientificSky = null;
}

function configureCameraGoal(runtime: SceneRuntime, view: AtlasSceneView) {
  const observer = view === "observer";
  runtime.observerActive = observer;
  runtime.controls.enabled = !observer;
  runtime.camera.fov = observer ? 85 : 42;
  runtime.camera.updateProjectionMatrix();
  const close = view === "surface";
  runtime.cameraGoal.copy(observer ? OBSERVER_CAMERA : close ? CLOSE_CAMERA : ORBIT_CAMERA);
  runtime.targetGoal.copy(observer ? OBSERVER_TARGET : close ? CLOSE_TARGET : ORBIT_TARGET);
  if (observer) runtime.cameraTransition.cancel();
  else runtime.cameraTransition.start(runtime.cameraGoal, runtime.targetGoal);
  runtime.controls.minDistance = observer ? 0.1 : close ? 0.16 : 1.45;
  runtime.controls.maxDistance = observer ? 25 : close ? 4.5 : 10;
  runtime.controls.enableRotate = true;
  runtime.controls.enableZoom = true;
  runtime.minimumCameraRadius = observer ? 0 : close ? 1.001 : 1.15;
  runtime.root.visible = !observer;
  runtime.backgroundStars.visible = !observer;
  if (runtime.surfacePatch) runtime.surfacePatch.visible = close && !observer;
}

function buildPlanetLayers(runtime: SceneRuntime, planet: Planet, profile: PlanetVisualProfile, quality: AtlasQualityProfile, view: AtlasSceneView, includeEarthReferenceLayers: boolean) {
  clearPlanetLayers(runtime);
  const layers = new THREE.Group();
  const materials = createAtlasPlanetMaterials(profile, quality);
  const usesEllipsoidFallback = planet.id === "earth";
  const globe = new THREE.Mesh(createPlanetGeometry(profile, quality, usesEllipsoidFallback), materials.surface);
  layers.add(globe);

  if (materials.ocean && profile.ocean) {
    const ocean = new THREE.Mesh(new THREE.SphereGeometry(profile.ocean.radius, quality.sphereWidthSegments, quality.sphereHeightSegments), materials.ocean);
    ocean.renderOrder = 1;
    layers.add(ocean);
  }

  const cloudRadius = profile.clouds?.radius;
  if (cloudRadius && materials.clouds.length > 0) {
    const cloudGeometry = new THREE.SphereGeometry(cloudRadius, quality.sphereWidthSegments, quality.sphereHeightSegments);
    materials.clouds.forEach((material, index) => {
      const clouds = new THREE.Mesh(cloudGeometry, material);
      if (planet.id === "earth") clouds.name = `earth-cloud-${index}`;
      clouds.renderOrder = 2 + index;
      layers.add(clouds);
    });
  }

  if (materials.atmosphere && profile.atmosphere) {
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(profile.atmosphere.atmosphereRadius, quality.sphereWidthSegments, quality.sphereHeightSegments), materials.atmosphere);
    if (planet.id === "earth") atmosphere.name = "earth-atmosphere";
    atmosphere.renderOrder = 8;
    layers.add(atmosphere);
  }

  let surfacePatch: THREE.Mesh | null = null;
  if (planet.hasSurface && quality.surfacePatchSegments > 120) {
    surfacePatch = new THREE.Mesh(createSurfacePatch(profile, quality, usesEllipsoidFallback), materials.surface);
    surfacePatch.visible = view === "surface";
    surfacePatch.renderOrder = 5;
    layers.add(surfacePatch);
  }

  if (planet.rings) addRings(layers);
  if (planet.id === "earth" && includeEarthReferenceLayers) addEarthReferenceLayers(layers);
  runtime.root.rotation.set(0, 0, profile.axialTilt ?? 0);
  runtime.root.add(layers);
  runtime.layers = layers;
  runtime.materialSet = materials;
  runtime.surfacePatch = surfacePatch;
}

export default function PlanetSurfaceExplorer({ initialPlanetId = "mars", onPlanetChange, lockPlanet = false, hideDetails = false, earthVisualLayers, requestedView, onViewChange, comparisonMode = "none", constellationSky, constellationSkyLayers = DEFAULT_CONSTELLATION_SKY_LAYERS }: PlanetSurfaceExplorerProps) {
  const mount = useRef<HTMLDivElement>(null);
  const runtime = useRef<SceneRuntime | null>(null);
  const earthVisualLayersRef = useRef<EarthVisualLayers | undefined>(earthVisualLayers);
  const comparisonModeRef = useRef<AtlasComparisonMode>(comparisonMode);
  const [selectedId, setSelectedId] = useState(() => PLANETS.some((planet) => planet.id === initialPlanetId) ? initialPlanetId : "mars");
  const [view, setView] = useState<AtlasSceneView>(requestedView ?? "orbital");
  const viewRef = useRef(view);
  const [quality, setQuality] = useState<AtlasQuality>("auto");
  const [autoQuality, setAutoQuality] = useState<ResolvedAtlasQuality>("medium");
  const [renderStats, setRenderStats] = useState<RenderStats | null>(null);
  const selected = useMemo(() => PLANETS.find((planet) => planet.id === selectedId)!, [selectedId]);
  const resolvedQuality = quality === "auto" ? autoQuality : quality;
  const qualityProfile = ATLAS_QUALITY_PROFILES[resolvedQuality];
  const visualProfile = PLANET_VISUAL_PROFILES[selected.id];
  const hasEarthReferenceLayers = earthVisualLayers !== undefined;

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("planet");
    if (!requested || !PLANETS.some((planet) => planet.id === requested)) return;
    const frame = window.requestAnimationFrame(() => setSelectedId(requested));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!PLANETS.some((planet) => planet.id === initialPlanetId) || initialPlanetId === selectedId) return;
    const frame = window.requestAnimationFrame(() => setSelectedId(initialPlanetId));
    return () => window.cancelAnimationFrame(frame);
  }, [initialPlanetId, selectedId]);

  useEffect(() => {
    if (quality !== "auto") return;
    const frame = window.requestAnimationFrame(() => setAutoQuality(resolveAtlasQuality("auto")));
    return () => window.cancelAnimationFrame(frame);
  }, [quality]);

  useEffect(() => {
    if (!requestedView) return;
    const frame = window.requestAnimationFrame(() => setView(requestedView));
    return () => window.cancelAnimationFrame(frame);
  }, [requestedView]);

  useEffect(() => { comparisonModeRef.current = comparisonMode; }, [comparisonMode]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#020302");
    scene.fog = new THREE.FogExp2("#020302", 0.018);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
    camera.position.copy(ORBIT_CAMERA);
    const comparisonCamera = new THREE.PerspectiveCamera(42, 1, 0.01, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.domElement.className = "atlas-webgl";
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "Visor 3D. No céu local: arraste ou use as setas para mirar, mais e menos para zoom.");
    host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.enablePan = false;
    controls.minDistance = 1.45;
    controls.maxDistance = 10;
    controls.target.copy(ORBIT_TARGET);
    scene.add(new THREE.HemisphereLight("#9bc8f0", "#07090b", 0.16));
    scene.add(new THREE.AmbientLight("#132442", 0.055));
    const sun = new THREE.DirectionalLight("#ffe2ab", 3.8);
    sun.position.set(-4, 3, 5);
    scene.add(sun);
    const root = new THREE.Group();
    scene.add(root);
    const stars = starfield();
    scene.add(stars);
    let renderedWidth = 0;
    let renderedHeight = 0;
    const resize = (force = false) => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      const nextWidth = Math.round(width);
      const nextHeight = Math.round(height);
      if (!force && nextWidth === renderedWidth && nextHeight === renderedHeight) return;
      renderedWidth = nextWidth;
      renderedHeight = nextHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      comparisonCamera.aspect = width / height;
      comparisonCamera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight, false);
    };
    const sceneRuntime: SceneRuntime = {
      scene,
      camera,
      comparisonCamera,
      renderer,
      controls,
      root,
      backgroundStars: stars,
      scientificSky: null,
      observerActive: false,
      layers: null,
      materialSet: null,
      surfacePatch: null,
      sun,
      cameraGoal: ORBIT_CAMERA.clone(),
      cameraTransition: new AtlasCameraTransition(),
      targetGoal: ORBIT_TARGET.clone(),
      sunDirection: new THREE.Vector3(),
      minimumCameraRadius: 1.15,
      elapsedSeconds: 0,
      lastFrameTime: performance.now(),
      resize,
    };
    runtime.current = sceneRuntime;
    const interruptCameraTransition = () => sceneRuntime.cameraTransition.cancel();
    controls.addEventListener("start", interruptCameraTransition);
    const releaseObserverControls = bindObserverControls(renderer.domElement, camera, sceneRuntime.targetGoal, () => sceneRuntime.observerActive);
    let animationFrame = 0;
    let resizeFrame = 0;
    let disposed = false;
    let lastStatsUpdate = 0;
    let sampledFrameTime = 0;
    let sampledFrames = 0;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionQuery.matches;
    const onMotionPreferenceChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      controls.enableDamping = !reduceMotion;
    };
    motionQuery.addEventListener("change", onMotionPreferenceChange);
    controls.enableDamping = !reduceMotion;
    const exposeDebugStats = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const scheduleRender = () => {
      if (!disposed && !document.hidden && animationFrame === 0) animationFrame = window.requestAnimationFrame(render);
    };
    const render = () => {
      animationFrame = 0;
      const now = performance.now();
      const frameMs = now - sceneRuntime.lastFrameTime;
      const delta = Math.min(frameMs / 1000, 0.1);
      sceneRuntime.lastFrameTime = now;
      sceneRuntime.elapsedSeconds += reduceMotion ? 0 : delta;
      const elapsed = sceneRuntime.elapsedSeconds;
      sampledFrameTime += frameMs;
      sampledFrames += 1;
      if (sceneRuntime.observerActive) {
        camera.position.set(0, 0, 0);
        camera.lookAt(sceneRuntime.targetGoal);
      } else {
        sceneRuntime.cameraTransition.update(camera.position, controls.target, delta, reduceMotion);
        controls.dampingFactor = 1 - Math.pow(1 - 0.055, delta * 60);
        controls.update();
      }
      if (camera.position.length() < sceneRuntime.minimumCameraRadius) camera.position.setLength(sceneRuntime.minimumCameraRadius);
      sceneRuntime.sunDirection.copy(sun.position).normalize();
      sceneRuntime.materialSet?.update(elapsed, camera.position, sceneRuntime.sunDirection);
      const comparison = comparisonModeRef.current;
      if (comparison === "none") {
        renderer.render(scene, camera);
      } else {
        const viewportWidth = Math.max(1, Math.floor(renderedWidth / 2));
        const viewportHeight = Math.max(1, renderedHeight);
        const fullAspect = camera.aspect;
        camera.aspect = viewportWidth / viewportHeight;
        camera.updateProjectionMatrix();
        renderer.setScissorTest(true);
        renderer.setViewport(0, 0, viewportWidth, viewportHeight);
        renderer.setScissor(0, 0, viewportWidth, viewportHeight);
        renderer.render(scene, camera);

        root.scale.setScalar(comparison === "visual-scale" ? 1.28 : 1);
        comparisonCamera.position.copy(camera.position).multiplyScalar(comparison === "real-size" ? 1.22 : 1);
        comparisonCamera.lookAt(controls.target);
        comparisonCamera.aspect = viewportWidth / viewportHeight;
        comparisonCamera.updateProjectionMatrix();
        renderer.setViewport(viewportWidth, 0, renderedWidth - viewportWidth, viewportHeight);
        renderer.setScissor(viewportWidth, 0, renderedWidth - viewportWidth, viewportHeight);
        renderer.render(scene, comparisonCamera);
        root.scale.setScalar(1);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, renderedWidth, renderedHeight);
        camera.aspect = fullAspect;
        camera.updateProjectionMatrix();
      }
      if (exposeDebugStats && now - lastStatsUpdate > 1_000) {
        lastStatsUpdate = now;
        if (sceneRuntime.observerActive) renderer.domElement.dataset.observerView = `${camera.fov.toFixed(1)}/${sceneRuntime.targetGoal.x.toFixed(3)}/${sceneRuntime.targetGoal.y.toFixed(3)}/${sceneRuntime.targetGoal.z.toFixed(3)}`;
        renderer.domElement.dataset.atlasCamera = `${camera.position.x.toFixed(4)}/${camera.position.y.toFixed(4)}/${camera.position.z.toFixed(4)}`;
        const stats = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures, frameMs: sampledFrameTime / Math.max(sampledFrames, 1) };
        renderer.domElement.dataset.atlasStats = `${stats.calls}/${stats.triangles}/${stats.textures}/${stats.frameMs.toFixed(2)}`;
        setRenderStats(stats);
        sampledFrameTime = 0;
        sampledFrames = 0;
      }
      scheduleRender();
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        return;
      }
      sceneRuntime.lastFrameTime = performance.now();
      resize(true);
      scheduleRender();
    };
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => resize());
    });
    observer.observe(host);
    document.addEventListener("visibilitychange", onVisibilityChange);
    resize();
    scheduleRender();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      window.cancelAnimationFrame(resizeFrame);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motionQuery.removeEventListener("change", onMotionPreferenceChange);
      observer.disconnect();
      releaseObserverControls();
      controls.removeEventListener("start", interruptCameraTransition);
      clearPlanetLayers(sceneRuntime);
      clearScientificSky(sceneRuntime);
      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();
      controls.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      host.replaceChildren();
      runtime.current = null;
    };
  }, []);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    current.renderer.setPixelRatio(Math.min(window.devicePixelRatio, qualityProfile.pixelRatioCap));
    current.resize(true);
    buildPlanetLayers(current, selected, visualProfile, qualityProfile, viewRef.current, hasEarthReferenceLayers);
    applyEarthVisualLayers(current, earthVisualLayersRef.current);
  }, [qualityProfile, selected, visualProfile, hasEarthReferenceLayers]);

  useEffect(() => {
    if (runtime.current) configureCameraGoal(runtime.current, view);
  }, [view, selectedId]);

  useEffect(() => {
    earthVisualLayersRef.current = earthVisualLayers;
    if (runtime.current) applyEarthVisualLayers(runtime.current, earthVisualLayers);
  }, [earthVisualLayers]);

  useEffect(() => {
    const current = runtime.current;
    if (!current) return;
    clearScientificSky(current);
    if (constellationSky) {
      current.scientificSky = buildScientificSky(constellationSky, DEFAULT_CONSTELLATION_SKY_LAYERS, current.renderer.getPixelRatio());
      current.scene.add(current.scientificSky);
    }
  }, [constellationSky, qualityProfile]);

  useEffect(() => {
    if (runtime.current) applyScientificSkyLayers(runtime.current.scientificSky, constellationSkyLayers);
  }, [constellationSky, constellationSkyLayers, qualityProfile]);

  useEffect(() => {
    const current = runtime.current;
    if (current && view === "observer" && constellationSky) {
      const fit = fitObserverSky(constellationSky, current.camera.aspect);
      current.targetGoal.set(...fit.direction);
      current.camera.fov = fit.fov;
      current.camera.updateProjectionMatrix();
    }
  }, [constellationSky, view]);

  function observerAction(action: "fit" | "horizon" | "in" | "out") {
    const current = runtime.current;
    if (!current || !constellationSky) return;
    if (action === "fit") {
      const fit = fitObserverSky(constellationSky, current.camera.aspect);
      current.targetGoal.set(...fit.direction);
      current.camera.fov = fit.fov;
    } else if (action === "horizon") {
      const azimuth = Math.atan2(-current.targetGoal.x, current.targetGoal.z) * 180 / Math.PI;
      current.targetGoal.set(...observerDirection(18, azimuth));
      current.camera.fov = 85;
    } else current.camera.fov = observerFieldOfView(current.camera.fov * (action === "in" ? .8 : 1.25));
    current.camera.updateProjectionMatrix();
  }

  function nextQuality() {
    setQuality((current) => QUALITY_ORDER[(QUALITY_ORDER.indexOf(current) + 1) % QUALITY_ORDER.length]);
  }

  return <section className={`atlas-explorer ${constellationSky ? observerStyles.observer : ""}`}>
    {!lockPlanet && <nav className="planet-picker" aria-label="Escolha um planeta">{PLANETS.map((planet) => <button key={planet.id} className={planet.id === selected.id ? "planet-chip selected" : "planet-chip"} onClick={() => { setSelectedId(planet.id); setView("orbital"); onPlanetChange?.(planet.id); }}><i style={{ background: planet.color }} />{planet.name}</button>)}</nav>}
    <div className="atlas-stage" ref={mount}>
      <div className="atlas-overlay atlas-status"><span>SELECIONADO</span><strong>{constellationSky ? `${constellationSky.constellation.name.toUpperCase()} · ${constellationSky.constellation.iau_abbreviation}` : selected.name.toUpperCase()}</strong><small>{constellationSky ? "céu local AltAz · dados Gaia/IAU" : `${selected.kind} · qualidade ${quality === "auto" ? `auto/${resolvedQuality}` : resolvedQuality}`}</small>{renderStats && <small className="atlas-debug-stats">{renderStats.calls} calls · {renderStats.triangles.toLocaleString("pt-BR")} tri · {renderStats.textures} tex · {renderStats.frameMs.toFixed(1)} ms</small>}</div>
      <div className="atlas-overlay atlas-actions">{constellationSky ? <><button type="button" onClick={() => observerAction("fit")}>Enquadrar estrelas</button><button type="button" onClick={() => observerAction("horizon")}>Ver horizonte</button><button type="button" aria-label="Aproximar céu" onClick={() => observerAction("in")}>Zoom +</button><button type="button" aria-label="Afastar céu" onClick={() => observerAction("out")}>Zoom −</button></> : <><button type="button" className={view === "orbital" ? "active" : ""} aria-pressed={view === "orbital"} onClick={() => { setView("orbital"); onViewChange?.("orbital"); }}>Órbita</button><button type="button" className={view === "surface" ? "active" : ""} aria-pressed={view === "surface"} onClick={() => { setView("surface"); onViewChange?.("surface"); }}>{selected.hasSurface ? "Aproximar solo" : "Topo das nuvens"}</button><button type="button" onClick={nextQuality}>Qualidade: {quality}</button>{selected.id === "earth" && !lockPlanet && <a href="/atlas/earth">Janela da Terra</a>}</>}</div>
      {constellationSky && <div className={observerStyles.skyNotice} role="status">{constellationSky.stars.filter((star) => star.above_horizon).length} estrelas acima do horizonte · {constellationSky.stars.length} no recorte{!constellationSky.stars.some((star) => star.above_horizon) && <strong>Esta seleção não tem estrelas acima do horizonte neste horário. Explore o mapa de catálogo ou altere o UTC.</strong>}{observerLightNotice(constellationSky.twilight) && <strong>{observerLightNotice(constellationSky.twilight)}</strong>}</div>}
      {comparisonMode !== "none" && <div className="atlas-overlay atlas-comparison-status">COMPARAÇÃO · {comparisonMode === "real-size" ? "referência relativa" : "ampliação visual"} · dois viewports, um renderer</div>}
      {view === "surface" && RENDER_REFERENCES[selected.id] && <a className="atlas-overlay mission-credit" href={RENDER_REFERENCES[selected.id].sourceUrl} target="_blank" rel="noreferrer"><span>REFERÊNCIA CIENTÍFICA</span><strong>{RENDER_REFERENCES[selected.id].label}</strong><small>geometria e materiais gerados localmente ↗</small></a>}
      <div className="atlas-overlay atlas-instructions">{constellationSky ? "arraste ou use setas para mirar · roda/pinça ou +/− para zoom · contraste didático, não fotométrico" : view === "orbital" ? "arraste para orbitar · role para aproximar" : "transição contínua · role para variar a altitude"}</div>
    </div>
    {!hideDetails && <div className="atlas-data">
      <article className="surface-brief"><p className="eyebrow">AMBIENTE</p><h2>{selected.surfaceTitle}</h2><p>{selected.surfaceCopy}</p><div className="surface-tag">{selected.hasSurface ? "MATERIAL PBR PROCEDURAL MULTIESCALA" : "TOPO DE NUVENS PROCEDURAL PBR"}</div>{RENDER_REFERENCES[selected.id] && <aside className="mission-note"><strong>Referência usada na renderização</strong><p>{RENDER_REFERENCES[selected.id].description}</p><a href={RENDER_REFERENCES[selected.id].sourceUrl} target="_blank" rel="noreferrer">{RENDER_REFERENCES[selected.id].label} · fonte científica ↗</a></aside>}{selected.classification && <aside className="classification-note"><strong>Por que Plutão é um planeta anão</strong><p>{selected.classification}</p></aside>}</article>
      <dl className="planet-metrics"><div><dt>Raio médio</dt><dd>{selected.radiusKm}</dd></div><div><dt>Gravidade</dt><dd>{selected.gravity}</dd></div><div><dt>Pressão</dt><dd>{selected.pressure}</dd></div><div><dt>Temperatura</dt><dd>{selected.temperature}</dd></div><div><dt>Atmosfera</dt><dd>{selected.atmosphere}</dd></div><div><dt>Rotação</dt><dd>{selected.rotation}</dd></div><div><dt>Distância do Sol</dt><dd>{selected.sunDistance}</dd></div><div><dt>Condições</dt><dd>{selected.conditions}</dd></div><div><dt>Adversidades</dt><dd>{selected.hazards.join(" · ")}</dd></div><div><dt>Fonte</dt><dd><a href={selected.sourceUrl} target="_blank" rel="noreferrer">{selected.source} ↗</a></dd></div></dl>
    </div>}
  </section>;
}
