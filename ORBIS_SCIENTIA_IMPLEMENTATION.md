# Plano mestre de implementação do Orbis Scientia

> Versão consolidada a partir do handoff auditado em 2026-08-17.
>
> Este arquivo substitui, em caso de conflito, os planos anteriores.
>
> Coloque este documento na raiz do repositório. Leia integralmente
> `AGENTS.md` e este arquivo antes de editar qualquer código.

---

## 0. Autoridade, objetivo e modo de execução

Este documento é a especificação autoritativa para:

1. estabilizar a base TypeScript;
2. concluir uma janela dedicada à Terra sem romper o Atlas;
3. implementar versões iniciais, funcionais e extensíveis de 12 melhorias;
4. preservar integralmente as regras físicas, a procedência dos dados e o
   comportamento privado do serviço científico;
5. validar tudo localmente, sem commit, push, deploy ou túnel.

As inspirações de produto são:

- NASA Eyes: navegação espacial, tempo, trajetórias, missões e explicação;
- Google Earth: câmera multiescala, busca, camadas, medições, projetos e
  narrativas.

Use essas referências apenas como inspiração de interação. Não copie código,
layout, ícones, screenshots, texturas, marcas ou identidade visual.

Se o repositório real divergir deste handoff, inspecione o estado atual e
adapte a implementação sem reverter alterações preexistentes. Não trate este
documento como autorização para destruir ou substituir trabalho local.

---

# Parte I — Handoff técnico auditado

## 1. Objetivo do projeto

Orbis Scientia é uma bancada científica interativa do Sistema Solar. Ela não
deve trocar precisão por animação plausível: estados de referência, catálogos,
procedência e limitações precisam permanecer visíveis.

Há duas experiências web principais:

- `/`: planetário orbital, estado de referência, pequena simulação N-body e
  consultas científicas locais;
- `/atlas`: Atlas 3D procedural dos planetas, voltado à exploração visual e a
  dados físicos descritivos; não é uma efeméride nem um mapa de missão.

Tecnologias atuais:

- React 19;
- Vinext/Vite;
- Cloudflare Worker;
- Three.js direto;
- Python 3.12;
- FastAPI;
- Astropy;
- SciPy.

Não se usa React Three Fiber nem Babylon.

## 2. Regras invioláveis de integridade física

Os valores abaixo são a fonte física:

```text
position_m
velocity_m_s
mu_m3_s2
epoch
reference_frame
```

O backend e a integração Velocity-Verlet trabalham em SI:

```text
metros
segundos
m³/s²
```

A visualização nunca pode escrever, normalizar, arredondar ou substituir o
estado físico.

Fluxo obrigatório:

```text
DE442s/SPICE ou estado N-body
        ↓
estado físico
        ↓
adaptador visual declarativo
        ↓
posição da cena, câmera e UI
```

Regras:

- O integrador padrão é Velocity-Verlet de passo fixo.
- DOP853 exige SciPy.
- O modelo N-body é gravitacional newtoniano de massas pontuais.
- O modelo não inclui J2, relatividade, marés ou pressão de radiação.
- O snapshot usa J2000 / Solar System Barycenter e SPICE ET/TDB.
- Órbitas desenhadas são osculantes, derivadas do estado atual e exibidas em
  janela limitada.
- Órbitas osculantes não são previsões de efeméride.
- Luas só podem ser desenhadas quando existir uma fonte explícita de estado.
- Os registros de elementos médios JPL das luas são metadados pesquisáveis,
  não posições.
- Apenas a Lua possui estado exato visualizado na versão auditada.
- Nenhum recurso visual pode alterar o estado físico original.
- Nenhum estado serializado de UI deve virar fonte de verdade física.

Leia antes de alterar dinâmica ou renderização:

```text
docs/physics.md
docs/orbital-visualization.md
docs/limitations.md
```

## 3. Dados e procedência presentes

### Snapshot público

Arquivo:

```text
public/reference-snapshot.json
```

Conteúdo auditado:

- 10 corpos:
  - Sol;
  - Mercúrio;
  - Vênus;
  - Terra;
  - Lua;
  - Marte;
  - Júpiter;
  - Saturno;
  - Urano;
  - Netuno;
- época: `2026-08-05T00:00:00`;
- fonte: `NAIF SPICE DE442s`.

### Bundle local em `data/`

Conteúdo auditado:

- três kernels NAIF/DE442s, aproximadamente 32,8 MB;
- manifestos SHA-256;
- catálogo de 460 luas;
- subconjunto de 10.000 estrelas Gaia DR3;
- 88 constelações IAU.

Os dados baixados ou gerados não fazem parte automaticamente do código-fonte
publicado. Os manifestos registram aquisição, origem e integridade.

### Catálogo de luas

Distribuição auditada:

```text
Terra: 1
Marte: 2
Júpiter: 115
Saturno: 291
Urano: 30
Netuno: 16
Plutão: 5
Total: 460
```

Não há SPKs de satélites gigantes no bundle. Não desenhe essas luas como se
suas posições fossem conhecidas.

### Constelações e estrelas

- As constelações são limites/classificações IAU via Astropy.
- Elas não são desenhos culturais.
- O subconjunto Gaia DR3 contém movimento próprio e paralaxe.
- Não transforme o catálogo em céu topocêntrico sem executar a transformação
  científica apropriada.

### Scripts reprodutíveis

Local:

```text
scripts/
```

Responsabilidades:

- download de kernels;
- exportação do snapshot;
- atualização de luas;
- atualização de constelações;
- montagem de Gaia;
- geração do bundle;
- geração e validação de manifestos;
- benchmarks.

Não execute downloads grandes ou geração de dados sem necessidade e sem
ambiente apropriado.

## 4. Arquitetura atual

