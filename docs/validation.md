# Validation report — local run

Run time: 2026-08-12. `backend/.venv/Scripts/python.exe -m pytest backend/tests -q` ran 14 tests successfully: two-body orbital closure, energy conservation, forward/backward reversibility, barycentre, collision/singularity handling, artificial eclipse classifications, DE442s scale state, no-extrapolation, catalog inventories, offline FastAPI endpoints, the 88-constellation inventory, live observer/eclipses coverage, and paginated moon-catalogue search without inventing ephemerides.

The 128-body synthetic performance fixture ran 20 Velocity-Verlet steps in 3.5567331 s, or 177.8367 ms per step. This is CPU calculation only and must not be reported as browser FPS.

Kernel integrity validation checked 3/3 files against the generated SHA-256 manifest. The generated data inventory records 460 JPL catalog moons, 10,000 Gaia DR3 stars and 88 IAU constellations. The frontend production build and its 6 tests completed successfully. The local moon endpoint serves 80-item pages with `total=460`; `Ganymede` filtered by `Jupiter` returns exactly the named JPL catalogue record without constructing a position from its mean elements.

The local observer endpoint was exercised at SÃ£o Paulo (-23.5505, -46.6333, 760 m) on 2024-04-08 at 12:00 and 18:00 UTC and returned different solar altitudes, proving that the UTC input reaches the topocentric calculation. The 2024-04-08 eclipse candidate endpoint at Kerrville, Texas (30.0474, -99.1403, 500 m) classified the event as total, returned maximum at 18:34:24 UTC and contacts at 17:14:52, 18:32:10, 18:36:38 and 19:55:35 UTC. NASA's Kerrville feed documented totality from 1:32 p.m. to 1:36 p.m. local time, so the calculated internal contacts fall within that published minute-level interval. This is a classification/contact smoke validation only.

On this PC, the same 36-hour local eclipse search completed in 6.565 s after warm-up. This is a local candidate-search latency, not an operational-prediction performance claim.

No three-event NASA accuracy claim is made. The current local eclipse module uses topocentric apparent discs, 10-minute candidate brackets, Brent contact roots and a bounded minimum with Astropy's builtin ephemeris. It flags itself as not a Besselian DE442+IERS prediction and therefore does not meet the requested operational eclipse error targets.

## Implementação mestre — 2026-08-18

Após alinhar o contrato de cena, as rotas de dados e o carregamento cliente do
Atlas, `npx.cmd tsc --noEmit` passou sem `skipLibCheck`. `npm.cmd test` passou
com 11 testes Node/SSR/Worker e 17 testes TypeScript; os testes incluem o
round-trip e a migração de `requestedUtc`, `hasPhysicalState`, `.orbis.json`,
manifests de missão sem trajetória e as rotas `/missions`,
`/missions/apollo-11` e `/events` sem canvas. `npm.cmd run lint` terminou com
0 erros e o aviso preexistente de dependência de hook em `app/page.tsx`.
`backend/.venv/Scripts/python.exe -m pytest backend/tests` passou 14 testes,
com o aviso de depreciação de `TestClient`.

A inspeção manual local confirmou um canvas no `/atlas/earth`, alternância dos
nove corpos e da aproximação de superfície sem novo erro de console, rotas de
missões/eventos sem canvas e o mesmo resultado em 390 × 844. Essa verificação
não fez deploy, publicou porta nem configurou túnel.

## Visualização orbital — 2026-08-17

`npm.cmd test` concluiu a compilação de produção, 7 testes de renderização/Worker e 3 testes de contrato da escala visual. Esses testes verificam que o mapeamento visual é monotônico, que o modo proporcional conserva as razões de distância e que o foco não cria luas fora da fonte de estado. `backend/.venv/Scripts/python.exe -m pytest backend/tests` concluiu 14 testes com um aviso de depreciação do `TestClient`.

A prévia de produção local foi aberta e os controles foram exercitados: seleção de Marte, foco, retorno à escala visual, mapa orbital e o vínculo explícito para a ficha de Marte no Atlas. A instância de desenvolvimento em `localhost:3000` encontrada nesta máquina estava registrada, porém não respondia; ela foi preservada e não foi encerrada.

## Observatório de constelações — 2026-08-18

