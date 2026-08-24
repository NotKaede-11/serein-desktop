param(
    [Parameter(Mandatory = $true)]
    [string]$Executable,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ExecutableArguments
)

$ErrorActionPreference = 'Stop'
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'

if (-not (Test-Path -LiteralPath $vswhere)) {
    throw 'Visual Studio Build Tools were not found.'
}

$installationPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$developerCommand = Join-Path $installationPath 'Common7\Tools\VsDevCmd.bat'
$developerEnvironment = & cmd.exe /d /s /c "`"$developerCommand`" -no_logo -arch=x64 >nul && set"

foreach ($line in $developerEnvironment) {
    $parts = $line -split '=', 2
    if ($parts.Count -eq 2) {
        Set-Item -Path "Env:$($parts[0])" -Value $parts[1]
    }
}

$sereinCargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
Set-Item -Path 'Env:Path' -Value "$sereinCargoBin;$((Get-Item -Path 'Env:Path').Value)"

if ($Executable -eq 'cargo') {
    $Executable = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
}

& $Executable @ExecutableArguments
exit $LASTEXITCODE
