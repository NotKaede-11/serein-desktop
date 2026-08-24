param(
    [string]$Configuration = 'release'
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$package = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$config = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'src-tauri\tauri.conf.json') | ConvertFrom-Json
$version = [string]$package.version
$binary = Join-Path $projectRoot "src-tauri\target\$Configuration\Serein.exe"
$bundleRoot = Join-Path $projectRoot 'src-tauri\target\release\bundle\nsis'
$previewInstaller = Join-Path $projectRoot "artifacts\Serein-$version-Windows-x64-Setup.exe"
$portableArchive = Join-Path $projectRoot "artifacts\Serein-$version-Windows-x64-Portable.zip"

if ($config.productName -ne 'Serein' -or $config.mainBinaryName -ne 'Serein') {
    throw 'Tauri product and binary names must both be Serein.'
}
if ($config.identifier -ne 'io.serein.desktop') {
    throw 'Unexpected long-term application identifier.'
}
if ($config.bundle.windows.nsis.installMode -ne 'currentUser') {
    throw 'The NSIS installer must default to current-user installation.'
}
if ($config.bundle.windows.webviewInstallMode.type -ne 'downloadBootstrapper') {
    throw 'The normal installer must use the documented Evergreen WebView2 bootstrapper strategy.'
}
if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
    throw "Missing release executable: $binary"
}
$versionInfo = (Get-Item -LiteralPath $binary).VersionInfo
if ($versionInfo.ProductName -ne 'Serein' -or $versionInfo.FileDescription -ne 'Serein') {
    throw 'Windows executable metadata is not branded as Serein.'
}
$installers = @(Get-ChildItem -LiteralPath $bundleRoot -Filter 'Serein*.exe' -File -ErrorAction Stop)
if ($installers.Count -ne 1) {
    throw "Expected one NSIS installer, found $($installers.Count)."
}
if (-not (Test-Path -LiteralPath $previewInstaller -PathType Leaf)) {
    throw "Missing preview installer artifact: $previewInstaller"
}
$bundleHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installers[0].FullName).Hash
$previewHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $previewInstaller).Hash
if ($bundleHash -ne $previewHash) {
    throw 'The preview installer does not match the verified Tauri NSIS bundle.'
}
if (-not (Test-Path -LiteralPath $portableArchive -PathType Leaf)) {
    throw "Missing portable archive: $portableArchive"
}
[System.Reflection.Assembly]::LoadWithPartialName('System.IO.Compression.FileSystem') | Out-Null
$portableZip = [System.IO.Compression.ZipFile]::OpenRead($portableArchive)
try {
    $portableEntries = @($portableZip.Entries | Where-Object { $_.Name } | ForEach-Object { $_.FullName.Replace('\', '/') } | Sort-Object)
} finally {
    $portableZip.Dispose()
}
$expectedPortableEntries = @('PORTABLE-README.txt', 'Serein.exe')
if (($portableEntries -join "`n") -ne ($expectedPortableEntries -join "`n")) {
    throw "Unexpected portable payload: $($portableEntries -join ', ')"
}
$unexpectedPayloads = @(Get-ChildItem -Recurse -File -LiteralPath (Join-Path $projectRoot 'src-tauri\target\release\bundle') | Where-Object { $_.Extension -in '.py', '.pyc' })
if ($unexpectedPayloads.Count) {
    throw 'Legacy Python files were found in the release bundle.'
}

[pscustomobject]@{
    Product = $versionInfo.ProductName
    Version = $versionInfo.ProductVersion
    Binary = $binary
    Installer = $previewInstaller
    Portable = $portableArchive
    InstallMode = $config.bundle.windows.nsis.installMode
    WebView2 = $config.bundle.windows.webviewInstallMode.type
    LegacyPythonPayloads = $unexpectedPayloads.Count
} | Format-List
