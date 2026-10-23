import * as THREE from "three";
import type { AtlasQualityProfile, PlanetAtmosphereProfile, PlanetCloudProfile, PlanetOceanProfile, PlanetSurfaceProfile, PlanetVisualProfile } from "./planetVisualProfiles";

type DynamicUniforms = {
  time: THREE.IUniform<number>;
  sunDirection: THREE.IUniform<THREE.Vector3>;
  cameraPosition: THREE.IUniform<THREE.Vector3>;
};

export type AtlasPlanetMaterials = {
  surface: THREE.MeshStandardMaterial;
  ocean?: THREE.MeshPhysicalMaterial;
  clouds: THREE.ShaderMaterial[];
  atmosphere?: THREE.ShaderMaterial;
  update: (elapsedSeconds: number, cameraPosition: THREE.Vector3, sunDirection: THREE.Vector3) => void;
};

const SURFACE_VERTEX = `
varying vec3 vAtlasPosition;
varying mat3 vAtlasNormalMatrix;
`;

const PROCEDURAL_FRAGMENT = `
varying vec3 vAtlasPosition;
varying mat3 vAtlasNormalMatrix;
uniform float uSeed;
uniform float uSurfaceMode;
uniform float uMacroFrequency;
uniform float uRegionalFrequency;
uniform float uMicroFrequency;
uniform float uLandBias;
uniform float uLandDetailWeight;
uniform float uPolarIce;
uniform float uNormalStrength;
uniform float uCloudShadowStrength;
uniform float uTime;
uniform vec3 uPaletteA;
uniform vec3 uPaletteB;
uniform vec3 uPaletteC;
uniform vec3 uPaletteD;
uniform vec3 uOceanDeep;
uniform vec3 uOceanShallow;
uniform float uOceanRoughness;
uniform float uWaveStrength;

float atlasHash(vec3 point) {
  point = fract(point * 0.1031);
  point += dot(point, point.yzx + 33.33);
  return fract((point.x + point.y) * point.z);
}

float atlasValueNoise(vec3 point) {
  vec3 cell = floor(point);
  vec3 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float n000 = atlasHash(cell + vec3(0.0, 0.0, 0.0));
  float n100 = atlasHash(cell + vec3(1.0, 0.0, 0.0));
  float n010 = atlasHash(cell + vec3(0.0, 1.0, 0.0));
  float n110 = atlasHash(cell + vec3(1.0, 1.0, 0.0));
  float n001 = atlasHash(cell + vec3(0.0, 0.0, 1.0));
  float n101 = atlasHash(cell + vec3(1.0, 0.0, 1.0));
  float n011 = atlasHash(cell + vec3(0.0, 1.0, 1.0));
  float n111 = atlasHash(cell + vec3(1.0, 1.0, 1.0));
  float nearPlane = mix(mix(n000, n100, local.x), mix(n010, n110, local.x), local.y);
  float farPlane = mix(mix(n001, n101, local.x), mix(n011, n111, local.x), local.y);
  return mix(nearPlane, farPlane, local.z);
}

float atlasFbm(vec3 point) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave += 1) {
    sum += atlasValueNoise(point) * amplitude;
    point = point * 2.03 + vec3(19.19, 7.13, 31.73);
    amplitude *= 0.5;
  }
  return sum / 0.9375;
}

float atlasLandMask(vec3 position) {
  vec3 direction = normalize(position);
  float continentalWaves = sin(direction.x * 4.4 + sin(direction.z * 3.7) * 1.45)
    + cos(direction.z * 4.1 + direction.y * 2.8)
    + sin(direction.y * 5.3 - direction.x * 1.9);
  float macro = 0.5 + continentalWaves * 0.105;
  float regional = atlasFbm(direction * uRegionalFrequency + uSeed * 0.37);
  float continent = mix(macro, regional, uLandDetailWeight);
  return smoothstep(uLandBias - 0.3, uLandBias + 0.3, continent);
}

float atlasCloudMask(vec3 position) {
  vec3 direction = normalize(position);
  float firstField = atlasFbm(direction * 3.8 + vec3(uTime * 0.011, 0.0, -uTime * 0.008));
  float secondField = atlasFbm(direction * 8.1 + vec3(-uTime * 0.006, uTime * 0.004, 0.0));
  return smoothstep(0.68, 0.9, firstField * 0.7 + secondField * 0.3);
}

vec3 atlasSurfaceColor(vec3 position) {
  vec3 direction = normalize(position);
  float land = atlasLandMask(position);
  float regional = atlasFbm(direction * uRegionalFrequency + uSeed * 0.83);
  float micro = atlasFbm(direction * uMicroFrequency + uSeed * 1.71);
  float latitude = abs(direction.y);
  float polar = smoothstep(uPolarIce, 1.0, latitude + regional * 0.08);
  float bands = 0.5 + 0.5 * sin(direction.y * 27.0 + regional * 5.0);
  vec3 rock = mix(uPaletteA, uPaletteB, smoothstep(0.3, 0.75, regional));
  vec3 fertile = mix(uPaletteB, uPaletteC, smoothstep(0.38, 0.76, micro));
  vec3 terrestrial = mix(rock, fertile, smoothstep(0.34, 0.76, regional));
  vec3 banded = mix(uPaletteA, uPaletteD, bands);
  banded = mix(banded, uPaletteB, atlasFbm(direction * uRegionalFrequency * 0.7));
  vec3 frozen = mix(uPaletteB, uPaletteD, smoothstep(0.28, 0.74, regional));
  vec3 material = mix(terrestrial, banded, step(0.5, uSurfaceMode));
  material = mix(material, frozen, step(1.5, uSurfaceMode));
  material = mix(material, uPaletteD, polar * (0.6 + 0.4 * (1.0 - uSurfaceMode)));
  vec3 oceanFloor = mix(uPaletteA * 0.45, uPaletteB * 0.55, regional);
  return mix(oceanFloor, material, land);
}
`;

