# Launches the app's components copy of ComfyUI standalone, exactly as the
# supervisor spawns it (same interpreter, --base-directory, flags), for dev
# work and the live test suite (which defaults to http://127.0.0.1:8000).
#
#   .\scripts\dev-comfy.ps1              # port 8000
#   .\scripts\dev-comfy.ps1 -Port 8188
#   .\scripts\dev-comfy.ps1 -ReserveVram 8          # Patient-tier emulation (16-8 = "8 GB card")
#   .\scripts\dev-comfy.ps1 -ExtraArgs '--disable-dynamic-vram'
#
# -ReserveVram N tells ComfyUI to treat N GB of VRAM as off-limits (feeds
# EXTRA_RESERVED_VRAM, which the dynamic-VRAM accounting honors) - the
# emulation knob for the Patient-tier measurement pass.
#
# Do not run this while the app (or another ComfyUI) is rendering - one GPU,
# one renderer at a time (the same rule the app's VRAM arbiter enforces).

param(
    [int]$Port = 8000,
    [string]$Components = (Join-Path $env:LOCALAPPDATA 'com.logiscape.stillsong\components'),
    [double]$ReserveVram = 0,
    [string[]]$ExtraArgs = @()
)

$ErrorActionPreference = 'Stop'
$python = Join-Path $Components 'python-env\Scripts\python.exe'
$mainPy = Join-Path $Components 'ComfyUI\main.py'
$comfyData = Join-Path $Components 'comfy-data'
if (-not (Test-Path $python) -or -not (Test-Path $mainPy)) {
    throw "Components ComfyUI not found under $Components - run the app's first-run setup."
}
$listening = $null
try { $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop } catch {}
if ($listening) {
    throw "Port $Port is already in use (another ComfyUI?). Stop it or pass -Port."
}

$comfyArgs = @('--port', $Port, '--base-directory', $comfyData, '--disable-api-nodes')
if ($ReserveVram -gt 0) { $comfyArgs += @('--reserve-vram', $ReserveVram) }
if ($ExtraArgs.Count -gt 0) { $comfyArgs += $ExtraArgs }

$env:HF_HUB_OFFLINE = '1'
Set-Location $Components
& $python -s $mainPy @comfyArgs
