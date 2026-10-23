# Handoff técnico — Orbis Scientia

> Atualizado em 2026-09-22. Este é o ponto de partida para outro agente.
> O working tree possui mudanças locais importantes ainda não consolidadas em commit.

## Atualização de estabilização C1–C6 — 2026-09-22

Executado o escopo de correção do documento fornecido em 22/09; as evoluções
opcionais da seção 4 não foram implementadas. Os registros abaixo das seções
históricas não substituem as evidências desta rodada em `docs/validation.md`.

- C1: cobertura IERS verificada antes de AltAz e de janelas de planejamento;
  `IERS_DATA_UNAVAILABLE`/503 distingue tabela ausente, previsões vencidas,
  cobertura insuficiente e interpolação indisponível. Somente `InvalidUtcError`
  vira erro sintático 422 nas rotas de observador. Outros defeitos continuam
  erros internos sanitizados. Gateway e Terra exibem indisponibilidade sem
  inventar resultados nem buscar um fallback científico aproximado.
- C2: nascer/pôr usa `itertools.pairwise`; regressões incluem planejamento
  diário/anual circumpolar, sempre abaixo, cruzamentos e ausência de noite.
- C3: o Worker valida o envelope v1 pelo decoder compartilhado e preserva
  disponibilidade/status/método de cada operação nativa. Catálogos e referência
  fixa continuam capacidades próprias do Worker; JSON acessível não comprova
  disponibilidade científica.
- C4: comparação temporal do snapshot é estrita, com offsets e precisão de
  microssegundos. ISO com segundos obrigatórios, fração de 1–6 dígitos e
  `Z`/`z`/offset HH:MM são aceitos; ausência de offset significa UTC.
  Datas arbitrárias, inválidas e offsets como `+00:60` são rejeitados. Astropy
  conserva suporte nativo a leap seconds reais; eles não equivalem à época fixa.
- C5: helpers tipados preservam a resposta completa anterior após falhas e
  novas tentativas. Terra separa o erro atual da identidade original (UTC,
  latitude, longitude e elevação), marca resultado anterior/desatualizado e
  mantém cancelamento/controle de geração. A espera conjunta céu/eclipse foi
  mantida; separar as consultas continua sendo evolução opcional.
- C6: ESLint ignora caches Python, ambientes virtuais e saídas geradas sem
  afrouxar regras de código. O link `/missions` da home usa `next/link`.
  O cache pytest não foi apagado nem teve permissões alteradas.

Validação final: build + 61 testes frontend/Worker, TypeScript e lint aprovados;
backend com 56 aprovados, 1 ignorado e 18 avisos; whitespace do índice e do
working tree sem erros. Não houve nova QA visual de navegador/dispositivo.

Pendência operacional: IERS_Auto local contém previsões desde 2026-07-31,
com aproximadamente 53,53 dias de idade e limite de 30. São Paulo em
2026-08-05 retorna corretamente 503 com motivo `expired-prediction` até uma
atualização controlada dos dados. UMi a 80°N em 2024-04-08 retorna 200.
Não desativar `auto_max_age` nem habilitar downloads de runtime para contornar
esse bloqueio. Procedimento e limitações estão em `docs/validation.md`.

Git: branch `main`, 80 caminhos staged, 76 unstaged e 45 untracked no fim desta
rodada (categorias podem sobrepor). Nenhum arquivo foi staged por esta execução.
O índice isolado NÃO representa o código testado. Foram preservadas alterações
anteriores; os arquivos tocados nesta correção estão enumerados na validação.
Nenhum commit, push, deploy, túnel, atualização de dependência ou novo ZIP.
O `orbis-scientia-handoff-2026-08-18.zip` não é um pacote atualizado.

## 1. Objetivo, leitura inicial e autoridade

