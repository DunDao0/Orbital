# Instalador executável do Orbital para Windows

## Para instalar

1. Baixe **[Orbital-0.1.2-Setup-x64.exe](https://github.com/DunDao0/Orbital/releases/download/v0.1.2/Orbital-0.1.2-Setup-x64.exe)**.
2. Abra o arquivo, mantenha a pasta sugerida e clique em **Instalar**. Não é necessário extrair um ZIP.
3. Deixe **Abrir o Orbital após a instalação** marcado para iniciar a preparação. Acompanhe os downloads na janela que abre e mantenha a internet conectada.
4. Depois da preparação, o navegador abre o Orbital. Nas próximas vezes, use o atalho da área de trabalho ou **Iniciar → Orbital 0.1.2 → Abrir Orbital**.

Requisitos: Windows 10/11 x64, computador Intel ou AMD, navegador com WebGL, internet na primeira abertura e pelo menos 4 GB livres como margem inicial. Não é necessário instalar Node.js, Python, Git ou Docker manualmente. O assistente e os componentes usam apenas o perfil do usuário; não solicitam privilégios de administrador nem alteram o PATH global.

A pasta padrão é `%LOCALAPPDATA%\Programs\Orbital\0.1.2`. O assistente aceita outra pasta local vazia. Uma pasta com arquivos é recusada para preservar seu conteúdo. Se esta mesma versão já estiver registrada, abra-a pelo atalho ou desinstale antes de instalar novamente; escolha outra pasta vazia se houver dados preservados.

O instalador ainda não possui assinatura digital. O Windows pode mostrar editor desconhecido ou um aviso de reputação. Verifique a origem em `DunDao0/Orbital`; em máquinas gerenciadas, consulte o responsável quando houver bloqueio.

## O que acontece

O `.exe` contém o pacote de código, confere seu SHA-256 e os hashes individuais antes de copiar os arquivos. Ele cria os atalhos **Abrir Orbital**, **Parar Orbital** e **Desinstalar Orbital** no menu Iniciar, oferece um atalho na área de trabalho e registra a versão em **Configurações → Aplicativos**.

A preparação de Node.js, Python, dependências e dados acontece na primeira abertura, pelo mesmo fluxo verificado usado na distribuição ZIP. A janela do assistente confirma a instalação dos arquivos; o Orbital estará pronto para uso quando a janela de preparação mostrar `Pronto: http://127.0.0.1:3000`. Em caso de falha no download, mantenha a pasta instalada e abra novamente pelo atalho para tentar a preparação outra vez.

O pacote não é totalmente offline. A aplicação continua abrindo no navegador e usa apenas as portas locais 3000 e 8000. Consulte o [manual Windows](instalacao-windows.md) para diagnóstico, dados científicos e opções avançadas.

## Parar, atualizar e remover

A versão 0.1.2 corrige uma falha de reabertura no Windows: uma leitura simultânea podia bloquear a atualização de `.orbis/state.json` e encerrar o supervisor. A leitura agora permite a substituição atômica do arquivo; bloqueios temporários são repetidos por até cinco segundos, sem expor JSON incompleto. Se o supervisor encerrar durante a abertura, a preparação informa a falha imediatamente e indica o log, em vez de aguardar o tempo limite inteiro.

- **Parar:** use o atalho **Parar Orbital**. Fechar o navegador não encerra os serviços.
- **Atualizar:** pare a versão anterior e instale a nova release. As versões usam pastas e atalhos distintos; só execute uma instância de cada vez, pois as portas são fixas. Não mova ambientes `.orbis` entre pastas.
- **Desinstalar:** use **Configurações → Aplicativos → Orbital 0.1.2 → Desinstalar**, ou o atalho **Desinstalar Orbital**. A remoção pede confirmação e tenta parar apenas a instância daquela pasta.

A desinstalação remove os arquivos originais que ainda correspondem ao manifesto, os atalhos reconhecidos e o registro dessa versão. **Arquivos modificados, arquivos pessoais, downloads, dependências e dados gerados são preservados.** A pasta restante é informada ao final; remover o aplicativo não libera automaticamente o espaço desses arquivos. Não há exclusão recursiva da pasta de instalação. Manifesto alterado, caminho com junção/link ou falha na parada impedem a remoção.

## Gerar o instalador a partir do código

Execute no Windows, na raiz do projeto:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows\Build-Installer.ps1 -OutputDirectory C:\Orbital-build\0.1.2
```

Escolha uma pasta de saída que ainda não exista. O script usa o compilador do .NET Framework de 64 bits já disponível nesta estação, em `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`. Se não estiver disponível, o build para com uma mensagem; não instala ferramentas automaticamente. Os arquivos de saída são:

- `Orbital-0.1.2-Setup-x64.exe`: assistente em português, com manifesto `asInvoker`.
- `Orbital-0.1.2-Windows-x64.zip`: distribuição alternativa com o mesmo conteúdo.
- `SHA256SUMS.txt`: hashes dos dois downloads.
- `PackageInfo.cs`: metadados usados na compilação, não necessário ao usuário final.

O empacotamento continua usando a lista explícita de fontes de `Export-Source.ps1`. Ambientes, credenciais, caches, logs e dados baixados ficam fora dos downloads. A autoria e os metadados do produto usam **DunDao0**. O build não assina o executável nem publica automaticamente no GitHub.

## Validação

`tests/setup-exe.test.mjs`, incluído no comando `npm test`, compila o executável real no Windows, instala em uma pasta temporária com espaços e verifica hashes, atalhos e registro. Também confere a recusa de pasta ocupada, instalação duplicada e manifesto alterado, além da preservação de arquivos locais durante a desinstalação. Se essa versão já estiver instalada no perfil, o teste informa que foi pulado para preservá-la.

```powershell
node --test tests/installer.test.mjs tests/setup-exe.test.mjs
backend\.venv\Scripts\python.exe -m pytest backend\tests\test_windows_installer.py
```

Esses testes exercitam o modo automatizado `--install-dir <pasta vazia>`, que não abre o aplicativo nem cria atalho na área de trabalho. A interação manual com as telas do assistente, avisos do Windows e outras máquinas não é comprovada por esses testes.

Os testes Python incluem um bloqueio real de arquivo no Windows, recuperação após sua liberação, limite de tentativas e preservação do erro original quando o estado não pode ser gravado. Para validar uma release, também instale o executável gerado em uma pasta nova, abra o Orbital, confira a prontidão científica, pare e reabra repetidamente. Os testes unitários não substituem esse ciclo completo.
