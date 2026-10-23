import type { Metadata } from "next";
import SiteSidebar from "@/app/components/SiteSidebar";
import AtlasDataRoute from "@/app/components/atlas/AtlasDataRoute";

export const metadata: Metadata = {
  title: "Eventos | Orbis Scientia",
  description: "Eventos com fonte, filtros, cobertura e limitações declaradas.",
};

export default function EventsPage() {
  return <div className="app-frame"><SiteSidebar active="events" /><AtlasDataRoute kind="events" /></div>;
}