| Área | Arquivos principais | Responsabilidade |
| --- | --- | --- |
| Página orbital | `app/page.tsx`, `app/components/SolarSystemScene.tsx` | Carrega referência, executa Velocity-Verlet no cliente e apresenta UI, céu, eclipses e catálogo. |
| Escala visual | `app/components/orbital/VisualScaleMapper.ts` | Mapeia vetores físicos para `real`, `visual` e `focus` sem mutar a origem. |
| Atlas | `app/atlas/page.tsx`, `app/components/PlanetSurfaceExplorer.tsx` | Uma única cena/canvas Three.js, câmera contínua, controles de planeta, vista, qualidade e HUD. |
| Materiais do Atlas | `app/components/atlas/planetVisualProfiles.ts`, `app/components/atlas/planetMaterials.ts` | Perfis tipados e PBR procedural de superfície, oceano, nuvens e atmosfera. |
| API científica | `backend/src/astro_system/api/main.py` | FastAPI para referência, N-body, céu local, eclipse e catálogos. |
| Núcleo científico | `backend/src/astro_system/dynamics/`, `ephemeris/`, `coordinates/`, `eclipses/`, `catalogs/` | Gravidade, integração, DE/SPICE, AltAz, eclipse local e catálogos. |
| API publicada | `worker/index.ts`, `worker/scientific-api.ts` | Worker read-only, assets estáticos e proxy opcional ao backend local. |
| Estilo e navegação | `app/globals.css`, `app/components/SiteSidebar.tsx` | Layout responsivo e navegação entre Sistema Solar e Atlas. |
| Documentação | `docs/architecture.md`, `docs/physics.md`, `docs/data_sources.md`, `docs/limitations.md`, `docs/validation.md` | Escopo, fontes, limites e evidências. |

`vite.config.ts` configura Vinext e Cloudflare.

D1 e R2 são opcionais. Nenhuma funcionalidade científica pode passar a
depender deles sem necessidade explícita e documentação.

## 5. Funcionalidades auditadas

### Planetário orbital `/`

- Carrega o estado na data UTC escolhida a partir da API local.
- Se a API estiver indisponível, usa apenas o snapshot estático na época
  exportada.
- Alterna entre referência e N-body.
- Possui pausa, reset e velocidade em horas físicas por intervalo de UI.
- Usa cena Three.js com:
  - seleção de corpos;
  - rótulos;
  - órbitas osculantes;
  - foco;
  - mapa orbital;
  - modos de escala proporcional, legível e foco.
- Marcadores são ampliados deliberadamente para interação.
- A Lua é mostrada no foco terrestre por seu vetor de estado.
- Nenhuma lua de catálogo sem estado explícito é criada visualmente.
- Possui painel de céu local com transformação científica:
  - ICRS;
  - GCRS/ITRS;
  - AltAz.
- Possui busca de eclipse solar local conforme o modelo atual.
- Possui consulta/paginação do catálogo de luas.

### Atlas `/atlas`

- Uma única cena/canvas Three.js.
- Câmera contínua.
- Troca de planeta.
- Perfis procedurais tipados.
- Materiais PBR procedurais.
- Superfície, oceano, nuvens e atmosfera conforme perfil.
- Controles de vista e qualidade.
- HUD e navegação lateral.
- O Atlas é descritivo e visual.
- O Atlas não deve passar a fingir que é efeméride ou mapa de missão.

Inspecione a implementação real antes de assumir nomes de componentes,
controles ou estados adicionais.

## 6. Rotas e comportamento publicado

Rotas relevantes:

```text
GET /api/sky?latitude_deg=...&longitude_deg=...&elevation_m=...&utc=...
GET /api/eclipses/local?...
GET /api/catalogs/moons?primary=...&query=...&offset=0&limit=80
GET /api/catalogs/constellations
GET /api/simulate?...
```

No site, o Worker expõe no mesmo domínio:

- snapshot fixo;
- catálogos;
- proxy científico privado opcional.

Para estas rotas:

```text
/api/sky
/api/eclipses/local
/api/simulate
```

o Worker retorna `501` quando o binding privado
`CUSTOMER_HTTP_SCIENCE_API` não existe.

Regras obrigatórias:

- Nunca inventar cálculo aproximado.
- Nunca transformar `501` em resultado vazio.
- Nunca expor URL, porta, binding ou topologia do serviço.
- O túnel é opcional, privado e apenas para o serviço local em loopback.
- Não publicar porta.
- Não criar túnel público.
- Não incluir credenciais no repositório.

Leia:

```text
docs/local-scientific-service.md
```

## 7. Estado do Git auditado

Estado em 2026-08-17:

- branch: `main`;
- commit: `1f783a1`;
- mensagem: `Integrate local live sky and eclipse calculations`;
- dois commits à frente de `origin/main`;
- `d391eae`: prepara o túnel científico privado;
- `1f783a1`: integra céu e eclipses ao vivo.

Há alterações locais não commitadas.

Arquivos modificados informados:

```text
app/globals.css
app/page.tsx
API Python
catálogo de luas Python
testes da API
limites e validação
ESLint
package.json
lockfile
teste de HTML
worker/scientific-api.ts
```

Arquivos e árvores ainda não rastreados informados:

```text
app/atlas/
app/components/
docs/atlas-planet-visuals.md
docs/atlas-visuals/
docs/orbital-visualization.md
public/atlas/
public/og.png
tests/visual-scale.test.ts
logs locais
AGENTS.md
```

As mudanças locais introduzem principalmente:

- renderer Three.js;
- Atlas;
- navegação lateral;
- separação de escala visual;
- paginação e consulta de luas;
- contratos de teste.

Há avisos LF → CRLF. Eles não são falhas de conteúdo. Evite reformatação
desnecessária.

### Proibições

Não execute:

```text
git reset --hard
git checkout -- .
git restore .
git clean
git stash
git rebase
git commit
git push
wrangler deploy
cloudflared tunnel
```

Não remova arquivos não rastreados.

Não organize commits nesta execução.

## 8. Validação auditada e bloqueio atual

Confirmado em 2026-08-17:

```text
npm.cmd test
```

Resultado:

- build Vinext passou;
- testes Node/Worker/SSR: `7/7`;
- testes de escala visual: `3/3`.

Também passou:

```powershell
backend\.venv\Scripts\python.exe -m pytest backend\tests
```

Resultado:

```text
14/14
```

Existe aviso externo de depreciação em
`starlette.testclient`/httpx.

Também passou:

```text
git diff --check
```