Orbis Scientia é uma bancada científica e visual do Sistema Solar. O princípio
central é preferir procedência, limites explícitos e ausência declarada de dados
a uma animação apenas plausível. O fluxo atual é local: não criar commit, push,
deploy, túnel ou publicação de porta sem pedido explícito.

Antes de editar, leia AGENTS.md, este arquivo, README.md,
ORBIS_SCIENTIA_IMPLEMENTATION.md, docs/architecture.md,
docs/physics.md, docs/data_sources.md, docs/limitations.md,
docs/local-scientific-service.md e docs/validation.md.

## 2. Contratos físicos invioláveis

Os campos abaixo são a fonte física e jamais podem ser escritos pelo renderer,
câmera, escala, URL, camada ou componente de UI:

    position_m
    velocity_m_s
    mu_m3_s2
    epoch / time scale
    reference frame

Fluxo obrigatório:

    DE442s/SPICE ou Velocity-Verlet
        -> estado físico em SI
        -> adaptador visual declarativo
        -> posição de cena, câmera e interface

- Unidades internas: metros, segundos e m³/s².
- Estados de referência: J2000/ICRF-like, Solar System Barycenter e SPICE ET/TDB.
- Velocity-Verlet de passo fixo é o integrador padrão; DOP853 requer SciPy.
- O N-body é newtoniano de massas pontuais, sem J2, relatividade, marés,
  pressão de radiação ou subpassos hierárquicos de luas.
- Órbitas desenhadas são osculantes, derivadas do estado corrente; não são
  previsões de efeméride.
- O DE442s nunca é extrapolado.
- Uma lua só entra na cena com fonte explícita de estado. Elementos médios JPL
  são metadados pesquisáveis, não efemérides visuais.

## 3. Dados disponíveis e procedência

- public/reference-snapshot.json contém 10 corpos: Sol, Mercúrio, Vênus,
  Terra, Lua, Marte, Júpiter, Saturno, Urano e Netuno; época
  2026-08-05T00:00:00; fonte NAIF SPICE DE442s.
- data/ contém kernels NAIF/DE442s, manifestos SHA-256, catálogo JPL de 460
  luas, subconjunto Gaia DR3 de 10.000 estrelas e artefatos IAU.
- Luas: Terra 1, Marte 2, Júpiter 115, Saturno 291, Urano 30, Netuno 16 e
  Plutão 5. Somente a Lua tem estado exato exibível; faltam SPKs dos satélites
  gigantes.
- Gaia mantém magnitude, movimento próprio e paralaxe, mas não é o censo
  completo do céu.
- As 88 constelações são regiões IAU. Fronteiras formais não são asterismos
  nem linhas culturais; linhas culturais continuam desativadas sem fonte
  autorizada.

Os scripts em scripts/ reproduzem download, exportação, catálogos, bundle e
manifestos. Não baixar nem regenerar dados sem necessidade e ambiente apropriado.

## 4. Arquitetura

| Área | Arquivos principais | Responsabilidade |
| --- | --- | --- |
| Planetário | app/page.tsx e app/components/SolarSystemScene.tsx | Referência DE442s, N-body no navegador, catálogo, céu e eclipse. |
| Visualização orbital | app/components/orbital/VisualScaleMapper.ts | Modos real, visual e focus sem mutar vetores físicos. |
| Atlas | app/components/PlanetSurfaceExplorer.tsx | Único canvas, renderer, cena e loop Three.js de cada rota visual. |
| Atlas compartilhado | PlanetSurfaceLoader.tsx e AtlasPlanetaryWorkspace.tsx | Montagem cliente e estado compartilhado. |
| Janela da Terra | app/components/earth/EarthAtlasWorkspace.tsx | Painéis científicos e visuais sobre a cena existente. |
| Constelações | app/components/earth/ConstellationObservatory.tsx | Observatório AltAz retornado pelo backend. |
| Ciência no cliente | lib/science/ e app/components/science/ | Gateway, decoders em runtime e estados de erro. |
| Núcleo Python | backend/src/astro_system/ | Dinâmica, DE/SPICE, tempo, AltAz, eclipse, catálogos e FastAPI. |
| Worker | worker/index.ts e worker/scientific-api.ts | Snapshot/catálogos edge e proxy privado opcional. |

