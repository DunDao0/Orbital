import type { Metadata } from "next";
import SiteSidebar from "@/app/components/SiteSidebar";
import AtlasPlanetaryWorkspace from "@/app/components/atlas/AtlasPlanetaryWorkspace";

export const metadata: Metadata = {
  title: "Atlas Planetário | Orbis Scientia",
  description: "Explore os oito planetas em 3D, seus ambientes de superfície, atmosfera, pressão e propriedades físicas.",
  openGraph: { images: ["/og.png"] },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function PlanetAtlasPage() {
  return <div className="app-frame"><SiteSidebar active="atlas" /><main className="atlas-shell">
    <header className="atlas-topbar">
      <span>ATLAS PLANETÁRIO · 02</span><span>UM CANVAS · MATERIAIS PROCEDURAIS · FONTES DECLARADAS</span>
    </header>
    <section className="atlas-intro atlas-intro-command">
      <div><p className="eyebrow">NOVE MUNDOS · UMA EXPERIÊNCIA CONTÍNUA</p><h1>Entre em órbita. Leia cada ambiente.</h1><p>Escolha um planeta ou Plutão e aproxime-se de uma renderização procedural própria. Textura, relevo e atmosfera são interpretações visuais distintas; pressão, temperatura e demais métricas permanecem acompanhadas de fonte.</p></div>
      <nav className="atlas-route-actions" aria-label="Continuar exploração"><a href="/atlas/earth">Janela da Terra <span>camadas + observador</span></a><a href="/atlas/earth/constellations">Céu local <span>IAU + Gaia + AltAz</span></a></nav>
    </section>
    <AtlasPlanetaryWorkspace />
    <footer className="atlas-footer">Modelos 3D procedurais para exploração visual. Eles não são imagens de missão, mapas de elevação ou previsão meteorológica.</footer>
  </main></div>;
}
