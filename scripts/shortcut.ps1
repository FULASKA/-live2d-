# Create a "Live2D Stage" desktop shortcut pointing at the packaged exe.
# Usage: npm run shortcut   (or: powershell -File scripts/shortcut.ps1)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'dist\Live2DStage-win32-x64\Live2DStage.exe'
$icon = Join-Path $root 'assets\app.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Live2D Stage.lnk'

if (-not (Test-Path $exe)) { Write-Error "exe not found: $exe (run npm run pack first)" }

$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $exe
$s.WorkingDirectory = Split-Path -Parent $exe
if (Test-Path $icon) { $s.IconLocation = "$icon,0" }
$s.Description = 'Live2D Stage'
$s.Save()

Write-Host "created: $lnk"
Write-Host "target : $exe"
