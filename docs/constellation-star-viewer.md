# Constelações: estrelas e contexto — frontend

## Diagnóstico e implementação

- `addScientificStars` fornecia o atributo `color`, mas o ShaderMaterial não
  habilitava `vertexColors`. O shader referenciava um atributo não declarado
  pelo prefixo do Three. A opção foi corrigida, preservando o filtro de horizonte.
- Andrômeda está abaixo do horizonte para São Paulo, UTC 2026-08-05T00:00,
  conforme resposta real do serviço local. Esse vazio não deve ser corrigido
  alterando coordenadas ou tornando estrelas ocultas observáveis.
- A seleção abre agora **Explorar estrelas e história**: SVG com coordenadas
  ICRS do catálogo, magnitude G, seleção por clique/Enter/espaço, identificação,
  lista acessível e ficha editorial. **Céu local** mantém o renderer do Atlas.
- O mapa começa com as cinco estrelas do guia existente. Ao chegar o cálculo,
  incorpora as estrelas retornadas, inclusive abaixo do horizonte. O filtro G
  do formulário pertence ao cálculo local; o mapa mantém as cinco estrelas
  iniciais mesmo se esse filtro for mais restritivo. Não são estrelas aleatórias.
- Projeção esquemática de RA/Dec com longitude desenrolada, norte acima e RA
  crescente à esquerda. O ajuste de escala é visual; não serve como instrumento
  de distância angular e apresenta distorção em regiões polares/extensas.
- 88 significados e contexto de origem. Destaques nominais revisados nesta
  entrega: Andrômeda e Órion. Outras regiões identificam estrelas por Gaia DR3;
  não se afirma que exista curadoria nominal completa ou cross-match WGSN.
- Época de coordenadas, tradição histórica e descoberta individual são
  distinguidas. Datas de descoberta ausentes não são inventadas.

## Arquivos desta alteração

Criados: `lib/atlas/constellationEducation.ts`,
`app/components/earth/ConstellationCatalogueView.tsx`, seu CSS Module e este documento.
Editados incrementalmente: `PlanetSurfaceExplorer.tsx`,
`earth/ConstellationObservatory.tsx`, `tests/constellations.test.ts` e
`tests/rendered-html.test.mjs`. Nenhum backend, contrato público ou dado
científico gerado foi alterado nesta tarefa. Nenhuma dependência adicionada.

## Fontes e procedência

Textos editoriais próprios sintetizam fatos; nenhuma imagem externa foi copiada.