const NORMAL_PATCH = `
#include <normal_fragment_begin>
float atlasNormalField = atlasFbm(vAtlasPosition * uMicroFrequency + uSeed * 2.31);
vec3 atlasDetailAxis = normalize(vec3(
  sin(vAtlasPosition.y * uMicroFrequency * 0.61 + atlasNormalField * 4.0),
  cos(vAtlasPosition.z * uMicroFrequency * 0.47 - atlasNormalField * 3.0),
  sin(vAtlasPosition.x * uMicroFrequency * 0.53 + atlasNormalField * 5.0)
));
// The procedural field is object-locked; lighting normals are in view space.
atlasDetailAxis = vAtlasNormalMatrix * atlasDetailAxis;
atlasDetailAxis -= normal * dot(normal, atlasDetailAxis);
normal = normalize(normal + atlasDetailAxis * (atlasNormalField - 0.5) * uNormalStrength);
`;

function colorUniform(color: string): THREE.IUniform<THREE.Color> {
  return { value: new THREE.Color(color) };
}

function surfaceUniforms(surface: PlanetSurfaceProfile, dynamic: DynamicUniforms, cloudShadowStrength: number): Record<string, THREE.IUniform> {
  return {
    uSeed: { value: surface.seed },
    uSurfaceMode: { value: surface.mode === "rock" ? 0 : surface.mode === "banded" ? 1 : 2 },
    uMacroFrequency: { value: surface.macroFrequency },
    uRegionalFrequency: { value: surface.regionalFrequency },
    uMicroFrequency: { value: surface.microFrequency },
    uLandBias: { value: surface.landBias },
    uLandDetailWeight: { value: surface.landDetailWeight },
    uPolarIce: { value: surface.polarIce },
    uNormalStrength: { value: surface.normalStrength },
    uCloudShadowStrength: { value: cloudShadowStrength },
    uTime: dynamic.time,
    uPaletteA: colorUniform(surface.palette[0]),
    uPaletteB: colorUniform(surface.palette[1]),
    uPaletteC: colorUniform(surface.palette[2]),
    uPaletteD: colorUniform(surface.palette[3]),
  };
}

function patchPlanetVertex(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = `${SURFACE_VERTEX}\n${shader.vertexShader}`;
  shader.vertexShader = shader.vertexShader.replace(
    "#include <begin_vertex>",
    "#include <begin_vertex>\nvAtlasPosition = transformed;\nvAtlasNormalMatrix = normalMatrix;",
  );
}

