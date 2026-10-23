# Backend — correções após a revisão de 20/10/2026

## Escopo e preservação

Implementação local autorizada, na sequência abaixo, sem publicação, túnel,
commit, push ou operações destrutivas de Git. O checkout `main` já continha
alterações staged, unstaged e arquivos não rastreados; elas são preservadas.
Este documento separa os testes executados dos critérios ainda pendentes.

## Sequência e aceites

1. **Kernels:** manifesto confiável, lista exata, hashes e caminhos seguros;
   dados inválidos não carregam e não impedem o diagnóstico do serviço.
2. **Catálogos/cache:** integridade e estrutura verificadas antes do consumo,
   cache vinculado ao conteúdo aprovado, falhas explícitas e recuperação,
   sem inventar posições ou transformar ausência em catálogo vazio.
3. **Contratos:** capabilities completos e coerentes; versão de envelope
   obrigatória e estrita, mantendo 501, bytes válidos e ausência de retry POST.
4. **Tempo:** preservar a precisão UTC aceita e a conversão única para ET;
   testar offsets, segundos intercalares e equivalência dos leitores.
5. **Compose:** arquitetura compatível com locks, recursos e logs limitados,
   encerramento e recuperação configurados, orbital interno e dados read-only.
6. **Medições/diagnóstico:** startup com diagnóstico sanitizado, benchmark
   reproduzível de latência/memória/concorrência e avaliação explícita de
   cancelamento, sem prometer capacidade a partir de um ensaio.

## Baseline observado

- Revisão anterior, mesmo estado inicial: 145 testes locais passaram,
  cinco comparações SpiceyPy ignoradas e 69 avisos.
- Inventário: 12 arquivos verificados; IERS aprovado e utilizável em 20/10.
- Docker client disponível, daemon inicialmente desligado/inacessível.
- Volume C com aproximadamente 1,87 GiB livres no começo da implementação.
  Nenhuma limpeza foi autorizada ou executada.
- A suíte local não substitui o gate Docker nem a medição de carga.

## Evidências desta implementação

### 1. Kernels

- Manifesto conferido contra o inventário fornecido com o código; esquema
  estrito e lista exata de três kernels. Tamanhos/hashes dos arquivos também
  precisam coincidir com o inventário.
- Manifesto vazio, incompleto, duplicado, malformado ou caminho fora da raiz
  mantém o provider indisponível, sem erro de startup.
- `test_kernel_integrity.py`: **30 passaram** (3,79 s).
- Baseline `test_science_foundation.py -k "provider or health_is_cheap"`:
  **3 passaram**, 20 não selecionados, cinco avisos (9,26 s).

### Restrição do ambiente Docker

Docker Desktop foi iniciado somente para inventário: daemon 29.7.2, nenhum
contêiner em execução e três imagens científicas locais existentes. O espaço
livre caiu para aproximadamente 188 MiB; a instância iniciada foi parada, sem
build, exclusão, alteração dos contêineres ou publicação de porta.

O usuário informou não conseguir liberar espaço. O volume G é virtual
(Google Drive), compartilha o armazenamento local e não é alternativa de
disco. Após parar Docker, o espaço recuperou aproximadamente 2 GiB. Esse
comportamento torna arriscado presumir folga suficiente para novo build.
Validações locais continuam; Docker não será declarado aprovado sem execução.

Na continuação, C chegou a zero bytes e as gravações foram interrompidas antes
de iniciar o gate 5. Nenhum arquivo foi apagado pelo agente. Após o usuário
liberar espaço, a retomada confirmou **12.702.552.064 bytes livres** no mesmo
dia. As verificações Docker serão retomadas, sem confundir esse inventário
com aprovação de build ou runtime.

### 2. Catálogos e caches

- Cinco artefatos validados por hash/tamanho e estrutura: luas, Gaia,
  guias IAU, vértices de limites e status dos nomes oficiais.
- Cache de parsing identificado por raiz/conteúdo aprovado; cache derivado
  Gaia identificado por caminho e SHA. Bytes conferidos antes de cada
  consulta ao cache, mesmo com tamanho e mtime preservados.
- Cópias isolam os consumidores do conteúdo mutável do cache. Leituras de
  dados são limitadas ao tamanho aprovado mais um byte; prontidão não copia
  desnecessariamente o catálogo inteiro.
- Falhas retornam 503 `CATALOG_DATA_UNAVAILABLE`. Disponibilidade é reavaliada
  por operação; a capability `sky_constellations` distingue o observatório
  do céu básico. Nenhum GM, posição, época ou campo de procedência é inventado.
