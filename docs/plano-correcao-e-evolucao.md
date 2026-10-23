# Orbis Scientia — instruções de correção e evolução

Data: 22/09/2026. Base: revisão local realizada nesta conversa.
Status: plano de execução; nenhuma correção abaixo foi implementada por este documento.

## 1. Objetivo e modo de trabalho

Estabilizar os cálculos, os contratos e os estados de erro antes de ampliar as funcionalidades. Este arquivo condensa o que fazer, como fazer e como comprovar a conclusão. Não substitui o histórico em `docs/agent-handoff.md` nem autoriza publicação ou implementação automática de todo o backlog.

Ao receber autorização para executar:

1. Leia os `AGENTS.md` aplicáveis, `docs/agent-handoff.md` e o plano `ORBIS_SCIENTIA_IMPLEMENTATION.md`. Confronte documentos antigos com o código atual.
2. Confirme a raiz, branch e diferenças staged, unstaged e untracked. Há trabalho local sobreposto no índice e no disco; preserve-o. Não use `git add .`, reset, checkout destrutivo ou limpeza ampla.
3. Trabalhe em uma correção por vez: reproduzir → teste de regressão → alteração mínima → validação → registro da evidência.
4. Não faça commit, push, deploy, túnel, atualização de dependências ou novo ZIP sem pedido específico. O fluxo é local.
5. Registre o que realmente foi executado. Testes locais não comprovam hospedagem, comportamento visual ou funcionamento em dispositivos reais.

### Invariantes obrigatórios

- Preserve `position_m`, `velocity_m_s`, `mu_m3_s2`, época, referencial e integração Velocity-Verlet como estado físico; apresentação não escreve nesses valores.
- Escala, câmera, tamanho exibido e órbitas desenhadas são adaptadores visuais declarados.
- Não invente posições de luas nem resultados científicos para preencher indisponibilidade.
- Preserve contratos versionados, proveniência e privacidade da localização do observador.
- Não reescreva a arquitetura nem acrescente outro canvas sem necessidade demonstrada.

## 2. Ordem de execução

Execute C1 e C2 primeiro. Resolva C3–C6 antes de considerar a estabilização concluída. C6 pode ser antecipada para recuperar o lint. Só depois proponha as evoluções da seção 4.

### C1 — Corrigir disponibilidade dos dados IERS e classificação dos erros [alta]

**Evidência da revisão:** uma consulta de céu para São Paulo em `2026-08-05T00:00:00Z` retornou 422 com “O UTC do observador é inválido”. A investigação local identificou rejeição de valores preditivos IERS envelhecidos. A configuração offline apenas desativa downloads, e o tratamento genérico de `ValueError` confunde falha interna com entrada inválida.

**Onde:** `backend/src/astro_system/coordinates/iers_status.py`, `backend/src/astro_system/coordinates/observer.py`, `backend/src/astro_system/api/main.py`, contratos de erro e testes backend.

**Como fazer:**

1. Reproduza a consulta com `FastAPI TestClient`, usando o lifespan normal, latitude `-23.5505`, longitude `-46.6333`, elevação `760` e a data acima. Não dependa de um servidor exposto.
2. Inspecione origem, cobertura e idade da tabela efetivamente carregada; não presuma que a presença do arquivo significa validade para a consulta.
3. Separe validação sintática do UTC, indisponibilidade de dados auxiliares e defeitos internos. Introduza tratamento específico, alinhado ao contrato existente, sem expor traceback ao usuário.
4. Defina explicitamente a política offline: resultado apenas quando suportado; caso contrário, indisponibilidade/cobertura com motivo e proveniência. Não use simplesmente `auto_max_age=None` para ocultar a proteção.
5. Se houver novo código de erro, atualize backend, decoders, gateway e apresentação juntos. Atualizar tabelas externas requer procedimento controlado, não download silencioso em runtime.

**Aceite:** UTC malformado continua sendo erro de entrada; tabela ausente, vencida ou insuficiente produz erro científico específico; datas suportadas funcionam. Testes determinísticos devem usar fixtures controladas, sem depender da data da máquina ou da rede.

### C2 — Corrigir nascer/pôr em constelações circumpolares [alta]

**Evidência:** `_plan_window` compara `target_altitudes` com `target_altitudes[1:]` usando `zip(..., strict=True)`. Quando não encontra cruzamento, esgota sequências de tamanhos diferentes e lança `ValueError`. Consulta para `UMi`, latitude `80`, longitude `0`, elevação `0`, UTC `2024-04-08T00:00:00Z` retornou 422 na revisão.