function createSurfaceMaterial(surface: PlanetSurfaceProfile, dynamic: DynamicUniforms, cloudShadowStrength: number): THREE.MeshStandardMaterial {
  const uniforms = surfaceUniforms(surface, dynamic, cloudShadowStrength);
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: surface.roughness, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patchPlanetVertex(shader);
    shader.fragmentShader = `${PROCEDURAL_FRAGMENT}\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      vec3 atlasColor = atlasSurfaceColor(vAtlasPosition);
      float atlasCloudShadow = atlasCloudMask(vAtlasPosition) * uCloudShadowStrength;
      diffuseColor.rgb = atlasColor * (1.0 - atlasCloudShadow);
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", NORMAL_PATCH);
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `
      float atlasRoughnessNoise = atlasFbm(vAtlasPosition * uMicroFrequency + uSeed * 0.29);
      float roughnessFactor = clamp(roughness + (atlasRoughnessNoise - 0.5) * 0.22, 0.08, 0.98);
    `);
  };
  material.customProgramCacheKey = () => "atlas-surface-pbr-v4";
  return material;
}

function createOceanMaterial(surface: PlanetSurfaceProfile, ocean: PlanetOceanProfile, dynamic: DynamicUniforms): THREE.MeshPhysicalMaterial {
  const uniforms = {
    ...surfaceUniforms(surface, dynamic, 0),
    uOceanDeep: colorUniform(ocean.deepColor),
    uOceanShallow: colorUniform(ocean.shallowColor),
    uOceanRoughness: { value: ocean.roughness },
    uWaveStrength: { value: ocean.waveStrength },
  };
  const material = new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    roughness: ocean.roughness,
    metalness: 0,
    clearcoat: 0.42,
    clearcoatRoughness: 0.12,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    patchPlanetVertex(shader);
    shader.fragmentShader = `${PROCEDURAL_FRAGMENT}\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
      float atlasLand = atlasLandMask(vAtlasPosition);
      float atlasWater = 1.0 - smoothstep(0.18, 0.78, atlasLand);
      if (atlasWater < 0.015) discard;
      float atlasCoast = smoothstep(0.12, 0.8, atlasLand);
      float atlasWave = atlasFbm(normalize(vAtlasPosition) * 47.0 + vec3(uTime * 0.018, 0.0, -uTime * 0.014));
      diffuseColor.rgb = mix(uOceanDeep, uOceanShallow, atlasCoast * 0.88 + atlasWave * 0.12);
      diffuseColor.a = atlasWater * 0.94;
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_begin>", `${NORMAL_PATCH}
      float atlasWaveNoise = atlasFbm(vAtlasPosition * 52.0 + vec3(uTime * 0.02, 0.0, 0.0));
      normal = normalize(normal + atlasDetailAxis * (atlasWaveNoise - 0.5) * uWaveStrength);
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `
      float atlasOceanRoughness = atlasFbm(vAtlasPosition * 19.0 + uTime * 0.01);
      float roughnessFactor = clamp(uOceanRoughness + (atlasOceanRoughness - 0.5) * 0.16, 0.05, 0.52);
    `);
  };
  material.customProgramCacheKey = () => "atlas-ocean-pbr-v4";
  return material;
}

function createCloudMaterial(profile: PlanetCloudProfile, dynamic: DynamicUniforms, index: number): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uTime: dynamic.time,
      uSunDirection: dynamic.sunDirection,
      uColor: colorUniform(profile.color),
      uCoverage: { value: profile.coverage + index * 0.045 },
      uOpacity: { value: profile.opacity * (index === 0 ? 1 : 0.5) },
      uLayerOpacity: { value: 1 },
      uScale: { value: profile.scale * (index === 0 ? 1 : 1.73) },
      uSpeedA: { value: profile.speedA * (index === 0 ? 1 : -0.62) },
      uSpeedB: { value: profile.speedB * (index === 0 ? 1 : -0.71) },
      uPhase: { value: index * 14.19 },
    },
    vertexShader: `
      varying vec3 vCloudNormal;
      void main() {
        vCloudNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vCloudNormal;
      uniform float uTime;
      uniform vec3 uSunDirection;
      uniform vec3 uColor;
      uniform float uCoverage;
      uniform float uOpacity;
      uniform float uLayerOpacity;
      uniform float uScale;
      uniform float uSpeedA;
      uniform float uSpeedB;
      uniform float uPhase;
      float cloudHash(vec3 point) { return fract(sin(dot(point, vec3(17.13, 83.71, 31.19))) * 43758.5453); }
      float cloudNoise(vec3 point) {
        vec3 cell = floor(point); vec3 local = fract(point); local = local * local * (3.0 - 2.0 * local);
        float a = cloudHash(cell); float b = cloudHash(cell + vec3(1.0, 0.0, 0.0));
        float c = cloudHash(cell + vec3(0.0, 1.0, 0.0)); float d = cloudHash(cell + vec3(1.0, 1.0, 0.0));
        float e = cloudHash(cell + vec3(0.0, 0.0, 1.0)); float f = cloudHash(cell + vec3(1.0, 0.0, 1.0));
        float g = cloudHash(cell + vec3(0.0, 1.0, 1.0)); float h = cloudHash(cell + vec3(1.0, 1.0, 1.0));
        float nearPlane = mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
        float farPlane = mix(mix(e, f, local.x), mix(g, h, local.x), local.y);
        return mix(nearPlane, farPlane, local.z);
      }
      float cloudFbm(vec3 point) {
        float value = 0.0; float amplitude = 0.58;
        for (int octave = 0; octave < 3; octave += 1) { value += cloudNoise(point) * amplitude; point = point * 2.17 + 11.13; amplitude *= 0.5; }
        return value / 1.015;
      }
      void main() {
        vec3 normal = normalize(vCloudNormal);
        vec3 flow = vec3(uTime * uSpeedA + uPhase, uTime * uSpeedB, -uTime * uSpeedA * 0.41);
        float first = cloudFbm(normal * uScale + flow);
        float second = cloudFbm(normal * (uScale * 2.3) - flow.yzx * 0.63);
        float coverage = smoothstep(uCoverage, uCoverage + 0.18, first * 0.71 + second * 0.29);
        float light = 0.16 + max(dot(normal, normalize(uSunDirection)), 0.0) * 0.84;
        float silverLining = pow(max(dot(normalize(uSunDirection), normal), 0.0), 8.0) * 0.22;
        gl_FragColor = vec4(uColor * (light + silverLining), coverage * uOpacity * uLayerOpacity);
      }
    `,
  });
  material.customProgramCacheKey = () => `atlas-clouds-v3-${index}`;
  return material;
}

