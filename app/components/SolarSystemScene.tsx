"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BODY_VISUAL_SCALE, DEFAULT_VISUAL_SCALE, type VisualMode, VisualScaleMapper, type VisualScaleSettings } from "@/app/components/orbital/VisualScaleMapper";
import { planetVisualProfile } from "@/app/components/orbital/planetVisualProfiles";
import { navigationDistances, zoomDistance } from "@/app/components/orbital/navigation";
import { orbitalPoints } from "@/app/components/orbital/orbitalPoints";

export type SceneBody = {
  name: string;
  mu_m3_s2: number;
  radius_m: number;
  color: string;
  position_m: number[];
  velocity_m_s: number[];
};

type Props = { bodies: SceneBody[]; selected: string; focusVersion: number; onSelect: (name: string) => void };
type LabelMode = "selected" | "all" | "none";

type BodyNode = {
  group: THREE.Group;
  detail: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  marker: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite;
  radius: number;
  rings?: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
};

type OrbitNode = {
  line: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  lastBuild: number;
  mapperKey: string;
  signature: string;
};

class CameraDirector {
  private transition: { fromPosition: THREE.Vector3; fromTarget: THREE.Vector3; toPosition: THREE.Vector3; toTarget: THREE.Vector3; started: number; duration: number } | null = null;
  private solarPosition = new THREE.Vector3(20, 38, 23);
  private solarTarget = new THREE.Vector3();

  cancel() { this.transition = null; }

  zoom(camera: THREE.PerspectiveCamera, controls: OrbitControls, factor: number) {
    const offset = camera.position.clone().sub(controls.target);
    const distance = zoomDistance(offset.length(), factor, controls.minDistance, controls.maxDistance);
    if (offset.lengthSq() < 1e-16) offset.set(0, 0, 1);
    this.move(camera, controls, controls.target.clone().add(offset.normalize().multiplyScalar(distance)), controls.target, 180);
  }

  rememberSolar(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    this.solarPosition.copy(camera.position);
    this.solarTarget.copy(controls.target);
  }

  move(camera: THREE.PerspectiveCamera, controls: OrbitControls, position: THREE.Vector3, target: THREE.Vector3, duration = 620) {
    this.transition = { fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), toPosition: position.clone(), toTarget: target.clone(), started: performance.now(), duration };
  }

  focus(camera: THREE.PerspectiveCamera, controls: OrbitControls, target: THREE.Vector3, radius: number) {
    const offset = camera.position.clone().sub(controls.target);
    if (offset.lengthSq() < 0.0001) offset.set(1.2, 0.72, 1.35);
    const distances = navigationDistances(radius, camera.fov, camera.aspect);
    controls.minDistance = distances.minimum;
    offset.normalize().multiplyScalar(distances.focus);
    this.move(camera, controls, target.clone().add(offset), target, 720);
  }

  fit(camera: THREE.PerspectiveCamera, controls: OrbitControls, positions: THREE.Vector3[], extent: number) {
    if (!positions.length) return;
    const box = new THREE.Box3();
    positions.forEach((position) => box.expandByPoint(position));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const direction = camera.position.clone().sub(controls.target).normalize();
    if (direction.lengthSq() < 0.001) direction.set(0.68, 0.5, 0.76);
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const verticalSlope = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const horizontalSlope = verticalSlope * camera.aspect;
    let distance = Math.max(7, extent * 0.4);
    for (const position of positions) {
      const relative = position.clone().sub(sphere.center);
      distance = Math.max(distance, relative.dot(direction) + Math.max((Math.abs(relative.dot(right)) + 2) / horizontalSlope, (Math.abs(relative.dot(up)) + 2) / verticalSlope));
    }
    distance *= 1.12;
    this.move(camera, controls, sphere.center.clone().add(direction.multiplyScalar(distance)), sphere.center, 640);
  }

  map(camera: THREE.PerspectiveCamera, controls: OrbitControls, extent: number) {
    this.rememberSolar(camera, controls);
    camera.up.set(0, 0, -1);
    this.move(camera, controls, new THREE.Vector3(0.001, Math.max(18, extent * 2.05), 0.001), new THREE.Vector3(), 680);
  }

  solar(camera: THREE.PerspectiveCamera, controls: OrbitControls) {
    camera.up.set(0, 1, 0);
    this.move(camera, controls, this.solarPosition, this.solarTarget, 650);
  }

  update(camera: THREE.PerspectiveCamera, controls: OrbitControls, now: number) {
    if (this.transition) {
      const progress = THREE.MathUtils.clamp((now - this.transition.started) / this.transition.duration, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      camera.position.lerpVectors(this.transition.fromPosition, this.transition.toPosition, eased);
      controls.target.lerpVectors(this.transition.fromTarget, this.transition.toTarget, eased);
      if (progress >= 1) this.transition = null;
    }
    const distance = Math.max(0.00001, camera.position.distanceTo(controls.target));
    const near = Math.max(0.0000001, distance / 1_800);
    const far = Math.max(70, distance * 38);
    if (Math.abs(camera.near - near) > near * 0.05 || Math.abs(camera.far - far) > 0.01) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }
}

