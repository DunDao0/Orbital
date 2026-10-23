"use client";

import Link from "@/app/components/AppLink";

type Props = { active: "orbital" | "atlas" | "earth" | "constellations" | "missions" | "events" };

const EXPLORATION_LINKS = [
  { href: "/", active: "orbital", index: "01", title: "Sistema Solar", detail: "estados e dinâmica" },
  { href: "/atlas", active: "atlas", index: "02", title: "Atlas Planetário", detail: "mundos em 3D" },
  { href: "/atlas/earth", active: "earth", index: "03", title: "Terra", detail: "camadas e observador" },
  { href: "/atlas/earth/constellations", active: "constellations", index: "04", title: "Constelações", detail: "céu local IAU/Gaia" },
] as const;

const RESEARCH_LINKS = [
  { href: "/missions", active: "missions", index: "05", title: "Missões", detail: "fontes e marcos" },
  { href: "/events", active: "events", index: "06", title: "Eventos", detail: "tempo e cobertura" },
] as const;

export default function SiteSidebar({ active }: Props) {
  return <aside className="site-sidebar">
    <Link className="sidebar-brand" href="/" aria-label="Orbis Scientia, início"><span className="sidebar-orbit-mark" aria-hidden="true" /><span><strong>ORBIS</strong> SCIENTIA<small>observatório computacional</small></span></Link>
    <p className="sidebar-kicker">EXPLORAR</p>
    <nav className="sidebar-nav" aria-label="Navegação principal">
      {EXPLORATION_LINKS.map((item) => <Link key={item.href} href={item.href} aria-current={active === item.active ? "page" : undefined} className={active === item.active ? "active" : ""}><span className="sidebar-index">{item.index}</span><span>{item.title}<small>{item.detail}</small></span></Link>)}
    </nav>
    <p className="sidebar-kicker sidebar-kicker-secondary">INVESTIGAR</p>
    <nav className="sidebar-nav" aria-label="Pesquisa e narrativas">
      {RESEARCH_LINKS.map((item) => <Link key={item.href} href={item.href} aria-current={active === item.active ? "page" : undefined} className={active === item.active ? "active" : ""}><span className="sidebar-index">{item.index}</span><span>{item.title}<small>{item.detail}</small></span></Link>)}
    </nav>
    <div className="sidebar-note"><span className="pulse" /> execução local <strong>ativa</strong><small>SI · J2000 · fontes rastreáveis</small></div>
  </aside>;
}
