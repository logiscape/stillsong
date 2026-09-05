# Installs (mirrors) the ComfyUI-Stillsong overlay into a ComfyUI custom_nodes
# directory. Default target: the app's components copy - the same arrangement
# production uses. Restart ComfyUI after installing.
#
#   .\scripts\install-comfy-overlay.ps1                      # components copy
#   .\scripts\install-comfy-overlay.ps1 -Target <path>\custom_nodes

param(
    [string]$Target = (Join-Path $env:LOCALAPPDATA 'com.logiscape.stillsong\components\comfy-data\custom_nodes')
)

$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot '..\comfy-overlay\ComfyUI-Stillsong'
$src = (Resolve-Path $src).Path
if (-not (Test-Path $Target)) {
    throw "custom_nodes directory not found: $Target"
}
$dest = Join-Path $Target 'ComfyUI-Stillsong'

# /MIR keeps the install exact (removes files deleted from the overlay).
robocopy $src $dest /MIR /XD __pycache__ /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
    throw "robocopy failed with exit code $LASTEXITCODE"
}
Write-Host "Installed overlay -> $dest (restart ComfyUI to load it)"
