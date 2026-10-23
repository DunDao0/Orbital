# Architecture

Orbis Scientia separates reference data, closed-system dynamics, catalogs and visualisation.  `backend/src/astro_system/ephemeris` reads an exact-epoch DE442s state.  It never substitutes a visual orbit if a kernel is absent. `dynamics` is a point-mass Newtonian closed N-body system; it uses SI units and has a fixed-step velocity-Verlet path plus a SciPy DOP853 adapter when SciPy is available.

The browser viewer receives a labelled fixed-epoch state in `public/reference-snapshot.json`. Its N-body control applies velocity-Verlet directly to the received positions and velocities; trails/paths are not supplied as artwork. The viewer says explicitly that the projection and radii are logarithmically exaggerated.

The local FastAPI service is intentionally separate. It exposes reference state, N-body run, topocentric sky, local eclipse candidate calculation and catalog endpoints. A production deployment of the static viewer must be paired with a separately operated API to perform new-date SPICE, sky or eclipse calculations.

## Atlas routes and shared scene contract

The Atlas has one owner for each mounted Three.js experience: one canvas, one
renderer and one animation loop. The Earth window reuses that owner; routes
`/missions`, `/missions/:id` and `/events` deliberately render accessible data
panels only, not an extra scene.

`OrbitalSceneStateV1` serializes presentation intent only: `experience`,
target, `requestedUtc`, camera, layers, selection and panel. Legacy v1 links
that used `utc` are migrated on read, while new links serialize only
`requestedUtc`. No SI vector, observer coordinate, API address, binding or
credential is part of a shared scene.

`DataSource` and `DataProvenance` in `lib/science/contracts.ts` define the
safe common vocabulary for source, licence, epoch, frame, time scale, coverage
and limitations. They are presentation metadata, not a substitute for the
underlying physical state.

`AtlasPlanetaryWorkspace` mantém o contrato de cena também em `/atlas`: a
troca de planeta atualiza o alvo serializado e restaura o mesmo fragmento após
refresh. `AtlasFoundationPanel` é compartilhado por `/atlas` e
`/atlas/earth`; suas ferramentas avançadas ficam em seções HTML expansíveis.
Em telas pequenas, `AtlasResponsiveDrawer` apresenta esses controles como um
painel inferior, sem montar canvas, renderer ou loop adicional.

As rotas de missões, eventos e jornadas continuam sem WebGL. Quando o usuário
aplica uma seleção, elas navegam para `/atlas/earth` com um `sceneHash`
validado que contém apenas seleção, UTC solicitado e intenção de câmera. A
Janela da Terra restaura esse estado no renderer já existente; nenhuma
trajetória ou geometria ausente é criada durante a transferência.

## Constellation observatory

`/atlas/earth/constellations` reuses `PlanetSurfaceExplorer`. In `observer`
mode its globe and procedural starfield are hidden, then one disposable group
of `Points` and `LineSegments` receives only the backend AltAz response. There
is no second canvas, renderer, scene or animation loop. The serializable scene
may contain selection, observer camera and layers, but never observer
coordinates or a scientific response. The static guide catalogue works without
the native backend; `/api/sky/constellations` has the same stable Worker 501
behaviour as other live-sky routes.

## Fase G: gateway e ciclo de vida científico

`lib/science/client.ts` é o único gateway do frontend para referência,
catálogos, céu, eclipse e simulação. Respostas passam por decoders runtime
antes de entrar no estado React; falha de contrato não é convertida em dado.
Coordenadas de observador usam POST JSON e não entram no endereço.

`worker/index.ts` delega toda rota científica a uma única tabela em
`worker/scientific-api.ts`. Snapshot e catálogos são artefatos estáticos; céu,
eclipse e simulação são proxy ou 501, nunca uma implementação alternativa.

No FastAPI, o lifespan possui o provider DE442s verificado, o status dos
catálogos, IERS offline e o semáforo N-body. O provider é reutilizado entre
requests e fechado no shutdown. Kernels ausentes degradam capacidades sem
derrubar health ou catálogos.

## Superfície de trabalho unificada

A navegação global organiza o produto em dois eixos: exploração (`Sistema
Solar`, `Atlas`, `Terra` e `Constelações`) e investigação (`Missões` e
`Eventos`). A rota orbital continua sendo a bancada científica, mas sua
abertura expõe primeiro o estado ativo, os inventários verificáveis e os
caminhos de continuidade antes dos painéis analíticos extensos.

Essa composição não altera ciência ou ownership gráfico. O planetário mantém
seu próprio canvas; o Atlas mantém um único `canvas.atlas-webgl`, renderer e
loop por experiência; rotas narrativas continuam sem WebGL. Os números do
resumo vêm de `data-status.json`, e nenhum cartão de navegação produz estado
físico.