Tecnologias: React 19, Vinext/Vite, Three.js direto, Python 3.12, FastAPI,
Astropy, SciPy e Cloudflare Worker. Não há React Three Fiber nem Babylon.

## 5. Rotas de produto e renderer

- /: planetário orbital científico.
- /atlas: Atlas procedural dos nove planetas.
- /atlas/earth: Janela da Terra, sobre a mesma cena Atlas.
- /atlas/earth/constellations: observatório de constelações, no mesmo ciclo de
  vida do PlanetSurfaceExplorer.
- /atlas/journeys, /atlas/missions e /atlas/events: rotas narrativas/de dados
  sem segundo canvas.
- /missions, /missions/:id e /events: rotas públicas de manifestos/eventos
  sem canvas.

Cada rota visual deve manter um canvas.atlas-webgl, um WebGLRenderer, uma cena
e um loop. Rotas narrativas não montam Three.js. Geometria e materiais precisam
ser descartados na troca de planeta, camada e desmontagem.

### Atlas visual

- Nove corpos: Mercúrio, Vênus, Terra, Marte, Júpiter, Saturno, Urano, Netuno
  e Plutão.
- Perfis tipados e PBR procedural: superfície multiescala, normal e roughness,
  oceano mascarado, nuvens e atmosfera Rayleigh/Mie aproximada.
- Vistas orbital e de aproximação usam a mesma câmera. Em high, corpos
  rochosos usam patch curvo local; o globo não vira um plano desconexo.
- Qualidade auto, low, medium e high; o HUD local pode mostrar renderer.info.
- Nenhuma textura, modelo ou asset comercial externo é carregado. As fontes
  visuais de referência estão em public/atlas/CREDITS.md.

## 6. Estado compartilhável e ferramentas B–E

OrbitalSceneStateV1, em lib/atlas/scene/, é o contrato de apresentação
serializado no fragmento URL. Contém experiência, alvo, requestedUtc, câmera,
camadas, seleção e painel. Não pode conter vetor SI, latitude, longitude,
elevação, endereço da API, binding, token ou credencial. Links antigos com utc
são migrados para requestedUtc e não devem reserializar o campo legado.

requestedUtc organiza a apresentação; não prova que existe efeméride naquela
data e não pode disparar interpolação visual escondida.

- Medições geodésicas usam Vincenty/WGS84. Medições espaciais usam somente
  position_m e velocity_m_s existentes; sem eles, o resultado é indisponível.
- Comparador: dois viewports scissor do mesmo renderer, somente referência
  relativa e ampliação visual. Distância de tela não é física.
- Jornadas: três manifestos locais com transcrição, fontes e cenas
  declarativas; não há movimento automático.
- Projetos: schema 1 local, exportação .orbis.json, importação até 500 kB,
  validação e sanitização. Coordenadas do observador não persistem.
- Missões: manifests com agência, frame, cobertura, marcos e fontes. Apollo 11
  é not-applicable/no-trajectory; não exibir posição ou velocidade sem
  trajetória publicada.
- Eventos: normalizados, filtráveis e sempre com fonte/limite; não inferir
  geometria no navegador.
- Earth Lab: a camada externa está atrás de EARTH_LAB_FEATURE_FLAG = false. A
  fixture é offline e não geográfica; o loader é cancelável/LRU. O terreno
  elipsoidal retorna null, sem altura inventada.
- Assistente: não há provedor de IA externo. As respostas locais são
  determinísticas; o contexto não inclui localização, credenciais ou acesso ao
  renderer. Perguntas científicas indisponíveis não recebem estimativa.

