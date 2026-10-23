#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Escolha uma pasta de saida nova. Nada sera sobrescrito.' }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw 'O compilador .NET Framework de 64 bits nao foi encontrado neste Windows.' }
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'A versao deve usar o formato X.Y.Z.' }
New-Item -ItemType Directory -Path $output | Out-Null
$archive = Join-Path $output "Orbital-$version-Windows-x64.zip"
& "$PSScriptRoot\Export-Source.ps1" -Destination $archive
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$metadata = @"
using System.Reflection;
[assembly: AssemblyTitle("Orbital")]
[assembly: AssemblyProduct("Orbital")]
[assembly: AssemblyCompany("DunDao0")]
[assembly: AssemblyVersion("$version.0")]
[assembly: AssemblyFileVersion("$version.0")]
internal static class PackageInfo { internal const string Version = "$version"; internal const string Sha256 = "$hash"; }
"@
$metadataPath = Join-Path $output 'PackageInfo.cs'
[IO.File]::WriteAllText($metadataPath, $metadata, [Text.UTF8Encoding]::new($false))
$exe = Join-Path $output "Orbital-$version-Setup-x64.exe"
$arguments = @('/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/codepage:65001',
    ('/out:' + $exe), ('/win32manifest:' + (Join-Path $PSScriptRoot 'setup\app.manifest')),
    ('/resource:' + $archive + ',Orbital.Payload.zip'),
    '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll',
    '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
    '/reference:System.Web.Extensions.dll', '/reference:Microsoft.CSharp.dll',
    (Join-Path $PSScriptRoot 'setup\OrbitalSetup.cs'), $metadataPath)
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw "Compilacao falhou: $LASTEXITCODE" }
$sums = @($archive, $exe) | ForEach-Object { (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($_) }
[IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS.txt'), (($sums -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
Write-Host "Instalador gerado: $exe"
Write-Host 'A primeira abertura precisa de internet. O executavel nao possui assinatura digital.'