- Gate HTTP + catálogo + planejamento: **38 passaram**, dez avisos (41,07 s),
  no novo ambiente Python 3.12/SpiceyPy.
- Revalidação dos núcleos kernels/catálogos após ajustes de leitura limitada:
  **53 passaram**, sem avisos (4,66 s).

### Ambiente alternativo para validar SPICE

Foi criado `work/science-py312`, independente da `.venv` anterior e do runtime
bundled. Python 3.12.14, SpiceyPy 7.0.0/CSPICE_N0067 e 35 pacotes travados com
hashes. Mesmas versões científicas dos locks Linux; no Windows, `uvloop` é
inaplicável e `colorama` satisfaz os marcadores de dependência da plataforma.
Instalação somente por wheels, sem cache, sem copiar os dados científicos.
Verificação de pins, import nativo, `pip check` e integridade IERS passaram.
O ambiente ocupa aproximadamente 218 MiB. Isso não é um build Docker.

### 3. Contratos da API

- Capabilities completas e validadas, incluindo snapshot, limites e estado
  de cada operação. Resposta incompleta do orbital não permite readiness
  positiva nem limites inventados.
- `schema_version` precisa ser o inteiro `1`, também nos erros. `true`,
  `1.0`, strings e versão ausente são rejeitados.
- Respostas válidas preservam os bytes e a procedência; 501 continua 501,
  sem fallback astronômico nem repetição automática de POST.
- IERS ausente/corrompido desabilita as operações do observador. Previsões
  antigas são declaradas sem invalidar dados históricos válidos. Orbital
  não depende de IERS para prontidão ou capabilities.
- Gate de limites, papéis dos serviços, contratos e catálogos HTTP:
  **121 passaram**, sem skips (60,42 s), em Python 3.12/SpiceyPy.
- Regressão adicional: `False` não pode ser aceito como centro numérico `0`;
  **1 passou**. Verificação de whitespace do diff passou.
- Revisão cruzada encontrou JSON não interoperável em campos extras/erros:
  `NaN`, infinitos, overflow `1e999` e chaves duplicadas agora são rejeitados
  como 502, inclusive em resposta 501. O 501 válido permanece intacto.
- Na retomada, duas regressões confirmaram que aninhamento JSON excessivo
  também precisa virar 502, não 500. Captura específica adicionada, sem
  vazamento de conteúdo nem retry: **128 testes passaram**, nenhum ignorado,
  no subset contracts/boundaries/service roles (33,28 s; 144 avisos).
- A execução completa em Python 3.14 revelou que a exceção do parser, sozinha,
  não era uma proteção portátil. Agora há limite explícito de **128 níveis de
  containers**, percorrido iterativamente. Treze regressões focadas passaram
  em cada ambiente (3.14 e 3.12), incluindo 127/128/129 e 10.000 níveis:
  200/501 válidos preservam bytes; excesso retorna 502, sem retry.

### 4. Precisão temporal

- Canonicalização UTC preserva até seis casas decimais, mantendo pelo menos
  três para compatibilidade. Conversão ET evita subtrair datas Julianas
  previamente colapsadas em um único float.
- Simulação e gateway usam a mesma adição de segundos SI para a época final.
  Offsets, segundos intercalares e frações submilissegundo são preservados.
- SPICE e leitor DE442s recebem a mesma época numérica; não há segunda
  interpretação de UTC por `str2et`.
- Gate ampliado de oito arquivos (tempo, foundation, IERS, efeméride,
  limites da API, capabilities, serviços e catálogos HTTP): **205 passaram,
  nenhum ignorado**, 198 avisos em 54,05 s, Python 3.12/SpiceyPy.
- Extremos reais DE442s aceitos; **1 microssegundo fora dos dois extremos
  retorna 422**. Não houve relaxamento de limite nem extrapolação.
- Avisos mantidos visíveis: deprecações Starlette/AnyIO e ERFA nas datas
  extremas. Essa execução não substitui a suíte final completa.

### 5. Compose, instalação e manutenção

- Plataforma Linux AMD64 explícita, compatível com os hashes dos wheels.
  CPU/RAM/PIDs, tmpfs, logs, workers, concorrência e encerramento são
  configuráveis. Limites operacionais não alteram limites científicos.
- Imagens runtime incluem o inventário exigido pelo provider.
- Lock Windows CPython 3.12 e manifesto de artefatos persistidos no backend;
  os locks Linux anteriores foram preservados. Gate confere paridade de
  versões, com exceções de plataforma declaradas (`uvloop`/`colorama`).
- Runner exige perfil explícito e distingue `--check-only` de suíte completa.
  Gate completo rejeita testes ignorados.