type SceneRuntime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  bodyNodes: Map<string, BodyNode>;
  pickables: Map<string, THREE.Object3D>;
  orbitNodes: Map<string, OrbitNode>;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  raycaster: THREE.Raycaster;
  mapper: VisualScaleMapper | null;
  director: CameraDirector;
  framed: boolean;
};

function orbitSignature(body: SceneBody): string { return [...body.position_m, ...body.velocity_m_s].map((value) => Number(value).toPrecision(7)).join("|"); }

function labelSprite(name: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
    context.fillStyle = "rgba(238, 246, 255, .96)";
    context.fillText(name.toUpperCase(), 8, 38);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(2.18, 0.54, 1);
  return sprite;
}

function disposeBody(node: BodyNode) {
  node.detail.geometry.dispose();
  node.detail.material.dispose();
  node.marker.geometry.dispose();
  node.marker.material.dispose();
  node.label.material.map?.dispose();
  node.label.material.dispose();
  node.rings?.geometry.dispose();
  node.rings?.material.dispose();
}

export default function SolarSystemScene({ bodies, selected, focusVersion, onSelect }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const runtime = useRef<SceneRuntime | null>(null);
  const onSelectRef = useRef(onSelect);
  const focusedVersion = useRef(0);
  const navigatedSelection = useRef(selected);
  const navigatedMode = useRef<VisualMode>("visual");
  const [visualMode, setVisualMode] = useState<VisualMode>("visual");
  const [compression, setCompression] = useState(DEFAULT_VISUAL_SCALE.compression);
  const [showTrajectories, setShowTrajectories] = useState(true);
  const [labelMode, setLabelMode] = useState<LabelMode>("selected");
  const [mapView, setMapView] = useState(false);
  const settings = useMemo<VisualScaleSettings>(() => ({ ...DEFAULT_VISUAL_SCALE, mode: visualMode, compression, focusBody: selected }), [compression, selected, visualMode]);
  const mapperKey = `${settings.mode}:${settings.compression.toFixed(3)}:${settings.focusBody}`;

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#030812");
    scene.fog = new THREE.FogExp2("#030812", 0.014);
    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    camera.position.set(20, 38, 23);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "solar-system-webgl";
    host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 1.3;
    controls.maxDistance = 400;
    controls.zoomSpeed = 1.15;
    controls.panSpeed = 0.7;
    controls.screenSpacePanning = true;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    const grid = new THREE.GridHelper(84, 28, "#5b6446", "#14202b");
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.14;
    scene.add(grid, new THREE.AmbientLight("#8bb2e9", 0.72));
    const light = new THREE.PointLight("#ffd58a", 4.3, 95, 2);
    light.position.set(0, 1.5, 0);
    scene.add(light);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.042, 10, 44), new THREE.MeshBasicMaterial({ color: "#f5e6ae", transparent: true, opacity: 0.9 }));
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    scene.add(ring);
    const bodyNodes = new Map<string, BodyNode>();
    const pickables = new Map<string, THREE.Object3D>();
    const orbitNodes = new Map<string, OrbitNode>();
    const raycaster = new THREE.Raycaster();
    const director = new CameraDirector();
    const interruptNavigation = () => director.cancel();
    controls.addEventListener("start", interruptNavigation);
    runtime.current = { scene, camera, renderer, controls, bodyNodes, pickables, orbitNodes, ring, raycaster, mapper: null, director, framed: false };

    let animationFrame = 0;
    let resizeFrame = 0;
    let disposed = false;
    let renderedWidth = 0;
    let renderedHeight = 0;
    const scheduleDraw = () => {
      if (!disposed && !document.hidden && animationFrame === 0) animationFrame = window.requestAnimationFrame(draw);
    };
    const draw = (now: number) => {
      animationFrame = 0;
      const active = runtime.current;
      if (!active) return;
      active.director.update(camera, controls, now);
      for (const [name, node] of active.bodyNodes) {
        if (!node.group.visible) continue;
        const close = name === "Sun" || camera.position.distanceTo(node.group.position) < Math.max(7, node.radius * 100);
        node.detail.visible = close;
        node.marker.visible = !close;
        // The HUD already identifies the focused body. Fade world-space text
        // before it fills the screen or crosses the near plane on approach.
        node.label.material.opacity = THREE.MathUtils.smoothstep(camera.position.distanceTo(node.group.position) / Math.max(node.radius, 0.00001), 8, 14);
      }
      controls.update();
      renderer.render(scene, camera);
      scheduleDraw();
    };
    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height || (renderedWidth === Math.round(width) && renderedHeight === Math.round(height))) return;
      renderedWidth = Math.round(width);
      renderedHeight = Math.round(height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(renderedWidth, renderedHeight, false);
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        return;
      }
      resize();
      scheduleDraw();
    };
    const observer = new ResizeObserver(() => { window.cancelAnimationFrame(resizeFrame); resizeFrame = window.requestAnimationFrame(resize); });
    observer.observe(host);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const pointer = new THREE.Vector2();
    const pointerStart = new THREE.Vector2();
    let activePointer: number | null = null;
    let dragged = false;
    const beginPointer = (event: PointerEvent) => {
      if (activePointer !== null || !event.isPrimary) { dragged = true; return; }
      activePointer = event.pointerId;
      dragged = event.button !== 0;
      pointerStart.set(event.clientX, event.clientY);
    };
    const movePointer = (event: PointerEvent) => {
      if (event.pointerId === activePointer && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) dragged = true;
    };
    const cancelPointer = () => { activePointer = null; dragged = true; };
    const selectAtPointer = (event: PointerEvent) => {
      if (event.pointerId !== activePointer) return;
      activePointer = null;
      if (dragged) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...pickables.values()].filter((group) => group.visible), true)
        .filter((hit) => hit.object.visible && !(hit.object instanceof THREE.Sprite));
      let object: THREE.Object3D | undefined = hits[0]?.object;
      let name: string | undefined;
      while (object && !name) {
        name = object.userData.bodyName as string | undefined;
        object = object.parent ?? undefined;
      }
      if (name) {
        onSelectRef.current(name);
        const node = bodyNodes.get(name);
        if (node) director.focus(camera, controls, node.group.position, node.radius);
      }
    };
    renderer.domElement.addEventListener("pointerdown", beginPointer);
    renderer.domElement.addEventListener("pointermove", movePointer);
    renderer.domElement.addEventListener("pointercancel", cancelPointer);
    renderer.domElement.addEventListener("pointerup", selectAtPointer);
    resize();
    scheduleDraw();
    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      window.cancelAnimationFrame(resizeFrame);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerup", selectAtPointer);
      renderer.domElement.removeEventListener("pointerdown", beginPointer);
      renderer.domElement.removeEventListener("pointermove", movePointer);
      renderer.domElement.removeEventListener("pointercancel", cancelPointer);
      controls.removeEventListener("start", interruptNavigation);
      bodyNodes.forEach(disposeBody);
      orbitNodes.forEach((node) => { node.line.geometry.dispose(); node.line.material.dispose(); });
      grid.geometry.dispose(); (grid.material as THREE.Material).dispose();
      ring.geometry.dispose(); ring.material.dispose(); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); runtime.current = null;
    };
  }, []);

  useEffect(() => {
    const active = runtime.current;
    if (!active) return;
    const mapper = new VisualScaleMapper(bodies, settings);
    active.mapper = mapper;
    const present = new Set(bodies.map((body) => body.name));
    for (const [name, node] of active.bodyNodes) {
      if (present.has(name)) continue;
      active.scene.remove(node.group); disposeBody(node); active.bodyNodes.delete(name); active.pickables.delete(name);
    }
    for (const body of bodies) {
      let node = active.bodyNodes.get(body.name);
      if (!node) {
        const profile = planetVisualProfile(body.name, body.color);
        const group = new THREE.Group();
        const detail = new THREE.Mesh(new THREE.SphereGeometry(1, body.name === "Sun" ? 36 : 28, body.name === "Sun" ? 26 : 20), new THREE.MeshStandardMaterial({ color: profile.color, emissive: profile.emissive ?? "#000000", emissiveIntensity: profile.emissive ? 1.18 : 0.08, roughness: profile.roughness, metalness: 0.03 }));
        const marker = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: profile.marker }));
        group.userData.bodyName = body.name; detail.userData.bodyName = body.name; marker.userData.bodyName = body.name;
        const label = labelSprite(body.name);
        group.add(detail, marker, label);
        let rings: BodyNode["rings"];
        if (body.name === "Saturn") {
          rings = new THREE.Mesh(new THREE.RingGeometry(1.28, BODY_VISUAL_SCALE.saturnRingExtent, 64), new THREE.MeshBasicMaterial({ color: "#ddc887", transparent: true, opacity: 0.44, side: THREE.DoubleSide, depthWrite: false }));
          rings.rotation.x = Math.PI / 2.34; group.add(rings);
        }
        node = { group, detail, marker, label, radius: mapper.displayRadius(body), rings };
        active.bodyNodes.set(body.name, node); active.pickables.set(body.name, group); active.scene.add(group);
      }
      node.radius = mapper.displayRadius(body);
      node.rings?.scale.setScalar(node.radius);
      const point = mapper.mapBody(body);
      node.group.visible = point !== null;
      if (point) { node.group.position.copy(point); node.label.position.set(node.radius + 0.28, node.radius + 0.34, 0); }
      node.label.visible = labelMode === "all" || (labelMode === "selected" && body.name === selected);
      // Selection is an outline, not an inflation of the body's apparent size.
      node.detail.scale.setScalar(node.radius);
      node.marker.scale.setScalar(node.radius);
    }
    const selectedNode = active.bodyNodes.get(selected);
    active.controls.minDistance = navigationDistances(selectedNode?.radius ?? 0.01, active.camera.fov, active.camera.aspect).minimum;
    if (selectedNode?.group.visible) {
      active.ring.position.copy(selectedNode.group.position); active.ring.scale.setScalar(selectedNode.radius * 1.22); active.ring.visible = true;
    } else active.ring.visible = false;

    if (!active.framed && bodies.length) {
      active.framed = true;
      active.director.fit(active.camera, active.controls, [...active.bodyNodes.values()].filter((node) => node.group.visible).map((node) => node.group.position), mapper.displayExtent);
    }

    const sun = bodies.find((body) => body.name === "Sun");
    const orbitBodies = showTrajectories && visualMode !== "focus" && sun ? bodies.filter((body) => body.name !== "Sun" && body.name !== "Moon") : [];
    const expectedOrbits = new Set(orbitBodies.map((body) => body.name));
    for (const [name, node] of active.orbitNodes) {
      if (expectedOrbits.has(name)) continue;
      active.scene.remove(node.line); node.line.geometry.dispose(); node.line.material.dispose(); active.orbitNodes.delete(name);
    }
    const now = performance.now();
    if (sun) for (const body of orbitBodies) {
      const signature = orbitSignature(body);
      const existing = active.orbitNodes.get(body.name);
      const shouldBuild = !existing || existing.mapperKey !== mapperKey || (existing.signature !== signature && now - existing.lastBuild > 700);
      if (shouldBuild) {
        const physicalPoints = orbitalPoints(body, sun);
        const points = physicalPoints?.map((point) => mapper.mapOrbitPoint(point, body.name)).filter((point): point is THREE.Vector3 => point !== null) ?? [];
        if (points.length > 3) {
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          if (existing) {
            existing.line.geometry.dispose(); existing.line.geometry = geometry; existing.lastBuild = now; existing.mapperKey = mapperKey; existing.signature = signature;
          } else {
            const profile = planetVisualProfile(body.name, body.color);
            const line = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: profile.orbit, transparent: true, opacity: 0.37 }));
            line.renderOrder = 1; active.scene.add(line); active.orbitNodes.set(body.name, { line, lastBuild: now, mapperKey, signature });
          }
        }
      }
      const node = active.orbitNodes.get(body.name);
      if (node) node.line.material.opacity = body.name === selected ? 0.92 : 0.34;
    }
  }, [bodies, labelMode, mapperKey, selected, settings, showTrajectories, visualMode]);

  useEffect(() => {
    const active = runtime.current;
    if (!active) return;
    const changedSelection = navigatedSelection.current !== selected;
    const changedMode = navigatedMode.current !== visualMode;
    const requestedFocus = focusedVersion.current !== focusVersion;
    navigatedSelection.current = selected;
    navigatedMode.current = visualMode;
    focusedVersion.current = focusVersion;
    if (changedMode && visualMode !== "focus") {
      active.camera.up.set(0, 1, 0);
      if (mapView) active.director.map(active.camera, active.controls, active.mapper?.displayExtent ?? 32);
      else active.director.fit(active.camera, active.controls, [...active.bodyNodes.values()].filter((node) => node.group.visible).map((node) => node.group.position), active.mapper?.displayExtent ?? 32);
    } else if (changedSelection || requestedFocus || changedMode) {
      const node = active.bodyNodes.get(selected);
      if (node?.group.visible) active.director.focus(active.camera, active.controls, node.group.position, node.radius);
    }
  }, [focusVersion, mapView, selected, visualMode]);

  function focusSelected() {
    const active = runtime.current;
    const node = active?.bodyNodes.get(selected);
    if (!active || !node?.group.visible) return;
    active.director.focus(active.camera, active.controls, node.group.position, node.radius);
  }
  function zoomSelected(factor: number) {
    const active = runtime.current;
    if (active) active.director.zoom(active.camera, active.controls, factor);
  }
  function fitSystem() {
    const active = runtime.current;
    if (!active?.mapper) return;
    active.director.fit(active.camera, active.controls, [...active.bodyNodes.values()].filter((node) => node.group.visible).map((node) => node.group.position), active.mapper.displayExtent);
  }
  function returnSolar() {
    const active = runtime.current;
    if (!active) return;
    setMapView(false); setVisualMode("visual");
    active.camera.up.set(0, 1, 0);
    if (visualMode === "visual") fitSystem();
  }
  function toggleMap() {
    const active = runtime.current;
    if (!active?.mapper) return;
    if (mapView) { setMapView(false); active.director.solar(active.camera, active.controls); }
    else { setVisualMode("visual"); setMapView(true); active.director.map(active.camera, active.controls, active.mapper.displayExtent); }
  }

  const modeLabel = visualMode === "real" ? "escala proporcional" : visualMode === "focus" ? "contexto local" : "escala visual";
  const focusNotice = visualMode === "focus" && selected !== "Earth" && selected !== "Sun" ? "Não há estado de lua de referência para este sistema; nenhuma órbita foi inventada." : visualMode === "focus" && selected === "Earth" ? "Lua exibida pela posição de referência; a ampliação é apenas visual." : visualMode === "visual" ? "Tamanhos reduzidos e distância Terra–Lua ampliada para leitura. Física preservada." : "Distâncias proporcionais; tamanhos limitados para evitar interseções.";

  return <div ref={mount} className="solar-system-scene" aria-label="Cena WebGL tridimensional do Sistema Solar. Arraste para girar, role para aproximar e clique em um corpo para selecioná-lo." role="application">
    <div className="scene-hud scene-hud-top"><span>VISTA ORBITAL · {modeLabel}</span><strong>{selected.toUpperCase()}</strong></div>
    <div className="scene-hud scene-hud-actions" aria-label="Controles da visualização">
      <label>Escala<select aria-label="Modo de escala visual" value={visualMode} onChange={(event) => { setMapView(false); setVisualMode(event.target.value as VisualMode); }}><option value="real">Real proporcional</option><option value="visual">Visual legível</option><option value="focus">Foco no corpo</option></select></label>
      <label className={visualMode === "visual" ? "" : "control-muted"}>Compressão <output>{Math.round(compression * 100)}%</output><input aria-label="Compressão visual de distâncias" type="range" min="0" max="100" value={Math.round(compression * 100)} disabled={visualMode !== "visual"} onChange={(event) => setCompression(Number(event.target.value) / 100)} /></label>
      <div className="scene-control-row"><button type="button" onClick={fitSystem}>Enquadrar</button><button type="button" onClick={focusSelected}>Focar</button></div>
      <div className="scene-control-row"><button type="button" onClick={() => zoomSelected(0.72)}>Aproximar +</button><button type="button" onClick={() => zoomSelected(1 / 0.72)}>Afastar −</button></div>
      <span>Roda/pinça: zoom · arrastar: girar · botão direito/dois dedos: deslocar</span>
      <div className="scene-control-row"><button type="button" aria-pressed={mapView} onClick={toggleMap}>{mapView ? "Sair do mapa" : "Mapa orbital"}</button><button type="button" onClick={returnSolar}>Retornar</button></div>
      <button type="button" aria-pressed={showTrajectories} onClick={() => setShowTrajectories((value) => !value)}>{showTrajectories ? "Ocultar" : "Exibir"} órbitas</button>
      <button type="button" onClick={() => setLabelMode((value) => value === "selected" ? "all" : value === "all" ? "none" : "selected")}>Rótulos: {labelMode === "selected" ? "seleção" : labelMode === "all" ? "todos" : "nenhum"}</button>
    </div>
    <div className="scene-hud scene-hud-bottom"><span>DE442s · J2000 · {modeLabel}</span><span>{focusNotice}</span></div>
  </div>;
}
