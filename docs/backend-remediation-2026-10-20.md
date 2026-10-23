# Correções do backend — 2026-10-20

Escopo autorizado: corrigir a auditoria em ordem, preservar alterações locais,
validar localmente e não publicar. Este relatório registra execução, não uma
aprovação presumida do estado anterior.

## Inventário inicial

- Raiz `C:\aleatorio\eu\Solar`, branch `main`, dois commits locais à frente.
- Há alterações staged, unstaged e arquivos não rastreados preexistentes.
- Nenhuma operação de reset/checkout/restore/clean/stash/rebase/commit/push.
- Python local sem SpiceyPy; último diagnóstico desta auditoria: 82 passaram,
  cinco comparações SPICE ignoradas, 25 avisos. Isso não valida o Docker.
- Docker Desktop estava parado; aproximadamente 3,8 GiB livres no volume C.

## Critérios e sequência

| Etapa | Aceite |
| --- | --- |
| IERS | versão/hashes/locks coerentes, consulta atual e histórica, rejeição de cobertura inválida, atualização e reversão preservando arquivos |
| Ciência | direção observada correta para constelações; C1/C2/C3/C4 corretos mesmo em janelas incompletas; regressões reais e controladas |
| API | razões numéricas seguras, contratos físicos completos, limite incremental de corpo, correlação e diagnóstico de 500 |
| Dados | checksum/schema no startup e prontidão; falhas explícitas; nenhuma procedência fictícia |
| Docker | plataforma compatível, limites configuráveis, logs limitados, shutdown, isolamento preservado e validação real |
| Desempenho e operação | benchmark reproduzível por operação, mediana/p95, memória/concorrência, avaliação de cancelamento, documentação de atualização/rollback |

## Evidência em andamento

- `npx.cmd tsc --noEmit`: passou antes das alterações científicas.
- Testes iniciais de política IERS + manutenção: 24 passaram, um aviso externo.
- Pacote preparado: `astropy-iers-data==0.2026.10.12.1.3.27`, wheel universal.
  SHA-256: `d5ee18fd7645492b72b0ac3f274d5b5f9a1857334bd63bb1d0355b01a2c2733a`.
- Conjunto anterior e candidato preservados em
  `backend/releases/iers-2026-10-20`, com manifesto de hashes. O wheel fica
  local e ignorado pelo Git, fora do contexto Docker.
- Versão instalada na `.venv` por lock/hash usando somente o wheel local.
- Gate oficial passa a exigir cobertura IERS atual, além da integridade;
  testes de datas inválidas permanecem separados e determinísticos.
- Smoke da API via TestClient no ambiente local: consulta de céu em
  `2026-10-20T12:18:42.304Z` respondeu 200 com nove objetos; consulta de 2024
  respondeu 200; consulta de 2400 respondeu 503 `IERS_DATA_UNAVAILABLE`.
  Integridade verificada, previsão desde 02/10/2026, idade de 18,5 dias,
  limite de idade em 01/11/2026, cobertura nominal até 04/10/2027.
- Política/manutenção/endurecimento: primeira execução teve 29 testes
  aprovados e um timeout de inicialização do processo orbital de teste
  (limite de 30 s). Reexecução isolada do caso HTTP passou em 33,75 s
  totais. Não foi alterado nenhum limite científico para obter aprovação.
- Wheel da versão anterior também foi obtido e verificado, para permitir
  reversão local offline. A manutenção/reversão está descrita em
  [backend-data-maintenance.md](backend-data-maintenance.md).
- Gate científico: direção aparente GCRS preservada para classificação IAU;
  contatos de eclipse identificados pela direção do cruzamento, incluindo
  janelas truncadas; minimização em segundos relativos ao intervalo.
  Regressões novas + geometria: **16 passaram** (15,64 s).
  Casos anteriores de céu/eclipse: **2 passaram**, 25 não selecionados pelo
  filtro (33,06 s). `git diff --check` desses arquivos passou.

As demais etapas ainda precisam de implementação e evidências. Nenhuma
conclusão de runtime Docker ou capacidade é implicada por esta seção.
