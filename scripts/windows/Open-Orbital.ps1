#requires -Version 5.1
$ErrorActionPreference = 'Stop'
& "$PSScriptRoot\Install-Orbital.ps1"
if ($LASTEXITCODE -ne 0) { Read-Host 'Nao foi possivel abrir. Confira a mensagem acima. Pressione Enter para fechar'; exit 1 }
