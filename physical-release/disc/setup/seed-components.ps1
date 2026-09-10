<#
  Stillsong disc setup.

  Copies the studio components from this disc into the folder where
  Stillsong's setup wizard expects to find them, checking every file's
  hash on the way, records that folder for the app, and then runs the
  normal Stillsong installer. Nothing is downloaded, and nothing on this
  disc is executed except the installer.

  Run it through Install-Stillsong.cmd, or directly:
    powershell -ExecutionPolicy Bypass -File seed-components.ps1 [-Destination <folder>] [-SkipInstaller] [-Yes]
#>
[CmdletBinding()]
param(
  [string]$Destination,
  [switch]$SkipInstaller,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$setupDir = $PSScriptRoot
$discRoot = Split-Path -Parent $setupDir
$manifest = Get-Content -Raw (Join-Path $setupDir 'disc-manifest.json') | ConvertFrom-Json
$appData = Join-Path $env:APPDATA 'com.logiscape.stillsong'
$pointer = Join-Path $appData 'components-dir.txt'
$defaultDest = Join-Path $env:LOCALAPPDATA 'com.logiscape.stillsong\components'
$wizardFree = [long]$manifest.wizardFreeBytes

function GB($b) { '{0:N1} GB' -f ($b / 1e9) }
function Say($t) { Write-Host $t }
function Head($t) { Write-Host ''; Write-Host $t -ForegroundColor Cyan }

Say ''
Say ("  Stillsong {0} - setup from disc" -f $manifest.app.version)
Say '  Everything Stillsong needs is on this disc. This will:'
Say '    1. copy the studio components to your computer (checking each file),'
Say '    2. run the Stillsong installer.'
Say '  Then open Stillsong and its setup wizard finishes without the internet.'

# --- where -------------------------------------------------------------------
Head 'Where should the components live?'
if (-not $Destination) {
  $Destination = $defaultDest
  if (Test-Path $pointer) {
    $prev = (Get-Content -Raw $pointer).Trim()
    if ($prev) { $Destination = $prev }
  }
  Say ("  They are about {0}. The usual place is:" -f (GB $manifest.components.bytes))
  Say "    $Destination"
  if (-not $Yes) {
    $answer = Read-Host '  Press Enter to use it, or type a different folder (a second drive is fine)'
    if ($answer.Trim()) { $Destination = $answer.Trim().Trim('"') }
  }
}
if (-not [IO.Path]::IsPathRooted($Destination)) { throw "Please give a full path (like D:\Stillsong\components), not '$Destination'." }
$Destination = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $Destination | Out-Null

$alreadySetUp = Test-Path (Join-Path $Destination '.install-complete')
if ($alreadySetUp) {
  Say '  Stillsong has already finished setting up in this folder, so there is nothing to copy.'
  Say '  Only the installer will run (to install or update the app itself).'
}

# --- room ----------------------------------------------------------------------
$files = @($manifest.components.files)
$toCopy = @()
$bytesToCopy = 0L
$kept = 0
if (-not $alreadySetUp) {
  # Files already in the folder (an earlier run of this script) are re-hashed,
  # not trusted by size: the app itself accepts whatever it finds there, so
  # this script is the only integrity check the components ever get.
  $existing = @($files | Where-Object { Test-Path (Join-Path $Destination ($_.rel -replace '/', '\')) })
  if ($existing.Count -gt 0) { Say ("  Checking {0} file(s) already in that folder..." -f $existing.Count) }
  $checked = 0
  foreach ($f in $files) {
    $dest = Join-Path $Destination ($f.rel -replace '/', '\')
    if (Test-Path $dest) {
      $checked++
      Write-Progress -Activity 'Checking files already in place' -Status (Split-Path -Leaf $f.rel) -PercentComplete ([int](100 * $checked / $existing.Count))
      $ok = ((Get-Item $dest).Length -eq [long]$f.size)
      if ($ok) { $ok = ((Get-FileHash -Algorithm SHA256 -LiteralPath $dest).Hash.ToLowerInvariant() -eq $f.sha256) }
      if ($ok) { $kept++; continue }
      Remove-Item -Force -LiteralPath $dest    # wrong size or content: replace it from the disc
    }
    $toCopy += $f
    $bytesToCopy += [long]$f.size
  }
  Write-Progress -Activity 'Checking files already in place' -Completed
  if ($kept -gt 0) { Say ("  {0} already in place and verified." -f $kept) }
  $need = $bytesToCopy + $wizardFree
  try {
    $drive = New-Object IO.DriveInfo(([IO.Path]::GetPathRoot($Destination)))
    $free = $drive.AvailableFreeSpace
  } catch { $free = $null }
  if ($free -ne $null) {
    Say ("  Free on that drive: {0}. Needed: {1} ({2} to copy, plus the 40 GB of working room the setup wizard checks for before unpacking)." -f (GB $free), (GB $need), (GB $bytesToCopy))
    if ($free -lt $need) {
      throw "Not enough room. Free up space or choose a folder on a larger drive, then run Install-Stillsong.cmd again."
    }
  }
}

# --- copy ----------------------------------------------------------------------
function Copy-Verified($src, $dst, $expectedSha, $expectedSize, $label, $doneBefore, $totalBytes) {
  $tmp = "$dst.part"
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  $sha = [Security.Cryptography.SHA256]::Create()
  $in = [IO.File]::OpenRead($src)
  $out = [IO.File]::Create($tmp)
  try {
    $buf = New-Object byte[] (4MB)
    $copied = 0L
    $lastTick = 0
    while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
      $out.Write($buf, 0, $n)
      [void]$sha.TransformBlock($buf, 0, $n, $null, 0)
      $copied += $n
      $tick = [Environment]::TickCount
      if ($tick - $lastTick -gt 500) {
        $lastTick = $tick
        $pct = [int](100 * ($doneBefore + $copied) / $totalBytes)
        Write-Progress -Activity 'Copying the studio components' -Status ("{0}  ({1} of {2})" -f $label, (GB ($doneBefore + $copied)), (GB $totalBytes)) -PercentComplete $pct
      }
    }
    [void]$sha.TransformFinalBlock($buf, 0, 0)
  } finally {
    $in.Dispose(); $out.Dispose()
  }
  $hex = ([BitConverter]::ToString($sha.Hash) -replace '-', '').ToLowerInvariant()
  if ($copied -ne [long]$expectedSize -or $hex -ne $expectedSha) {
    Remove-Item -Force $tmp -ErrorAction SilentlyContinue
    throw "The copy of '$label' did not match the disc's record of it. The disc may be scratched or the drive may be faulty: run Verify-Disc.cmd, and try again on another drive if it reports errors."
  }
  Move-Item -Force $tmp $dst
}

if (-not $alreadySetUp) {
  Head ("Copying {0} file(s), {1}" -f $toCopy.Count, (GB $bytesToCopy))
  if ($toCopy.Count -gt 0) {
    Say '  From a Blu-ray disc this takes 15 to 30 minutes. You can keep using the computer.'
    $done = 0L
    foreach ($f in $toCopy) {
      $src = Join-Path (Join-Path $discRoot $manifest.components.root) ($f.rel -replace '/', '\')
      if (-not (Test-Path $src)) { throw "This disc is missing '$($f.rel)'. Run Verify-Disc.cmd." }
      $dst = Join-Path $Destination ($f.rel -replace '/', '\')
      Copy-Verified $src $dst $f.sha256 $f.size (Split-Path -Leaf $f.rel) $done $bytesToCopy
      $done += [long]$f.size
    }
    Write-Progress -Activity 'Copying the studio components' -Completed
  } else {
    Say '  Everything is already in place.'
  }
  Say ("  {0} verified in {1}" -f $files.Count, $Destination)

  # Tell the app where they are, the same way its own "Where should they live?"
  # step does (see supervisor.rs: components-dir.txt, and the registry value the
  # uninstaller reads). The wizard will show this folder pre-selected.
  New-Item -ItemType Directory -Force -Path $appData | Out-Null
  [IO.File]::WriteAllText($pointer, $Destination, (New-Object Text.UTF8Encoding $false))
  & reg add 'HKCU\Software\Logiscape\Stillsong' /v ComponentsDir /t REG_SZ /d $Destination /f | Out-Null
}

# --- installer --------------------------------------------------------------
if ($SkipInstaller) {
  Head 'Skipping the installer, as asked.'
} else {
  Head 'Running the Stillsong installer'
  $installer = Join-Path $discRoot ($manifest.app.installer -replace '/', '\')
  if (-not (Test-Path $installer)) { throw "The installer is missing from this disc ($($manifest.app.installer)). Run Verify-Disc.cmd." }
  $p = Start-Process -FilePath $installer -PassThru -Wait
  switch ($p.ExitCode) {
    0 { }
    1 { throw 'The installer was cancelled. Run Install-Stillsong.cmd again when ready; the copied components are kept.' }
    default { throw "The installer reported an error (code $($p.ExitCode))." }
  }
}

Head 'Done.'
Say '  Open Stillsong from the Start menu. Its setup wizard will find the components'
Say '  already in place: press through, and it unpacks and checks the studio'
Say '  (a few minutes). Nothing is downloaded, now or ever.'
Say ''
exit 0
