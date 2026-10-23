# Fase G — fundação científica, contratos, segurança e confiabilidade

Data da implementação local: 2026-08-18.

## 1. Objetivo

Esta fase estabelece um contrato científico verificável entre o navegador, o
Worker e o FastAPI. O estado físico continua em SI e somente o backend ou o
integrador Velocity-Verlet pode produzir novos estados físicos. Escala, câmera,
marcadores e órbitas desenhadas continuam adaptadores exclusivamente visuais.

## 2. Problemas corrigidos

- Respostas agora têm `schema_version: 1`, metadados e request ID.
- O frontend valida respostas em runtime e distingue indisponibilidade, erro de
  contrato, validação, rede, cobertura e servidor.
- Céu, eclipse e simulação usam POST com JSON; GET de céu/eclipses é somente
  compatibilidade depreciada e GET de simulação retorna 405.
- O Worker possui uma única tabela de roteamento, não calcula astronomia e
  aplica allowlist de headers no proxy.
- O provider DE442s é criado no lifespan, verifica os três hashes e reutiliza o
  mesmo leitor durante toda a aplicação.
- UTC, UTC canônico e TDB/ET são campos diferentes; o offset universal fixo foi
  removido.
- IERS opera offline, com a tabela real e o estado observável na resposta.
- Contatos de eclipse têm semântica C1/C2/MAX/C3/C4.
- Scripts usam pins, `.part`, `os.replace`, checksums e timestamps com semântica
  distinta.
- Docker e o script oficial prendem o serviço ao loopback do host e desativam o
  access log bruto.

## 3. Arquitetura

O fluxo dinâmico é `UI → ScienceGateway → FastAPI local` durante o uso local.
O Worker expõe snapshot e catálogos publicados; operações dinâmicas sem binding
retornam 501. Se existir um binding privado em um ambiente futuro, o Worker
preserva método e corpo, mas não encaminha Cookie ou Authorization do navegador.

No FastAPI, o lifespan configura IERS, verifica o manifesto, carrega o provider
uma vez, cria o semáforo de simulação e fecha os recursos no shutdown. O
`ApplicationEphemerisProvider` escolhe SpiceyPy quando instalado ou o leitor
DE442s somente leitura. Ambos compartilham a mesma identidade explícita de
alvos e recusam extrapolação.

O Atlas não foi alterado estruturalmente: `PlanetSurfaceExplorer` continua
dono de um canvas, um `WebGLRenderer` e um loop. Nenhuma resposta científica é
gravada no contrato compartilhável da cena.

## 4. Contratos

Toda resposta de sucesso contém `schema_version` e `meta`, com `request_id`,
`generated_at_utc`, `service`, `software_version` e `capability`. Erros usam o
envelope `error` e nunca o `detail` padrão do FastAPI.

Entradas Pydantic rejeitam campos extras, NaN, infinito, limites inválidos e
strings excessivas. Os decoders TypeScript rejeitam versão desconhecida,
vetores fora de dimensão 3, números não finitos, contatos desconhecidos e
catálogos ou capacidades malformados.

Cada estado DE442s declara corpo apresentado, alvo real, centro, tipo e nome do
alvo. O alias `naif_id` continua sendo o ID físico apresentado; ele não mascara
baricentros do sistema.

## 5. Métodos HTTP

| Rota | Canônico | FastAPI | Worker sem binding |
| --- | --- | --- | --- |
| `/api/health` | GET | liveness local | liveness edge |
| `/api/health/ready` | GET | readiness científico | não exposto |
| `/api/capabilities` | GET | capacidades nativas | snapshot/catálogos e dinâmicos indisponíveis |
| `/api/reference/state` | GET | DE442s dinâmico | snapshot fixo |
| `/api/catalogs/moons` | GET | catálogo | catálogo |
| `/api/catalogs/stars` | GET | catálogo | catálogo |
| `/api/catalogs/constellations` | GET | catálogo | catálogo |
| `/api/sky` | POST | cálculo | 501 |
| `/api/sky/constellations` | POST | cálculo | 501 |
| `/api/eclipses/local` | POST | cálculo | 501 |
| `/api/simulate` | POST | cálculo | 501 |

GET de céu, constelações e eclipse continua temporariamente disponível com
`Deprecation: true` e `Warning`. O frontend não usa essas rotas. OPTIONS e Allow
são definidos por rota; GET de simulação é 405.

## 6. Política de fallback

Referência pode tentar o backend local e depois o Worker. O Worker aceita o
snapshot somente quando o UTC solicitado coincide exatamente com a época fixa;
para outra época retorna `REFERENCE_EPOCH_UNAVAILABLE`. A UI oferece uma ação
explícita para trocar o UTC para a época fixa.

Céu, eclipse, constelações calculadas e simulação não possuem fallback
astronômico no Worker ou navegador. Catálogos podem usar as cópias estáticas
publicadas porque são o mesmo artefato validado por hash.

## 7. Request IDs

`X-Request-ID` recebido é aceito somente com `[A-Za-z0-9._-]{1,64}`; caso
contrário, um UUID é gerado. O mesmo valor aparece no header e no corpo. O ID
não incorpora query, coordenadas, UTC, corpo, topologia, token ou credencial.

## 8. Cache

Health, readiness, capabilities, céu, eclipse, simulação e erros usam
`Cache-Control: private, no-store`. Snapshot e catálogos do Worker usam
`public, max-age=3600`. O Worker sobrescreve cache recebido do upstream nas
rotas dinâmicas.

## 9. Privacidade

Latitude, longitude, elevação e UTC do observador são enviados no corpo POST.
Não entram em URL canônica, hash da cena ou armazenamento. O Worker remove
query de POST e aplica limite de 64 KiB antes do proxy.

## 10. Logs

