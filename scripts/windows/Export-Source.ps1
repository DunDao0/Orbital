#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$archivePath = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $archivePath) { throw 'Destino ja existe; escolha um novo nome. Nada sera sobrescrito.' }
if ([IO.Path]::GetExtension($archivePath) -ne '.zip') { throw 'O destino precisa terminar em .zip.' }

# Explicit source roots; never enumerate .git, work, data, secrets or installed runtimes.
$roots = @('app','backend/src','backend/tests','backend/tools','backend/validation','backend/locks',
    'db','drizzle','docs','lib','public','scripts','tests','worker')
$files = @('.gitignore','.gitattributes','AGENTS.md','README.md','README.github.md',
    'ORBIS_SCIENTIA_IMPLEMENTATION.md','package.json','package-lock.json',
    'next-env.d.ts','next.config.ts','vite.config.ts','tsconfig.json','worker-env.d.ts',
    'postcss.config.mjs','eslint.config.mjs','drizzle.config.ts','docker-compose.yml',
    'backend/pyproject.toml','backend/Dockerfile','backend/.dockerignore','backend/data-inventory.json',
    'Instalar-e-Abrir.cmd','Parar-Orbital.cmd')
$selected = [Collections.Generic.List[string]]::new()
function Add-Tree([string]$Relative) {
    $absolute = Join-Path $projectRoot $Relative
    if (-not (Test-Path -LiteralPath $absolute)) { throw "Fonte ausente: $Relative" }
    foreach ($entry in Get-ChildItem -LiteralPath $absolute -Force) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Link nao permitido no pacote: $($entry.FullName)" }
        if ($entry.Name -match '^(\.env|\.git$|\.venv$|__pycache__$|\.pytest_cache$|node_modules$|\.orbis$)' -or
            $entry.Extension -in @('.log','.pyc','.pyo','.zip','.pem','.key','.tsbuildinfo')) { continue }
        $child = "$Relative/$($entry.Name)"
        if ($entry.PSIsContainer) { Add-Tree $child } else { $selected.Add($child) }
    }
}
foreach ($root in $roots) { Add-Tree $root }
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $file))) { throw "Fonte ausente: $file" }
    $selected.Add($file)
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($archivePath)) | Out-Null
$archive = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
$manifest = [ordered]@{ schema = 1; kind = 'source-online-installer'; files = @() }
try {
    foreach ($relative in ($selected | Sort-Object -Unique)) {
        $source = Join-Path $projectRoot $relative
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $source, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        $manifest.files += @{ path = $relative; sha256 = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    $entry = $archive.CreateEntry('SOURCE-MANIFEST.json')
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try { $writer.Write(($manifest | ConvertTo-Json -Depth 5)) } finally { $writer.Dispose() }
} finally { $archive.Dispose() }
Write-Host "Pacote criado: $archivePath"
Write-Host "Arquivos: $($manifest.files.Count). Instalacao inicial requer internet."
Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
