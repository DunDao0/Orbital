"use client";

import dynamic from "next/dynamic";
import type { PlanetSurfaceExplorerProps } from "@/app/components/PlanetSurfaceExplorer";

const PlanetSurfaceExplorer = dynamic(() => import("@/app/components/PlanetSurfaceExplorer"), {
  ssr: false,
  loading: () => <div className="atlas-loading">Construindo ambiente planetário…</div>,
});

/**
 * Client-only mount point: the visualizer retains its single canvas/renderer
 * lifecycle while the server renders the textual route shell normally.
 */
export default function PlanetSurfaceLoader(props: PlanetSurfaceExplorerProps) {
  return <PlanetSurfaceExplorer {...props} />;
}