**Onde:** `backend/src/astro_system/coordinates/constellation_observatory.py`, função `_plan_window`; tratamento da rota em `api/main.py`.

**Como fazer:**

1. Acrescente teste que falhe para o cenário circumpolar.
2. Compare pares adjacentes com `itertools.pairwise`, ou use `zip(target_altitudes[:-1], target_altitudes[1:], strict=True)`.
3. Preserve as convenções existentes para cruzamento do horizonte. Teste nascer, pôr, ausência de cruzamento, objeto sempre abaixo, objeto sempre acima e ausência de noite astronômica.
4. Verifique o planejamento diário e anual. Não converta um defeito de cálculo em “UTC inválido”.

**Aceite:** nenhuma exceção de comprimentos; classificação e indicadores coerentes; cenários normais continuam passando. Use datas/tabelas controladas para isolar este defeito de C1.

### C3 — Respeitar capacidades individuais no Worker [média]

**Evidência:** `verifiedNativeCapabilities` aceita qualquer objeto JSON como saudável; a resposta pública usa esse único booleano para anunciar céu, eclipses e simulação. O backend pode responder normalmente e declarar `simulate.available=false` por falta de kernels.

**Onde:** `worker/scientific-api.ts`, contratos/decoders em `lib/science/`, `tests/scientific-api.test.mjs`.

**Como fazer:** valide o envelope versionado e os campos necessários; distinga serviço acessível de operação disponível; preserve o estado de cada capacidade. Respostas vazias, malformadas ou de versão desconhecida não podem habilitar funcionalidades. Não confunda capacidades estáticas do Worker com as do serviço nativo.

**Aceite:** testes para binding ausente, falha de transporte, JSON inválido, `{}`, versão incompatível, todas as capacidades disponíveis e disponibilidade parcial. Um backend sem simulação não pode fazer o Worker anunciá-la como disponível.

### C4 — Normalizar UTC sem invalidar offsets [média]

**Evidência:** `sameUtc` acrescenta `Z` a strings que não terminam em `Z`, inclusive às que já têm offset. A comparação rejeita `2026-08-04T21:00:00-03:00` como equivalente a `2026-08-05T00:00:00Z`.

**Onde:** `worker/scientific-api.ts`, função `sameUtc`; testes de Worker e contratos temporais.

**Como fazer:** reconheça os formatos explicitamente aceitos pelo projeto; só aplique a convenção de UTC sem offset quando prevista pelo contrato. Compare instantes normalizados e rejeite entradas inválidas, sem aceitar formatos arbitrários por acidente.

**Aceite:** os dois horários acima são equivalentes; offsets positivos/negativos e frações de segundo são testados; instantes diferentes continuam rejeitados pelo snapshot fixo. Backend e fallback devem concordar sobre os formatos aceitos.

### C5 — Preservar o último resultado válido após falha [média]

**Evidência:** `EarthAtlasWorkspace` mantém `previous` durante o carregamento, mas perde esse dado quando `resourceError` substitui o estado após uma falha.

**Onde:** `app/components/earth/EarthAtlasWorkspace.tsx`, tipos `ScienceResource` e componentes de estado científico.

**Como fazer:** preserve os dados e a identidade da consulta que os produziu; mostre separadamente o erro da nova tentativa e o aviso de resultado anterior/desatualizado. Não rotule dados antigos com a nova data ou localização. Respeite cancelamento e impeça resposta antiga de sobrescrever uma consulta mais recente.

**Aceite:** sucesso → nova consulta → erro mantém o resultado anterior claramente identificado; primeiro acesso com erro não inventa dados; novo sucesso substitui corretamente o anterior. Cubra rede, indisponibilidade, validação, cancelamento e respostas fora de ordem.

### C6 — Recuperar o lint oficial [média]

**Evidência:** `npm.cmd run lint` falhou com `EPERM` ao percorrer `backend/.pytest_cache`; o pytest também avisou sobre o cache local.

**Onde:** `eslint.config.mjs`, escopo do script de lint em `package.json`.

**Como fazer:** delimite o código frontend/Worker/scripts que deve ser analisado e exclua caches, ambientes virtuais e saídas geradas. Não desative regras de código para esconder erros. Investigue o cache Python separadamente, sem exclusão ampla ou alteração de permissões da máquina.

