# Atlas — materiais planetários, atmosfera e LOD

## Diagnóstico inicial

O Atlas usava uma esfera `MeshStandardMaterial` com um mapa `CanvasTexture` e
um halo `MeshBasicMaterial` de opacidade constante. Ao escolher **Aproximar
solo**, a esfera era removida e trocada por um plano de terreno separado. Essa
troca quebrava a continuidade da câmera, do relevo, da luz e da atmosfera. Não
havia configuração de qualidade nem telemetria do renderer.

Baseline visual, em `1440 × 900`, usava um canvas de `1078 × 700` e não
produzia erros ou avisos no console. O projeto não expunha `renderer.info`,
então draw calls, triângulos e texturas não estavam disponíveis antes da
instrumentação de desenvolvimento.

## Arquitetura entregue

`app/components/atlas/planetVisualProfiles.ts` centraliza os perfis tipados de
superfície, atmosfera, oceano, nuvens e qualidade. Cada planeta possui paleta,
escalas de ruído, relevo, roughness, parâmetros atmosféricos e, quando cabível,
camada de oceano e nuvens. Os números físicos estão concentrados nos perfis,
e não distribuídos no loop de renderização.

`app/components/atlas/planetMaterials.ts` cria materiais PBR reutilizáveis:

- Superfície `MeshStandardMaterial` com albedo procedural de escala
  planetária, regional e microdetalhe, normal procedural e roughness variável.
- Oceano `MeshPhysicalMaterial` separado, com máscara contínua de água,
  clearcoat, Fresnel/specular do material físico e ondas em duas frequências.
- Nuvens em uma ou duas camadas procedurais independentes; no nível `high`, a
  primeira camada também reduz a luz da superfície.
- Atmosfera de single scattering aproximado com Rayleigh, Mie, anisotropia,
  altura de escala, absorção, direção do Sol e posição da câmera. O shader
  intensifica o horizonte, reduz o lado noturno e aquece a luz rasante.

`PlanetSurfaceExplorer` preserva um canvas, uma cena e uma fonte solar
direcional. Órbita e aproximação passam a interpolar a mesma câmera; a esfera
global permanece presente. Em qualidade `high`, planetas rochosos recebem um
patch curvo local de maior densidade, derivado da mesma função de relevo da
esfera, sem subdividir o planeta inteiro.

A lâmina do oceano fica acima do deslocamento máximo da esfera global. A
máscara procedural descarta a casca sobre os continentes; isso elimina as
interseções triangulares de profundidade que apareceriam em uma aproximação da
costa, sem adicionar uma geometria local desconexa.

## Qualidade e recursos

| Nível | Esfera | Patch local | Nuvens | Sombra de nuvens | DPR máximo |
| --- | ---: | ---: | ---: | --- | ---: |
| `low` | 80 × 56 | 72 | 0 | não | 1.0 |
| `medium` | 112 × 76 | 108 | 1 | não | 1.5 |
| `high` | 152 × 104 | 156 | 2 | sim | 2.0 |

`auto` inicia em `medium` para não causar divergência de hidratação e decide
no cliente: reduz para `low` somente em hardware muito limitado e usa `high`
somente em máquinas com ao menos 12 núcleos lógicos e DPR até 2.

Em `localhost`, o HUD expõe `renderer.info` uma vez por segundo. Em uma mesma
cena Terra, `1440 × 900`, após aquecimento, as leituras observadas foram:

| Nível | Draw calls | Triângulos | Texturas internas | Frame time médio* |
| --- | ---: | ---: | ---: | ---: |
| `low` | 4 | 26.400 | 1 | 23,49 ms |
| `medium` | 5 | 67.200 | 1 | 29,55 ms |
| `high` | 6 | 156.560 | 1 | 34,01 ms |

\* A medição inclui o navegador de automação e serve para comparação local,
não como benchmark universal. O contador de texturas reporta somente recursos
do renderer; o sistema não carrega mapas raster externos.

## Licença, assets e Blender

Nenhuma imagem, normal map, height map, modelo ou asset externo foi baixado ou
incorporado. A página de texturas Earth da Poliigon foi consultada apenas como
referência visual de variedade PBR — solo, areia, rocha, neve e vegetação — e
nenhum download, scraping ou automação de assets foi executado.

As referências científicas por planeta continuam em `public/atlas/CREDITS.md`.
O comando `blender --version` não encontrou Blender no ambiente. Por isso não
foi criado pipeline Blender e o runtime não depende dele.

## Marcos e validação

1. Auditoria e baseline: screenshots e console limpo registrados.
2. Perfis e materiais: superfície multiescala, oceano, nuvens e atmosfera
   parametrizados por planeta.
3. Continuidade: uma cena/canvas, interpolação de câmera e LOD por qualidade.
4. Recursos: materiais e geometrias são descartados nas trocas de planeta,
   qualidade e unmount; uniformes são atualizados sem recriar materiais por
   frame.
5. Validação: `npm.cmd run lint`, `npm.cmd run build` e `npm.cmd test`.

Na rodada final, `lint` terminou com 0 erros (permanece um aviso preexistente
de dependência de hook em `app/page.tsx`), `build` passou e `test` passou com
7 de 7 testes. A verificação manual em `1440 × 900` e `390 × 844` não mostrou
erros nem avisos de console. A troca por todos os nove planetas e a navegação
para fora e de volta a `/atlas` mantiveram exatamente um `canvas.atlas-webgl`.

