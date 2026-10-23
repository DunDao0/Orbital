# Horizonte real — validação com API nativa em 20/10/2026

## Escopo e resultado

Teste do frontend com o FastAPI/Astropy local real, sem fixtures, mocks, replay
de respostas ou alteração do backend. Os dois serviços estavam desligados e
foram iniciados com os scripts existentes, apenas em loopback. Não houve
instalação, atualização de IERS, download ou modificação de dados científicos.
Ao concluir, os dois processos iniciados para este teste foram encerrados;
as portas locais 3000 e 8000 ficaram sem listeners.

**Resultado final: 7/7 cenários passaram.** Nos campos testados, os pontos e
fronteiras enviados ao WebGL correspondem ao AltAz retornado pela API. Estrelas
abaixo do horizonte não foram desenhadas; fronteiras foram recortadas no solo.
O enquadramento incluiu todas as estrelas acima do horizonte desses recortes,
inclusive em 390×844. Isso não é uma validação independente da astrometria do
backend nem uma inspeção visual exaustiva das 88 constelações.

## Matriz real

Data: **05/08/2026**, limite **Gaia G ≤ 5,5**.
São Paulo: latitude −23,5505°, longitude −46,6333°, elevação 760 m.
Ponto de teste no hemisfério norte: latitude 51,5°, longitude −0,12°, elevação 20 m.
São coordenadas explícitas de teste, não geolocalização do usuário.

| Caso | UTC | Acima / retornadas | Pontos GPU / enquadrados | Vértices IAU após recorte |
| --- | --- | --- | --- | --- |
| Andrômeda, São Paulo, abaixo | 00:00 | 0 / 57 | 0 / 0 | 0 |
| Andrômeda, horário favorável da API | 07:00 | 57 / 57 | 57 / 57 | 74 |
| Andrômeda, viewport 390×844 | 07:00 | 57 / 57 | 57 / 57 | 74 |
| Andrômeda, parcialmente acima | 03:00 | 32 / 57 | 32 / 32 | 50 |
| Escorpião, São Paulo | 00:00 | 68 / 68 | 68 / 68 | 40 |
| Órion, São Paulo, diurno | 15:00 | 81 / 81 | 81 / 81 | 54 |
| Ursa Menor, hemisfério norte | 00:00 | 19 / 19 | 19 / 19 | 46 |

Em Órion, a API retornou `twilight: day` e Sol a aproximadamente 49,48° de
altitude. Os pontos representam posições geométricas, não estrelas visíveis
a olho nu durante o dia.

## Correção restrita ao frontend

A imagem diurna mantinha pontos destacados para leitura, enquanto a advertência
principal ficava fora do visor. Foi incluído um aviso visível no próprio canvas:
“Céu diurno: estrelas com brilho ampliado para localização, não uma previsão
de visibilidade a olho nu.”

O mesmo mecanismo trata crepúsculo e classificações desconhecidas sem assumir
noite ou observabilidade. Usa somente a classificação retornada pelo backend;
não calcula iluminação ou astrometria alternativa no navegador.

Arquivos desta rodada:

- `lib/atlas/constellations.ts`: `observerLightNotice`.
- `app/components/PlanetSurfaceExplorer.tsx`: apresentação do aviso.
- `tests/constellations.test.ts`: regressão de dia, crepúsculo e estado desconhecido.
- `scripts/check_constellations_live.mjs`: gate de integração opt-in.
- Este documento.

O restante do checkout já continha alterações staged, unstaged e untracked de
outros trabalhos e foi preservado. Sem commit, push, dependências ou assets novos.

## Método de verificação

O gate abre o build de produção no Chromium/Playwright já disponível e usa os
controles reais da página. Confere:

- `meta.service: native` e sucesso HTTP das consultas reais;
- contagem acima do horizonte e tabela acessível versus resposta;
- `drawArrays(POINTS)` e seu buffer de posição versus AltAz recebido;
- matriz efetiva com olho sem translação e reflexão visual de leste;
- projeção dos pontos dentro do enquadramento após “Enquadrar estrelas”;
- `drawArrays(LINES)` das fronteiras IAU, isolando temporariamente grade/cardinais;
- clipping de fronteiras e ausência de estrelas/fronteiras ocultas;
- horário favorável, camadas sem reset de câmera e “Ver horizonte”;
- viewport estreito sem overflow horizontal e screenshots.

A instrumentação de leitura WebGL existe somente no contexto isolado do teste,
não no bundle da aplicação. Não intercepta requests nem altera respostas.
O maior desvio entre coordenadas esperadas e buffers Float32 ficou abaixo de
`4,8e-7` unidades visuais. Esse número mede apenas conversão/armazenamento do
renderer, **não precisão astronômica**.

## Comandos e evidências

Em terminais separados:

```powershell
.\scripts\start_science_api.ps1
npm.cmd test
npm.cmd run start -- --hostname 127.0.0.1 --port 3000
```

Com os serviços ativos:

```powershell
# Somente quando Playwright já instalado não estiver na resolução normal:
$env:ORBIS_PLAYWRIGHT_MODULE = '<caminho existente do pacote playwright>'
node scripts/check_constellations_live.mjs
npx.cmd tsc --noEmit --incremental false
npm.cmd run lint
```

Resultados:

- `npm.cmd test`: passou, incluindo build e regressões oficiais.
- TypeScript e lint: passaram.
- `node --check scripts/check_constellations_live.mjs`: passou.
- `git diff --check` no escopo rastreado: passou.
- Gate real: exit 0, sete casos, `errors: []`.
- Imagens finais inspecionadas em 1440×900 e 390×844.

Evidências locais, ignoradas pelo Git:

- `outputs/constellations-live-baseline/`: seis casos antes do novo aviso.
- `outputs/constellations-live-final/results.json`: relatório final e warnings.
- No mesmo diretório final: `andromeda-below`, `andromeda-favorable`,
  `andromeda-mobile`, `andromeda-partial`, `scorpius-night`, `orion-day` e
  `ursa-minor-north`, cada um com PNG e resposta JSON real.
- `scorpius-horizon.png`: ação “Ver horizonte”.

## Limites e avisos

- Foram registrados quatro avisos de performance `GPU stall due to ReadPixels`
  no Chromium headless durante as capturas/leitura de GPU. Não houve erro de
  JavaScript, HTTP, compilação de shader ou `INVALID_OPERATION`. O teste não é
  benchmark de FPS nem avaliação em GPU/dispositivo físico do usuário.
- O catálogo Gaia é um recorte limitado, não todas as estrelas; mantém a época
  J2016.0 declarada. A API informa ausência de aplicação de movimento próprio
  nos registros sem velocidade radial completa. Nada foi propagado no frontend.
- IERS é o conjunto local disponibilizado pela API, com seu aviso de incerteza
  preservado. Nenhum dado foi baixado para fazer o teste passar.
- Fronteiras IAU são limites de regiões, não desenhos culturais ligando estrelas.
  O cross-match de nomes oficiais continua declarado indisponível pela API.
- Nuvens, poluição luminosa, relevo e obstruções não são modelados. Pinça em
  hardware físico e precisão astronômica independente não foram exercitadas.