- [IAU: constelações e cartas](https://iauarchive.eso.org/public/themes/constellations/): significados, regiões e marcos de padronização.
- [Harvard/CfA Wolbach: origens](https://library.cfa.harvard.edu/iau-constellations): grupos históricos e figuras representadas.
- [IAU: nomes estelares](https://iauarchive.eso.org/public/themes/naming_stars/): nomenclatura não equivale a descoberta.
- [Carta And](https://iauarchive.eso.org/static/public/constellations/pdf/AND.pdf) e
  [carta Ori](https://iauarchive.eso.org/static/public/constellations/pdf/ORI.pdf): destaques nominais, sem associá-los a IDs Gaia.
- [NASA: galáxia de Andrômeda](https://www.nasa.gov/image-article/andromeda-high-energy-x-rays/): distinção entre galáxia e região celeste.
- Coordenadas e magnitudes reutilizam `constellation_guides.json` e o retorno
  científico existentes. Não há novas texturas, fotografias ou assets comerciais.

## Validação executada

- `npx.cmd tsc --noEmit`: passou; repetido com `--incremental false`, sem erros.
- `npm.cmd run lint`: passou.
- `node --experimental-strip-types --test tests/constellations.test.ts`: 8/8.
- `npm.cmd test`: execução final passou, incluindo build + 21 testes MJS + 50 TS.
- `git diff --check` nos arquivos rastreados editados: passou.
- O primeiro teste integrado encontrou uma expectativa SSR antiga do texto do
  visor; ela foi atualizada para os dois modos. Uma tentativa intermediária foi
  bloqueada por ENOSPC. Nova leitura indicou espaço disponível e a execução
  final passou; não houve limpeza de arquivos ou encerramento de processos.
- Build ainda informa chunks acima de 500 kB, tempo de plugins e classificação
  estática limitada de rotas pelo vinext. Não são falhas de teste.

### Browser local (IAB)

`http://localhost:3000/atlas/earth/constellations`, preview já ativo.

- Andrômeda: 57 estrelas no mapa após resposta, com G máximo solicitado 5,5;
  aviso de região abaixo do horizonte e ficha Alpheratz/Mirach/Almach.
- Escorpião: 68 estrelas no mapa e estrelas efetivamente visíveis no renderer
  do céu local; sem erros/warnings capturados no console desta sessão.
- Seleção de estrela por teclado atualizou ID, magnitude e coordenadas.
  Pontos brilhantes são desenhados por último para não ficarem sob alvos de
  clique de estrelas fracas. Lista oferece alternativa para campos densos.
- Capturas visuais inspecionadas na tarefa em viewport padrão (1265×712) e
  móvel (390×844). Não foram gravados novos PNGs no repositório.
- Viewport móvel sem overflow horizontal da página (largura do documento 377).
- Alternar céu local → catálogo → céu local: contagem de canvas 1 → 0 → 1.
- Estatística instantânea no renderer: 4 calls, 0 triângulos (Points/Lines),
  1 textura, aproximadamente 16,7 ms; não é benchmark homogêneo de desempenho.

## Limites e próximos incrementos

Os nomes populares de todas as estrelas ainda não estão cruzados com Gaia.
Os highlights textuais não prometem estar contidos neste recorte incompleto.
Sem resposta local, o mapa continua com os cinco registros já disponíveis no
guia; o céu local informa a falha em vez de inventar astrometria.
Curadoria nominal/histórica individual das outras 86 constelações e datas de
descobertas documentadas de objetos específicos são complementos futuros.
Esta entrega não valida exaustivamente os 88 campos no browser; os 88 guias,
significados e projeções são cobertos pelo teste automatizado.

## Revisão do horizonte real

O modo observador ainda herdava OrbitControls com dolly e interpolação para
uma posição/target fixos a cada frame. Isso deslocava o olho da origem AltAz e
disputava os gestos. Agora:

- câmera fixa em (0,0,0), orientação independente de órbita e zoom por FOV
  limitado a 20–115 graus; roda, arraste, setas, botões e pinça de dois pontos;
- enquadramento pela distribuição das estrelas acima do horizonte, ajustado
  à proporção do viewport, em vez de um ponto arbitrário da região IAU;
- reflexão visual do eixo leste para respeitar a câmera right-handed: olhando
  norte, leste aparece à direita e zênite continua acima. AltAz não é alterado;
- fundo com solo geométrico e céu, horizonte e rótulos N/L/S/O. Esse fundo e o
  brilho ampliado são didáticos, não uma simulação fotométrica ou de relevo;
- fronteiras mais discretas, pontos com núcleo/glow e tamanho corrigido pelo
  pixel ratio; fundo, sprites e materiais descartados na troca/desmontagem;
- toolbar responsiva: Enquadrar estrelas / Ver horizonte / Zoom + / Zoom −;
- troca de constelação preserva o modo local; ausência de estrelas visíveis
  oferece mapa ou horário favorável do planejamento já retornado pelo backend.
  A mudança de UTC só ocorre ao clicar, passando o novo horário explicitamente
  ao gateway, sem depender de um setState ainda não aplicado.

Novos módulos: `atlas/observerControls.ts`, `atlas/observerBackdrop.ts` e
`atlas/observerView.module.css`. Testes adicionais exercitam direção leste,
enquadramento, limites de FOV, eventos reais via handlers, imobilidade do olho,
inatividade fora do modo observador e remoção dos listeners.

Validação da revisão: `npm.cmd test` passou (21 MJS + 53 TS), assim como lint
e TypeScript. No browser, Escorpião mostrou 68 estrelas às 00:00 UTC; Andrômeda
mostrou zero nesse horário, preservou o modo local ao ser selecionada e, após
clicar em Usar horário favorável (07:00 UTC), mostrou 57 acima do horizonte.
Zoom alterou FOV de 59,3 para 47,4 graus e o arraste alterou a direção sem
transladar a câmera. Sem warnings/erros de console nessas verificações.
Viewport móvel 390×844: um canvas, largura do documento 377, toolbar em duas
linhas sem overflow; Andrômeda e rótulo N · NORTE legíveis. Setas/zoom por
teclado mudaram a visão de `82.5/-0.003/0.394/0.919` para
`70.1/-0.083/0.394/0.915`, mantida após aguardar novos frames. Pinça está
implementada, mas não foi exercitada com tela de toque física. O último ajuste
de tamanho dos rótulos também foi confirmado por um novo build bem-sucedido.