### Bloqueio obrigatório

Este comando falha:

```powershell
npx.cmd tsc --noEmit
```

Causas conhecidas:

1. `three` e `three/addons/controls/OrbitControls.js` sem declarações
   TypeScript disponíveis para a configuração atual.
2. Inferências `any` no Atlas.
3. Campo opcional incompatível em `planetVisualProfiles.ts`.
4. Callback de `requestAnimationFrame` com assinatura incompatível.
5. Tipos Cloudflare como `Fetcher`, `D1Database` e
   `cloudflare:workers` indisponíveis para o `tsc` puro.
6. Teste importando `.ts` sem configuração apropriada.
7. Inferência de campo do catálogo em `worker/scientific-api.ts` impede
   `toLowerCase`.

O build avisa que um chunk minificado excede 500 kB. É aviso de performance,
não falha funcional.

---

# Parte II — Sequência obrigatória de trabalho

## 9. Fase 0 — Inventário seguro

Antes de editar:

1. Ler `AGENTS.md`.
2. Ler este documento.
3. Ler:
   - `docs/physics.md`;
   - `docs/orbital-visualization.md`;
   - `docs/limitations.md`;
   - `docs/architecture.md`;
   - `docs/data_sources.md`;
   - `docs/validation.md`;
   - `docs/local-scientific-service.md`;
   - documentos do Atlas e assets.
4. Inspecionar:
   - `package.json`;
   - lockfile;
   - `tsconfig*`;
   - ESLint;
   - `vite.config.ts`;
   - Worker;
   - backend;
   - rotas;
   - componentes Three.js;
   - testes;
   - assets.
5. Executar:

```powershell
git status --short
git diff --stat
git diff --check
```

6. Identificar quais alterações já existiam antes desta tarefa.
7. Não reverter, sobrescrever ou reformatar trabalho preexistente.

## 10. Fase 1 — Restaurar TypeScript

O trabalho funcional só começa depois de:

```powershell
npx.cmd tsc --noEmit
```

passar.

### Requisitos

- Instalar ou configurar tipos compatíveis com a versão atual de Three.js.
- Tipar corretamente `OrbitControls`.
- Separar contextos de frontend, Worker e testes quando necessário.
- Usar tipos Cloudflare oficiais/compatíveis.
- Não criar `declare module "*"` amplo.
- Não declarar APIs Cloudflare como `any`.
- Não usar `any` global.
- Não excluir arquivos problemáticos do `tsc`.
- Não usar `skipLibCheck` apenas para ocultar o problema.
- Corrigir os tipos reais do Atlas.
- Corrigir opcionais de `planetVisualProfiles.ts`.
- Corrigir `requestAnimationFrame`, guardar o ID e cancelar no descarte.
- Corrigir a normalização do catálogo no Worker com type guard.
- Preservar o comando principal `npx.cmd tsc --noEmit`.

Estrutura possível, somente se compatível:

```text
tsconfig.base.json
tsconfig.app.json
tsconfig.worker.json
tsconfig.tests.json
tsconfig.json
```

### Critério de saída

Executar e passar:

```powershell
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run lint
backend\.venv\Scripts\python.exe -m pytest backend\tests
git diff --check
```

## 11. Fase 2 — Contratos científicos e capacidades

Antes da janela da Terra, centralize os contratos.

Estrutura sugerida, adaptada à organização real:

```text
app/lib/science/contracts.ts
app/lib/science/client.ts
app/lib/science/errors.ts
app/lib/science/capabilities.ts
```

Ou diretório equivalente já existente.

Nenhum componente novo deve chamar `fetch` científico diretamente.

### Estado de recurso

Use união discriminada equivalente a:

```ts
export type ScienceResource<T> =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      data: T;
      provenance?: ScienceProvenance;
      limitations?: string[];
    }
  | {
      status: "unavailable";
      httpStatus: 501;
      capability: ScienceCapability;
      message: string;
    }
  | {
      status: "out-of-range";
      message: string;
      validFromUtc?: string;
      validUntilUtc?: string;
    }
  | {
      status: "validation-error";
      message: string;
      fieldErrors?: Record<string, string>;
    }
  | {
      status: "error";
      message: string;
      httpStatus?: number;
      requestId?: string;
    };
```

### Requisitos

- Usar `AbortSignal`.
- Usar `URLSearchParams`.
- Diferenciar vazio válido, indisponível, inválido e fora de cobertura.
- Preservar proveniência.
- Não registrar query completa com coordenadas.
- Não criar fallback astronômico.

### Endpoint de capacidades

Adicionar:

```text
GET /api/capabilities
```

A resposta pode informar:

- snapshot disponível;
- catálogos disponíveis;
- `sky` disponível;
- `eclipses_local` disponível;
- `simulate` disponível;
- limites temporais públicos quando existentes.

Não pode informar:

- nome do binding;
- URL interna;
- `localhost`;
- `127.0.0.1`;
- porta;
- token;
- túnel;
- topologia.

A UI continua tratando `501`, mesmo depois de consultar capacidades.

---

# Parte III — Janela dedicada à Terra

## 12. Fase 3 — `/atlas/earth`

Criar uma rota dedicada:

```text
/atlas/earth
```

Ela é uma especialização do Atlas, não uma nova aplicação.

### Regra arquitetural

Não criar:

- segundo canvas;
- segundo renderer;
- segunda cena global;
- segundo loop principal;
- modal com outra aplicação Three.js;
- efeméride paralela no Atlas.

Reutilizar:

```text
app/components/PlanetSurfaceExplorer.tsx
```

ou extrair dele um controlador compartilhado, preservando um único contexto
WebGL.

### Estrutura conceitual

```text
Atlas compartilhado
├── canvas e renderer
├── controlador de câmera
├── adaptador visual do planeta
└── janela/inspector da Terra
    ├── visão geral
    ├── observador
    ├── céu local
    ├── eclipses
    ├── Terra–Lua
    ├── camadas
    └── dados e método
```

### Desktop e mobile

Desktop:

- canvas principal;
- inspector lateral;
- navegação existente preservada.

Mobile:

