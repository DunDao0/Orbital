import type { Metadata } from "next";
import SiteSidebar from "@/app/components/SiteSidebar";
import AtlasDataRoute from "@/app/components/atlas/AtlasDataRoute";

export const metadata: Metadata = {
  title: "Missões | Orbis Scientia",
  description: "Manifestos de missão com marcos, cobertura e proveniência; sem trajetória inventada.",
};

export default function MissionsPage() {
  return <div className="app-frame"><SiteSidebar active="missions" /><AtlasDataRoute kind="missions" /></div>;
}
