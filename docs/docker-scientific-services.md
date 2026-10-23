# Dois serviços de cálculo locais

> Configuração atualizada em 20/10/2026: perfis científicos explícitos Linux e
> Windows CPython 3.12, locks com hashes, inventário no runtime e guardrails
> configuráveis. As evidências de **22/09/2026** preservadas abaixo são históricas:
> não aprovam o build nem o runtime das alterações de 20/10.
> Veja também a [política temporal](ephemeris-time-policy.md).

O `docker-compose.yml` separa processos, preservando os contratos HTTP do site.
O backend direto `astro_system.api.main:app` continua disponível sem Docker.

| Serviço | Responsabilidade | Acesso |
| --- | --- | --- |
| `science` | Céu topocêntrico, observatório de constelações, busca local de eclipses; encaminhamento das rotas orbitais | `127.0.0.1:8000` |
| `orbital` | Estados DE442s, integração Velocity-Verlet, catálogos de luas, estrelas e constelações | Somente rede Docker interna |

O encaminhamento não recalcula resultados: preserva o JSON orbital, valores SI,
época, referencial, procedência e erros. Não repete POST nem substitui 501 por
uma aproximação. Falhas de conexão retornam 503; timeout, 504; respostas inválidas,
502. Cookies e credenciais recebidos do navegador não são encaminhados.

## O que esta separação não inventa

- Planetas e Lua: somente alvos e intervalos explicitamente cobertos pelos kernels.
  Alguns alvos são baricentros de sistemas, conforme o contrato existente.
- Outras luas: catálogo não equivale a estado orbital. Precisam de kernels próprios.
- Estrelas: posições de catálogo e transformação observacional, não órbitas físicas
  integradas pelo sistema solar. Não há novo modelo de dinâmica estelar.
- Eclipses: mantém o método e suas limitações declaradas; não se torna uma previsão
  operacional Besseliana por estar em um contêiner.
- IERS: continua offline, com rejeição de previsões vencidas e épocas sem cobertura.
  A imagem não atualiza tabelas ou kernels automaticamente.

## Iniciar

Requer Docker com motor Linux ativo e Compose. Execute na raiz do projeto:

```powershell
cd C:\aleatorio\eu\Solar
docker compose config --quiet
docker compose --profile tests build
docker compose --profile tests run --rm --no-deps science-tests
# Só promover as mesmas imagens após aprovação do gate.
docker compose up -d
docker compose ps
Invoke-RestMethod http://127.0.0.1:8000/api/health
Invoke-RestMethod http://127.0.0.1:8000/api/health/ready
Invoke-RestMethod http://127.0.0.1:8000/api/capabilities
```

Não inicie simultaneamente a API Python direta e `science` na mesma porta.
Para teste paralelo, configure `$env:SCIENCE_PORT = '8010'` antes do Compose.
Isso não muda automaticamente a URL usada pelo frontend.
O frontend continua iniciado separadamente com `npm.cmd run dev`.

Logs: `docker compose logs --tail 100 science orbital`.
Parar os dois serviços: `docker compose stop`.
`/api/health` é liveness; `/api/health/ready` informa dependências locais/orbitais.
Readiness não garante cobertura IERS para qualquer data: consulte o campo `iers`
e o resultado da solicitação. Os healthchecks usam liveness para não reiniciar
indefinidamente um processo saudável quando faltam dados científicos.

## Dimensionamento sem vínculo com esta máquina

Há limites operacionais configuráveis, não uma arquitetura limitada a este
notebook. Estes padrões são guardrails iniciais, **não capacidade medida**:

| Serviço | CPU máxima | Memória máxima | PIDs | `/tmp` |
| --- | --- | --- | --- | --- |
| `science` | 2 | 2 GiB | 256 | 256 MiB |
| `orbital` | 2 | 1 GiB | 256 | 256 MiB |
| `science-tests` | 2 | 3 GiB | 512 | 512 MiB |

`SCIENCE_CPUS`, `ORBITAL_CPUS`, `TEST_CPUS`, `SCIENCE_MEMORY_LIMIT`,
`ORBITAL_MEMORY_LIMIT`, `TEST_MEMORY_LIMIT`, `ORBIS_PIDS_LIMIT`,
`TEST_PIDS_LIMIT`, `ORBIS_TMPFS_BYTES` e `TEST_TMPFS_BYTES` alteram esses limites.
O uso de tmpfs conta contra a memória do contêiner. Limites baixos podem causar
OOM/indisponibilidade; não representam aceleração automática.
Exemplo para um servidor com recursos suficientes, ainda não recomendação medida:

```powershell
$env:SCIENCE_WORKERS = '4'
$env:ORBITAL_WORKERS = '2'
$env:ORBITAL_TIMEOUT_SECONDS = '120'
$env:SCIENCE_CPUS = '4'
$env:SCIENCE_MEMORY_LIMIT = '4g'
$env:ORBITAL_CPUS = '2'
$env:ORBITAL_MEMORY_LIMIT = '2g'
docker compose config --quiet
docker compose up -d
```

Os padrões são um worker por serviço. Cada worker tem memória, kernel pool,
catálogos e semáforo próprios; cada worker orbital admite uma integração por vez.
`SCIENCE_CONCURRENCY` configura admissões científicas por worker, padrão 1,
sem criar fila distribuída. Aumentá-lo exige medir interferência entre operações.
Mais workers consomem mais RAM e não aceleram uma integração isolada. BLAS/OpenMP
usam uma thread por processo para evitar multiplicação involuntária de threads.
Meça latência p95, memória e saturação antes de aumentar workers. Limites
científicos de corpos/passos permanecem inalterados: hardware maior não é
autorização para removê-los sem validação numérica.

Para máquinas distintas, a factory aceita `ORBIS_ORBITAL_URL` configurado pelo
operador. O Compose entregue fica deliberadamente em uma rede interna local.
Distribuição entre hosts exige rede privada autenticada/TLS, balanceamento e
observabilidade; isso **não** foi implantado. Não há fila distribuída, cancelamento
remoto ou limite global entre réplicas. Um timeout do gateway não cancela um cálculo
já em execução no orbital. Não use `--scale` como promessa de balanceamento justo.

## Isolamento e reprodutibilidade

Ambos rodam como usuário não root, filesystem read-only, capabilities removidas,
sem novos privilégios, dados montados read-only e cache temporário em `/tmp`.
Somente a porta de `science` é vinculada ao loopback. O orbital só participa da
rede interna `computation`; science também usa a bridge `local_entry` para permitir
o vínculo ao host. Essa bridge não bloqueia conexões de saída; a política IERS
offline é imposta pelo aplicativo. O build precisa de internet para dependências.
O contexto de build exclui `.venv`, dados e arquivos locais por allowlist.
O Dockerfile fixa o digest da imagem base e instala `runtime`, `orbital`,
`tests` e `build` a partir de locks com `--require-hashes --only-binary=:all:`.
As faixas do `pyproject.toml` são metadados; não são a resolução aprovada desses
perfis. `data-inventory.json` é copiado já para o runtime, pois a integridade
de kernels/catálogos também é exigida durante o atendimento.

Os hashes binários Linux são **AMD64/CPython 3.12**; o Compose declara
`platform: linux/amd64`. Em ARM64 isso depende de emulação do Docker, não é
suporte nativo validado. Não trocar somente a plataforma: um perfil ARM nativo
exige wheels, hashes e validação científica próprios.

Os logs `json-file` são limitados a 3 arquivos de 10 MiB por contêiner, configuráveis
por `ORBIS_LOG_MAX_SIZE` e `ORBIS_LOG_MAX_FILES`. Isso não limpa logs/imagens antigos
nem limita o disco total do Docker. `init` coleta processos filhos; APIs usam
`restart: unless-stopped`, enquanto o runner nunca reinicia automaticamente.
Um healthcheck malsucedido não causa restart por si só.

Uvicorn recebe 120 s para shutdown e Compose aguarda 135 s antes do encerramento
forçado. Ao ajustar `ORBIS_SHUTDOWN_TIMEOUT_SECONDS` e `ORBIS_STOP_GRACE_PERIOD`,
manter a segunda duração maior que a primeira. Esses prazos não garantem
cancelamento seguro de uma tarefa científica em thread; um trabalho ainda em
execução pode ser interrompido ao atingir o limite. Guardar resultados apenas
após resposta completa, e não repetir POST automaticamente.

Para implantação em outro servidor, promover a mesma imagem aprovada por
ID/digest e os mesmos dados/inventário. Atualização e reversão IERS estão em
[manutenção controlada](backend-data-maintenance.md); não editar dados enquanto
serviços os consomem.

## Validação

```powershell
backend\.venv\Scripts\python.exe -m pytest backend\tests -p no:cacheprovider
backend\.venv\Scripts\python.exe -m pytest backend\tools\test_deployment_contract.py -p no:cacheprovider
docker compose --profile tests config --quiet
docker compose --profile tests config --format json
```

O primeiro comando continua útil no ambiente de desenvolvimento, mas não é
automaticamente o gate completo: pode não possuir SPICE/versões aprovadas.
O teste de deployment é um pré-build do checkout, executado explicitamente;
não é incluído dentro do contêiner, que não contém o Compose da raiz.