- canvas;
- painel inferior expansível;
- controles adequados para toque;
- conteúdo legível.

### 12.1. Visão geral

Funciona sem serviço científico.

Mostrar apenas dados existentes:

- classificação;
- raio equatorial e polar;
- rotação;
- translação;
- inclinação axial;
- escala física versus visual;
- fonte do perfil;
- fonte do snapshot;
- época;
- cobertura;
- link para a Lua.

Não preencher campos ausentes com estimativas.

### 12.2. Observador

Campos:

```text
latitude_deg
longitude_deg
elevation_m
utc
```

Regras:

- reutilizar validadores existentes;
- não persistir coordenadas por padrão;
- não incluir coordenadas automaticamente na URL;
- não enviar para analytics;
- não registrar a query completa;
- cancelar requisições antigas;
- ignorar respostas obsoletas;
- mostrar erros por campo.

### 12.3. Céu local

Consumir exclusivamente:

```text
GET /api/sky
```

Mostrar apenas campos retornados pela API.

Não:

- calcular AltAz no frontend;
- converter constelações em céu local aproximado;
- fabricar posição de estrela;
- substituir `501` por dados estáticos.

Mensagem adequada:

```text
Cálculos do céu local estão indisponíveis neste ambiente. O Atlas e os
catálogos continuam disponíveis.
```

### 12.4. Eclipses locais

Consumir exclusivamente:

```text
GET /api/eclipses/local
```

Mostrar:

- candidato;
- tipo;
- contatos;
- visibilidade;
- altitude nos contatos;
- intervalo pesquisado;
- fonte;
- limitações.

Texto de transparência:

```text
Resultado do modelo topocêntrico atual. Não destinado a previsão operacional
de alta precisão.
```

Não prometer precisão de 5–10 s ou 10 km.

### 12.5. Terra–Lua

Consumir:

```text
GET /api/catalogs/moons
```

Descobrir no código o identificador canônico da Terra.

Mostrar metadados da Lua e navegação.

Regras:

- A Lua pode ser visualizada com seu vetor de estado explícito.
- Outras luas de catálogo não podem ganhar posição inventada.
- Fase, distância, iluminação ou posição atuais exigem estado científico
  datado.

### 12.6. Camadas visuais

Camadas iniciais:

- superfície procedural;
- oceano;
- atmosfera;
- grade;
- marcador do observador;
- nuvens estáticas;
- luzes noturnas;
- escala visual.

Rotular claramente:

- nuvens estáticas não são meteorologia atual;
- luzes noturnas não são dados ao vivo;
- iluminação neutra não é terminador real;
- terminador real exige vetor solar com referencial documentado.

### 12.7. Dados e método

Mostrar:

- visual, snapshot ou cálculo ao vivo;
- época;
- referencial;
- ephemeris;
- cobertura;
- versão;
- fonte;
- limitações;
- identificador de requisição, quando útil.

### 12.8. Lifecycle

Ao trocar de planeta ou sair:

- remover objetos próprios;
- liberar geometrias;
- liberar materiais;
- liberar texturas;
- liberar render targets;
- remover listeners;
- cancelar timers;
- cancelar fetch;
- cancelar frames próprios;
- não chamar `renderer.dispose()` se ele é compartilhado.

Terra → outro planeta → Terra não pode acumular recursos.

---

# Parte IV — As 12 melhorias

## 13. Melhoria 1 — Estado universal da cena

Criar estado serializável e versionado para UI, câmera, alvo, tempo solicitado,
camadas e seleção.

O estado da cena nunca deve conter nem sobrescrever:

```text
position_m
velocity_m_s
mu_m3_s2
```

Contrato conceitual:

```ts
export interface OrbisSceneStateV1 {
  version: 1;

  experience:
    | "orbital"
    | "atlas"
    | "earth"
    | "mission"
    | "events"
    | "journey";

  target: {
    type:
      | "body"
      | "mission"
      | "earth-place"
      | "event"
      | "journey";
    id: string;
  };

  requestedUtc?: string;

  camera: {
    mode:
      | "overview"
      | "orbit"
      | "surface"
      | "ride-along"
      | "observer";
    distance: number;
    headingDeg: number;
    pitchDeg: number;
    rollDeg: number;
  };

  layers: Array<{
    id: string;
    visible: boolean;
    opacity: number;
  }>;

  selection?: {
    type: string;
    id: string;
  };

  panel?: string;
}
```

Entregas:

- validação de schema;
- serialização;
- migração por versão;
- restauração após refresh;
- histórico de câmera;
- copiar link;
- restaurar padrão;
- fallback seguro.

Preferir fragmento:

```text
#scene=...
```

Coordenadas do observador só entram mediante consentimento explícito.

## 14. Melhoria 2 — Controlador temporal compartilhado

Criar um controlador de tempo de UI, sem misturar fontes científicas
incompatíveis.

Ele deve distinguir:

```text
snapshot de referência
integração N-body
observação local
trajetória de missão
camada temporal terrestre
conteúdo estático do Atlas
```

Contrato conceitual:

```ts
export interface OrbisTimeSelection {
  requestedUtc: string;
  mode: "paused" | "playing";
  rate: number;
  step: "second" | "minute" | "hour" | "day";
}

export interface TemporalSourceState {
  source:
    | "reference"
    | "nbody"
    | "science-api"
    | "mission-bundle"
    | "earth-layer"
    | "static";
  validFromUtc?: string;
  validUntilUtc?: string;
  interpolation: "none" | "visual-only" | "supported";
}
```

Regras:

- A UI pode compartilhar o UTC solicitado.
- Cada domínio valida sua própria cobertura.
- O Atlas não passa a gerar efemérides por receber um UTC.
- O N-body continua usando seu integrador e estado próprios.
- Camadas ativas limitam o intervalo disponível.
- Interpolação visual não altera valores numéricos.
- Requisições antigas são canceladas.
- Não extrapolar.

Controles:

- agora;
- play/pause;
- passo;
- velocidade;
- UTC;
- retorno ao início;
- cobertura;
- marcadores de evento.

## 15. Melhoria 3 — Sistema de camadas

Contrato:

