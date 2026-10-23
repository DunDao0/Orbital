# Correções do frontend — 20/10/2026

Escopo: câmera, desenho orbital, horizonte real, controles e formulários.
Nenhuma alteração nesta rodada em backend, Worker, dados científicos, integração
N-body, épocas/referenciais ou dependências. O checkout já continha trabalho
staged, unstaged e untracked; ele foi preservado, sem commit ou push.

## Implementação

- A câmera do Atlas usa uma transição finita, cancelada pelo início de um gesto
  do OrbitControls. Após terminar/cancelar, não escreve mais na posição manual.
  Movimento reduzido aplica o destino uma única vez. Damping leva em conta o
  tempo entre frames, e o diagnóstico usa frame time real, não o delta limitado.
- `orbitalPoints.ts` preserva `|r × v|²` antes de normalizar a base da elipse.
  O helper só amostra a curva visual osculante; não propaga nem modifica SI.
- Camadas AltAz mudam visibilidade sem reconstruir a cena ou reenquadrar.
  Selecionar outra resposta ou clicar em “Enquadrar estrelas” continua ajustando
  o enquadramento. A câmera do observador permanece em `(0,0,0)`.
- Órbita/superfície reutilizam geometria e materiais. A baixa qualidade não cria
  geometria de nuvens sem nenhum material que possa possuí-la/descartá-la.
- Atmosfera integra um trecho limitado à casca e ao primeiro encontro com o
  solo, com densidade exponencial local, extinção solar e sombra do planeta.
  Usa 4/8/12 amostras de visão por qualidade e quatro amostras solares.
  Não atenua a densidade pela distância externa da câmera. As alturas de escala
  são frações da espessura atmosférica. É apresentação procedural aproximada,
  não modelo meteorológico ou calibração científica.
- Normais procedurais são transformadas ao espaço de visão antes da iluminação.
  Opacidade das nuvens/atmosfera chega ao shader por `uLayerOpacity`, sem
  recompilar shaders quando o slider muda.
- Busca atualiza o mesmo alvo consumido pelo renderer; camadas incompatíveis
  com o visor ficam ocultas/desabilitadas. A Terra no Atlas recebe suas camadas.
- Jornadas mantêm sessão/etapa/cena de retorno independentemente do corpo
  selecionado. Projetos possuem recuperação explícita validada e erros de
  armazenamento; não há leitura que sobrescreva automaticamente o projeto salvo.
- Parsers rejeitam campos vazios, valores não decimais e datas impossíveis.
  Aceitam ponto ou vírgula decimal. Zero explícito continua válido.
  Tempo de links é restaurado sem compartilhar coordenadas do observador.
  Pedidos cancelados/antigos não substituem a consulta atual.
- Na revisão do build de produção, o prefetch do `next/link` do vinext instalado
  falhava ao resolver um export minificado (`getPrefetchInterceptionContext`).
  Desativar apenas prefetch eliminou esse erro, mas o teste de clique revelou a
  mesma falha com `navigateClientSide`: a URL não mudava. Os links usam navegação
  documental nativa como mitigação local, sem alterar dependências ou renderer.
  Clique, teclado e abertura em nova aba são mantidos. A troca de rota recarrega
  o documento; dados persistidos em URL/localStorage permanecem, enquanto estado
  somente em memória não atravessa a navegação.
- ESLint ignora `work/**`, assim como o Git já fazia. Esse diretório contém
  cópias temporárias de smoke tests de outro trabalho, não o código-fonte ativo.
  A rodada final detectou ali uma cópia antiga de teste; ela não foi modificada.

## Validação reproduzível

Gates definidos pelo projeto:

```powershell
npm.cmd test
npx.cmd tsc --noEmit --incremental false
npm.cmd run lint
```

Teste adicional de interações com Playwright **já instalado**, sem dependência
de produção e sem instalação automática:

```powershell
npm.cmd run start -- --hostname 127.0.0.1 --port 3000
# Em outro terminal, se Playwright não estiver na resolução normal do Node:
$env:ORBIS_PLAYWRIGHT_MODULE = '<caminho existente do pacote playwright>'
node scripts/check_frontend_browser.mjs
```

