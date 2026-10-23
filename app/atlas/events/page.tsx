import type { Metadata } from "next";
import AtlasDataRoute from "@/app/components/atlas/AtlasDataRoute";
import SiteSidebar from "@/app/components/SiteSidebar";

export const metadata: Metadata = { title: "Eventos | Atlas Planetário | Orbis Scientia", description: "Centro de eventos astronômicos, de missões e da Terra com proveniência." };
export default function AtlasEventsPage() { return <div className="app-frame"><SiteSidebar active="atlas" /><AtlasDataRoute kind="events" /></div>; }
