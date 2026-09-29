param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $Root).Path
$Target = Join-Path $Root 'Demarrer-NIKOUS.bat'
$Icon = Join-Path $Root 'assets\nikous.ico'
$Desktop = [Environment]::GetFolderPath('DesktopDirectory')
$ShortcutPath = Join-Path $Desktop 'NIKOUS.lnk'

if (-not (Test-Path -LiteralPath $Target)) {
    throw 'Demarrer-NIKOUS.bat est introuvable dans le dossier choisi.'
}

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $Target
$Shortcut.WorkingDirectory = $Root
$Shortcut.Description = 'Assistant local NIKOUS'
if (Test-Path -LiteralPath $Icon) {
    $Shortcut.IconLocation = "$Icon,0"
}
$Shortcut.Save()
Write-Output "Created: $ShortcutPath"
