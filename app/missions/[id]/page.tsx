import { notFound } from "next/navigation";
import SiteSidebar from "@/app/components/SiteSidebar";
import AtlasDataRoute from "@/app/components/atlas/AtlasDataRoute";
import { ORBITAL_MISSIONS } from "@/lib/atlas/missions";

export default async function MissionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ORBITAL_MISSIONS.some((mission) => mission.id === id)) notFound();
  return <div className="app-frame"><SiteSidebar active="missions" /><AtlasDataRoute kind="missions" missionId={id} /></div>;
}
