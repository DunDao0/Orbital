import type { Metadata } from "next";
import AtlasDataRoute from "@/app/components/atlas/AtlasDataRoute";
import SiteSidebar from "@/app/components/SiteSidebar";

export const metadata: Metadata = { title: "Missões | Atlas Planetário | Orbis Scientia", description: "Manifestos de missão e marcos com cobertura temporal declarada." };
export default function AtlasMissionsPage() { return <div className="app-frame"><SiteSidebar active="atlas" /><AtlasDataRoute kind="missions" /></div>; }
