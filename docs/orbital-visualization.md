# Visualização orbital e integridade física

## Contrato de dados

O backend e a integração no navegador mantêm os valores físicos em SI: `position_m`, `velocity_m_s`, `mu_m3_s2`, época e referencial J2000. O renderizador não os edita.

`VisualScaleMapper` recebe uma cópia de leitura desses vetores e produz apenas coordenadas de cena. O fluxo é:

`estado SPICE/N-body → dinâmica física → adaptador visual → posição exibida → cena/câmera/UI`.

## Modos de escala

- **Real proporcional:** distâncias heliocêntricas lineares, normalizadas apenas para caber no enquadramento; marcadores continuam deliberadamente não proporcionais para permanecerem clicáveis.
- **Visual legível (padrão):** mistura contínua de escala linear e logarítmica, com separação mínima monotônica entre órbitas. O controle de compressão regula apenas essa camada.
- **Foco no corpo:** centraliza o corpo selecionado. Para a Terra, a Lua usa seu vetor de estado de referência relativo, ampliado somente na renderização. Para outros sistemas, luas de catálogo sem kernel/estado não são desenhadas.

As trajetórias são órbitas osculantes Keplerianas calculadas a partir do estado atual e são atualizadas em janela limitada, não em cada quadro WebGL. Elas não constituem uma previsão de efeméride.

## Janela da Terra no Atlas

`/atlas/earth` reutiliza `PlanetSurfaceExplorer`, o mesmo proprietário de cena
WebGL usado pela ficha do Atlas. Por montagem de rota existe um único canvas,
um controle de câmera e um loop de animação; não há um segundo renderizador
sobreposto para a vista da Terra.

O marcador de observador e a grade latitude/longitude são apenas adaptadores
visuais. Eles nunca retornam valores ao integrador, nem alteram
`position_m`, `velocity_m_s`, `mu_m3_s2`, época ou referencial. A Lua só é
apresentada como estado orbital quando há uma fonte de estado explícita; os
demais itens de catálogo permanecem metadados.

## Câmera e desempenho

`CameraDirector` centraliza foco, enquadramento, retorno e mapa orbital. As transições interpolam posição e alvo; planos de corte são ajustados à distância da câmera. Geometrias das órbitas só são recriadas quando muda a transformação visual ou quando o estado integrado passou pela janela de atualização.

The scene URL carries a versioned presentation contract. It records the
experience, target, requested UTC, camera and visual layers; it carries no
observer coordinates or SI vectors. The `requestedUtc` label is intentional:
it is not evidence that the renderer holds an ephemeris at that time.

## Fase G: fronteira física reforçada

O renderer não recebeu lógica científica nova. `ScienceGateway` entrega
somente objetos já validados, e `advanceFixedSteps` clona a entrada antes de
integrar. A velocidade de reprodução controla contagem de passos, não o passo
de 3.600 s. `position_m`, `velocity_m_s`, `mu_m3_s2`, época, frame e identidade
do alvo nunca são derivados de escala visual. A regressão automatizada mantém
um `WebGLRenderer`, um `canvas.atlas-webgl` e um loop no Atlas; rotas narrativas
continuam sem canvas.

## Proporção e separação visual — 2026-09-22

Correção exclusivamente frontend do planetário (`SolarSystemScene`), sem
alteração de APIs, snapshot, integração ou backend. O raio anterior saturava
em 0,82 para muitos corpos, aproximando indevidamente os tamanhos aparentes.

`BODY_VISUAL_SCALE` centraliza uma curva de potência de expoente 0,45, Terra
com raio visual 0,28 e Sol com 0,95. Cada par reserva 28% de sua distância
exibida como folga; o restante limita proporcionalmente os raios nominais,
considerando o envelope dos anéis de Saturno e da indicação de seleção.
Não há piso que force corpos muito próximos a se intersectarem. Selecionar
não aumenta o planeta. Marcadores distantes seguem o mesmo raio visual.

No modo legível, a Lua parte da posição exibida da Terra e usa o vetor físico
relativo multiplicado por `450/AU`. Não há mudança de direção nem posição
inventada; a ampliação é declarada no HUD. O modo real mantém todas as
distâncias lineares; Terra/Lua podem ficar muito pequenas e continuam
selecionáveis pela lista. O foco conserva a ampliação local anterior.

A abertura enquadra os corpos com uma câmera mais elevada, considerando
projeção vertical e horizontal. Geometrias unitárias são reutilizadas quando
muda a escala. Anéis acompanham o raio de Saturno e são descartados no cleanup.
O cleanup remove apenas o canvas próprio, sem apagar controles React no HMR.