O middleware registra apenas request ID, método, pathname sem query, status e
duração. O script oficial usa `--no-access-log`; valores do observador e corpo
não são registrados. Erros internos registram somente categoria e request ID.

## 11. Ciclo de vida SPICE

O manifesto é verificado antes do provider. SpiceyPy, quando presente, executa
`kclear` apenas na inicialização controlada e no shutdown, carrega cada kernel
uma vez e serializa o acesso ao kernel pool. O fallback instancia `DEKernel`
uma vez e reutiliza seus bytes somente leitura. O shutdown fecha o leitor.

## 12. Provider fallback

Ausência ou corrupção de kernel não derruba o processo. Health e catálogos
continuam disponíveis; referência e simulação retornam erro estável;
capabilities degrada granularmente e readiness pode responder 503. O fallback
DE442s continua sem extrapolação e sem inventar estado.

## 13. Cobertura

A cobertura é extraída dos segmentos do SPK e intersectada para os alvos
solicitados. FastAPI publica esse intervalo em capabilities e retorna
`EPHEMERIS_OUT_OF_COVERAGE` antes de integrar. No Worker, cobertura do snapshot
é exatamente sua época fixa.

## 14. Escalas de tempo

Entrada é UTC. Sufixo Z, ausência de offset por compatibilidade e offsets ISO
válidos são normalizados para UTC. Astropy converte UTC para TDB e segundos ET
desde J2000 TDB quando SpiceyPy não está instalado. Os campos são
`input_utc`, `canonical_utc`, `ephemeris_time_et_s` e `state_time_scale`.

A regeneração do snapshot trocou o antigo offset fixo pela conversão Astropy.
Comparada à versão anterior, a maior correção medida foi 34,1340408325 m em
posição e 0,0000413660 m/s em velocidade, ambas em Mercúrio; época física,
frame, centro, unidades e GM foram mantidos. Essa é uma correção de tempo
científica documentada, não uma escala visual.

## 15. IERS

`iers.conf.auto_download = False`. A resposta informa classe da tabela, faixa
UTC, status e avisos reais. Céu local usa ICRS → GCRS/ITRS → AltAz topocêntrico
com pressão 0 hPa. O horizonte é geométrico e não afirma visibilidade.

## 16. Limites N-body

Backend: 2 a 10 corpos, máximo 20.000 passos, duração absoluta de até um ano,
passo até 86.400 s, duração não nula e múltipla do passo. Corpos duplicados e
desconhecidos são rejeitados. Um semáforo local limita uma simulação por vez.
As métricas incluem energia, momento linear/angular, baricentro e deriva.

Browser: passo físico fixo de 3.600 s; velocidade controla somente 1 a 24
subpassos por atualização. A entrada é clonada, GM e metadados são preservados,
e singularidade pausa no último estado finito sem enviar NaN ao renderer.

## 17. Semântica de eclipse

Parcial usa C1/MAX/C4; total ou anular usa C1/C2/MAX/C3/C4; nenhum evento não
tem contatos. Cada contato pode declarar a posição do Sol e se ele está acima
do horizonte geométrico. Isso permanece separado de observabilidade. O método
é busca candidata por discos aparentes, brackets de 10 minutos, raízes Brent e
mínimo limitado; não é solução Besseliana operacional.

## 18. Catálogos

FastAPI e Worker mantêm 460 luas, 10.000 estrelas Gaia e 88 constelações IAU.
Paginação de luas aceita no máximo 250. Ganymede e demais luas sem estado SPK
continuam somente como metadados de elementos médios; nenhuma posição é
inventada. As abreviações IAU são únicas.

## 19. Docker

O Compose publica `127.0.0.1:8000:8000`, monta `data` somente leitura, remove
capabilities Linux, aplica `no-new-privileges`, filesystem somente leitura e
tmpfs em `/tmp`. O Dockerfile usa Python 3.12 slim e usuário não root. O Uvicorn
interno pode ouvir `0.0.0.0` porque a publicação do host é explicitamente
loopback; o comando usa `--no-access-log`. Não há credenciais ou túnel.

## 20. Testes

A matriz automatizada cobre envelopes, request IDs, sanitização, limite de
corpo, readiness, corrupção/ausência de kernel, reuso e concorrência do
provider, tempo, IERS, identidade/cobertura, simulação, céu, eclipses,
catálogos, Worker, runtime decoders, gateway, cancelamento, snapshot, N-body e
regressões de canvas. Os testes são offline; nenhum mock abre rede externa.
Resultados finais executados ficam na seção datada de `docs/validation.md`.

## 21. Limitações remanescentes

- DE442s não é extrapolado e gigantes usam baricentros do sistema.
- Somente a Lua tem estado exato entre as luas exibíveis; elementos médios não
  são posições observáveis.
- N-body é newtoniano de pontos materiais: sem J2, relatividade, marés, pressão
  de radiação ou subpassos hierárquicos de luas.
- DOP853 não está exposto na API pública e o N-body do navegador não usa Web
  Worker.
- Órbitas desenhadas são osculantes; escalas e marcadores são visuais.
- Céu usa refração desabilitada e não modela clima, poluição luminosa, relevo,
  obstruções, equipamento ou percepção.
- Eclipse não é operacional; o Gaia publicado não é o céu completo.
- Worker não calcula astronomia; operações dinâmicas exigem o backend local.
- Presença futura de binding não garante saúde; GET legado é menos privado.
- Atlas continua visual/procedural.

## 22. Preparação para fases futuras

Os contratos permitem acrescentar constelações avançadas, Laboratório N-body,
Terra física, eclipse Besseliano, sistemas de luas, missões, Earth Lab e um
assistente sem misturar estado físico e visual. Cada capacidade futura deve
declarar fonte, cobertura, referencial, limites e ausência explícita de dados.