**Aceite:** o comando oficial conclui; arquivos de código continuam cobertos; cache Python não é percorrido pelo ESLint. Execute o lint novamente após a mudança e corrija ou relate os problemas reais que ele revelar.

## 3. Validação e definição de pronto

Execute na raiz, em PowerShell, observando o código de saída de cada comando separadamente:

```powershell
npm.cmd test
npx.cmd tsc --noEmit
npm.cmd run lint
backend\.venv\Scripts\python.exe -m pytest backend\tests
git diff --check
git diff --cached --check
```

Os testes novos devem entrar no gate oficial: criar um arquivo de teste que o script não executa não resolve a cobertura. Confirme a lista de testes em `package.json` antes de adicionar arquivos TypeScript. Execute testes focados durante cada correção e o conjunto aplicável antes da entrega.

**Referência histórica da revisão de 22/09/2026, não garantia de estado futuro:**

| Verificação | Resultado observado |
|---|---|
| `npm.cmd test`, incluindo build | 55 testes aprovados |
| TypeScript | Aprovado |
| Backend | 34 aprovados, 1 ignorado |
| Lint | Falha de acesso ao cache Python |
| Whitespace staged/unstaged | Sem erros |
| Diagnósticos adicionais | C1, C2 e C4 reproduzidos |

Houve avisos de datas, dependências e cache no backend. Não suprima avisos em bloco: identifique os esperados e os que indicam limitações. A revisão não incluiu nova QA visual completa, dispositivos reais ou hospedagem.

Uma correção só está pronta quando o cenário falho tem regressão automatizada, os gates aplicáveis foram executados, contratos permanecem consistentes e nenhuma alteração local alheia foi perdida. Relate testes ignorados e validações não realizadas.

## 4. Evoluções após estabilização — selecionar escopo antes de implementar

1. **Testes de navegador:** cobrir recuperação de falhas, mudanças rápidas de data, navegação por teclado e layout estreito. Acrescentar ao gate acordado; screenshots antigas não substituem validação atual.
2. **Proveniência na interface:** reutilizar componentes científicos existentes para mostrar fonte, época do resultado, cobertura, motivo de bloqueio e estado desatualizado. Evitar duplicar lógica por tela.
3. **Consultas independentes na Terra:** avaliar a substituição da espera conjunta por atualizações independentes de céu e eclipse, com cancelamento e controle de concorrência. Aceite: uma operação lenta não bloqueia a apresentação da outra.
4. **Planejador de observação:** aprofundar o existente com janelas úteis e motivos de indisponibilidade; declarar cadência e limites. Não prometer precisão maior do que o método fornece.
5. **Comparação de cenas/épocas e projetos exportáveis:** evoluir os formatos existentes, preservando versão, proveniência, anotações, migração e privacidade da localização.
6. **Jornadas educativas e desempenho:** explicar escala visual versus física; medir antes de otimizar. Ajustes de qualidade gráfica não podem alterar cálculos nem estado científico.

Estas são propostas, não funcionalidades consideradas prontas nem autorização para executar todas de uma vez.

## 5. Entrega e continuidade

- Atualize `docs/agent-handoff.md` e `docs/validation.md` após correções reais: arquivos alterados, decisões, cenários reproduzidos, resultados e pendências. Não marque itens deste plano concluídos apenas por terem sido documentados.
- Registre o estado Git atual; a revisão encontrou `main` com trabalho staged, unstaged e untracked. Um commit apenas do índice pode não corresponder ao código testado.
- Não trate `orbis-scientia-handoff-2026-08-18.zip` como pacote atualizado. Se um novo ZIP for solicitado, use lista explícita de arquivos, exclua segredos/caches/ambientes/builds/logs e verifique conteúdo e extração.
- Na resposta de entrega, informe: o que mudou, evidência de validação, limitações restantes e próximo passo recomendado. Não publique nem versione sem autorização.

### Pedido curto para outro agente

> Leia `docs/plano-correcao-e-evolucao.md` e as instruções do repositório. Confira o estado atual e preserve as alterações locais. Quando autorizado a implementar, comece por C1 e C2, criando testes de regressão antes das correções. Continue C3–C6 dentro do escopo combinado. Não execute as evoluções opcionais, commit, publicação ou empacotamento sem pedido específico. Entregue evidências, não apenas uma lista de alterações.