function createAtmosphereMaterial(profile: PlanetAtmosphereProfile, quality: AtlasQualityProfile, dynamic: DynamicUniforms): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Integrate only up to the planet intersection. A back-face depth test
    // would otherwise hide all front-side haze behind the opaque globe.
    depthTest: false,
    side: THREE.BackSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uSunDirection: dynamic.sunDirection,
      uLayerOpacity: { value: 1 },
      uPlanetRadius: { value: profile.planetRadius },
      uAtmosphereRadius: { value: profile.atmosphereRadius },
      uRayleigh: { value: new THREE.Vector3(...profile.rayleighScattering) },
      uRayleighScaleHeight: { value: profile.rayleighScaleHeight },
      uMieScattering: { value: profile.mieScattering },
      uMieAbsorption: { value: profile.mieAbsorption },
      uMieScaleHeight: { value: profile.mieScaleHeight },
      uMieAnisotropy: { value: profile.mieAnisotropy },
      uAbsorption: { value: new THREE.Vector3(...(profile.absorption ?? [0, 0, 0])) },
      uSunIntensity: { value: profile.sunIntensity },
      uExposure: { value: profile.exposure },
    },
    vertexShader: `
      varying vec3 vAtmospherePosition;
      varying vec3 vAtmosphereCamera;
      varying vec3 vAtmosphereSun;
      uniform vec3 uSunDirection;
      void main() {
        // Object space also handles axial tilt and the comparison viewport.
        mat4 worldToPlanet = inverse(modelMatrix);
        vAtmospherePosition = position;
        vAtmosphereCamera = (worldToPlanet * vec4(cameraPosition, 1.0)).xyz;
        vAtmosphereSun = normalize(mat3(worldToPlanet) * uSunDirection);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vAtmospherePosition;
      varying vec3 vAtmosphereCamera;
      varying vec3 vAtmosphereSun;
      uniform float uLayerOpacity;
      uniform float uPlanetRadius;
      uniform float uAtmosphereRadius;
      uniform vec3 uRayleigh;
      uniform float uRayleighScaleHeight;
      uniform float uMieScattering;
      uniform float uMieAbsorption;
      uniform float uMieScaleHeight;
      uniform float uMieAnisotropy;
      uniform vec3 uAbsorption;
      uniform float uSunIntensity;
      uniform float uExposure;
      vec2 sphereInterval(vec3 origin, vec3 direction, float radius) {
        float b = dot(origin, direction);
        float d = b * b - dot(origin, origin) + radius * radius;
        if (d < 0.0) return vec2(1.0, -1.0);
        float root = sqrt(d);
        return vec2(-b - root, -b + root);
      }
      vec2 density(vec3 point) {
        float altitude = max(length(point) - uPlanetRadius, 0.0)
          / max(uAtmosphereRadius - uPlanetRadius, 0.001);
        return exp(-altitude / max(vec2(uRayleighScaleHeight, uMieScaleHeight), vec2(0.001)));
      }
      vec3 extinction(vec2 column) {
        return uRayleigh * column.x
          + vec3(uMieScattering + uMieAbsorption) * column.y
          + uAbsorption * column.x;
      }
      void main() {
        vec3 origin = vAtmosphereCamera;
        vec3 direction = normalize(vAtmospherePosition - origin);
        vec3 sunDirection = normalize(vAtmosphereSun);
        vec2 interval = sphereInterval(origin, direction, uAtmosphereRadius);
        float start = max(interval.x, 0.0);
        float finish = interval.y;
        vec2 ground = sphereInterval(origin, direction, uPlanetRadius);
        if (ground.x > 0.0 && ground.y >= ground.x) finish = min(finish, ground.x);
        if (finish <= start) discard;
        const int VIEW_STEPS = ${quality.cloudShadows ? 12 : quality.cloudLayers > 0 ? 8 : 4};
        const int LIGHT_STEPS = 4;
        float stepLength = (finish - start) / float(VIEW_STEPS);
        float thickness = max(uAtmosphereRadius - uPlanetRadius, 0.001);
        vec2 viewColumn = vec2(0.0);
        vec3 radiance = vec3(0.0);
        float mu = dot(direction, sunDirection);
        float rayleighPhase = 0.0596831 * (1.0 + mu * mu);
        float g = clamp(uMieAnisotropy, 0.0, 0.95);
        float miePhase = (1.0 - g * g) / (12.566371 * pow(max(1.0 + g * g - 2.0 * g * mu, 0.01), 1.5));
        for (int sampleIndex = 0; sampleIndex < VIEW_STEPS; sampleIndex++) {
          vec3 point = origin + direction * (start + (float(sampleIndex) + 0.5) * stepLength);
          vec2 sampleColumn = density(point) * stepLength / thickness;
          vec2 sunGround = sphereInterval(point, sunDirection, uPlanetRadius);
          if (!(sunGround.x > 0.0 && sunGround.y >= sunGround.x)) {
            float lightStep = max(sphereInterval(point, sunDirection, uAtmosphereRadius).y, 0.0) / float(LIGHT_STEPS);
            vec2 lightColumn = vec2(0.0);
            for (int lightIndex = 0; lightIndex < LIGHT_STEPS; lightIndex++) {
              lightColumn += density(point + sunDirection * (float(lightIndex) + 0.5) * lightStep) * lightStep / thickness;
            }
            vec3 transmission = exp(-extinction(viewColumn + sampleColumn * 0.5 + lightColumn));
            radiance += transmission * (uRayleigh * sampleColumn.x * rayleighPhase
              + vec3(uMieScattering * sampleColumn.y * miePhase));
          }
          viewColumn += sampleColumn;
        }
        float alpha = clamp(1.0 - dot(exp(-extinction(viewColumn)), vec3(0.333333)), 0.0, 0.9);
        // Straight alpha: do not multiply scattering by optical depth twice.
        gl_FragColor = vec4(radiance * uSunIntensity * uExposure * 4.0 / max(alpha, 0.0001), alpha * uLayerOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  material.customProgramCacheKey = () => `atlas-atmosphere-path-v3-${quality.cloudShadows ? 12 : quality.cloudLayers > 0 ? 8 : 4}`;
  return material;
}

export function createAtlasPlanetMaterials(profile: PlanetVisualProfile, quality: AtlasQualityProfile): AtlasPlanetMaterials {
  const dynamic: DynamicUniforms = {
    time: { value: 0 },
    sunDirection: { value: new THREE.Vector3(0, 1, 1).normalize() },
    cameraPosition: { value: new THREE.Vector3() },
  };
  const cloudShadowStrength = quality.cloudShadows ? profile.clouds?.shadowStrength ?? 0 : 0;
  const clouds = profile.clouds && quality.cloudLayers > 0
    ? Array.from({ length: quality.cloudLayers }, (_, index) => createCloudMaterial(profile.clouds!, dynamic, index))
    : [];
  return {
    surface: createSurfaceMaterial(profile.surface, dynamic, cloudShadowStrength),
    ocean: profile.ocean ? createOceanMaterial(profile.surface, profile.ocean, dynamic) : undefined,
    clouds,
    atmosphere: profile.atmosphere ? createAtmosphereMaterial(profile.atmosphere, quality, dynamic) : undefined,
    update(elapsedSeconds, cameraPosition, sunDirection) {
      dynamic.time.value = elapsedSeconds;
      dynamic.cameraPosition.value.copy(cameraPosition);
      dynamic.sunDirection.value.copy(sunDirection);
    },
  };
}