```ts
export interface OrbisLayerDefinition {
  id: string;
  title: string;

  category:
    | "visual"
    | "scientific"
    | "missions"
    | "events"
    | "reference";

  kind:
    | "texture"
    | "raster-tiles"
    | "vector"
    | "markers"
    | "trajectory"
    | "geometry";

  temporal: boolean;
  opacitySupported: boolean;

  source: {
    name: string;
    attribution: string;
    license?: string;
  };

  coverage?: {
    validFromUtc?: string;
    validUntilUtc?: string;
  };

  status:
    | "static"
    | "snapshot"
    | "historical"
    | "near-real-time"
    | "live";

  limitations?: string[];
}
```

Funcionalidades:

- ligar/desligar;
- opacidade;
- legenda;
- fonte;
- época/data;
- cobertura;
- status;
- limitações;
- lazy loading;
- cancelamento;
- erro;
- descarte;
- persistência no estado da cena.

Camadas iniciais:

Planetário:

- órbitas osculantes;
- rótulos;
- eixos;
- mapa orbital;
- corpos com estado explícito.

Atlas/Terra:

- materiais procedurais;
- oceano;
- atmosfera;
- grade;
- nuvens estáticas;
- luzes noturnas;
- marcador do observador.

Uma camada invisível não deve continuar consumindo recursos sem necessidade.

## 16. Melhoria 4 — Busca universal e `fly-to`

Paleta acessível, preferencialmente:

```text
Ctrl+K
```

Categorias:

- corpos do snapshot;
- luas do catálogo;
- constelações;
- estrelas do catálogo;
- missões com manifesto;
- eventos;
- locais terrestres curados;
- jornadas;
- comandos.

Resultado normalizado:

```ts
export interface OrbisSearchResult {
  id: string;
  type:
    | "body"
    | "moon-metadata"
    | "constellation"
    | "star"
    | "mission"
    | "event"
    | "earth-place"
    | "journey"
    | "command";
  title: string;
  subtitle?: string;
  aliases?: string[];
  targetId?: string;
  hasPhysicalState: boolean;
}
```

`hasPhysicalState` evita que um resultado de catálogo seja tratado como
posição renderizável.

Controlador de câmera:

```ts
export interface FlyToRequest {
  targetId: string;
  cameraPreset?: string;
  durationMs?: number;
  requestedUtc?: string;
}
```

Requisitos:

- cancelar animação anterior;
- evitar atravessar corpo;
- ajustar clipping;
- manter histórico;
- respeitar movimento reduzido;
- não criar canvas;
- atualizar estado compartilhável;
- navegação por teclado;
- aliases localizados.

Busca de lugares externos não entra sem provedor aprovado. O MVP pode usar
pontos curados e projetos locais.

## 17. Melhoria 5 — Medições e comparação

### Fonte dos valores

Medidas científicas devem vir de:

- estado físico;
- snapshot;
- backend;
- dataset geodésico;
- manifesto científico explícito.

Nunca medir distância real a partir de coordenadas visuais comprimidas.

### Terra

Implementar quando suportado:

- coordenadas;
- distância geodésica;
- área;
- diferença de altitude;
- distância ao horizonte;
- perfil de elevação somente com terreno real.

Informar:

```text
Modelo geodésico: WGS84
```

### Espaço

Mostrar somente quando houver dados suficientes:

- distância centro a centro;
- distância entre superfícies;
- diâmetro;
- tamanho angular;
- separação angular;
- tempo-luz;
- velocidade relativa;
- período orbital.

Distinguir:

```text
valor físico
representação visual
```

### Comparador

Comparar dois corpos no mesmo renderer usando viewport/scissor.

Modos:

- tamanho físico;
- escala visual;
- silhueta;
- dados físicos;
- rotação/translação;
- órbitas, apenas quando houver estado apropriado.

Não criar segundo contexto WebGL.

## 18. Melhoria 6 — Jornadas guiadas

Criar motor declarativo de narrativa.

```ts
export interface OrbisJourneyStep {
  id: string;
  title: string;
  body: string;
  scene: OrbisSceneStateV1;

  media?: {
    type: "image" | "video";
    assetId: string;
    caption?: string;
  };

  durationMs?: number;
  waitForUser?: boolean;
  citations?: string[];
}
```

Funcionalidades:

- anterior;
- próximo;
- pausa;
- progresso;
- transcrição;
- teclado;
- sair e restaurar cena;
- movimento reduzido;
- fontes.

Primeiras jornadas:

1. Escala do Sistema Solar.
2. Terra e Lua.
3. Como um eclipse acontece.

Regras:

- Cena descreve UI/câmera, não estado físico.
- Dados numéricos vêm de fontes existentes.
- Jornada não pode inventar posição de lua.
- Assets precisam de atribuição.

## 19. Melhoria 7 — Explorador de missões

O Atlas auditado não é mapa de missão. Portanto, crie experiência dedicada:

```text
/missions
/missions/<id>
```

Ela pode reutilizar módulos de câmera, renderer e camadas, mas deve manter
semântica própria.

Contrato:

```ts
export interface MissionManifest {
  id: string;
  name: string;
  agency: string;
  launchUtc?: string;
  endUtc?: string;
  targetBodies: string[];
  trajectoryBundle?: string;
  milestones: MissionMilestone[];

  frame: string;
  timeScale: string;

  coverage: {
    validFromUtc: string;
    validUntilUtc: string;
  };

  sources: DataSource[];
}
```

Regras:

- trajetória exige fonte explícita;
- frame e escala temporal obrigatórios;
- não processar kernels inteiros no navegador;
- gerar bundles versionados em script/backend;
- segmentar trajetórias;
- carregar somente intervalo necessário;
- não extrapolar;
- fixture sintética é permitida apenas em testes e nunca como missão real.

MVP:

- infraestrutura;
- catálogo de missões;
- rota de detalhes;
- linha do tempo;
- marcos;
- modo acompanhar;
- trajetória real somente se houver bundle com fonte;
- ausência de bundle deve aparecer como indisponível.

## 20. Melhoria 8 — Earth Lab temporal

Adicionar ao contexto da Terra um sistema de camadas científicas datadas.