## Evidências visuais

- `docs/atlas-visuals/baseline-earth-orbital-1440x900.png`
- `docs/atlas-visuals/baseline-earth-surface-1440x900.png`
- `docs/atlas-visuals/after-earth-orbital-1440x900.png`
- `docs/atlas-visuals/after-earth-approach-1440x900.png`
- `docs/atlas-visuals/after-earth-surface-1440x900.png`
- `docs/atlas-visuals/after-earth-terminator-1440x900.png`
- `docs/atlas-visuals/after-earth-mobile-390x844.png`

Para reproduzir a inspeção, execute `npm.cmd run dev`, abra
`http://localhost:3000/atlas`, selecione Terra, alterne Órbita/Aproximar solo
e percorra os níveis de qualidade. Navegue para outra rota e volte para
confirmar que permanece apenas um canvas e um loop de animação.

## Janela especializada da Terra

`/atlas/earth` é uma ficha científica da Terra sobre o mesmo
`PlanetSurfaceExplorer`; ela não cria um segundo renderer ou uma segunda cena.
Além dos perfis procedurais já descritos, a rota oferece camadas visuais
efetivas para atmosfera, nuvens, grade latitude/longitude e marcador de
observador. A grade e o marcador são linhas/geometrias locais descartadas
junto com as demais camadas do planeta no unmount ou na troca de perfil.

Os cálculos de céu e eclipses são pedidos somente ao serviço científico. A
interface valida faixas de latitude, longitude, altitude e UTC, cancela
requisições antigas, mantém o último resultado confirmado durante a espera e
declara indisponibilidade sem estimativa no navegador. A localização permanece
apenas no estado da sessão: não é serializada em URL, armazenamento local ou
logs da aplicação.

O carregamento do visualizador é feito por `PlanetSurfaceLoader`, um ponto de
montagem cliente que preserva o shell HTML das rotas e evita uma fronteira
`Suspense` de servidor incompleta no modo de desenvolvimento. Ele não cria um
segundo canvas: após a montagem continua existindo apenas
`canvas.atlas-webgl` por rota visual.

Evidências desta rota:

- `docs/atlas-visuals/earth-window-desktop-1440x900.png`
- `docs/atlas-visuals/earth-window-mobile-390x844.png`

Na inspeção local atual, ambas as resoluções apresentaram exatamente um
`canvas.atlas-webgl` e console sem novas mensagens. O bundle ainda produz o
aviso conhecido de chunk acima de 500 kB; o `SolarSystemScene` e a cena do
Atlas permanecem carregados sob demanda e não foram adicionadas dependências
de produção para esta entrega.

### Estado de cena e comparador

Na ficha da Terra, `OrbitalSceneStateV1` é a única origem para vista de câmera
e camadas renderizáveis. Ao restaurar o fragmento da URL, a mesma configuração
de atmosfera, nuvens, grade, marcador e aproximação é reaplicada ao canvas;
as coordenadas do observador continuam fora do link.

O comparador mantém um único renderer com dois viewports. Os dois modos
oferecidos têm semântica visual verificável: **referência relativa** mantém o
globo em escala de referência com enquadramento mais aberto no viewport direito
e **ampliação visual**
aumenta apenas esse globo. Não há modos que afirmem mostrar dados físicos,
rotação ou órbita sem uma representação própria.

### Resultado da validação final

| Verificação | Resultado |
| --- | --- |
| `npx.cmd tsc --noEmit` | passou |
| `npm.cmd run lint` | 0 erros; 1 aviso preexistente de dependência de hook em `app/page.tsx` |
| Build e suítes Node | build passou; 11 testes de integração/SSR e 18 testes TypeScript passaram |
| `backend\\.venv\\Scripts\\python.exe -m pytest backend\\tests` | 14 testes passaram; um aviso preexistente de depreciação do `TestClient` |
| Serviço científico local | consulta de céu retornou 9 objetos; consulta de eclipse retornou `none`, sem fallback no navegador |
| Estado compartilhável | um link com atmosfera e nuvens ocultas, grade e marcador ativos, vista de superfície e UTC alterado restaurou todos esses valores após recarga |
| Navegação e responsividade | `/atlas` → `/atlas/earth` em desktop e os registros móveis em `390 × 844`: 1 canvas por rota visual, sem erros no console |
| Comparador | `ampliação visual` foi validada em dois viewports e um único renderer; os modos sem implementação foram removidos |

Na Terra em `1440 × 900`, após aquecimento e em `auto/medium`, o HUD local
reportou 5 draw calls, 67.200 triângulos, 1 textura interna e cerca de 17,2 ms
por quadro. Essa leitura é comparativa no navegador local; não é um benchmark
universal.

## Limitações e próximos passos opcionais

- As máscaras de continente, bioma, relevo e nuvem são procedurais e
  interpretativas, não mapas cartográficos nem dados de missão.
- A atmosfera é single scattering aproximado; uma LUT de múltiplo scattering
  seria uma evolução futura caso haja orçamento de GPU e dados de calibração.
- O patch local só é ativado em `high`; isso preserva o frame time previsível
  no modo padrão.
- Mapas licenciados de albedo, normal, roughness, altura, bioma, oceano e
  cobertura de nuvens podem ser conectados aos perfis no futuro, desde que sua
  procedência e licença sejam documentadas.
