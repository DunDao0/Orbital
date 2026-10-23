"use client";

import { useRef, useState } from "react";
import { MAX_PROJECT_BYTES, newProject, parseProjectText, readStoredProject, sanitizeProjectText, writeStoredProject, type OrbitalAnnotation, type OrbitalProject } from "@/lib/atlas/projects";
import type { OrbitalSceneStateV1 } from "@/lib/atlas/scene/contracts";

type Props = { scene: OrbitalSceneStateV1; onSceneChange: (scene: OrbitalSceneStateV1) => void };

export default function AtlasProjectPanel({ scene, onSceneChange }: Props) {
  const [project, setProject] = useState<OrbitalProject>(() => newProject(scene));
  const [annotationText, setAnnotationText] = useState("");
  const [annotationKind, setAnnotationKind] = useState<OrbitalAnnotation["kind"]>("note");
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  function saveScene() { setProject((current) => ({ ...current, scenes: [...current.scenes, scene] })); setNotice("Cena adicionada ao projeto local."); }
  function addAnnotation() {
    const text = sanitizeProjectText(annotationText);
    if (!text) { setNotice("Escreva uma anotação antes de adicionar."); return; }
    setProject((current) => ({ ...current, annotations: [...current.annotations, { id: crypto.randomUUID(), kind: annotationKind, text, targetId: scene.target.id }] }));
    setAnnotationText(""); setNotice("Marcação adicionada como metadado local.");
  }
  function saveLocal() {
    try {
      const result = writeStoredProject(window.localStorage, project);
      if (result.status === "saved") { setProject(result.project); setNotice("Projeto salvo somente neste navegador. Use Abrir projeto salvo para recuperá-lo."); }
      else setNotice(result.status === "invalid" ? "O projeto excede o limite de 500 kB ou contém dados inválidos. O arquivo salvo foi preservado." : "Não foi possível salvar: o armazenamento pode estar bloqueado ou cheio. Exporte o projeto para preservar seu trabalho.");
    } catch { setNotice("O navegador bloqueou o armazenamento local. Exporte o projeto para preservar seu trabalho."); }
  }
  function loadLocal() {
    try {
      const result = readStoredProject(window.localStorage);
      if (result.status === "ready") { setProject(result.project); setNotice("Projeto recuperado do navegador. Abra uma cena abaixo para aplicá-la ao visor."); }
      else setNotice(result.status === "missing" ? "Não há projeto salvo neste navegador." : result.status === "invalid" ? "O projeto salvo é inválido ou incompatível. Seus dados foram preservados, sem sobrescrever o armazenamento." : "Não foi possível acessar o armazenamento deste navegador.");
    } catch { setNotice("O navegador bloqueou o acesso ao armazenamento local."); }
  }
  function exportProject() {
    const validated = parseProjectText(JSON.stringify(project));
    if (!validated) { setNotice("Não foi possível exportar: o projeto é inválido ou excede o limite de 500 kB."); return; }
    const href = URL.createObjectURL(new Blob([JSON.stringify(validated)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = href; anchor.download = `${validated.title}.orbis.json`; anchor.click(); URL.revokeObjectURL(href); setNotice("Arquivo .orbis.json preparado para download.");
  }
  function importProject(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_PROJECT_BYTES) { setNotice("Arquivo muito grande. O limite do projeto é 500 kB."); return; }
    const reader = new FileReader();
    reader.onload = () => { const parsed = typeof reader.result === "string" ? parseProjectText(reader.result) : null; if (!parsed) { setNotice("Arquivo inválido, muito grande ou schema não suportado."); return; } setProject(parsed); setNotice("Projeto importado. Nenhuma coordenada de observador foi incluída."); };
    reader.onerror = () => setNotice("Não foi possível ler o arquivo selecionado."); reader.readAsText(file);
  }

  return <section className="atlas-tool-panel" aria-labelledby="projects-title">
    <div><p className="eyebrow">PROJETOS LOCAIS</p><h2 id="projects-title">Cenas e marcações sem conta ou servidor</h2><p>Projeto v1. As marcações são metadados e não escrevem no estado científico ou no observador.</p></div>
    <div className="atlas-tool-grid"><article className="atlas-tool-card"><label>Título<input value={project.title} maxLength={120} onChange={(event) => setProject((current) => ({ ...current, title: event.target.value }))} /></label><label>Descrição<input value={project.description ?? ""} maxLength={600} onChange={(event) => setProject((current) => ({ ...current, description: event.target.value }))} /></label><div className="atlas-next-actions"><button type="button" onClick={saveScene}>Salvar cena atual</button><button type="button" onClick={saveLocal}>Salvar no navegador</button><button type="button" onClick={loadLocal}>Abrir projeto salvo</button><button type="button" onClick={exportProject}>Exportar .orbis.json</button><button type="button" onClick={() => fileInput.current?.click()}>Importar arquivo</button></div><input ref={fileInput} className="visually-hidden" type="file" accept="application/json,.orbis.json" onChange={(event) => importProject(event.target.files?.[0])} /><p aria-live="polite">{notice || "Ações só ocorrem após clique explícito. Abrir projeto salvo substitui somente a edição atual; não grava no navegador."}</p></article>
      <article className="atlas-tool-card"><h3>Marcação</h3><label>Tipo<select value={annotationKind} onChange={(event) => setAnnotationKind(event.target.value as OrbitalAnnotation["kind"])}><option value="marker">marcador</option><option value="path">caminho</option><option value="area">área</option><option value="note">anotação</option></select></label><label>Texto<input value={annotationText} maxLength={600} onChange={(event) => setAnnotationText(event.target.value)} /></label><button type="button" onClick={addAnnotation}>Adicionar marcação</button><p className="atlas-next-muted">Sem HTML executável, URLs arbitrárias ou coordenadas privadas.</p></article>
      <article className="atlas-tool-card"><h3>Cenas e marcações</h3><ol className="atlas-project-list">{project.scenes.map((item, index) => <li key={`${item.requestedUtc}-${index}`}><button type="button" className="quiet" onClick={() => onSceneChange(item)}>Abrir cena {index + 1}</button><span>{item.target.id} · {item.requestedUtc}</span></li>)}</ol><ul className="atlas-transcript">{project.annotations.map((item) => <li key={item.id}><strong>{item.kind}</strong><span>{item.text} · alvo {item.targetId ?? "não definido"}</span></li>)}</ul></article></div>
  </section>;
}
