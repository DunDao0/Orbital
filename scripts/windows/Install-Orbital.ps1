#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Start', 'Stop', 'Status')][string]$Action = 'Start',
    [switch]$PrepareOnly,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\')
$localRoot = Join-Path $projectRoot '.orbis'
$statePath = Join-Path $localRoot 'state.json'
$webUrl = 'http://127.0.0.1:3000'
$setupLock = $null
$transcribing = $false

function Read-State {
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    try {
        # Allow the supervisor to atomically replace the file while it is read.
        $stream = [IO.File]::Open($statePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
        try {
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8)
            try { $rawState = $reader.ReadToEnd() } finally { $reader.Dispose() }
        } finally { $stream.Dispose() }
        $state = $rawState | ConvertFrom-Json
        if ($state.root -ne $projectRoot) { return $null }
        # Preserve fractional seconds, matching the supervisor's Python time.time().
        $now = ([DateTimeOffset]::UtcNow - [DateTimeOffset]'1970-01-01T00:00:00Z').TotalSeconds
        $age = ($now - [double]$state.heartbeat)
        if ($age -lt 0 -or $age -gt 15) { return $null }
        return $state
    } catch { return $null }
}
function Run-Checked([string]$Executable, [string[]]$Arguments) {
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Executable @Arguments 2>&1 | ForEach-Object { Write-Host "$_" }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $oldPreference }
    if ($code -ne 0) { throw "Comando falhou (codigo $code): $Executable" }
}
function Get-VerifiedZip($Spec, [string]$Archive, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Archive)) {
        Write-Host "Baixando $($Spec.url)"
        Invoke-WebRequest -UseBasicParsing -Uri $Spec.url -OutFile "$Archive.part" -TimeoutSec 300
        if ((Get-FileHash -LiteralPath "$Archive.part" -Algorithm SHA256).Hash -ne $Spec.sha256) {
            throw "Download com hash invalido. Nada foi executado: $Archive.part"
        }
        Move-Item -LiteralPath "$Archive.part" -Destination $Archive
    }
    if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $Spec.sha256) {
        throw "Arquivo local com hash invalido: $Archive. Remova somente esse ZIP e tente novamente."
    }
    Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force
}
function File-Hash([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }

try {
    if ($Action -eq 'Status') {
        $running = Read-State
        if ($running) { $running | ConvertTo-Json } else { Write-Host 'Orbital nao esta em execucao por este instalador.' }
        exit 0
    }
    if ($Action -eq 'Stop') {
        $running = Read-State
        if (-not $running) { Write-Host 'Nenhuma instancia deste instalador para parar.'; exit 0 }
        [IO.File]::WriteAllText((Join-Path $localRoot 'stop.request'), $running.session)
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            Start-Sleep -Seconds 1
            if (-not (Read-State)) { Write-Host 'Orbital parado.'; exit 0 }
        }
        throw 'O supervisor ainda nao confirmou a parada. Consulte .orbis\logs; nenhum processo externo foi encerrado.'
    }
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
        throw 'Este instalador requer Windows x64 (Intel/AMD) e PowerShell de 64 bits. ARM nao esta incluido.'
    }
    Set-Location -LiteralPath $projectRoot
    New-Item -ItemType Directory -Force -Path $localRoot, "$localRoot\logs", "$localRoot\runtime", "$localRoot\downloads" | Out-Null
    try { $setupLock = [IO.File]::Open("$localRoot\setup.lock", 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Outra instalacao esta em andamento nesta pasta. Aguarde sua conclusao.' }
    Start-Transcript -LiteralPath "$localRoot\logs\installation.log" -Append | Out-Null
    $transcribing = $true
    $running = Read-State
    if ($running) {
        if ($running.status -eq 'error') { throw $running.error }
        if ($running.status -ne 'ready') { throw 'O site ainda esta iniciando. Aguarde e tente novamente.' }
        if (-not (Get-Process -Id $running.pid -ErrorAction SilentlyContinue)) { throw 'Estado antigo encontrado. Aguarde 15 segundos e tente novamente.' }
        $frontHealth = Invoke-RestMethod "$webUrl/__orbis/health" -TimeoutSec 5
        $apiHealth = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 5
        if ($frontHealth.api -ne 'orbis-local-frontend' -or $apiHealth.api -ne 'orbis-local-scientific-api' -or $apiHealth.status -ne 'ok') {
            throw 'Os servicos nao confirmaram a identidade. Consulte .orbis\logs.'
        }
        Write-Host "Orbital ja esta aberto: $webUrl"
        if (-not $NoBrowser -and -not $PrepareOnly) { Start-Process $webUrl }
        exit 0
    }
    foreach ($port in @(3000, 8000)) {
        if (-not $PrepareOnly -and (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {
            throw "Porta $port ocupada. Pare a outra instancia ou programa antes de iniciar. Nada sera encerrado automaticamente."
        }
    }
    $pins = Get-Content -LiteralPath "$PSScriptRoot\runtimes.json" -Raw | ConvertFrom-Json
    $required = @('package-lock.json', 'vite.config.ts', 'worker\index.ts', 'backend\locks\windows-cp312.lock', 'backend\data-inventory.json', 'public\scientific\constellation_guides.json')
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relative))) { throw "Pacote incompleto: falta $relative. Extraia o ZIP inteiro." }
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $ProgressPreference = 'SilentlyContinue'
    $nodeDir = Join-Path "$localRoot\runtime" $pins.node.folder
    $node = Join-Path $nodeDir 'node.exe'
    $uvDir = Join-Path "$localRoot\runtime" $pins.uv.folder
    $uv = Join-Path $uvDir 'uv.exe'
    if (-not (Test-Path -LiteralPath $node)) { Get-VerifiedZip $pins.node "$localRoot\downloads\node.zip" "$localRoot\runtime" }
    if (-not (Test-Path -LiteralPath $uv)) { Get-VerifiedZip $pins.uv "$localRoot\downloads\uv.zip" $uvDir }
    $env:PATH = "$nodeDir;$env:PATH" # Child process only; no global PATH change.
    $env:UV_PYTHON_INSTALL_DIR = "$localRoot\runtime\python"
    $env:UV_CACHE_DIR = "$localRoot\cache\uv"
    $env:UV_PYTHON_PREFERENCE = 'only-managed'
    $env:UV_PYTHON_INSTALL_REGISTRY = 'false'
    $env:UV_NO_CONFIG = 'true'
    $env:npm_config_cache = "$localRoot\cache\npm"
    $env:WRANGLER_SEND_METRICS = 'false'
    Write-Host '[1/4] Preparando Python local (sem instalacao global)...'
    Run-Checked $uv @('python', 'install', $pins.python, '--no-bin', '--no-registry')
    $python = Join-Path $localRoot 'venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $python)) {
        Run-Checked $uv @('venv', '--python', $pins.python, "$localRoot\venv")
    }
    $pythonLock = "$projectRoot\backend\locks\windows-cp312.lock"
    $backendHash = (File-Hash $pythonLock) + ':' + $pins.python
    $backendMarker = "$localRoot\backend.ready"
    Write-Host '[2/4] Verificando dependencias cientificas fixadas...'
    if (-not (Test-Path -LiteralPath $backendMarker) -or (Get-Content -LiteralPath $backendMarker -Raw) -ne $backendHash) {
        Run-Checked $uv @('pip', 'sync', '--python', $python, '--require-hashes', '--only-binary', ':all:', $pythonLock)
        [IO.File]::WriteAllText($backendMarker, $backendHash)
    }
    Write-Host '[3/4] Preparando interface...'
    Write-Host 'Na primeira instalacao os downloads podem levar varios minutos. Nao feche esta janela.'
    $npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
    $frontHash = (File-Hash "$projectRoot\package-lock.json") + (File-Hash "$projectRoot\package.json") + $pins.node.version
    $frontMarker = "$localRoot\frontend.ready"
    if (-not (Test-Path -LiteralPath "$projectRoot\node_modules\vite\package.json") -or -not (Test-Path -LiteralPath $frontMarker) -or (Get-Content -LiteralPath $frontMarker -Raw) -ne $frontHash) {
        Run-Checked $node @($npmCli, 'ci', '--include=dev', '--include=optional', '--ignore-scripts=false', '--no-audit', '--no-fund')
        [IO.File]::WriteAllText($frontMarker, $frontHash)
    }
    Write-Host '[4/4] Verificando catalogos e kernels aprovados...'
    Run-Checked $python @("$PSScriptRoot\bootstrap_data.py")
    if ($PrepareOnly) { Write-Host 'Preparacao concluida. Use Instalar-e-Abrir.cmd para abrir.'; exit 0 }
    $supervisor = Start-Process -FilePath $python -ArgumentList @('"' + "$PSScriptRoot\supervisor.py" + '"', '--node', '"' + $node + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput "$localRoot\logs\supervisor.out.log" -RedirectStandardError "$localRoot\logs\supervisor.err.log" -PassThru
    Write-Host 'Iniciando site e API. A primeira compilacao pode levar alguns minutos...'
    for ($attempt = 0; $attempt -lt 240; $attempt++) {
        Start-Sleep -Seconds 1
        $running = Read-State
        if ($running -and $running.status -eq 'error') { throw $running.error }
        if ($supervisor.HasExited) {
            throw 'O supervisor encerrou antes de abrir o site. Consulte .orbis\logs\supervisor.err.log.'
        }
        if ($running -and $running.status -eq 'ready') {
            Write-Host "Pronto: $webUrl"
            if ($running.warning) { Write-Warning $running.warning }
            if (-not $NoBrowser) { Start-Process $webUrl }
            exit 0
        }
    }
    throw 'O site nao ficou pronto a tempo. Consulte .orbis\logs e use Parar-Orbital.cmd antes de tentar novamente.'
} catch {
    Write-Host "`nERRO: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($transcribing) { Stop-Transcript | Out-Null }
    if ($setupLock) { $setupLock.Dispose() }
}