O runner oficial exige `--environment linux-cp312` ou
`--environment windows-cp312`: valida SO/arquitetura/CPython 3.12, versões,
coerência dos hashes/manifests e paridade científica entre os perfis.
Depois verifica IERS e sua cobertura atual, inventário, `pip check` e
`pytest tests validation` sem ignorados. O CMD do contêiner seleciona Linux.
`--check-only` executa os diagnósticos sem pytest e informa expressamente
`suite_executed=false`; não serve como aprovação da suíte.

### Perfil Windows isolado com SPICE

`backend/locks/windows-cp312.lock` e seu manifesto contêm as mesmas versões
científicas do Linux. Só os wheels mudam; `uvloop` é omitido no Windows e
`colorama 0.4.6` é incluído por pytest. A instalação não modifica a `.venv`
original nem exige instalar o backend em modo editable.

Para reproduzir, instalar **Python 3.12 AMD64** com o launcher `py` e selecionar uma pasta NOVA:

```powershell
cd C:\aleatorio\eu\Solar
if (Test-Path -LiteralPath work/science-py312) { throw 'Ambiente já existe; preservar e escolher outra pasta para reconstrução.' }
py -3.12 -m venv work/science-py312
if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o ambiente Python 3.12.' }
work\science-py312\Scripts\python.exe -m pip install --require-hashes --only-binary=:all: --no-cache-dir --no-compile -r backend/locks/windows-cp312.lock
if ($LASTEXITCODE -ne 0) { throw 'Instalação falhou; não executar o gate.' }
work\science-py312\Scripts\python.exe -B backend/tools/run_gates.py --environment windows-cp312
```

Para um ambiente já preparado, executar somente a última linha. O runner importa
o código de `backend/src`; os dados existentes são reutilizados, não copiados.
A aprovação Windows exercita SPICE e as mesmas regressões científicas, mas **não**
valida build, rede, cgroups, tmpfs ou lifecycle Docker.

`test_service_roles.py` cobre isolamento de rotas, ausência de carregamento de
kernels no processo science, estado real encaminhado sem alteração, integração,
indisponibilidade, timeout, resposta inválida, 501/429/422 sem fallback/retry,
limite de corpo e remoção de credenciais no encaminhamento.
Esses testes em processo não substituem build e execução real no motor Docker.

### Pré-build executado em 20/10/2026

- `pytest backend/tests/test_execution_profiles.py backend/tests/test_iers_release.py backend/tools/test_deployment_contract.py -p no:cacheprovider -ra`:
  **29 passaram**, sem skips.
- `docker compose --profile tests config --quiet` e inspeção do JSON resolvido:
  aprovados; limites, plataforma, ausência de porta orbital e isolamento do runner
  correspondem à configuração documentada.
- `run_gates.py --environment windows-cp312 --check-only`: aprovado, 35 pins,
  IERS íntegro e válido na execução, 12 arquivos do inventário e `pip check`.
  A resposta foi `suite_executed=false`: não é aprovação da suíte completa.

Esse bloco registra somente o pré-build; aprovação da imagem, rede, cgroups e
runtime exige execução Docker com suas próprias evidências.

### Validação final de 20/10/2026

O [relatório de hardening](backend-hardening-followup-2026-10-20.md) registra a
execução posterior: **375 testes sem falhas ou skips no Windows CPython 3.12**
e **375 sem falhas ou skips na imagem Linux CPython 3.12**, com SPICE, inventário
e IERS verificados. Os três alvos foram reconstruídos e seus IDs registrados.
O runner real foi inspecionado sem rede/portas, não-root, rootfs/dados read-only
e com limites de recursos aplicados.

Também foi validado o par science/orbital em projeto Compose separado e sem
portas no host: serviços saudáveis, indisponibilidade explícita ao parar
orbital, céu local preservado e recuperação com estados físicos idênticos.
Os contêineres/redes temporários foram removidos; os antigos foram preservados.
O benchmark nativo e suas limitações estão no mesmo relatório; ele não é uma
medição de capacidade dos contêineres em produção.

### Evidência executada em 2026-09-22

- Suíte Python local: **67 passed, 1 skipped**, 21 warnings; o teste comparativo
  SpiceyPy foi ignorado por ausência dessa dependência opcional. Os warnings
  incluem depreciação TestClient/httpx e ERFA para épocas históricas/distantes.
- Compose config e build das duas imagens: passaram.
- Compose up com espera por saúde: ambos os contêineres `healthy`.
- HTTP real pelo Windows: readiness true; estado de Sol/Terra/Lua com 3 corpos;
  integração de 6 passos; céu histórico com 9 objetos; consulta de 1 estrela.
