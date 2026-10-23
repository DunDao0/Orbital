import type { Metadata } from "next";
import ConstellationObservatory from "@/app/components/earth/ConstellationObservatory";

export const metadata: Metadata = {
  title: "Constelações da Terra | Orbis Scientia",
  description: "Observatório AltAz local com catálogo Gaia DR3 limitado e fronteiras formais IAU/Roman–Delporte.",
};

export default function EarthConstellationsPage() {
  return <ConstellationObservatory />;
}
