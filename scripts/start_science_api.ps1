param(
  [ValidateRange(1, 65535)]
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot "backend\.venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $python)) {
  throw "Ambiente Python não encontrado em backend\.venv. Instale as dependências do backend antes de iniciar o serviço."
}

try {
  $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
  if ($health.status -eq "ok" -and $health.api -eq "orbis-local-scientific-api") {
    Write-Host "A API científica já está ativa em http://127.0.0.1:$Port"
    try {
      $ready = Invoke-RestMethod "http://127.0.0.1:$Port/api/health/ready" -TimeoutSec 3
      Write-Host "Readiness: $($ready.status)"
    } catch {
      Write-Warning "A API respondeu ao health, mas o readiness está degradado ou indisponível."
    }
    return
  }
} catch {
  # A conexão recusada é esperada quando a porta está livre.
}

try {
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
} catch {
  $listener = $null
}
if ($null -ne $listener) {
  throw "A porta local $Port já está ocupada por outro serviço (PID $($listener.OwningProcess)). Encerre-o ou escolha outra porta com -Port."
}

Write-Host "Orbis Scientia API em http://127.0.0.1:$Port"
Write-Host "Readiness: http://127.0.0.1:$Port/api/health/ready"
Write-Host "O serviço aceita somente conexões locais e não inicia túnel."
& $python -m uvicorn astro_system.api.main:app --app-dir (Join-Path $projectRoot "backend\src") --host 127.0.0.1 --port $Port --no-access-log