## 7. Observatório de constelações — fase F

Rota: /atlas/earth/constellations.

- Formulário explícito de latitude, longitude, elevação e UTC. Os valores ficam
  somente no estado da página e não entram em hash ou links.
- O backend executa ICRS -> GCRS/ITRS -> AltAz com EarthLocation WGS84, UTC,
  pressão de 0 hPa e IERS offline. O cliente não calcula AltAz nem cria
  fallback para 501.
- O palco usa o mesmo canvas, câmera, renderer e loop. Na visão de observador,
  globo e estrelas procedurais são ocultos; estrelas vêm apenas da resposta
  Gaia/AltAz validada.
- Usa BufferGeometry, Points e LineSegments; não criar um objeto Three por
  estrela. Segmentos abaixo do horizonte não são desenhados.
- Convenção visual: +Y zênite, +Z norte e +X leste; azimute N=0° e E=90°.
- Camadas: estrelas Gaia, fronteiras IAU, constelação selecionada, grade de
  horizonte, cardeais e linhas culturais desativadas.
- O pipeline offline gera 88 guias, 775 segmentos de borda J2000 e uma
  declaração de cross-match WGSN indisponível. Nunca inferir nomes de estrelas
  por proximidade ou Gaia ID.
- O planejamento mensal é apenas triagem geométrica de escuridão/altura; não
  considera clima, relevo, obstruções, equipamento ou melhor horário futuro.

## 8. Fundação científica e segurança — fase G

O fluxo dinâmico local é UI -> ScienceGateway -> FastAPI. O Worker serve
snapshot/catálogos e, sem binding privado, retorna indisponibilidade explícita.
Nenhum cálculo astronômico roda no Worker.

### Contratos HTTP

Sucessos incluem schema_version: 1 e meta com request_id, data UTC gerada,
serviço, versão e capability. Erros usam envelope estável error, não o detail
padrão do FastAPI. Decoders TypeScript rejeitam versão desconhecida, vetores sem
três componentes, valores não finitos, contatos inválidos e catálogos/capacidades
malformados.

| Rota | Método canônico | Worker sem backend nativo |
| --- | --- | --- |
| /api/health e /api/capabilities | GET | estado edge, sem topologia privada |
| /api/reference/state | GET | snapshot fixo somente na época exata |
| /api/catalogs/moons, /stars, /constellations | GET | catálogo estático validado |
| /api/sky e /api/sky/constellations | POST JSON | 501 SCIENCE_SERVICE_UNAVAILABLE |
| /api/eclipses/local e /api/simulate | POST JSON | 501 SCIENCE_SERVICE_UNAVAILABLE |

GET de céu, constelações e eclipse é compatibilidade depreciada; GET de
simulação retorna 405. OPTIONS declara métodos por rota.

### Privacidade, cache e provider

- Latitude, longitude, elevação e UTC do observador seguem no corpo POST; não
  entram em URL canônica, hash, armazenamento ou log.
- O Worker limita corpo a 64 KiB, remove query de POST, não encaminha Cookie ou
  Authorization e aplica allowlist de headers ao proxy.
- Health, capabilities, operações dinâmicas e erros usam Cache-Control:
  private, no-store. Snapshot/catálogos edge usam public, max-age=3600.
- X-Request-ID é validado por [A-Za-z0-9._-]{1,64} ou gerado; não incorpora
  dados de observador, token ou topologia.
- O provider DE442s nasce no lifespan, verifica manifesto, usa SpiceyPy quando
  instalado ou leitor DE somente leitura, reutiliza recursos e fecha no
  shutdown. Falta/corrupção de kernel degrada capacidades sem derrubar
  health/catálogos.
- UTC de entrada, UTC canônico e TDB/ET são distintos. A conversão usa Astropy;
  não reintroduzir offset universal fixo.
- IERS permanece offline e a resposta expõe o estado real da tabela.

### Limites científicos específicos

