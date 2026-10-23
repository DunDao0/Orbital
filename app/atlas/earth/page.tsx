import type { Metadata } from "next";
import EarthAtlasWorkspace from "@/app/components/earth/EarthAtlasWorkspace";

export const metadata: Metadata = {
  title: "Terra | Atlas Planetário | Orbis Scientia",
  description: "Janela da Terra com camadas visuais, snapshot, catálogo lunar e estados explícitos de cálculos científicos locais.",
};

export default function EarthAtlasPage() {
  return <EarthAtlasWorkspace />;
}
