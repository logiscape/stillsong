<#
  Checks every file on this disc (or a copy of it) against the sizes and
  SHA-256 hashes recorded in setup\disc-manifest.json when it was made.
  Reads only; changes nothing. Exit code 0 when everything matches.

    powershell -ExecutionPolicy Bypass -File verify-disc.ps1 [-Root <disc root>] [-Quick]

  -Quick compares sizes only (seconds instead of minutes).
#>
[CmdletBinding()]
param(
  [string]$Root,
  [switch]$Quick
)
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path $Root).Path
$manifest = Get-Content -Raw (Join-Path $Root 'setup\disc-manifest.json') | ConvertFrom-Json

$entries = @()
foreach ($f in $manifest.components.files) { $entries += [pscustomobject]@{ path = ($manifest.components.root + '/' + $f.rel); size = [long]$f.size; sha256 = $f.sha256 } }
foreach ($f in $manifest.files) { $entries += [pscustomobject]@{ path = $f.path; size = [long]$f.size; sha256 = $f.sha256 } }
$totalBytes = 0L
foreach ($e in $entries) { $totalBytes += $e.size }

Write-Host ("Checking {0} files ({1:N1} GB) under {2}" -f $entries.Count, ($totalBytes / 1e9), $Root)
if ($Quick) { Write-Host 'Quick mode: sizes only.' }
$bad = @()
$done = 0L
$sw = [Diagnostics.Stopwatch]::StartNew()
foreach ($e in $entries) {
  $full = Join-Path $Root ($e.path -replace '/', '\')
  if (-not (Test-Path -LiteralPath $full)) { $bad += "missing   $($e.path)"; continue }
  $len = (Get-Item -LiteralPath $full).Length
  if ($len -ne $e.size) { $bad += "size      $($e.path) ($len, expected $($e.size))"; $done += $e.size; continue }
  if (-not $Quick) {
    Write-Progress -Activity 'Verifying' -Status $e.path -PercentComplete ([int](100 * $done / $totalBytes))
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $full).Hash.ToLowerInvariant()
    if ($hash -ne $e.sha256) { $bad += "hash      $($e.path)" }
  }
  $done += $e.size
}
Write-Progress -Activity 'Verifying' -Completed

if ($bad.Count -eq 0) {
  Write-Host ("All {0} files match ({1:N0} s)." -f $entries.Count, $sw.Elapsed.TotalSeconds) -ForegroundColor Green
  exit 0
}
Write-Host ("{0} problem(s):" -f $bad.Count) -ForegroundColor Red
$bad | ForEach-Object { Write-Host "  $_" }
Write-Host 'This copy is damaged or incomplete. Try another drive, or another disc.'
exit 1