O gate de browser cria um contexto isolado em 1440×900 e 390×844; cobre gestos,
camadas, qualidades, busca, jornada, projeto salvo, campos vazios, restauração de
UTC, navegação de saída/retorno e movimento reduzido. Ele intercepta requisições
à API nativa com uma **fixture sintética somente de teste**: não inicia nem
altera backend, não valida astronomia e não modifica dados usados em produção.
O estado indisponível de `/api/capabilities` é simulado com HTTP 503 e identificado
por um header exclusivo da fixture. O gate exige a mensagem de indisponibilidade
na interface; essa resposta fica em `expectedServiceFailures`, separada de
`errors`. Outros HTTPs inesperados continuam reprovando o gate. A navegação
de saída/retorno usa cliques nos links reais do menu, não apenas recarga de URL.

Evidências são geradas em `outputs/frontend-regressions/` (ignorado pelo Git):
`results.json`, capturas da Terra, horizonte-fixture desktop/móvel e órbitas.
Consultar o JSON da última execução para os fluxos concluídos e erros.

## Arquivos desta rodada

- Câmera/renderização: `PlanetSurfaceExplorer.tsx`, `atlas/cameraTransition.ts`,
  `atlas/planetMaterials.ts`, `atlas/planetVisualProfiles.ts`, `SolarSystemScene.tsx`
  e `orbital/orbitalPoints.ts` em `app/components/`.
- Controles: `AtlasFoundationPanel`, `AtlasPlanetaryWorkspace`,
  `AtlasJourneyPanel`, `AtlasProjectPanel`, `AtlasMeasurementPanel` e
  `AtlasEventsPanel`; helpers em `lib/atlas/{search,layers,journeys,projects,planetaryScene}.ts`.
- Formulários: `EarthAtlasWorkspace`, `ConstellationObservatory`, `app/page.tsx`
  e `lib/science/observerFields.ts`.
- Navegação: `app/components/AppLink.tsx` e os componentes que já utilizavam
  `next/link`, sem alterar rotas.
- Regressões nos arquivos existentes `tests/{visual-scale,constellations,
  atlas-foundation,atlas-tools,science-ui-contract}.test.ts`; gate visual em
  `scripts/check_frontend_browser.mjs` e `tests/navigation-links.test.mjs`.
- `eslint.config.mjs`: exclusão das cópias temporárias em `work/`.

Esta lista identifica o escopo da rodada, não todas as mudanças preexistentes
que aparecem no `git diff` do checkout.

## Resultados da validação

- `npm.cmd test`: passou no checkout atual, incluindo build de produção,
  29 testes `.mjs` e 75 testes TypeScript (104 no total). A contagem inclui
  testes preexistentes/adicionados por outros trabalhos no checkout; não são
  104 testes novos desta correção.
- `npx.cmd tsc --noEmit --incremental false`: passou.
- `npm.cmd run lint`: passou, exit 0, após excluir as cópias temporárias de
  `work/` da varredura.
- O primeiro gate completo de browser passou nos oito fluxos funcionais, mas
  reprovou corretamente no console ao revelar o defeito de prefetch do framework.
  Um teste adicional por clique reproduziu também o erro de navegação. Esses
  achados motivaram o fallback nativo descrito acima.
- Após a correção, `node scripts/check_frontend_browser.mjs`: **8/8 fluxos
  passaram**, exit 0, `errors: []`. A única resposta HTTP de erro esperada foi
  o 503 de capabilities introduzido pela própria fixture e apresentado na UI.
- `git diff --check` do escopo e `node --check scripts/check_frontend_browser.mjs`:
  passaram.
- Capturas finais inspecionadas: Terra, qualidades, horizonte apontado para as
  estrelas, botão “Ver horizonte”, viewport estreito e órbitas. Sem overflow
  horizontal nos viewports testados. A saída para Missões tem zero canvas e a
  volta ao Atlas tem um canvas; a liberação de RAF/listeners/recursos foi também
  revisada no código, sem alegar medição de heap/GPU.
- Preview de produção iniciado em loopback e encerrado após a validação.

## Limites

- O clipping atmosférico usa uma esfera de referência, não um depth buffer de
  cada montanha, oceano, marcador ou anel. Não há múltiplo espalhamento.
- O teste de navegador não é uma medição comparável de GPU/FPS real; o ambiente
  headless pode renderizar por software. Não se declara ganho de desempenho.
- Pinça em hardware físico e observação astronômica com API/IERS ativos não são
  cobertas por fixtures ou testes de componentes.
- O aviso de bundle acima de 500 kB já existia; não foram adicionadas bibliotecas.
- A navegação client-side poderá voltar quando a versão do framework for
  corrigida e o build de produção passar por teste de clique/prefetch. Atualizar
  o framework inteiro não fez parte desta correção.
- Nenhum asset externo foi incorporado.
