#requires -Version 5.1
$ErrorActionPreference = 'Stop'
& "$PSScriptRoot\Install-Orbital.ps1" -Action Stop
if ($LASTEXITCODE -ne 0) { Read-Host 'Nao foi possivel parar. Confira a mensagem acima. Pressione Enter para fechar'; exit 1 }