- Preparação/ativação/rollback IERS schema 2 inclui os dois perfis. Releases
  antigas são preservadas e recusadas antes de qualquer escrita; exigem nova
  preparação pelo procedimento atualizado.
- **29 testes focados passaram**, sem skips. Compose config/JSON aprovados.
  Check-only Windows aprovado: 35 pins, IERS atual, inventário de 12 arquivos
  e `pip check`.
- Revisão independente fechou um falso positivo possível: o gate recusa
  `PYTEST_ADDOPTS` herdado e rejeita testes desmarcados, além de skips.
  Após isso: **23 testes de perfis** e **10 de releases IERS** passaram.
  Falha de escrita injetada confirmou recuperação byte a byte dos sete
  arquivos anteriores, sem modificar a release real.
- Build e validação Docker real executados no projeto separado
  `orbis-validation-20261020`, sem modificar os dois contêineres antigos
  `solar-*`, encontrados parados. Override de validação remove todas as
  portas do host; isso não é publicação do site.
- As três imagens iniciais construíram com instalação por hashes e `pip check`.
  As três foram reconstruídas com as últimas correções antes do gate final.
  Os três testes de contrato do Compose/Dockerfile passaram no checkout.

### Execução intermediária do ambiente original

Antes das alterações de ferramentas da etapa 6, a `.venv` Python 3.14 coletou
328 testes: **318 passaram, oito foram ignorados e dois falharam** (375,63 s,
185 avisos; build Docker concorrente, portanto não é medida de capacidade).

- Falha no reinício HTTP: timeout fixo de 30 s, sem diagnóstico capturado.
- Falha da regressão de JSON profundo: Python 3.14 aceitou a árvore sem lançar
  `RecursionError`, indicando necessidade de limite explícito de profundidade.
- Oito skips: cinco comparações SPICE anteriores e três casos novos de precisão
  entre leitores, pois essa `.venv` não contém SpiceyPy.

Esses resultados não são aprovação final; haverá reexecução após as correções
e gates completos com SPICE.

### 6. Diagnóstico, processos e medição

- Par de serviços efêmeros identificado por token exclusivo no health da
  factory de testes. Um HTTP 200 de processo alheio não comprova inicialização.
  A API de produção não recebe esse middleware de identificação.
- Startup configurável, buffer limitado e diagnósticos por categorias
  permitidas, sem reter mensagens privadas. Encerramento contém os filhos
  em Job Object no Windows e grupo privado no Linux; fallback confere PID
  e criação no mesmo handle. Falha do amostrador não impede o cleanup.
- Benchmark HTTP com nove operações, fases cold/priming/warm, concorrência
  configurável e nenhuma repetição automática. Sucessos, 429, outros erros
  e timeouts têm contagens e percentis separados.
- Memória de workers e launchers é registrada por identidade; pico agregado
  usa o mesmo ciclo de amostragem. RSS inacessível é `null`, nunca zero.
  Custo de observação e amostras incompletas ficam explícitos.
- Saída JSON exige caminho novo e preserva evidência parcial em caso de falha.
  Versões, configuração e hashes permitem identificar o ensaio.
- **28 testes focados passaram** em Python 3.12 (5,46 s), incluindo encerramento
  real de launcher e filhos no Windows, com e sem Job Object.
- Timeout de HTTP não cancela automaticamente o cálculo em thread. O
  benchmark interrompe as fases restantes da operação nesses casos e encerra
  seus processos; cancelamento cooperativo/distribuído não foi implementado.
  Método e limites em [backend-capacity.md](backend-capacity.md).

### Regressões do frontend

Nenhum código-fonte do frontend foi alterado nesta etapa.

- `npx.cmd tsc --noEmit`: passou.
- `npm.cmd test`: passou; build Vinext, 21 testes Node/Worker/SSR e
  53 testes TypeScript, sem falhas ou skips.
- `npm.cmd run lint`: passou.
- O build ainda informa chunks acima de 500 kB, tempos de plugins e rotas
  classificadas como `Unknown`. Isso não equivale a validação visual.

### Gate completo Windows CPython 3.12

Comando executado após as correções finais de código e ferramentas:

```powershell
.\work\science-py312\Scripts\python.exe -B backend/tools/run_gates.py --environment windows-cp312
```

- Perfil, 35 dependências, artefatos, IERS atual, inventário de 12 arquivos e
  `pip check`: aprovados.
- **375 testes passaram, zero falhas, zero skips**, em **120,86 s**.
  Inclui `backend/tests` e `backend/validation`, comparações reais SPICE,
  HTTP entre serviços, recuperação, concorrência e integração de 20.000 passos.