Regressões no gate existente: hierarquia de raios, folga entre todos os pares
do snapshot nos três modos e compressões 0/68/100%, invariância física e vetor
Terra–Lua. Os seis testes de escala passaram; TypeScript e lint também.
Os oito arquivos TypeScript listados no script oficial foram executados
diretamente após a falha do build: 43 testes aprovados, sem falhas.

Inspeção local viu a visão geral com corpos separados e foco Terra–Lua sem
interseção, um único canvas e console sem erros/avisos naquele momento.
O viewport efetivo reportado foi 1600×1000 (override solicitado 1440×900).
A ferramenta de navegador depois apresentou queda da aba; validação móvel e
ciclo completo de retorno não foram concluídos. Screenshots foram inspecionadas
na sessão, sem novos arquivos de imagem versionados.

`npm.cmd test` foi tentado duas vezes: o build parou por falta de memória,
primeiro no Node e depois no alocador nativo do bundler. Portanto o gate completo
não é declarado aprovado nesta rodada. Nenhum serviço foi encerrado, nenhuma
dependência/configuração de máquina foi alterada para contornar o problema.

Limite intencional: a folga garante separação dos volumes 3D, não elimina
ocultações em todos os ângulos de câmera. Alinhamentos em perspectiva continuam
possíveis; não deslocamos planetas artificialmente no plano da tela. Use mapa
orbital ou gire a câmera nesses casos.

## Navegação contínua — 2026-09-22

Foco agora move só a câmera, sem ativar o modo de escala local nem esconder
planetas. Trocar a seleção aproxima o corpo escolhido; `Focar` reenquadra o
atual. Os limites mínimo e de foco dependem do raio exibido e do campo de visão,
inclusive no canvas estreito. `Retornar` reenquadra o sistema completo, e os
botões `Aproximar +`/`Afastar −` complementam roda/pinça. Arraste orbita;
botão direito ou dois dedos deslocam no plano da tela. Gestos manuais cancelam
a transição automática, sem disputar a posição da câmera.

Arrastes e gestos multitoque não acionam seleção ao soltar. Picking ignora
grupos ocultos e rótulos. O texto 3D desaparece gradualmente durante aproximação
para não atravessar a câmera; o nome permanece no HUD. Nenhum dado físico ou
arquivo backend foi alterado. Helpers estão em `orbital/navigation.ts` e suas
regressões integram `tests/visual-scale.test.ts`, já no gate oficial.

Validação da navegação: build e 66 testes passaram (21 Node/SSR/Worker + 45
TypeScript), assim como `tsc --noEmit` e lint. Após o ajuste final de transparência
dos rótulos, a repetição do gate voltou a parar no build por falta de memória
do bundler; o gate completo dessa última alteração não é declarado aprovado.
Permanecem os avisos conhecidos
do bundler sobre chunks/tempo em plugins e classificação estática de rotas.
Inspeção em navegador confirmou foco na Terra sem trocar escala, seleção de
Marte, botão de afastar e retorno à visão geral, com console sem erros/avisos.
Multitoque em dispositivo físico não foi exercitado.

## Clique nas constelações — 2026-09-22

No observatório, selecionar uma região no catálogo ou nas candidatas inicia a
consulta com o identificador clicado e os dados atuais do formulário, sem exigir
um segundo clique em Calcular. O visor abaixo recebe scroll suave (instantâneo
com preferência por movimento reduzido), carregamento, motivo de erro e
identidade UTC/localização do resultado. Trocar a seleção cancela/invalida a
consulta anterior mesmo se o formulário novo for inválido. Resultados de outra
constelação não são mostrados sob a nova seleção.

A câmera mira a coordenada representativa AltAz retornada se estiver acima do
horizonte, ou uma estrela visível retornada quando a região for parcialmente
visível. Regiões abaixo do horizonte continuam ocultas com aviso explícito;
nenhuma coordenada científica é calculada ou inventada no frontend. A API
existente foi reutilizada sem qualquer alteração de backend.

Arquivos: `ConstellationObservatory.tsx`, `PlanetSurfaceExplorer.tsx`,
`lib/atlas/constellations.ts` e `tests/constellations.test.ts`.
Validação: cinco testes focados passaram, assim como `tsc --noEmit`. O gate
`npm.cmd test` falhou no build SSR por falta de memória do bundler, antes de
executar as suítes. A inspeção visual não foi concluída devido à instabilidade
de memória do ambiente (também observada em leitura via PowerShell).