Arquitetura:

```text
manifesto de camada
        ↓
provedor aprovado
        ↓
tile loader
        ↓
adaptador visual da Terra
```

Requisitos:

- manifesto versionado;
- fonte;
- licença;
- atribuição;
- data;
- cobertura;
- resolução;
- legenda;
- cache LRU;
- orçamento de memória;
- cancelamento;
- fallback;
- antimeridiano;
- polos;
- carregamento sob demanda.

Comparação:

- A/B;
- divisor;
- fade;
- alternância;
- lado a lado;
- animação temporal.

Sem provedor aprovado:

- implementar contratos;
- implementar loader;
- usar fixture local em testes;
- manter recurso externo atrás de feature flag;
- não apresentar fixture como dado atual.

O Worker não deve virar proxy irrestrito de tiles.

## 21. Melhoria 9 — Centro de eventos

Criar experiência dedicada:

```text
/events
```

Categorias:

- astronomia;
- missões;
- Terra.

Contrato:

```ts
export interface OrbisEvent {
  id: string;
  category: "astronomy" | "mission" | "earth";
  title: string;
  startUtc: string;
  endUtc?: string;
  status?: string;
  targetIds?: string[];
  geometry?: unknown;
  source: DataSource;
  limitations?: string[];
}
```

Fontes iniciais:

- eclipses locais existentes;
- marcos de manifestos de missão;
- eventos terrestres somente por adaptador aprovado.

Regras:

- nenhum evento por heurística no frontend;
- geometria aproximada deve ser rotulada;
- selecionar evento atualiza câmera e UTC solicitado;
- filtros por tipo, data e alvo;
- fonte e atualização visíveis;
- testes sem dependência de rede pública.

## 22. Melhoria 10 — Modo superfície e terreno

Adicionar modo de superfície à Terra sem tentar reproduzir todo o Google Earth.

MVP:

- transição globo → superfície;
- câmera próxima;
- seleção de ponto;
- horizonte;
- grade;
- marcador;
- elipsoide WGS84;
- interface de provider de elevação;
- fallback sem relevo.

Contrato:

```ts
export interface TerrainProvider {
  id: string;

  getTile(
    request: TerrainTileRequest,
    signal: AbortSignal,
  ): Promise<TerrainTile | null>;

  getAttribution(): string;
  getCoverage(): TerrainCoverage;
}
```

Requisitos:

- LOD;
- frustum culling;
- horizon culling;
- coordenadas relativas à câmera;
- cache LRU;
- orçamento de GPU;
- descarte;
- transição;
- nenhuma segunda cena global;
- nenhum relevo inventado.

Sem dataset aprovado:

- entregar superfície no elipsoide;
- entregar provider;
- fixture somente em testes.

## 23. Melhoria 11 — Projetos, marcações e exportação

Criar projetos locais sem conta.

Formato:

```ts
export interface OrbisProject {
  schemaVersion: 1;
  title: string;
  description?: string;
  scenes: OrbisSceneStateV1[];
  annotations: OrbisAnnotation[];
  createdAtUtc: string;
  assets?: ProjectAssetReference[];
}
```

Funcionalidades:

- criar projeto;
- salvar localmente;
- marcador;
- caminho;
- área;
- anotação;
- salvar cena;
- ordenar cenas;
- exportar `.orbis.json`;
- importar `.orbis.json`;
- validar schema.

Segurança:

- não executar HTML;
- não executar URL;
- sanitizar texto;
- limitar tamanho;
- rejeitar versão desconhecida;
- avisar sobre coordenadas;
- não incluir observador sem consentimento.

Projeto não altera estado físico.

## 24. Melhoria 12 — Assistente contextual “Pergunte ao Orbis”

Criar arquitetura segura e uma primeira versão progressiva.

Contexto:

```ts
export interface OrbisAssistantContext {
  experience: string;
  targetId: string;
  requestedUtc?: string;
  visibleLayers: string[];
  selectedObjectId?: string;
  cameraMode: string;
  scienceResponseIds?: string[];
}
```

Regras:

- enviar contexto estruturado;
- não enviar credenciais;
- não enviar coordenadas sem consentimento;
- não calcular efemérides;
- não inventar valor;
- citar fonte e época;
- distinguir visual de científico;
- ações passam pelos controladores;
- assistente não manipula Three.js diretamente.

Ações permitidas:

- focar;
- abrir painel;
- ligar camada;
- iniciar jornada;
- navegar;
- ajustar câmera.

Sem provedor de IA:

- implementar UI;
- implementar contexto;
- responder localmente perguntas determinísticas de catálogo;
- marcar perguntas externas como indisponíveis;
- não colocar chave no frontend;
- não criar resposta simulada.

---

# Parte V — Arquitetura compartilhada

## 25. Módulos sugeridos

Adapte à árvore atual. Não crie estruturas duplicadas.

```text
app/
  atlas/
    earth/

  missions/
  events/
  journeys/
  projects/

  components/
    scene/
    camera/
    time/
    layers/
    search/
    measurements/
    journeys/
    missions/
    events/
    terrain/
    projects/
    assistant/

  lib/
    science/
    scene/
    camera/
    time/
    layers/
    search/
    measurements/
    journeys/
    missions/
    events/
    terrain/
    projects/
    assistant/
    validation/

public/
  atlas/
  missions/
  journeys/
  fixtures/
```

Prefira contratos independentes de React para:

- serialização;
- validação;
- cálculo geodésico;
- cache;
- manifests;
- normalização;
- estados assíncronos.

## 26. Ownership de recursos Three.js

Todo recurso deve possuir dono explícito.

Contrato conceitual:

```ts
export interface VisualAdapter {
  mount(context: RenderContext): void;
  update(state: VisualState): void;
  resize(viewport: Viewport): void;
  dispose(): void;
}
```

`dispose()` deve liberar apenas recursos do adaptador.

Não destruir o renderer compartilhado ao trocar de experiência.

## 27. Proveniência comum

Use contrato equivalente:

```ts
export interface DataSource {
  id: string;
  name: string;
  url?: string;
  license?: string;
  retrievedAtUtc?: string;
}

export interface DataProvenance {
  source: DataSource;
  dataset?: string;
  version?: string;
  epochUtc?: string;
  referenceFrame?: string;
  timeScale?: string;
  validFromUtc?: string;
  validUntilUtc?: string;
  generatedAtUtc?: string;
  limitations?: string[];
}
```

UI científica deve mostrar proveniência de forma legível.

---

# Parte VI — Ordem de implementação

## 28. Gates obrigatórios

### Gate A — Base

- inventário;
- TypeScript;
- testes;
- contratos científicos;
- capacidades.

### Gate B — Terra

- `/atlas/earth`;
- painéis;
- lifecycle;
- desktop/mobile;
- `501`.

### Gate C — Fundação compartilhada

Implementar melhorias:

1. estado da cena;
2. tempo;
3. camadas;
4. busca e câmera.

### Gate D — Ferramentas e narrativa

Implementar:

5. medições e comparação;
6. jornadas;
11. projetos.

### Gate E — Dados explícitos

Implementar:

7. missões;
9. eventos.

### Gate F — Terra avançada

Implementar:

8. Earth Lab;
10. superfície/terreno.

### Gate G — Assistente

Implementar:

12. assistente contextual.

Após cada gate, executar validações. Não acumular todos os erros para o final.

Recursos dependentes de provedor externo podem ficar atrás de feature flag,
desde que:

- contratos estejam completos;
- UI de indisponibilidade exista;
- testes usem fixture local;
- nenhuma alegação falsa de conclusão seja feita.

---

# Parte VII — Testes obrigatórios

## 29. Testes da base

- `tsc` sem erros;
- Worker tipado;
- Three.js tipado;
- lifecycle;
- catálogo;
- paginação;
- `501`;
- capacidades;
- ausência de detalhes internos;
- validação temporal;
- ausência de extrapolação.

## 30. Testes da Terra

- rota renderiza;
- HTML contém conteúdo essencial;
- usa um canvas;
- funciona sem binding;
- distingue vazio de indisponível;
- cancela requisição antiga;
- não persiste coordenadas;
- mostra limitações;
- Lua com estado explícito;
- descarte ao navegar.

## 31. Estado da cena

- round-trip;
- versão;
- fallback;
- URL;
- privacidade;
- nenhum vetor físico serializado.

## 32. Tempo

- play/pause;
- cobertura;
- fontes distintas;
- cancelamento;
- não extrapolar;
- Atlas estático não virar efeméride.

## 33. Camadas

- ativação;
- opacidade;
- atribuição;
- cobertura;
- lazy loading;
- erro;
- cancelamento;
- descarte.

## 34. Busca e câmera

- aliases;
- teclado;
- `hasPhysicalState`;
- cancelamento de `fly-to`;
- histórico;
- movimento reduzido;
- um renderer.

## 35. Medições

- unidades;
- WGS84;
- valores ausentes;
- origem física;
- separação entre escala física e visual;
- comparador no mesmo canvas.

## 36. Jornadas

- navegação;
- restauração;
- transcrição;
- fontes;
- nenhuma posição inventada.

## 37. Missões

- manifesto;
- frame;
- escala temporal;
- cobertura;
- trajetória segmentada;
- ausência de extrapolação;
- fixture não visível em produção.

## 38. Earth Lab

- manifesto;
- tile loader;
- cache;
- cancelamento;
- fallback;
- atribuição;
- data;
- offline.

## 39. Eventos

- normalização;
- filtros;
- fonte;
- geometria aproximada;
- integração com tempo e câmera.

## 40. Terreno

- entrar/sair;
- elipsoide;
- cache;
- descarte;
- câmera;
- fallback;
- sem segundo renderer.

## 41. Projetos

- export/import;
- schema;
- tamanho;
- sanitização;
- privacidade;
- `.orbis.json`.

## 42. Assistente

- contexto mínimo;
- ausência de localização;
- fontes;
- indisponibilidade;
- ações permitidas;
- nenhuma manipulação direta do renderer.

---

# Parte VIII — Performance, acessibilidade e documentação

## 43. Performance

Requisitos:

- um canvas por experiência compartilhada;
- um renderer;
- um loop principal;
- code splitting;
- lazy loading por rota;
- texturas sob demanda;
- cache limitado;
- descarte;
- cancelamento;
- limite de `devicePixelRatio`;
- suspensão quando aba oculta;
- nenhuma duplicação de `three`;
- nenhum fetch duplicado por chave;
- providers externos fora dos testes.

O chunk acima de 500 kB é aviso. Tente reduzir com code splitting e informe o
resultado.

## 44. Acessibilidade

- teclado;
- foco visível;
- contraste;
- `aria-live` moderado;
- conteúdo textual equivalente;
- tabelas;
- transcrição;
- movimento reduzido;
- não depender de cor;
- controles touch;
- desktop e mobile.

## 45. Internacionalização

- português funcional;
- arquitetura preparada para inglês;
- UTC como referência científica;
- data local apenas para exibição;
- unidades configuráveis;
- aliases pesquisáveis.

## 46. Assets e licenças

- manifesto por asset;
- fonte;
- licença;
- atribuição;
- data de aquisição;
- checksum quando apropriado;
- não copiar assets das referências;
- não baixar grandes datasets sem aprovação;
- não commitar bundle local indevidamente.

## 47. Documentação

Atualizar:

```text
docs/architecture.md
docs/physics.md
docs/data_sources.md
docs/limitations.md
docs/validation.md
docs/local-scientific-service.md
docs/orbital-visualization.md
docs/atlas-planet-visuals.md
docs/atlas-visuals/
```

Documentar também:

- schema de cena;
- tempo;
- camadas;
- busca/câmera;
- medições;
- jornadas;
- missões;
- eventos;
- Earth Lab;
- terreno;
- projetos;
- assistente;
- privacidade;
- lifecycle;
- feature flags;
- providers.

---

# Parte IX — Fora de escopo

## 48. Não implementar