- Eclipse histórico em Kerrville: total, 5 contatos incluindo máximo.
- Época 2400: HTTP 422 `EPHEMERIS_OUT_OF_COVERAGE`, sem extrapolação.
- Usuário no orbital: `uid=100(orbis)`; somente science tem binding no host,
  `127.0.0.1:8000`. A rede adicional de entrada foi necessária para esse binding
  no Docker Desktop; orbital permanece apenas na rede interna.
- IERS na imagem construída: status `ok`; a dependência instalada no build inclui
  tabela mais recente que a do ambiente Python local. Isso não altera a tabela
  da `.venv` nem demonstra igualdade de versões entre os ambientes.
- Não executados: carga concorrente, benchmark de dimensionamento, distribuição
  entre hosts, GPU, validação visual do frontend ou novos modelos estelares/lunares.

## Contêiner de testes com SPICE

O target `orbital` deriva de `runtime` e instala SpiceyPy **7.0.0**, dentro da faixa
permitida pelo projeto. `science-tests` deriva desse mesmo target e adiciona pytest
e testes. Não alteramos a `.venv` Windows. O serviço science mantém sua imagem
sem SpiceyPy. Os testes não iniciam automaticamente com `docker compose up`.

```powershell
docker compose --profile tests build orbital science-tests
docker compose --profile tests run --rm --no-deps science-tests
docker compose --profile tests run --rm --no-deps science-tests python -m pytest validation -s -ra -p no:cacheprovider
```

A primeira execução roda a suíte completa; a segunda roda a carga delimitada:
128 consultas de referência em quatro threads e uma integração com 10 corpos e
20.000 passos. Não há limite de tempo usado como critério de aprovação. Esses
ensaios verificam repetibilidade e valores finitos nos limites atuais, não validam
precisão orbital absoluta nem capacidade de produção. Os testes de precisão e
conservação existentes permanecem na suíte completa, sem tolerâncias relaxadas.

O runner é não root, sem rede ou portas, filesystem read-only e dados públicos e
kernels montados read-only. Arquivos temporários ficam em `/tmp`; `--rm` remove
somente o contêiner efêmero após a execução. Não há saída persistente de relatório
configurada; o resultado é emitido no terminal. Os processos das APIs não recebem
as solicitações de carga, mas compartilham CPU/RAM do host com o runner.

### Resultado inicial da introdução de SPICE (antes da correção temporal)

- Build dos targets orbital e science-tests: aprovado.
- Suíte no Docker: **67 passaram, 1 falhou**, nenhum ignorado. A falha é
  `test_astropy_et_matches_spice_when_available`, em 1965: Astropy
  `-1104494364.2759533` s versus SPICE `-1104494358.8160558` s.
- Carga isolada: **2 passaram**; 128 consultas / 4 threads em 0,376 s e
  10 corpos / 20.000 passos em 7,103 s. Medições pontuais, sem garantia de throughput.
- Não houve mudança do modelo físico, da tolerância de 1 ms, nem remoção do teste.
  O serviço orbital em execução foi preservado até a resolução do gate.
- Naquela execução inicial, as dependências eram herdadas da mesma camada,
  mas ainda não havia lockfile completo nem pin de digest. Essa limitação
  histórica foi tratada na configuração atual; exige nova validação de build.

### Validação após a correção temporal

- `docker compose --profile tests run --rm --no-deps science-tests python -m pytest tests validation -ra -p no:cacheprovider`:
  **74 passed**, sem falhas ou skips, em 71,61 s. Inclui os dois ensaios de carga.
- Suíte Windows sem SpiceyPy: **67 passed, 5 skipped**. Os cinco skips são o
  comparador SPICE e os quatro novos casos de equivalência entre leitores; todos
  foram exercitados com sucesso no Docker. A `.venv` permanece inalterada.
- Permanecem avisos de depreciação TestClient/AnyIO, cache temporário Astropy e
  ERFA para épocas duvidosas; não foram silenciados para obter aprovação.
- A tolerância temporal continua 1 ms absoluto, agora com tolerância relativa
  zero. A comparação de 1965 usa o mesmo instante TT, não duas convenções UTC.
- Orbital atualizado e saudável com SpiceyPy 7.0.0. Verificação HTTP real pela
  API local: readiness true, três corpos em 1965 com provider `spiceypy-de442s`
  e conversão `Astropy/ERFA`, integração de seis passos e HTTP 422 para 2400.
  O contêiner science não foi recriado; não houve exposição externa.