- 206 avisos visíveis: deprecações Starlette/AnyIO e ERFA nas datas extremas
  exercitadas. Não foram suprimidos nem convertidos em cobertura científica.
- O runner declarou `complete-gate-passed` e `suite_executed: true`.

### Medição HTTP executada no Windows

Arquivo preservado: `work/capacity-windows-20261020-final.json` (SHA-256
`fbb5bc7917dae69f15de74f86d1a85132dcdaab00ad37b9fb71ee3d1cf86c037`).
Execução de 11:55:36 a 12:01:15, horário de São Paulo, em 20/10/2026.
Windows AMD64/CPython 3.12.14, quatro CPUs lógicas, um worker por serviço,
limite científico de um cálculo por worker, OMP/OpenBLAS com uma thread.
Sem build ou suíte concorrente; Docker Desktop estava ativo.

```powershell
.\work\science-py312\Scripts\python.exe -B backend/tools/benchmark_services.py --repetitions 5 --concurrency 1 2 4 --output work/capacity-windows-20261020-final.json
```

As 324 requisições medidas produziram **240 sucessos e 84 rejeições 429**;
nove chamadas de priming também tiveram sucesso. **Zero outros erros HTTP,
timeouts ou falhas de transporte**. Todas as nove operações concluíram.

Valores abaixo em milissegundos, somente respostas 2xx aquecidas.
Com concorrência 1 há cinco observações por operação; o p95 é o máximo dessa
pequena amostra. Com concorrência 4, a última coluna mostra rejeições entre
20 requisições (elas não entram no p95 de sucesso).

| Operação | p50, conc. 1 | p95, conc. 1 | p95, conc. 4 | 429, conc. 4 |
| --- | ---: | ---: | ---: | ---: |
| Estado de referência | 17,48 | 19,26 | 75,65 | 0/20 |
| Catálogo de luas | 33,96 | 40,28 | 188,57 | 0/20 |
| Catálogo de estrelas, 100 itens | 177,09 | 207,67 | 625,12 | 0/20 |
| Catálogo de constelações | 27,86 | 31,48 | 100,28 | 0/20 |
| Céu local | 262,56 | 275,53 | 413,48 | 15/20 |
| Céu de Orion | 861,20 | 1.004,57 | 963,17 | 15/20 |
| Eclipse, janela de seis horas | 2.731,20 | 2.855,23 | 2.671,28 | 15/20 |
| Simulação curta | 16,14 | 20,36 | 57,13 | 2/20 |
| Dez corpos / 20.000 passos | 9.239,80 | 12.485,66 | 11.141,57 | 15/20 |

- Maior RSS agregado observado no mesmo poll: **414,54 MiB**, durante a
  primeira consulta de Orion. Launchers e workers incluídos; não é memória
  física exclusiva nem o pico do host/WSL.
- **1.626 polls, nenhum incompleto**. Custo acumulado de parede das leituras:
  **65,86 s**, sobreposto ao ensaio, não descontado das latências. Não é tempo
  de CPU nem overhead isolado: inclui espera/desescalonamento durante a leitura.
  Os 100 ms são espera configurada entre leituras, não frequência efetiva de
  10 Hz. O amostrador pode interferir no ensaio; comparar intervalos maiores
  em nova medição antes de usar esses números para capacidade.
- Startup observado: aproximadamente 4,73–6,03 s por serviço; não faz parte das
  latências HTTP. O JSON contém cold, priming, concorrência 2, processos e hashes.
- As rejeições confirmam saturação controlada, não capacidade para executar
  quatro cálculos pesados simultaneamente. A simulação curta às vezes termina
  antes de outra chamada da onda chegar, portanto pode aceitar mais de uma.
- Mantidos os padrões conservadores de um worker e concorrência científica 1.
  Não dimensionar workers Linux nem prometer throughput de produção a partir
  deste único ensaio nativo; limites Compose são salvaguardas configuráveis,
  não uma equivalência de desempenho com Windows.

### Gate completo Docker/Linux CPython 3.12

```powershell
docker compose -p orbis-validation-20261020 --profile tests build science orbital science-tests
docker compose -p orbis-validation-20261020 --profile tests run --rm --no-deps science-tests
```

- Build final dos três alvos aprovado, sem alterar as tags `solar-*`.
- **375 testes passaram, zero falhas, zero skips**, em **137,05 s**;
  206 avisos das mesmas categorias do Windows. Runner:
  `complete-gate-passed`, `suite_executed: true`.
- 35 pacotes, inventário de 12 arquivos, IERS e `pip check` aprovados
  **dentro da imagem**, sem rede externa.
