param(
    [string]$Configuration = 'release'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$version = [string]$package.version
$artifactRoot = Join-Path $projectRoot 'artifacts'
$bundleRoot = Join-Path $projectRoot "src-tauri\target\$Configuration\bundle\nsis"
$setupDestination = Join-Path $artifactRoot "Serein-$version-Windows-x64-Setup.exe"

$installers = @(Get-ChildItem -LiteralPath $bundleRoot -Filter 'Serein*.exe' -File -ErrorAction Stop)
if ($installers.Count -ne 1) {
    throw "Expected exactly one Serein NSIS installer in $bundleRoot, found $($installers.Count)."
}

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
Copy-Item -LiteralPath $installers[0].FullName -Destination $setupDestination -Force
$portableArchive = & (Join-Path $PSScriptRoot 'package-portable.ps1') -Configuration $Configuration

$artifacts = @($setupDestination, [string]$portableArchive)
$artifacts | ForEach-Object {
    $item = Get-Item -LiteralPath $_
    $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $_
    [pscustomobject]@{
        Name = $item.Name
        Size = $item.Length
        SHA256 = $hash.Hash
    }
} | Format-Table -AutoSize
