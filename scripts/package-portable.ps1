param(
    [string]$Configuration = 'release'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$version = [string]$package.version
$binary = Join-Path $projectRoot "src-tauri\target\$Configuration\Serein.exe"
$artifactRoot = Join-Path $projectRoot 'artifacts'
$portableRoot = Join-Path $artifactRoot "Serein-$version-Windows-x64-Portable"
$archive = Join-Path $artifactRoot "Serein-$version-Windows-x64-Portable.zip"

if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
    throw "Serein executable was not found at $binary. Build the release application first."
}

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
if (Test-Path -LiteralPath $portableRoot) {
    $resolvedPortableRoot = (Resolve-Path -LiteralPath $portableRoot).Path
    if (-not $resolvedPortableRoot.StartsWith($artifactRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to replace a portable directory outside the artifact root: $resolvedPortableRoot"
    }
    Remove-Item -LiteralPath $resolvedPortableRoot -Recurse -Force
}
if (Test-Path -LiteralPath $archive) {
    $resolvedArchive = (Resolve-Path -LiteralPath $archive).Path
    if (-not $resolvedArchive.StartsWith($artifactRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to replace an archive outside the artifact root: $resolvedArchive"
    }
    Remove-Item -LiteralPath $resolvedArchive -Force
}

New-Item -ItemType Directory -Path $portableRoot | Out-Null
Copy-Item -LiteralPath $binary -Destination (Join-Path $portableRoot 'Serein.exe')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\PORTABLE-README.txt') -Destination $portableRoot
Compress-Archive -Path (Join-Path $portableRoot '*') -DestinationPath $archive -CompressionLevel Optimal

Write-Output $archive