- Backend N-body: 2–10 corpos, até 20.000 passos, duração absoluta até um ano,
  passo até 86.400 s e uma execução local por vez.
- Navegador N-body: passo físico de 3.600 s, 1–24 subpassos por atualização,
  clone da entrada e pausa no último estado finito em singularidade.
- Eclipse: parcial usa C1/MAX/C4; total/anular usa C1/C2/MAX/C3/C4. O método
  não é Besseliano nem operacional.

## 9. Git e pacote

Branch main, HEAD 1f783a1 (Integrate local live sky and eclipse calculations),
dois commits à frente de origin/main.

Na inspeção de 2026-08-19 havia 80 arquivos staged, 75 caminhos unstaged e
41 arquivos não rastreados. AM e MM significam conteúdo novo no working tree
além da versão staged: o índice não é uma fotografia completa. Há fontes novas
para constelações, contratos científicos, Docker, rotas e testes. Preserve tudo:
não usar reset, checkout, restore, clean ou stash destrutivo.

Arquivos temporários que não devem entrar em commit: logs de desenvolvimento
e tsconfig.tsbuildinfo.

Existe orbis-scientia-handoff-2026-08-18.zip, 35,7 MB e 216 entradas. Ele foi
criado antes das fases F/G e não é um pacote atualizado do working tree. Ao
recriar um ZIP, incluir código, documentação, testes, assets públicos e data/;
excluir .git, node_modules, backend/.venv, builds, caches, logs e .env*.

## 10. Validação atual — 2026-08-19

| Comando | Resultado |
| --- | --- |
| npx.cmd tsc --noEmit | passou |
| npm.cmd run lint | passou sem erros |
| npm.cmd test | build passou; 18 testes Node/SSR/Worker e 37 testes TypeScript passaram |
| backend/.venv/Scripts/python.exe -m pytest backend/tests | 34 passaram, 1 pulado; avisos do TestClient e ERFA sobre datas distantes |
| git diff --check e git diff --cached --check | sem erros de whitespace; apenas avisos LF→CRLF do Git |

O build ainda avisa sobre chunk minificado acima de 500 kB e classificação
Unknown de algumas rotas pelo analisador estático do Vinext. São avisos, não
falhas. A documentação registra inspeções manuais anteriores de desktop/mobile;
esta atualização não executou nova inspeção de browser.

## 11. Comandos de trabalho

    # frontend
    npm.cmd run dev
    npm.cmd test
    npx.cmd tsc --noEmit
    npm.cmd run lint

    # backend local
    scripts\start_science_api.ps1
    Invoke-RestMethod http://127.0.0.1:8000/api/health
    backend\.venv\Scripts\python.exe -m pytest backend\tests

    # dados, somente quando necessário
    python scripts\fetch_spice_data.py
    $env:PYTHONPATH = (Resolve-Path backend/src).Path
    python scripts\export_frontend_snapshot.py
    python scripts\update_moon_catalog.py
    python scripts\update_constellations.py
    python scripts\build_star_catalog.py
    python scripts\generate_offline_bundle.py
    python scripts\validate_data_manifest.py

## 12. Próximos passos seguros

1. Antes de qualquer commit, revisar separadamente git diff --cached e git diff,
   então decidir se as mudanças posteriores devem ser adicionadas.
2. Ao tocar UI, preservar a separação entre OrbitalSceneStateV1 e estado
   científico; validar desktop/mobile, console e ciclo de recursos WebGL.
3. Ao tocar API, manter schema, request ID, POST canônico, contratos de erro,
   sanitização de proxy, limites de corpo e ausência de fallback.
4. Ao tocar dados científicos, atualizar manifesto, proveniência, limitações e
   testes. Nunca transformar artefato de catálogo em estado físico.
5. Não afirmar precisão operacional para céu, eclipse, constelações ou terreno
   fora dos limites explicitamente documentados.
