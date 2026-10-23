# Capacidade do backend: medição reproduzível

O benchmark mede HTTP real entre dois serviços efêmeros próprios (`science` e
`orbital`), ligados exclusivamente a `127.0.0.1` em portas livres. Não usa APIs já
abertas pelo usuário, Compose em execução, túnel ou serviços externos. A factory
privada de validação identifica cada instância por um cabeçalho efêmero; um
`health` 200 de outro processo após colisão de porta não autoriza executar a carga.
Essa factory adiciona uma camada HTTP pequena e não muda a API normal. Não altera
o modelo físico, dados, kernels ou políticas científicas.

## Execução

Use o ambiente científico validado, com SPICE e o conjunto de dados aprovado.
Execute na raiz do projeto. O diretório de saída deve existir e cada arquivo
deve ser novo; um resultado anterior nunca é sobrescrito.

```powershell
.\work\science-py312\Scripts\python.exe -B backend\tools\benchmark_services.py --operations reference --repetitions 1 --concurrency 1 --output work\capacity-smoke-NEW.json
.\work\science-py312\Scripts\python.exe -B backend\tools\benchmark_services.py --repetitions 5 --concurrency 1 2 4 --output work\capacity-full-NEW.json
```

No Linux/container, use o Python do ambiente científico:

```bash
python -B /app/backend/tools/benchmark_services.py --repetitions 5 --concurrency 1 2 4 --output /tmp/capacity-NEW.json
```

Esse exemplo pressupõe o layout `/app/backend` da imagem; confirme o layout e
copie o relatório antes de remover um container de teste. O benchmark pode levar
vários minutos. Não execute simultaneamente com builds, outros benchmarks ou
suítes científicas se deseja uma linha de base interpretável.

Parâmetros relevantes:

- `--repetitions`: quantidade de ondas por nível de concorrência aquecido. Cada
  onda envia exatamente `concurrency` requisições, sem repetição automática.
- `--concurrency 1 2 4`: número de clientes simultâneos por onda.
- `--workers 1` e `--science-concurrency 1`: configuração explícita por processo.
  Mais workers duplicam parte dos dados, caches e capacidade de trabalho; o
  limite de concorrência não é global entre workers.
- `--startup-timeout 60`, `--orbital-timeout 60` e `--timeout 120`: prazos de
  inicialização, gateway e cliente, respectivamente. Ajustá-los não aumenta a
  capacidade nem torna cancelável uma thread de cálculo.
- `--sample-interval 0.1`: intervalo de espera entre amostras de memória.
- `--operations`: subconjunto explícito para diagnóstico leve.

## Operações e fases

Há consultas de referência, catálogos de luas, estrelas e constelações, céu local,
céu da constelação de Orion, eclipse local (janela de seis horas), simulação curta
e simulação de dez corpos com 20.000 passos. As entradas são fixas e públicas,
definidas em `backend/tools/benchmark_services.py`, com época
`2024-04-08T18:00:00Z`; não são coordenadas privadas do observador.

Cada operação inicia um par novo de serviços:

1. **Cold:** primeira chamada da operação após inicialização e consulta de
   vivacidade. Inicializadores já podem ter carregado dados; isso não representa
   cache frio do sistema operacional nem mede o custo de importação.
2. **Priming:** uma chamada explícita, relatada separadamente.
3. **Warm:** ondas nos níveis pedidos, usando os mesmos processos.

O tempo de inicialização de cada serviço é registrado separadamente. Não há
retry de POST ou de outra operação. Um timeout, desconexão ou erro de gateway
502/504 interrompe as fases restantes daquela operação e encerra seus processos
antes da próxima. Isso evita tratar CPU possivelmente ainda ocupada como ociosa.

## Estatísticas e memória

Os percentis usam **nearest-rank**: posição `ceil(p × n)` na amostra ordenada.
Sucesso HTTP 2xx, rejeição 429, demais erros HTTP, timeout e erro de transporte
têm contagens e percentis separados. Um 429 rápido não entra na latência de
sucesso. Um p95 com poucas observações costuma ser apenas o máximo observado;
não constitui previsão de capacidade de produção.

O amostrador roda fora do trecho cronometrado de cada cliente, mas compartilha
CPU com a carga e portanto tem efeito de observação. O relatório inclui número
de amostras, falhas e custo total de amostragem. RSS inacessível e processos
esperados ausentes tornam a amostra incompleta; não são convertidos em zero.
Picos agregados são calculados somente nas amostras completas. No Windows usa Toolhelp32,
GetProcessTimes e GetProcessMemoryInfo; no Linux usa `/proc`.

São identificados PID, instante de criação, papel e tipo (worker, launcher ou
filho). O launcher do venv Windows e seus filhos entram no total; o processo do
benchmark não entra. O pico agregado soma os processos do **mesmo ciclo de
amostragem**, nunca seus picos individuais obtidos em momentos diferentes.
Enumeração/leitura são sequenciais, não uma fotografia atômica. RSS/working set
pode contar páginas compartilhadas várias vezes e não equivale à memória física
exclusiva. Picos entre amostras e durante startup podem ser perdidos.

Os relatórios incluem versões dos pacotes, Python/SO, configuração, hashes do
inventário de dados, política IERS e fontes científicas/ferramentas. Os serviços
continuam verificando integridade/cobertura; erros científicos não são convertidos
em resultados de sucesso pelo benchmark.

## Encerramento e limites operacionais

No Windows há Job Object privado com encerramento dos filhos; se indisponível,
o fallback verifica PID **e criação no mesmo handle** antes de terminar cada
processo conhecido. No Linux cada serviço tem sessão/grupo privado. Nunca é
usado `taskkill` amplo, nome de executável ou porta de um serviço do usuário.
Os logs de startup ficam em buffer limitado de categorias sanitizadas, sem
mensagens cruas, caminhos, coordenadas ou credenciais. Falha de amostragem não
impede a tentativa de fechar handles/processos próprios; limpeza não confirmada
é um erro explícito.

Timeout de cliente/gateway **não cancela o trabalho científico em thread**.
Não existe fila distribuída ou cancelamento cooperativo implementado por esta
ferramenta. Encerrar os processos efêmeros ao final do ensaio é diferente de
cancelar uma requisição no serviço normal.

O padrão de um worker por serviço e limite científico de um cálculo por worker
continua sendo uma configuração conservadora, não uma promessa de capacidade.
Só ajuste workers, memória, CPU e timeouts após comparar ensaios repetidos em
ambiente identificado, incluindo sucesso, saturação e recuperação. Não foi
introduzido cache científico novo.

## Evidências

Este documento define o método e os comandos. O ensaio Windows de 20/10/2026 está
registrado em [backend-hardening-followup-2026-10-20.md](backend-hardening-followup-2026-10-20.md),
com JSON preservado em `work/capacity-windows-20261020-final.json`. Esse resultado
não representa desempenho de dois contêineres Compose nem de outra máquina.
Novas execuções exigem JSON novo, plataforma, configuração, data e limitações.
Testes unitários da ferramenta não substituem execução HTTP real nem validação
Docker.