Foram executados `npx.cmd tsc --noEmit`, `npm.cmd test`,
`npm.cmd run lint`, `backend/.venv/Scripts/python.exe -m pytest backend/tests`
e `git diff --check`. TypeScript passou. O build/teste do frontend passou com
12 testes Node/SSR/Worker e 21 testes TypeScript; inclui a rota
`/atlas/earth/constellations`, catálogo estático de 88 guias, Worker 501/proxy,
vetor AltAz, magnitude monotônica, recorte do horizonte e hash sem localização.
O pytest passou 16 testes; há somente o aviso externo de depreciação
`starlette.testclient`/httpx. O lint não teve erros e reteve o aviso
preexistente de dependência de hook em `app/page.tsx`. O build reteve o aviso
de chunk minificado acima de 500 kB.

A inspeção manual da shell local confirmou a rota, a navegação lateral, campos
com rótulos, as camadas acessíveis e o layout em desktop e 390 × 844 sem
overflow horizontal. Não foi possível validar o palco AltAz no navegador nesta
rodada porque o processo que já ocupava `127.0.0.1:8000` respondeu com o
contrato antigo de constelações; ele foi preservado. A página agora detecta essa
versão antiga e instrui reiniciar a API local, em vez de exibir dados parciais.
O endpoint da implementação atual foi validado por TestClient e pelos 16 testes
Python. Nenhum deploy, túnel ou publicação de porta foi realizado.

## Fase G — fundação científica, contratos e segurança — 2026-08-18

O baseline da fase passou em `npm.cmd test`, `npx.cmd tsc --noEmit`,
`npm.cmd run lint` e no pytest então existente. A validação final encontrou e
corrigiu duas expectativas de frontend introduzidas durante a fase: o teste SSR
ainda procurava o rótulo genérico `SPICE`, e o carregamento inicial chamava uma
função que atualizava estado de forma síncrona a partir de um efeito. Após as
correções, `npm.cmd test` terminou com 18/18 testes Node/SSR/Worker e 36/36
testes TypeScript, incluindo o build de produção; o build reteve apenas o aviso
de chunk minificado acima de 500 kB. `npx.cmd tsc --noEmit` e
`npm.cmd run lint` terminaram sem erros ou avisos.

`backend/.venv/Scripts/python.exe -m pytest backend/tests` terminou com 34
testes aprovados e uma comparação opcional ignorada porque SpiceyPy não está
instalado. Permaneceram avisos externos: a depreciação de
Starlette `TestClient`/httpx e avisos ERFA de ano duvidoso ao exercitar as
extremidades históricas da cobertura. O validador offline confirmou 3 kernels,
460 luas, 10.000 estrelas, 88 constelações, 10 corpos no snapshot e 7 entradas
de manifesto, incluindo igualdade entre cada cópia pública e sua origem.

Uma medição local isolada registrou 154,871 ms para inicializar o provedor,
466,584 ms para a primeira consulta de referência e 7,573 ms para a segunda,
com `load_count=1` e vetores idênticos. O caso de 20.000 passos com dois corpos
respondeu HTTP 200 em 593,587 ms, dos quais 584,660 ms foram atribuídos ao
cálculo. A busca manual de eclipse local observada no navegador levou
5.901,517 ms; esses números caracterizam somente esta execução e esta máquina.

A inspeção manual local, feita com o navegador integrado, confirmou um único
canvas no planetário e no Atlas, ausência de overflow em 1440 × 900 e 390 ×
844, rotas narrativas sem canvas e console sem novos erros. Com o backend
disponível, foram exercitados referência, céu, eclipse e simulação com respostas
privadas e IDs de requisição. Com o backend interrompido, o snapshot fixo só foi
aceito em sua época declarada, os cálculos dinâmicos retornaram o contrato 501 e
o último resultado confirmado permaneceu visível. O N-body foi exercitado
manualmente em uma velocidade e automatizadamente em duas velocidades; o teste
de teclado não foi concluído pela ferramenta e não é reivindicado.

`docker --version`, `docker compose version` e `docker compose config` foram
tentados, mas o executável Docker não existe nesta máquina; por isso o build e
a execução do contêiner não foram validados. Nenhum deploy, túnel, publicação
de porta, commit, push ou alteração de credencial foi realizado.

## Correção visual e integração do Atlas — 2026-08-19

A revisão em navegador confirmou que os renderizadores já desenhavam os
planetas, mas o canvas orbital herdava a altura dos painéis laterais e seu
centro ficava abaixo da primeira dobra. O layout agora mantém o palco com
altura própria e, no celular, o apresenta antes dos controles extensos. Em
1280 × 720, o centro do canvas orbital ficou em aproximadamente 620 px; em
390 × 844, ficou em aproximadamente 745 px. Ambos permaneceram sem overflow
horizontal.