- Inspeção do contêiner real de testes: usuário `orbis`, rootfs read-only,
  dados/public read-only, rede `none`, nenhum port binding, 2 CPUs,
  3 GiB de RAM, 512 PIDs, tmpfs de 512 MiB com `noexec,nosuid`,
  capabilities removidas e `no-new-privileges`.
- Docker Engine 29.7.2, Compose 5.4.0, daemon com quatro CPUs e
  8.257.122.304 bytes de memória. Não foi feito benchmark Linux/Compose
  equivalente à matriz nativa; o gate de carga não substitui esse benchmark.

Identidades das imagens locais efetivamente verificadas:

| Alvo | SHA-256 |
| --- | --- |
| science | `95a4e8702acf60f3e408471b1531c34d7655b816d84497be024430a16376b718` |
| orbital | `5e1c6cce77c31136e501e22e808efbe5f6277ea5b16ea7087479f1a1fb38cd59` |
| science-tests | `702bcdfe1d9518c2258215c0619a7ead632a9c0a7a9ca934c53ead78c6845b93` |

### Runtime Compose: serviços separados, queda e recuperação

Foi usado exclusivamente o projeto de validação, com
`work/compose-validation-no-ports.yml` removendo portas e desabilitando restart
automático nos contêineres temporários. O helper
`work/check-compose-runtime.py` executou HTTP de dentro do contêiner science.

- Subida `--wait`: os dois serviços ficaram healthy.
- Online: health, readiness, referência, capabilities, três catálogos,
  simulação e céu local responderam **200**. Request ID preservado.
- Orbital parado: health e céu local **200**, readiness e referência **503**;
  código `ORBITAL_UNAVAILABLE`, sem resposta astronômica inventada.
- Orbital reiniciado: os nove checks online voltaram a **200**.
  SHA-256 dos corpos de referência antes/depois idêntico:
  `2e1fc35ddadc7e86eae0d045e5592f3d94fffd894507cc5b9992772609425d40`.
- Execução como UID 100. Ambos rootfs/dados read-only, 2 CPUs/256 PIDs,
  RAM science 2 GiB/orbital 1 GiB, logs limitados a três arquivos de 10 MiB
  e stop timeout 135 s. Nenhum binding de porta no host.
- Rede computation com `internal=true`; orbital ligado somente a ela.
- Ao final, `down` removeu apenas os dois contêineres e as duas redes criadas
  para validação. Imagens, dados, volumes existentes e contêineres antigos
  `c029e53432b2`/`29e3be747293` foram preservados. Nenhum processo Python
  temporário permaneceu na enumeração Windows.
- Docker Desktop foi desligado novamente, restabelecendo o estado inicial.
  Espaço livre final observado em C: **9.362.534.400 bytes**. Nenhuma limpeza de
  arquivos, imagens, caches ou volumes do usuário foi feita.

### Reexecução final da `.venv` original

```powershell
backend\.venv\Scripts\python.exe -B -m pytest backend/tests -p no:cacheprovider -ra
```

**365 passaram, oito skips, zero falhas**, 187 avisos, **153,08 s**.
Os skips correspondem exclusivamente à ausência de SpiceyPy nessa instalação:
cinco comparações em `test_science_foundation.py` e três em
`test_time_precision.py`. Todos esses casos foram executados e aprovados
nos dois perfis completos acima. A instalação antiga não foi modificada.
Este ensaio coincidiu com o rebuild Docker, portanto sua duração não é benchmark.

## Conclusão e limites remanescentes

As seis etapas deste follow-up foram implementadas e seus aceites locais
executados. Não houve commit, push, deploy, túnel, publicação de porta,
reset, checkout, restore, clean, stash ou rebase. O índice Git manteve o SHA-256
`7c16d9ba10c2fb510f17718fa77137ccb8f6c20927a87998a5a642aa99867a1d`;
os trabalhos staged, unstaged e não rastreados anteriores foram preservados.
`git diff --check` passou, com os avisos de conversão LF/CRLF existentes.

Não foram implementados nem afirmados: cancelamento cooperativo/distribuído
de cálculos, fila global entre workers, capacidade garantida de produção,
suporte validado em ARM64/GPU ou validação visual/hardware. Timeout não é
cancelamento. As deprecações das dependências continuam visíveis; atualizar
os pins exige novo gate, não supressão de avisos.

Os dados IERS estavam válidos nesta execução; a política atual expira o uso
das previsões em **01/11/2026 UTC**, exigindo atualização controlada para
continuar usando previsões após esse limite. Dados históricos válidos não são
globalmente desabilitados por isso. Nenhuma cobertura foi extrapolada.
