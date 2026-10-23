"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PlanetSurfaceLoader from "@/app/components/PlanetSurfaceLoader";
import type { AtlasComparisonMode, AtlasSceneView } from "@/app/components/PlanetSurfaceExplorer";
import AtlasFoundationPanel from "@/app/components/atlas/AtlasFoundationPanel";
import AtlasResponsiveDrawer from "@/app/components/atlas/AtlasResponsiveDrawer";
import type { OrbitalSceneStateV1 } from "@/lib/atlas/scene/contracts";
import { earthRenderLayersFromScene, sceneHash, sceneStateFromHash } from "@/lib/atlas/scene/state";
import { ATLAS_PLANET_IDS, atlasDefaultScene, atlasVisualTarget, restoreAtlasScene } from "@/lib/atlas/planetaryScene";

export default function AtlasPlanetaryWorkspace() {
  const [scene, setScene] = useState<OrbitalSceneStateV1>(atlasDefaultScene);
  const [sceneReady, setSceneReady] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<AtlasComparisonMode>("none");

  useEffect(() => {
    const restored = sceneStateFromHash(window.location.hash);
    const queryPlanet = new URLSearchParams(window.location.search).get("planet");
    const frame = window.requestAnimationFrame(() => {
      setScene(restoreAtlasScene(restored, queryPlanet));
      setSceneReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!sceneReady) return;
    window.history.replaceState(null, "", `${window.location.pathname}${sceneHash(scene)}`);
  }, [scene, sceneReady]);

  const visualTarget = atlasVisualTarget(scene);
  const selectedPlanetId = visualTarget.planetId;
  const earthVisualLayers = useMemo(() => earthRenderLayersFromScene(scene), [scene]);

  const selectPlanet = useCallback((planetId: string) => {
    if (!ATLAS_PLANET_IDS.has(planetId)) return;
    setScene((current) => ({
      ...current,
      experience: "atlas",
      target: { type: "body", id: planetId },
      selection: { type: "body", id: planetId },
      camera: { ...current.camera, mode: "orbit", distance: 5.5 },
      panel: "overview",
    }));
  }, []);

  const changeView = useCallback((view: AtlasSceneView) => {
    if (view === "observer") return;
    setScene((current) => ({
      ...current,
      camera: { ...current.camera, mode: view === "surface" ? "surface" : "orbit", distance: view === "surface" ? 1.62 : 5.5 },
      panel: view === "surface" ? "terrain" : "overview",
    }));
  }, []);

  return <>
    {visualTarget.notice && <p className="earth-method-note" role="status">{visualTarget.notice}</p>}
    <PlanetSurfaceLoader
      initialPlanetId={selectedPlanetId}
      onPlanetChange={selectPlanet}
      requestedView={scene.camera.mode === "surface" ? "surface" : "orbital"}
      onViewChange={changeView}
      comparisonMode={comparisonMode}
      earthVisualLayers={selectedPlanetId === "earth" ? earthVisualLayers : undefined}
    />
    <AtlasResponsiveDrawer title="Ferramentas do Atlas" description="Cena, tempo, camadas e busca">
      <AtlasFoundationPanel scene={scene} onSceneChange={setScene} comparisonMode={comparisonMode} onComparisonChange={setComparisonMode} layerContext="atlas" />
    </AtlasResponsiveDrawer>
  </>;
}
