# Validação do instalador Windows — 20/10/2026

## Entrega

O fluxo `Instalar-e-Abrir.cmd` prepara um ambiente isolado na pasta do projeto e inicia a interface e a API locais. `Parar-Orbital.cmd` solicita o encerramento dos processos pertencentes a essa instância.

O instalador é um launcher de código-fonte para Windows x64, não um executável assinado nem um pacote totalmente offline. A instalação inicial baixa runtimes, dependências e kernels científicos; não exige instalar Node.js, Python, Git ou Docker manualmente.

Consulte [o manual](instalacao-windows.md) para requisitos, instalação por duplo clique, alternativa manual, diagnóstico e distribuição.

## Verificações executadas

| Verificação | Evidência e resultado |
| --- | --- |
| Instalação em cópia limpa do código | ZIP de código extraído em `work/installer smoke clean`, uma pasta com espaços, sem copiar `node_modules`, ambiente Python ou runtimes da instalação de desenvolvimento. |
| Compatibilidade do launcher | Execução por Windows PowerShell 5.1; scripts também passaram por análise sintática nesse interpretador. |
| Runtimes locais | Download e verificação SHA-256 de Node.js 22.23.2 e uv 0.9.2. Python 3.12.12 instalado pelo uv no diretório privado do projeto, com opções para não criar registro nem comandos globais. |
| Dependências | `npm ci` concluiu na cópia limpa. Ambiente Python sincronizado a partir do lock Windows com hashes e distribuição exclusivamente em wheels. |
| Dados científicos | Seis catálogos e três manifestos aprovados restaurados; três kernels baixados e conferidos contra os hashes esperados. |
| Inicialização real | Página inicial e rota do Atlas da Terra responderam HTTP 200. API de prontidão retornou `ready: true`, com provedor `spiceypy-de442s`. |
| Reutilização | Nova chamada do launcher reconheceu os serviços existentes, sem criar outra instância. Reabertura com `UV_OFFLINE=true` e `npm_config_offline=true` reutilizou o ambiente preparado. |
| Encerramento | A ação `Stop` encerrou a instância supervisionada; as portas 3000 e 8000 deixaram de ter listeners após a conclusão. |
| Frontend | `npm.cmd test` concluiu com sucesso, incluindo build e testes. `npx.cmd tsc --noEmit` e `npm.cmd run lint` concluíram sem erros. |
| Regressões do instalador | Oito testes em `tests/installer.test.mjs` passaram, incluindo validação de hashes, binding local, PowerShell 5.1 e caminho com espaços. Seis testes em `backend/tests/test_windows_installer.py` passaram. |

Os testes do backend adicionados neste trabalho cobrem preparação dos dados, reutilização sem downloads, preservação de dados divergentes, detecção de adulteração, modo somente verificação, porta já ocupada e encerramento de processo pertencente ao Job Object do instalador.

## Ajustes necessários para uma instalação reproduzível

- O `package-lock.json` recebeu duas entradas transitivas ausentes de `emnapi`, que impediam o `npm ci` em uma pasta limpa. Não foi feita atualização geral das dependências.
- `.gitattributes` preserva os bytes dos catálogos e manifestos científicos. A normalização de quebras de linha pelo Git alteraria seus hashes.
- O launcher de frontend impõe `127.0.0.1:3000` e porta estrita; a API usa `127.0.0.1:8000`. Portas ocupadas geram erro, sem encerrar programas de terceiros.
- A exportação usa uma lista explícita de fontes e um manifesto SHA-256. Exclui instalações locais, caches, kernels baixados, `.git`, arquivos de ambiente e chaves.
- O lint ignora `work/` e `.orbis/`, que contêm cópias de validação e arquivos instalados, não novas fontes do projeto.

## Limites desta validação

- O teste foi feito em uma pasta limpa nesta estação Windows, não em uma máquina virtual recém-instalada. A compatibilidade com todas as políticas corporativas, antivírus, proxies e instalações Windows ainda não está demonstrada.
- A inicialização foi exercitada com `-NoBrowser`. As respostas HTTP e o ciclo dos processos foram verificados; a abertura automática do navegador padrão e a interação visual completa por duplo clique ainda precisam de aceite manual.
- As flags offline mencionadas controlam os gerenciadores de pacotes. Não houve desconexão física da rede, e isso não prova que todas as funcionalidades da aplicação sejam offline.
- O conjunto científico completo do backend não foi executado neste trabalho. Os testes novos não substituem seus gates científicos nem validam novas posições, épocas, referenciais ou cálculos.
- Os limites de cobertura e disponibilidade IERS continuam valendo. Site aberto não significa que qualquer época ou observação seja cientificamente suportada.
- Não houve commit, push, release, deploy, túnel ou publicação no GitHub. As alterações locais preexistentes foram preservadas.

## Aceite antes de uma release

1. Publicar somente após autorização, incluindo launchers, scripts, manual, locks, catálogos, manifestos e `.gitattributes` com os bytes aprovados.
2. Baixar o ZIP da própria revisão publicada em uma máquina Windows x64 limpa, extrair e executar `Instalar-e-Abrir.cmd`.
3. Confirmar abertura do navegador, página inicial, Atlas, avisos de cobertura e encerramento por `Parar-Orbital.cmd`.
4. Registrar a revisão testada e testar também o caso de internet indisponível na primeira instalação e o de porta ocupada.
5. Para distribuição offline ou como `.exe` assinado, planejar uma entrega separada com runtimes, licenças, assinatura e testes de máquina limpa; o launcher atual não se apresenta como esse produto.
