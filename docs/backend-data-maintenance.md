# Manutenção controlada dos dados científicos

O processo de cálculo não baixa nem atualiza tabelas. Kernels, catálogos e IERS
possuem aprovação explícita. Não aumentar `auto_max_age`, ativar downloads
automáticos ou contornar o erro `IERS_DATA_UNAVAILABLE`.

## IERS: preparar, validar e ativar

1. Consultar a publicação oficial do
   [Astropy no PyPI](https://pypi.org/project/astropy-iers-data/) e selecionar uma
   versão explícita. `prepare` verifica o SHA-256 do wheel universal, sua
   identidade e o layout dos arquivos; não instala o pacote nem troca a política.
2. Preparar uma pasta NOVA. O exemplo abaixo é a versão usada em 20/10/2026;
   não reutilizar a pasta de uma execução anterior:

   ```powershell
   backend\.venv\Scripts\python.exe backend/tools/update_iers.py prepare --version 0.2026.10.12.1.3.27 --output backend/releases/iers-2026-10-20
   ```

   A pasta contém `previous/`, `candidate/`, `release.json` e wheels verificados
   para atualização/reversão offline. Se apenas o download do wheel anterior
   falhar, retomar com `cache-rollback --release <pasta>`; não repetir `prepare`.
   Os wheels ficam fora do contexto Docker e são ignorados pelo Git.
   Releases atuais usam schema 2: política, lock IERS, lock runtime Linux e
   lock Windows CPython 3.12, com seus manifests, formam um conjunto de sete
   arquivos. Um par Windows lock/manifest ausente ou incompleto é recusado
   antes de download ou alteração.
3. Revisar as diferenças entre os dois conjuntos: somente versão/artefato/hash
   IERS devem mudar. Os outros pins de dependências ficam intactos.
4. Usar uma janela de manutenção para o ambiente Python direto: parar somente
   as instâncias identificadas deste projeto antes da instalação. Não matar
   processos arbitrários nem trocar arquivos em um serviço em uso.
5. Instalar o candidato local, sem rede, e ativar os arquivos somente após
   sucesso do instalador:

   ```powershell
   backend\.venv\Scripts\python.exe -m pip install --no-index --find-links backend/releases/iers-2026-10-20 --no-deps --require-hashes --only-binary=:all: -r backend/releases/iers-2026-10-20/candidate/locks/iers.lock
   if ($LASTEXITCODE -ne 0) { throw 'Instalação falhou; não ativar a política.' }
   backend\.venv\Scripts\python.exe backend/tools/update_iers.py activate --release backend/releases/iers-2026-10-20
   if ($LASTEXITCODE -ne 0) { throw 'Ativação falhou; manter o serviço parado e investigar.' }
   backend\.venv\Scripts\python.exe -m pip check
   backend\.venv\Scripts\python.exe -m pytest backend/tests
   ```

   `activate` verifica todo o manifesto e recusa alterações locais inesperadas.
   A troca de múltiplos arquivos **não** é uma transação atômica para leitores
   concorrentes; por isso a janela de manutenção é obrigatória. Uma falha de
   escrita tenta recuperar os bytes anteriores e deve ser investigada antes de
   reiniciar o serviço.
6. Confirmar `bundle.integrity=verified`, versão aprovada, cobertura da consulta
   e `prediction_usable_now=true`. Testar céu, constelações e eclipse com datas
   controladas; uma data fora da cobertura deve continuar indisponível.
7. No Docker, reconstruir e testar as imagens candidatas antes de promover.
   O gate oficial valida versões, hashes, inventário, cobertura IERS atual e
   suíte completa sem skips. Promover a **mesma imagem por ID/digest**, sem
   resolver dependências novamente durante a promoção.

## Reversão

Para Python direto, durante a mesma janela de manutenção:

```powershell
backend\.venv\Scripts\python.exe -m pip install --no-index --find-links backend/releases/iers-2026-10-20 --no-deps --require-hashes --only-binary=:all: -r backend/releases/iers-2026-10-20/previous/locks/iers.lock
if ($LASTEXITCODE -ne 0) { throw 'Reinstalação falhou; não trocar a política.' }
backend\.venv\Scripts\python.exe backend/tools/update_iers.py activate --release backend/releases/iers-2026-10-20 --rollback
if ($LASTEXITCODE -ne 0) { throw 'Reversão falhou; manter o serviço parado e investigar.' }
backend\.venv\Scripts\python.exe -m pip check
```

Restaurar **pacote, política e locks juntos**. O arquivo histórico isolado
`locks/iers-rollback.lock` não constitui um procedimento de reversão; preservamos
esse artefato antigo, mas o procedimento atual usa `previous/`.

Arquivos de release de schema 1 (cinco arquivos, anteriores à inclusão do perfil Windows)
são preservados, mas não podem ser ativados pelo procedimento atual: ele recusa
a operação antes de qualquer escrita, sem derivar hashes ausentes do manifesto.
Para retornar à versão de um release antigo, preparar uma **nova pasta de release**
com `prepare --version <versão-desejada>` pelo procedimento schema 2, revisar e
validar o conjunto completo e então ativá-lo durante a janela de manutenção.
Não modificar o release histórico nem copiar apenas seu lock IERS por cima.

No Docker, reativar o conjunto anterior de imagens testadas e os mesmos dados
identificados por checksum; não reconstruir uma versão antiga esperando obter
a mesma imagem. Manter os IDs/digests e o inventário junto ao relatório da
validação. A reversão de software não rejuvenesce previsões: se o pacote antigo
estiver vencido, consultas preditivas devem voltar a falhar explicitamente.

## Validade e atualização

`/api/health/ready` informa o estado IERS. `prediction_expires_utc` é o limite
de idade das previsões; `valid_until_utc` é a borda nominal da tabela, não uma
promessa de validade preditiva. `refresh_recommended` avisa cinco dias antes do
limite. O gate de promoção exige dados utilizáveis na data de sua execução.
Planejar atualização antes do vencimento; não há tarefa automática criada.

## Catálogos e kernels

Não editar `data/` enquanto as APIs o consomem. Preparar uma nova versão,
registrar origem/licença/época, conferir schema e comparar hashes/manifests.
Nunca regenerar um inventário para simplesmente esconder uma corrupção.
Preservar a versão anterior completa e associar cada imagem testada ao conjunto
de dados validado. Estados SI, época, referencial e cobertura permanecem
autoritativos; atualização de dados não autoriza extrapolação.