No Atlas móvel, Marte ficou visível na primeira tela e o painel inferior de
ferramentas ocupou 736 px quando expandido. Na Terra móvel, o canvas começou
em aproximadamente 427 px e a altura total da página caiu de cerca de 15.554
px para 3.120 px com as ferramentas avançadas recolhidas. `/atlas` e
`/atlas/earth` mantiveram um único `canvas.atlas-webgl`.

Foram exercitados no navegador: troca Marte → Terra com atualização do hash,
`Ctrl+K` em `/atlas`, abertura das seções expansíveis, painel móvel fechado e
aberto, missão → Terra, evento → Terra e jornada → Terra. Em todos os três
handoffs narrativos, seleção e UTC foram restaurados na cena e apenas o canvas
da Terra foi montado. Os logs da prévia não registraram erros nem avisos de
runtime. Os loops do Atlas e do planetário agora cancelam o frame agendado
quando a aba fica oculta e retomam após `visibilitychange`.

## Reformulação da superfície de trabalho — 2026-09-01

A abertura orbital foi reorganizada como centro de operação compacto, com
estado científico ativo, inventários e atalhos para Atlas, Terra, missões e
eventos antes dos painéis extensos. O Atlas recebeu uma entrada compacta com
acesso direto à Janela da Terra e ao observatório de constelações. A barra
lateral foi agrupada por exploração e investigação, sem remover rotas.

Foram executados `npx.cmd tsc --noEmit`, `npm.cmd run lint` e `npm.cmd test`.
TypeScript e lint terminaram sem erros. O teste oficial concluiu o build de
produção, 18 testes Node/SSR/Worker e 37 testes TypeScript. O pytest concluiu
34 testes, com 1 teste opcional ignorado e 18 avisos externos/de cache. O aviso
conhecido de chunk minificado acima de 500 kB permaneceu. Nenhuma inspeção
visual em navegador é reivindicada nesta rodada; ela não foi executada.

## Estabilização C1–C6 — 2026-09-22

Escopo autorizado: somente as seis correções do documento fornecido, lido
integralmente. Estado conferido no checkout `C:\aleatorio\eu\Solar`, branch
`main`, PowerShell 7.6.5. Trabalho anterior staged/unstaged/untracked foi
preservado. As evoluções opcionais não fazem parte desta entrega.

### Reprodução e política científica

Antes da alteração, `FastAPI TestClient` com lifespan normal reproduziu HTTP
422 e mensagem de UTC inválido tanto no céu de São Paulo
(-23.5505, -46.6333, 760 m, `2026-08-05T00:00:00Z`) quanto em UMi
(80, 0, 0 m, `2024-04-08T00:00:00Z`). Testes de pares adjacentes reproduziram
separadamente o `ValueError` de sequências desiguais.

Depois, com o mesmo TestClient e sem servidor exposto:

| Cenário | Resultado atual |
| --- | --- |
| São Paulo, 2026-08-05 | 503, `IERS_DATA_UNAVAILABLE`, `expired-prediction` |
| UMi, 80°N, 2024-04-08 | 200, planejamento diário e anual |
| UTC malformado (regressão) | 422, `VALIDATION_ERROR` |
| Defeito interno simulado (regressão) | 500, `INTERNAL_ERROR`, sem traceback/detalhe privado |

A tabela efetivamente carregada é `IERS_Auto`, offline, cobertura nominal de
1973-01-02 a 2027-08-07. Previsões começam em 2026-07-31; idade medida de
53,53 dias contra `auto_max_age=30`. Cobertura nominal NÃO significa que as
previsões ainda sejam válidas. O intervalo aceito é fechado no início e aberto
no fim, evitando extrapolação de interpolação no último ponto. Datas observadas
históricas permanecem utilizáveis apesar da idade das previsões. UT1 e movimento
polar devem ter status válido e valores finitos.

`IERS_DATA_UNAVAILABLE` inclui motivo e proveniência, atravessa o Worker sem
perder status/detalhes e vira indisponibilidade no gateway. A Terra mostra o
motivo recebido. Nenhuma rotina atribui `auto_max_age=None` ou ativa download.
O planejador verifica todas as amostras diárias e mensais; se qualquer janela
necessária estiver sem cobertura, a resposta inteira fica indisponível, sem
inventar um planejamento anual parcial. A busca de eclipse verifica seus limites.

