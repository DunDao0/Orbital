# Atlas Orbital — fase F: Observatório de Constelações da Terra

## Escopo entregue

- Rota de apresentação com WebGL: `/atlas/earth/constellations`.
- Catálogo local de 88 regiões IAU, pesquisável por abreviação e nome oficial.
- Formulário explícito de latitude, longitude, elevação e UTC. Esses valores
  ficam somente no estado da página; não entram no fragmento de cena nem em
  links compartilháveis.
- Transformação científica no backend nativo:
  `ICRS → GCRS/ITRS → AltAz` com `EarthLocation` WGS84, UTC, pressão `0 hPa`
  e IERS sem download automático. O cliente não calcula AltAz nem cria
  fallback quando a API retorna indisponível.
- Palco no mesmo ciclo de vida de `PlanetSurfaceExplorer`: uma cena, uma
  câmera ativa, um `canvas.atlas-webgl`, um renderer e um loop. A visão de
  observador oculta o globo e o campo procedural; estrelas renderizadas vêm
  exclusivamente da resposta Gaia/AltAz do backend.
- Geometria em `BufferGeometry`, `Points` e `LineSegments`; recursos do grupo
  científico são descartados em troca/desmontagem. Não há objeto Three por
  estrela nem um segundo canvas.
- Planejamento anual: para cada mês, o backend avalia o dia 15 em UTC com
  cadência de 30 minutos e mantém somente amostras com Sol abaixo de −18°;
  para o dia UTC solicitado usa 10 minutos. A altura máxima da coordenada
  representativa classifica a janela como indisponível, baixa, razoável ou
  favorável. É uma triagem geométrica sem clima, brilho do céu, relevo,
  obstruções ou equipamento.

## Dados e pipeline offline

`backend/.venv/Scripts/python.exe scripts/update_constellations.py` gera, sem
rede, a partir dos arquivos Astropy instalados e do subconjunto Gaia já salvo:

- `data/constellations/constellation_guides.json` — 88 guias e metadados de
  busca por abreviação IAU, nome oficial e aliases portugueses editoriais;
  coordenadas representativas são somente pontos internos de navegação;
- `data/constellations/iau_boundary_vertices_j2000.json` — 775 segmentos de
  borda compartilhada. O particionamento usa todos os breakpoints Roman 1987
  em B1875 e transforma os extremos de forma determinística para ICRS/J2000;
- `data/stars/iau_named_stars.json` — declaração explícita de cross-match WGSN
  indisponível. Nomes nunca são inferidos de Gaia IDs ou proximidade;
- `data/constellations/iau_boundaries.json` — inventário compacto legado,
  preservado para compatibilidade; ele não é tratado como geometria.

Depois, `scripts/generate_offline_bundle.py` atualiza checksums, estado
público e cópias em `public/scientific/`. Nenhuma consulta externa ocorre em
tempo de execução da página.

## Semântica de observação e camadas

O adaptador de apresentação usa `+Y = zênite`, `+Z = norte`, `+X = leste`,
com azimute `N=0°`, `E=90°`, `S=180°`, `W=270°`. Ele recebe AltAz pronto do
backend. Segmentos abaixo do horizonte não são desenhados; cruzamentos são
recortados somente para apresentação e tratam a continuidade 0°/360°.

As camadas são `sky-gaia-stars`, `sky-iau-boundaries`,
`sky-selected-constellation`, `sky-horizon-grid`,
`sky-cardinal-directions` e `sky-cultural-lines`. A última fica desativada:
o projeto não possui uma fonte de linhas culturais e não as substitui por
limites oficiais.

O estado semântico `DEFAULT_CONSTELLATION_SCENE` contém a seleção
`{ type: "constellation", id: "Ori" }` e a câmera `observer`, mas não contém
posição de observador.

## Limites conhecidos

- O subconjunto Gaia tem no máximo 10.000 fontes com `G <= 6.5`; não é um
  censo estelar completo e mantém a época de catálogo J2016.0 indicada em cada
  resposta.
- As fronteiras IAU são regiões formais, não asterismos físicos ou desenhos
  culturais. Regiões e estrelas não afirmam associação espacial.
- O conteúdo histórico permanece explicitamente indisponível onde não há uma
  fonte editorial curada no bundle.
- O glossário português serve somente para busca. A fonte dele é identificada
  como editorial Orbis Scientia e não altera o nome IAU nem a geometria formal.
- A página não calcula “melhor horário” futuro por heurística; esse estado é
  declarado como não calculado até existir uma solicitação científica própria.
- O Worker serve o catálogo estático e retorna 501 para
  `/api/sky/constellations` sem backend nativo configurado. Ele não cria uma
  aproximação astronômica.

## Validações previstas

```powershell
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run lint
backend\.venv\Scripts\python.exe -m pytest backend\tests
git diff --check
```

Os testes cobrem o catálogo de 88 itens, artefatos de geometria distintos,
busca/paginação, retorno AltAz que varia no tempo, contrato 501/proxy do
Worker, conversão visual AltAz, recorte do horizonte, continuidade de azimute,
magnitude monotônica e ausência de latitude/longitude/elevação no hash. A
inspeção manual ainda deve verificar desktop, mobile, teclado, movimento
reduzido, desmontagem/remontagem e ausência de erros no console.