- cópia de NASA Eyes;
- cópia de Google Earth;
- Street View;
- contas;
- colaboração multiusuário;
- deploy;
- push;
- túnel;
- proxy irrestrito;
- segredo no cliente;
- cálculo astronômico aproximado;
- extrapolação DE442s;
- posição de lua por elementos médios;
- modelo de eclipse operacional;
- meteorologia operacional;
- previsão de segurança;
- múltiplos renderers;
- substituição geral do Atlas;
- grandes downloads automáticos;
- reescrita física para atender animação.

---

# Parte X — Comandos

## 49. Desenvolvimento

```powershell
npm.cmd run dev
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run lint
```

## 50. Backend

```powershell
scripts\start_science_api.ps1
Invoke-RestMethod http://127.0.0.1:8000/api/health
backend\.venv\Scripts\python.exe -m pytest backend\tests
```

Não publique a porta.

## 51. Dados

Somente quando necessário:

```powershell
python scripts\fetch_spice_data.py
$env:PYTHONPATH = (Resolve-Path backend/src).Path
python scripts\export_frontend_snapshot.py
python scripts\update_moon_catalog.py
python scripts\build_star_catalog.py
python scripts\update_constellations.py
python scripts\generate_offline_bundle.py
python scripts\validate_data_manifest.py
```

Esses comandos podem exigir rede e ambiente adequado.

## 52. Validação final

```powershell
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run lint
backend\.venv\Scripts\python.exe -m pytest backend\tests
git diff --check
git status --short
```

Validação manual quando possível:

```text
1. Abrir `/`.
2. Verificar referência e N-body.
3. Confirmar que escala visual não altera estado SI.
4. Abrir `/atlas`.
5. Trocar todos os planetas.
6. Abrir `/atlas/earth`.
7. Testar com e sem binding.
8. Testar céu e eclipse.
9. Verificar Terra–Lua.
10. Compartilhar/restaurar cena.
11. Testar tempo, camadas e busca.
12. Medir e comparar.
13. Executar três jornadas.
14. Abrir missão disponível.
15. Abrir eventos.
16. Testar Earth Lab offline.
17. Entrar/sair de superfície.
18. Exportar/importar projeto.
19. Usar assistente sem localização.
20. Repetir em mobile.
21. Verificar console.
22. Verificar canvases, loops, listeners e memória.
```

---

# Parte XI — Critérios de aceite

## 53. Checklist final

- [ ] Alterações locais preexistentes foram preservadas.
- [ ] Nenhum arquivo não rastreado foi removido.
- [ ] Nenhum commit, push, deploy ou túnel foi realizado.
- [ ] `npx.cmd tsc --noEmit` passa.
- [ ] Testes frontend/Worker/SSR passam.
- [ ] Lint passa.
- [ ] Testes Python passam.
- [ ] `git diff --check` passa.
- [ ] Estado SI nunca é mutado pela visualização.
- [ ] Atlas continua descritivo, não uma efeméride fictícia.
- [ ] Luas sem estado explícito não são posicionadas.
- [ ] `501` continua sem fallback aproximado.
- [ ] `/api/capabilities` não expõe detalhes internos.
- [ ] `/atlas/earth` reutiliza o renderer.
- [ ] Terra funciona sem serviço científico.
- [ ] Céu e eclipse usam as APIs corretas.
- [ ] Coordenadas permanecem privadas por padrão.
- [ ] Estado da cena não serializa vetores físicos.
- [ ] Tempo diferencia fontes e coberturas.
- [ ] Camadas exibem fonte e data.
- [ ] Busca distingue metadado de estado físico.
- [ ] Medições usam dados físicos, não escala visual.
- [ ] Comparador usa o mesmo canvas.
- [ ] Existem três jornadas.
- [ ] Missões exigem trajetória explícita.
- [ ] Eventos não são inferidos no cliente.
- [ ] Earth Lab possui fallback offline.
- [ ] Superfície funciona no elipsoide sem relevo inventado.
- [ ] Projetos exportam/importam `.orbis.json`.
- [ ] Assistente não inventa ciência.
- [ ] Recursos Three.js são descartados.
- [ ] Conteúdo essencial existe em HTML acessível.
- [ ] Desktop e mobile foram verificados.
- [ ] Documentação e manifestos foram atualizados.
- [ ] Avisos restantes foram relatados honestamente.

---

# Parte XII — Relatório final

## 54. Formato obrigatório

Ao terminar, responder com:

1. estado inicial encontrado;
2. divergências em relação ao handoff;
3. correções TypeScript;
4. implementação da Terra;
5. resumo de cada uma das 12 melhorias;
6. contratos e schemas criados;
7. rotas e componentes adicionados;
8. arquivos alterados por domínio;
9. fontes, assets, licenças e feature flags;
10. resultado exato de cada comando;
11. testes manuais realmente executados;
12. limitações restantes;
13. aviso de bundle;
14. confirmação de ausência de commit, push, deploy e túnel;
15. confirmação de preservação das alterações locais.

Não declarar como implementado ou testado algo que não foi concluído.

---

# Parte XIII — Roteiro de implementação

Orientações de trabalho:

```text
Leia integralmente AGENTS.md e
ORBIS_SCIENTIA_IMPLEMENTATION.md antes de editar.

Trate ORBIS_SCIENTIA_IMPLEMENTATION.md como a especificação
autoritativa. Em caso de conflito, ela substitui os planos anteriores.

Comece pelo inventário seguro e preserve todas as alterações locais e arquivos
não rastreados. Não execute reset, checkout, restore, clean, stash, rebase,
commit ou push. Não faça deploy, não publique porta e não crie túnel.

Primeiro faça npx.cmd tsc --noEmit passar sem esconder erros. Depois implemente
os gates na ordem definida.

Preserve os valores SI, a época, o referencial e a procedência. Não transforme
escala visual em estado físico, não posicione luas sem estado explícito, não
extrapole DE442s e não crie fallback astronômico para respostas 501.

Mantenha um único canvas, renderer e loop compartilhado no Atlas. Use rotas
dedicadas para missões e eventos, sem transformar o Atlas descritivo em uma
efeméride ou mapa de missão fictício.

Execute as validações após cada gate e entregue o relatório final no formato
da seção 54. Não afirme que algo foi testado se não foi executado.
```
