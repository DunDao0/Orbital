# Instalação e execução do Orbital no Windows

Este manual permite preparar o Orbital e abrir o site no próprio computador, sem instalar Git, Docker, Node.js ou Python manualmente. O instalador baixa e configura os componentes necessários dentro da pasta do projeto. A primeira instalação exige internet; este não é um pacote de instalação totalmente offline.

**O que você precisa ter antes de começar:** Windows 10/11 de 64 bits em um computador Intel ou AMD, um navegador com suporte a gráficos 3D, internet e espaço disponível. **O que será instalado automaticamente:** Node.js, que executa a interface; Python, que faz os cálculos; e as bibliotecas e os dados astronômicos usados pelo Orbital. Você não precisa escolher versões nem baixar esses programas separadamente. O Windows PowerShell necessário ao instalador já vem no Windows; Git e Docker não são necessários para este procedimento.

O caminho mais simples é baixar **[Orbital-0.1.1-Setup-x64.exe](https://github.com/DunDao0/Orbital/releases/download/v0.1.1/Orbital-0.1.1-Setup-x64.exe)**, abrir o arquivo e clicar em **Instalar**. O assistente instala os arquivos e cria atalhos, sem precisar extrair o ZIP. A primeira abertura prepara os componentes pela internet. Veja o [passo a passo do instalador executável](instalador-exe-windows.md). Para acompanhar cada etapa ou automatizar a preparação, use os comandos da seção **Operação pelo PowerShell**.

O instalador inicia a interface e o backend Python no próprio computador. O build usa Vite/Vinext e o plugin Cloudflare para executar o Worker local. Os módulos `db/` e `drizzle/` são opcionais e não possuem banco provisionado.

## Requisitos

- Windows 10 ou 11 de 64 bits, arquitetura x64. Este instalador não atende Windows ARM, Linux ou macOS.
- Navegador com suporte a WebGL para a visualização 3D.
- Pasta local com permissão de gravação. Evite `Arquivos de Programas`, pastas protegidas e executar diretamente de dentro do ZIP.
- Internet para baixar componentes ausentes na instalação ou em um reparo.
- Como margem inicial, reserve pelo menos 4 GB livres para downloads, ambientes e arquivos temporários. Não é uma medição de consumo máximo.
- Portas locais `3000` e `8000` livres para iniciar o site. A opção `-PrepareOnly` não exige essas portas livres.

Não é necessário abrir como administrador. O instalador usa o Windows PowerShell incluído no sistema e não depende do PowerShell 7.

## Alternativa: instalação pelo ZIP

1. Baixe **[Orbital 0.1.1 em ZIP para Windows x64](https://github.com/DunDao0/Orbital/releases/download/v0.1.1/Orbital-0.1.1-Windows-x64.zip)**. Essa versão é preliminar. Você também encontra o arquivo `Orbital-0.1.1-Windows-x64.zip` na seção **Assets** da [release](https://github.com/DunDao0/Orbital/releases/tag/v0.1.1); não é necessário ter conta no GitHub.
2. No Explorador de Arquivos, clique com o botão direito no ZIP e escolha **Extrair Tudo**. Escolha uma pasta sua, como `Documentos\Orbital`.
3. Abra a pasta extraída que contém `Instalar-e-Abrir.cmd`, `package.json` e a pasta `backend`.
4. Dê dois cliques em **Instalar-e-Abrir.cmd**.
5. Aguarde a preparação e as verificações. A duração depende da conexão e do computador; não feche a janela enquanto estiver baixando ou instalando.
6. Quando o instalador indicar que os serviços estão prontos, use o navegador que ele abriu ou acesse [Orbital local](http://127.0.0.1:3000).

O site fica acessível somente neste computador. Não há publicação na internet, túnel, conta de nuvem ou configuração de Docker.

Para atualizar, encerre a instância atual e extraia o ZIP da versão desejada em uma pasta nova. Consulte [Releases](https://github.com/DunDao0/Orbital/releases) para ver os downloads disponíveis. O arquivo `SHA256SUMS.txt` permite conferir a integridade do ZIP; não é um programa a executar. Para quem deseja o código da branch `main` entre releases, **Code → Download ZIP** continua disponível no repositório.

### O que o instalador prepara

- Uma cópia local do Node.js e do gerenciador `uv`.
- Python 3.12.12 e as dependências científicas aprovadas para Windows x64.
- As dependências do frontend a partir do lockfile do projeto.
- Os catálogos científicos incluídos no código e os kernels de efemérides obtidos das fontes configuradas.
- Os processos locais da interface e da API científica.

Os downloads e dados usam verificações de integridade. Se uma verificação falhar, a instalação deve parar; não remova hashes nem desative essas verificações para prosseguir.

### Fontes e versões dos componentes

As versões e os hashes SHA-256 dos ZIPs de Node.js e `uv` estão fixados em [`scripts/windows/runtimes.json`](../scripts/windows/runtimes.json):

- **Node.js 22.23.2:** distribuição Windows x64 do projeto Node.js, conferida contra a [lista oficial de checksums](https://nodejs.org/download/release/v22.23.2/SHASUMS256.txt).
- **uv 0.9.2:** distribuição Windows x64 da [release oficial da Astral](https://github.com/astral-sh/uv/releases/tag/0.9.2), que publica um [checksum do ZIP](https://github.com/astral-sh/uv/releases/download/0.9.2/uv-x86_64-pc-windows-msvc.zip.sha256).
- **Python 3.12.12:** instalação gerenciada pelo `uv`, dentro de `.orbis\runtime\python`, conforme o mecanismo descrito na [documentação oficial de versões Python](https://docs.astral.sh/uv/concepts/python-versions/).

Esses componentes ficam no projeto, sem instalar Node.js ou Python globalmente. O launcher não pede uma versão Python genérica como “a mais recente”: usa a versão exata declarada. Os hashes das dependências Python ficam no lock Windows; os dos dados científicos, no inventário aprovado.

## Abrir novamente e encerrar

Para abrir outra vez, execute **Instalar-e-Abrir.cmd** na mesma pasta. Ele reutiliza a instalação existente; componentes ausentes ou que precisem de reparo podem exigir novos downloads.

Para encerrar os serviços iniciados pelo instalador, execute **Parar-Orbital.cmd**. Fechar a aba do navegador não encerra os processos locais.

O supervisor agrupa os processos que criou, incluindo os subprocessos da interface, como `workerd`. O comando de parada encerra esse grupo, sem procurar e encerrar programas alheios pelo número da porta ou por um PID externo.

Não mova nem renomeie a pasta com os serviços em execução. Para usar outro caminho, prefira extrair o código em uma pasta nova e executar o instalador ali; não copie o ambiente `.orbis`, que pode conter referências ao caminho anterior.

## Confirmar que a instalação funcionou

Abra [a página inicial](http://127.0.0.1:3000) e [o Atlas da Terra](http://127.0.0.1:3000/atlas/earth).

Além da página, a API oferece:

- [Saúde do processo](http://127.0.0.1:8000/api/health): confirma que a API responde.
- [Prontidão científica](http://127.0.0.1:8000/api/health/ready): verifica as dependências necessárias.
- [Capacidades](http://127.0.0.1:8000/api/capabilities): informa quais operações estão disponíveis.

Uma página carregada ou um processo saudável não garante que toda consulta científica esteja disponível para qualquer data. A cobertura das efemérides e a validade das tabelas IERS continuam sendo verificadas.

Faça esta confirmação também no computador em que o projeto será utilizado. Testes feitos pelo mantenedor não garantem compatibilidade com todo antivírus, política de rede, navegador ou dispositivo gráfico.

## Resolver problemas comuns

| Situação | Como proceder |
| --- | --- |
| O arquivo abriu dentro do ZIP | Feche-o, use **Extrair Tudo** e execute a cópia extraída. |
| Download interrompido ou servidor indisponível | Confira a conexão e execute o instalador novamente. Consulte os logs se a falha persistir. |
| Falha de checksum ou integridade | Não ignore a proteção. Registre a mensagem e comunique o mantenedor; o arquivo pode estar incompleto ou diferente da versão aprovada. |
| Porta `3000` ou `8000` ocupada | Se for uma instância iniciada por este instalador, use **Parar-Orbital.cmd**. Se for outro programa, encerre-o pelo procedimento desse programa. O instalador não o encerra automaticamente. |
| O navegador não abriu | Após a confirmação de prontidão, abra [http://127.0.0.1:3000](http://127.0.0.1:3000) manualmente. |
| Falta de espaço ou acesso negado | Libere espaço por um procedimento seguro ou extraia novamente para uma pasta gravável do seu usuário. |
| A API responde, mas uma consulta informa IERS indisponível | A data pode estar fora da cobertura ou depender de previsões vencidas. Consulte a mensagem científica e a seção seguinte; reinstalar não equivale a atualizar os dados aprovados. |
| Windows ou antivírus bloqueia o script | Confirme a origem do repositório e consulte o responsável pela máquina. Não desative proteções nem contorne políticas corporativas. |

A distribuição ZIP usa um launcher `.cmd`. A distribuição `.exe` oferece o assistente e os atalhos; esse executável ainda não possui assinatura digital. O Windows pode mostrar avisos de procedência ou segurança. Em uma máquina administrada, a política da organização pode impedir sua execução.

Os registros ficam em **`.orbis\logs`**, dentro da pasta do projeto. Ao pedir suporte, informe a etapa que falhou, a mensagem e a versão do Windows. Revise os logs antes de compartilhá-los; eles podem conter caminhos locais.

### Repetir a preparação após remover pacotes

Se arquivos de dependências foram apagados manualmente, o marcador de instalação concluída pode continuar existindo. Pare o Orbital, preserve `.orbis\logs` e, no Explorador de Arquivos, remova somente os arquivos **`.orbis\backend.ready`** e **`.orbis\frontend.ready`** que existirem. Depois, execute `Instalar-e-Abrir.cmd` novamente.

Esses dois arquivos são marcadores recriáveis, não dados científicos. A remoção faz o instalador repetir a preparação das dependências; não garante reparar qualquer corrupção dentro de um pacote Python que ainda consta como instalado. Se o erro persistir, guarde os logs e faça uma instalação em uma extração nova. Não apague indiscriminadamente a pasta do projeto.

## Dados científicos e uso sem internet

Depois da preparação completa, a execução local reutiliza os componentes e dados instalados. Não se deve confundir isso com a existência de um pacote offline: um ZIP apenas do código-fonte não contém todos os runtimes, dependências e kernels que a primeira instalação precisa baixar.

O instalador não atualiza automaticamente a política IERS, não desliga a proteção contra previsões vencidas e não inventa resultados quando falta cobertura. Uma instalação antiga pode continuar abrindo o site enquanto certas consultas recentes ficam indisponíveis.

Atualizações científicas são procedimentos de manutenção, com origem, versão e integridade verificáveis. Consulte [manutenção dos dados do backend](backend-data-maintenance.md), [fontes dos dados](data_sources.md) e [limitações científicas](limitations.md).

As representações 3D não alteram posições, velocidades, parâmetros gravitacionais, época ou referencial usados nos cálculos. Elementos médios de catálogos de luas não se tornam posições observadas.

## Operação pelo PowerShell

Estes comandos executam as mesmas rotinas do duplo clique. Abra o PowerShell na pasta que contém `Instalar-e-Abrir.cmd`.

### Preparar e abrir

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\windows\Install-Orbital.ps1"
```

O parâmetro de política aplica-se somente ao processo iniciado; não altera permanentemente a política do computador e não prevalece sobre restrições impostas pela organização.

### Somente preparar os componentes

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\windows\Install-Orbital.ps1" -PrepareOnly
```

Use essa opção para concluir downloads e instalação sem iniciar os servidores nem abrir o navegador. Ela funciona também com as portas `3000` e `8000` ocupadas e não encerra quem as estiver usando. Se uma instância deste launcher já estiver ativa, pare-a antes de preparar novamente. A opção não produz um instalador offline redistribuível.

### Iniciar sem abrir uma aba

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\windows\Install-Orbital.ps1" -NoBrowser
```

### Consultar o estado

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\windows\Install-Orbital.ps1" -Action Status
```

### Encerrar os processos do launcher

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\windows\Install-Orbital.ps1" -Action Stop
```

Este é o equivalente a abrir `Parar-Orbital.cmd`.

### Consultar as verificações HTTP

Com os serviços ligados:

```powershell
Invoke-RestMethod "http://127.0.0.1:8000/api/health"
Invoke-RestMethod "http://127.0.0.1:8000/api/health/ready"
Invoke-RestMethod "http://127.0.0.1:8000/api/capabilities"
(Invoke-WebRequest "http://127.0.0.1:3000" -UseBasicParsing).StatusCode
```

Se a prontidão responder com erro ou estado degradado, leia a categoria informada antes de tentar reparar o ambiente. Uma restrição científica de data não é necessariamente falha de instalação.

## Estrutura da instalação

| Local | Finalidade |
| --- | --- |
| `.orbis\` | Runtimes, ambiente local e estado gerenciados pelo instalador. |
| `.orbis\venv\` | Ambiente Python isolado usado pelo launcher. |
| `.orbis\runtime\node-v22.23.2-win-x64\` | Node.js local usado pelo launcher. |
| `.orbis\logs\` | Registros de instalação e execução. |
| `node_modules\` | Dependências do frontend. |
| `data\` | Dados científicos locais, kernels e manifestos. |
| `backend\locks\windows-cp312.lock` | Dependências Python aprovadas para Windows x64 e CPython 3.12. |
| `backend\data-inventory.json` | Inventário de integridade dos dados aprovados. |
| `backend\src\astro_system\iers-policy.json` | Versão e integridade esperadas dos dados IERS. |

O frontend usa **Vinext em modo de desenvolvimento**, limitado a `127.0.0.1:3000`. A API executa diretamente em Python/FastAPI, limitada a `127.0.0.1:8000`. Esse caminho não inicia o conjunto de serviços Docker e não configura um serviço de produção.

As portas fazem parte do contrato atual entre interface, API e CORS. Não basta escolher portas diferentes na linha de comando: a configuração dos consumidores também precisa ser compatível.

O instalador não precisa modificar o `PATH` global nem substituir instalações de Node.js ou Python que você já tenha. Mantenha o ambiente local separado de experimentos de desenvolvimento; os comandos genéricos antigos de instalação não substituem os locks e as verificações deste fluxo.

## Instalação manual para desenvolvedores

Esta alternativa é opcional. Ao contrário do duplo clique, ela pressupõe Node.js e Python já disponíveis no terminal. Use Node.js 22.23.2 e Python 3.12.12 x64 para corresponder ao ambiente do launcher. Não use o lock Windows em Linux ou no Docker.

Na raiz do projeto, confira os executáveis e prepare as dependências:

```powershell
node --version
python --version
python -c "import platform; print(platform.machine())"
npm.cmd ci --include=dev --include=optional --ignore-scripts=false --no-audit --no-fund
python -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install --require-hashes --only-binary=:all: -r backend/locks/windows-cp312.lock
backend/.venv/Scripts/python.exe scripts/windows/bootstrap_data.py
backend/.venv/Scripts/python.exe scripts/windows/bootstrap_data.py --check-only
```

Pare se qualquer etapa falhar. Não prossiga com ambiente parcial e não troque a instalação travada por versões mais recentes escolhidas automaticamente.

Mantenha dois terminais abertos, ambos na raiz do projeto. No primeiro, inicie a API:

```powershell
backend/.venv/Scripts/python.exe -m uvicorn astro_system.api.main:app --app-dir backend/src --host 127.0.0.1 --port 8000 --no-access-log
```

No segundo, inicie a interface:

```powershell
node scripts/windows/start-frontend.mjs
```

Execute as verificações HTTP apresentadas anteriormente e abra [o site local](http://127.0.0.1:3000). Neste fluxo manual, encerre cada servidor com **Ctrl+C** no respectivo terminal. `Parar-Orbital.cmd` não deve encerrar processos que você iniciou manualmente.

Para verificar somente os dados no ambiente criado pelo instalador:

```powershell
.orbis/venv/Scripts/python.exe scripts/windows/bootstrap_data.py --check-only
```

Esse comando não substitui os testes do frontend ou do backend; ele verifica a preparação dos artefatos científicos.

## Preparar um ZIP do código para distribuição

Para o mantenedor, o exportador cria um pacote de código por uma lista explícita de arquivos e registra hashes. Execute na raiz do projeto, escolhendo um destino novo:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\windows\Export-Source.ps1" -Destination "C:\caminho\Orbital-fonte.zip"
```

Troque `C:\caminho` por uma pasta de destino sua. O arquivo exportado não é uma cópia completa do ambiente instalado e não deve incluir caches, segredos ou arquivos pessoais.

Antes de distribuir, extraia o pacote em uma pasta nova e teste o caminho de instalação a partir dela. Verifique se todos os módulos, os seis catálogos, os manifestos aprovados e os locks necessários foram incluídos. Não use como prova apenas a execução no checkout de desenvolvimento, que pode conter arquivos locais ausentes no Git.

Preserve também [`.gitattributes`](../.gitattributes), que marca os catálogos e manifestos científicos com `-text`. A conversão automática de quebras de linha mudaria seus hashes, mesmo sem alterar o conteúdo aparente do JSON. Não reformate esses arquivos nem remova essa regra na publicação.

Use o `package-lock.json` incluído no pacote. Ele contém as entradas necessárias para a instalação limpa, inclusive as dependências opcionais `emnapi`; não o substitua por uma cópia antiga para contornar um erro de `npm ci`.

Exportar o ZIP não publica o código nem cria uma release no GitHub. Commit, push, alteração de acesso e publicação continuam sendo operações separadas.

## O que já foi validado

O [registro de validação de 20/10/2026](installer-validation-2026-10-20.md) descreve a instalação em uma cópia limpa, os testes automatizados, a inicialização e a parada reais, além das verificações que ainda dependem de aceite em outra máquina.
