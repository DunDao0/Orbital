#requires -Version 5.1
[CmdletBinding()]
param([switch]$Quiet)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')).TrimEnd('\')
$lock = $null
try {
    function Assert-NoLink([string]$Path) {
        for ($current = $Path; $current; $current = [IO.Path]::GetDirectoryName($current)) {
            if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw "Link ou juncao encontrado. Nada sera removido: $current"
            }
        }
    }
    function Resolve-InstalledPath([string]$Relative) {
        if (-not $Relative -or $Relative.Contains('\') -or $Relative.Contains(':') -or @($Relative.Split('/') | Where-Object { $_ -in @('', '.', '..') }).Count) { throw 'Caminho invalido no manifesto.' }
        $path = [IO.Path]::GetFullPath((Join-Path $root $Relative))
        if (-not $path.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Caminho fora da instalacao.' }
        Assert-NoLink $path
        return $path
    }
    Assert-NoLink $root
    $markerPath = Join-Path $root 'INSTALLATION.json'
    $manifestPath = Join-Path $root 'SOURCE-MANIFEST.json'
    $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
    if ($marker.schema -ne 1 -or $marker.product -cne 'Orbital' -or $marker.version -notmatch '^\d+\.\d+\.\d+$' -or $marker.root -cne $root) { throw 'Esta pasta nao e uma instalacao reconhecida.' }
    if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -ne $marker.manifest_sha256) { throw 'Manifesto alterado. Nenhum arquivo sera removido.' }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Orbital-' + $marker.version
    if ((Get-ItemProperty -LiteralPath $registry).InstallLocation -cne $root) { throw 'O registro aponta para outra instalacao.' }
    # Resolve and validate every deletion target before stopping or removing anything.
    $targets = @($manifest.files | ForEach-Object { [pscustomobject]@{ path = (Resolve-InstalledPath $_.path); hash = $_.sha256 } })
    if (@($targets.path | Select-Object -Unique).Count -ne $targets.Count) { throw 'Manifesto com caminhos duplicados.' }
    $launcher = Resolve-InstalledPath 'scripts/windows/Install-Orbital.ps1'
    Assert-NoLink (Join-Path $root '.orbis')
    $launcherEntry = $targets | Where-Object path -eq $launcher
    if (-not $launcherEntry -or (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash -ne $launcherEntry.hash) { throw 'O launcher foi alterado. Restaure-o antes de desinstalar.' }
    if (-not $Quiet) {
        Add-Type -AssemblyName System.Windows.Forms
        $answer = [Windows.Forms.MessageBox]::Show('Remover o Orbital ' + $marker.version + '? Downloads, dados, logs e arquivos modificados serao preservados na pasta de instalacao.', 'Desinstalar Orbital', 'YesNo', 'Question')
        if ($answer -ne 'Yes') { exit 0 }
    }
    $windowsPowerShell = Join-Path ([Environment]::GetFolderPath('System')) 'WindowsPowerShell\v1.0\powershell.exe'
    & $windowsPowerShell -NoLogo -NoProfile -ExecutionPolicy Bypass -File $launcher -Action Stop
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel confirmar a parada. Nenhum arquivo foi removido.' }
    $lockPath = Join-Path $root '.orbis\setup.lock'
    if (Test-Path -LiteralPath $lockPath) { $lock = [IO.File]::Open($lockPath, 'Open', 'ReadWrite', 'None') }
    $appName = 'Orbital ' + $marker.version
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) $appName
    $links = @(
        @{ path = (Join-Path $menu 'Abrir Orbital.lnk'); script = 'Open-Orbital.ps1' },
        @{ path = (Join-Path $menu 'Parar Orbital.lnk'); script = 'Stop-Orbital.ps1' },
        @{ path = (Join-Path $menu 'Desinstalar Orbital.lnk'); script = 'Uninstall-Orbital.ps1' }
    )
    if ($marker.desktop) { $links += @{ path = (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) ($appName + '.lnk')); script = 'Open-Orbital.ps1' } }
    $shell = New-Object -ComObject WScript.Shell
    foreach ($item in $links) {
        if (Test-Path -LiteralPath $item.path) {
            Assert-NoLink $item.path
            $link = $shell.CreateShortcut($item.path)
            $expected = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $root ('scripts\windows\' + $item.script)) + '"'
            if ($link.TargetPath -ieq $windowsPowerShell -and $link.Arguments -ceq $expected -and $link.WorkingDirectory.TrimEnd('\') -ceq $root) { Remove-Item -LiteralPath $item.path }
            [Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) | Out-Null
        }
    }
    [Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell) | Out-Null
    if ((Test-Path -LiteralPath $menu) -and -not (Get-ChildItem -LiteralPath $menu -Force)) { Remove-Item -LiteralPath $menu }
    $preserved = 0
    foreach ($target in $targets) {
        if (Test-Path -LiteralPath $target.path -PathType Leaf) {
            if ((Get-FileHash -LiteralPath $target.path -Algorithm SHA256).Hash -eq $target.hash) { Remove-Item -LiteralPath $target.path }
            else { $preserved++ }
        }
    }
    Remove-Item -LiteralPath $registry
    Remove-Item -LiteralPath $manifestPath, $markerPath
    $directories = @($targets.path | ForEach-Object {
        for ($dir = [IO.Path]::GetDirectoryName($_); $dir -and $dir -ne $root; $dir = [IO.Path]::GetDirectoryName($dir)) { $dir }
    } | Sort-Object -Unique | Sort-Object Length -Descending)
    foreach ($dir in $directories) {
        if ((Test-Path -LiteralPath $dir) -and -not (Get-ChildItem -LiteralPath $dir -Force)) { Remove-Item -LiteralPath $dir }
    }
    if ($lock) { $lock.Dispose(); $lock = $null }
    $message = 'Orbital removido.'
    if (Get-ChildItem -LiteralPath $root -Force) { $message += " Arquivos locais preservados em: $root" }
    else { Remove-Item -LiteralPath $root }
    Write-Host $message
    if (-not $Quiet) { [Windows.Forms.MessageBox]::Show($message, 'Orbital') | Out-Null }
} catch {
    Write-Host "Nao foi possivel concluir: $($_.Exception.Message)"
    if (-not $Quiet) { Read-Host 'Pressione Enter para fechar' }
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
}