Para atualizar os dados no futuro: obter autorização específica para atualizar
dados/dependências; inventariar a versão instalada de `astropy-iers-data` e a
origem/tabela em uso; selecionar e registrar a versão/proveniência/checksum do
artefato aprovado; aplicar em ambiente controlado e repetir os testes e os dois
cenários acima. Só então reiniciar deliberadamente o serviço local para carregar
o artefato validado. Não foi feita atualização/download nesta rodada.

### Regressões e gates oficiais

Fixtures controlam a idade/cobertura IERS sem depender de relógio ou rede.
O caso anual circumpolar usa explicitamente a tabela histórica IERS-B local;
os casos de nascer/pôr usam altitudes determinísticas. O Worker cobre binding
ausente, transporte falho, JSON inválido, objeto vazio, versão incompatível,
disponibilidade completa/parcial e preservação do erro IERS. Os testes UTC
cobrem offsets positivos/negativos, frações e instantes não equivalentes.

Os testes de estado da Terra cobrem sucesso → loading → falha → retry → sucesso,
com identidade original, ausência de resultado no primeiro erro, rede,
indisponibilidade, validação, contrato, servidor, cobertura, cancelamento e
respostas fora de ordem. Eles testam os helpers usados pelo componente; não
substituem interação real em navegador. Novos testes TypeScript foram inseridos
em arquivos já listados em `package.json`; os novos Python são descobertos pelo
pytest oficial. Nenhuma dependência de teste foi adicionada.

Cada comando foi executado separadamente na raiz, com código de saída 0:

| Comando | Evidência final |
| --- | --- |
| `npm.cmd test` | Build + 21 testes Node/SSR/Worker + 40 testes TypeScript; 61 aprovados |
| `npx.cmd tsc --noEmit` | Sem erros |
| `npm.cmd run lint` | Sem erros/avisos de lint; não percorre cache Python |
| `backend\.venv\Scripts\python.exe -m pytest backend\tests` | 56 aprovados, 1 ignorado, 18 avisos; 58,22 s |
| `git diff --check` | Sem erros de whitespace; avisos locais LF/CRLF |
| `git diff --cached --check` | Sem erros de whitespace |

O teste ignorado é a comparação opcional com SpiceyPy, não instalado. Os avisos
backend são depreciação TestClient/httpx, ERFA para extremos históricos da
cobertura e falha de gravação do cache pytest. Inspeção somente leitura detectou
acesso negado em `backend/.pytest_cache/v`; nenhuma ACL/exclusão foi aplicada.
O build continua avisando sobre chunk acima de 500 kB, tempo em plugins e rotas
que o analisador estático do Vinext não classifica. Não foram suprimidos avisos.

### Arquivos tocados por esta rodada

Alterações incrementais em arquivos já existentes no disco (alguns já untracked):

- `backend/src/astro_system/coordinates/iers_status.py`
- `backend/src/astro_system/coordinates/observer.py`
- `backend/src/astro_system/coordinates/constellation_observatory.py`
- `backend/src/astro_system/ephemeris/time_conversion.py`
- `backend/src/astro_system/eclipses/local.py`
- `backend/src/astro_system/api/main.py`
- `worker/scientific-api.ts`
- `lib/science/decoders.ts`
- `lib/science/errors.ts`
- `app/components/earth/EarthAtlasWorkspace.tsx`
- `app/page.tsx`
- `eslint.config.mjs`
- `tests/scientific-api.test.mjs`
- `tests/science-gateway.test.ts`
- `tests/science-ui-contract.test.ts`
- `docs/agent-handoff.md` e `docs/validation.md`

Arquivos criados: `lib/science/resource.ts`,
`backend/tests/test_iers_policy.py` e
`backend/tests/test_constellation_planning.py`.
Build/cache de ferramentas são saídas locais, não entregáveis adicionais.

Revisão focada verificou propagação de erros, capacidades, UTC, retenção do
resultado, descarte de respostas antigas e inclusão dos testes no gate. O diff
global contém muito trabalho anterior e não deve ser atribuído a esta execução.
Estado Git final: `main`, 80 caminhos staged, 76 unstaged e 45 untracked; nenhum
staging/commit foi feito. O ZIP antigo não foi regenerado.

Não foi exercitada QA visual atual, navegação manual, dispositivo real,
servidor já aberto, hospedagem ou deploy. Evidências de navegador em seções
anteriores são históricas. Próximo passo recomendado: selecionar os testes de
navegador da seção 4 do plano e, separadamente, autorizar atualização controlada
dos dados IERS. Nenhuma mudança de estado físico, assets externos ou pipeline
gráfico foi necessária para estas correções.
