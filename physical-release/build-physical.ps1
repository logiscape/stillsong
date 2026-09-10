<#
.SYNOPSIS
  Builds the Stillsong physical release: installer + every first-run
  component + licenses + source, assembled into a disc tree and optionally
  written to an image, a Blu-ray recorder, or a USB drive.

.DESCRIPTION
  Stages, in physical-release\out\:
    stage\components\   every fetched component (download cache; survives runs)
    disc-components\    the manifest's files only, hard-linked from the stage;
                        this is what goes on the media as components\
    disc\               everything else that goes on the media
    *.iso               when -Iso is given

  Steps (each idempotent; -SkipBuild reuses the newest installer):
    1. tauri build with tauri.physical.conf.json merged in (offline WebView2)
    2. stage-components.mjs          fetch + hash every component
    3. collect-licenses.ps1          license texts for all of it
    4. git archive                   Corresponding Source (GPL-3.0 §6a)
    5. disc root: autorun, launcher, setup scripts, README, hashes
    6. make-image.ps1                -Iso / -Burn / -Usb
    7. verify-disc.ps1               -VerifyDrive X:

  The working tree must be clean: the source archive must correspond to the
  binary. Pass -AllowDirty only for local experiments, never for a disc that
  leaves the building.

.EXAMPLE
  .\build-physical.ps1 -FromComponents "$env:LOCALAPPDATA\com.logiscape.stillsong\components" -Iso
  .\build-physical.ps1 -SkipBuild -Burn
  .\build-physical.ps1 -SkipBuild -Usb E: -VerifyDrive E:
#>
[CmdletBinding()]
param(
  [string]$OutDir,
  [string]$FromComponents,
  [switch]$SkipBuild,
  [string]$Installer,
  [switch]$Iso,
  [switch]$Burn,
  [int]$RecorderIndex = 0,
  [string]$Usb,
  [string]$VerifyDrive,
  [ValidateSet('bd-r', 'bd-r-dl', 'bdxl-100', 'bdxl-128')][string]$Media = 'bd-r-dl',
  [switch]$AllowDirty
)
$ErrorActionPreference = 'Stop'
# ($PSScriptRoot is empty while PowerShell 5.1 evaluates param defaults, hence here.)
if (-not $OutDir) { $OutDir = Join-Path $PSScriptRoot 'out' }
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stage = Join-Path $OutDir 'stage'
$components = Join-Path $stage 'components'
$disc = Join-Path $OutDir 'disc'
# Mirrors MEDIA in lib\layout.mjs (2048-byte sectors) and its 64 MB overhead margin.
$capacities = @{ 'bd-r' = 25025314816; 'bd-r-dl' = 50050629632; 'bdxl-100' = 100103356416; 'bdxl-128' = 128001769472 }
$overhead = 64MB
$wizardFree = 40GB

function Step($n, $text) { Write-Host ''; Write-Host ("=== {0}. {1}" -f $n, $text) -ForegroundColor Cyan }
function Fail($text) { throw $text }
function Rel($base, $path) { $path.Substring($base.Length).TrimStart('\', '/') -replace '\\', '/' }

# --- identity ---------------------------------------------------------------
$tauriConf = Get-Content -Raw (Join-Path $repo 'src-tauri\tauri.conf.json') | ConvertFrom-Json
$manifest = Get-Content -Raw (Join-Path $repo 'components.json') | ConvertFrom-Json
$version = $tauriConf.version
$commit = (& git -C $repo rev-parse --short HEAD).Trim()
$dirty = @(& git -C $repo status --porcelain --untracked-files=no).Count -gt 0
if ($dirty -and -not $AllowDirty) {
  Fail 'The working tree has uncommitted changes, so the source archive would not correspond to the build. Commit first, or pass -AllowDirty for a local trial.'
}
$stamp = if ($dirty) { "$commit-dirty" } else { $commit }
Write-Host ("Stillsong {0} ({1}), components manifest {2}" -f $version, $stamp, $manifest.manifestVersion)

# --- 1. installer -----------------------------------------------------------
Step 1 'Installer'
if (-not $Installer) {
  if (-not $SkipBuild) {
    Push-Location $repo
    try {
      & npx.cmd tauri build --config (Join-Path $PSScriptRoot 'tauri.physical.conf.json')
      if ($LASTEXITCODE -ne 0) { Fail "tauri build failed ($LASTEXITCODE)" }
    } finally { Pop-Location }
  }
  $Installer = Get-ChildItem (Join-Path $repo 'src-tauri\target\release\bundle\nsis') -Filter '*-setup.exe' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
  if (-not $Installer) { Fail 'No installer found under src-tauri\target\release\bundle\nsis' }
}
$Installer = (Resolve-Path $Installer).Path
$sig = Get-AuthenticodeSignature $Installer
Write-Host ("using {0}  ({1:N1} MB, signature: {2})" -f $Installer, ((Get-Item $Installer).Length / 1MB), $sig.Status)
if ($sig.Status -ne 'Valid') { Write-Warning 'The installer is not signed (or the signature is invalid). A shipped disc should carry a signed, timestamped installer; see README.md.' }
if ($SkipBuild) { Write-Warning 'Reusing an existing installer: make sure it was built with tauri.physical.conf.json (offline WebView2 installer), or a machine without WebView2 cannot install it offline.' }

# --- 2. components ------------------------------------------------------------
Step 2 'Components'
$stageArgs = @('--out', $components)
if ($FromComponents) { $stageArgs += @('--from-components', $FromComponents) }
& node (Join-Path $PSScriptRoot 'stage-components.mjs') @stageArgs
if ($LASTEXITCODE -ne 0) { Fail 'component staging did not complete' }

# --- 3.-5. disc root ------------------------------------------------------------
Step 3 'Licenses'
if (Test-Path $disc) { Remove-Item -Recurse -Force $disc }
New-Item -ItemType Directory -Force $disc | Out-Null
& (Join-Path $PSScriptRoot 'collect-licenses.ps1') -ComponentsStage $components -OutDir (Join-Path $disc 'licenses') -RepoRoot $repo

Step 4 'Source'
$srcDir = New-Item -ItemType Directory -Force (Join-Path $disc 'source')
$srcZip = Join-Path $srcDir ("stillsong-{0}-{1}-source.zip" -f $version, $stamp)
& git -C $repo archive --format=zip --prefix ("stillsong-{0}/" -f $version) -o $srcZip HEAD
if ($LASTEXITCODE -ne 0) { Fail 'git archive failed' }
Set-Content -Encoding utf8 (Join-Path $srcDir 'README.txt') @(
  "Stillsong $version - Corresponding Source",
  "",
  "This archive is the complete source code of the Stillsong application on",
  "this disc, at git commit $commit, including the build scripts and the",
  "physical-release tooling that produced the disc. It is provided under",
  "GPL-3.0 section 6(a). Build instructions are in its README.md and",
  "AGENTS.md; the exact third-party versions are pinned in package-lock.json,",
  "src-tauri/Cargo.lock and components.json.",
  "",
  "ComfyUI (GPL-3.0) is present on this disc as its own source archive:",
  "components/_downloads/<commit>.tar.gz.",
  "",
  "Project home: https://github.com/logiscape/stillsong"
)
if ($dirty) { Add-Content (Join-Path $srcDir 'README.txt') "`r`nWARNING: built from a modified working tree (local trial build; not for distribution)." }

Step 5 'Disc root'
Copy-Item -Recurse (Join-Path $PSScriptRoot 'disc\*') $disc
Copy-Item (Join-Path $repo 'src-tauri\icons\icon.ico') (Join-Path $disc 'Stillsong.ico')
$setup = Join-Path $disc 'setup'
$installerName = Split-Path -Leaf $Installer
Copy-Item $Installer (Join-Path $setup $installerName)
Copy-Item (Join-Path $repo 'components.json') (Join-Path $setup 'components.json')

# Components as the app expects them, straight from the manifest (already verified by step 2).
$compFiles = @()
$compBytes = 0L
foreach ($it in $manifest.items) {
  $rel = if ($it.extract) { '_downloads/' + (($it.url -split '/')[-1] -replace '%2B', '+') } else { $it.installPath }
  $compFiles += [pscustomobject]@{ rel = $rel; size = [long]$it.size; sha256 = $it.sha256.ToLowerInvariant() }
  $compBytes += [long]$it.size
}
foreach ($w in $manifest.python.wheels) {
  $compFiles += [pscustomobject]@{ rel = ($manifest.python.wheelhouse.TrimEnd('/') + '/' + $w.filename); size = [long]$w.size; sha256 = $w.sha256.ToLowerInvariant() }
  $compBytes += [long]$w.size
}
$neededBytes = $compBytes + $wizardFree

# The components tree that goes on the media: exactly the manifest's files,
# hard-linked from the stage (no second copy on disk). The stage is a cache
# that outlives manifest bumps, so packaging it wholesale could ship files
# the manifest, SHA256SUMS and the capacity check know nothing about.
$discComponents = Join-Path $OutDir 'disc-components'
if (Test-Path $discComponents) { Remove-Item -Recurse -Force $discComponents }
$linked = 0
foreach ($f in $compFiles) {
  $src = Join-Path $components ($f.rel -replace '/', '\')
  $dst = Join-Path $discComponents ($f.rel -replace '/', '\')
  if (-not (Test-Path -LiteralPath $src)) { Fail "staged component missing: $src" }
  New-Item -ItemType Directory -Force (Split-Path -Parent $dst) | Out-Null
  try {
    New-Item -ItemType HardLink -Path $dst -Target $src -ErrorAction Stop | Out-Null
    $linked++
  } catch {
    Copy-Item -LiteralPath $src -Destination $dst
  }
}
Write-Host ("components for the media: {0} files ({1} hard-linked, {2} copied) in {3}" -f $compFiles.Count, $linked, ($compFiles.Count - $linked), $discComponents)

# README placeholders
$readme = Join-Path $disc 'README.txt'
$text = Get-Content -Raw $readme
$text = $text.Replace('{{VERSION}}', $version).Replace('{{COMMIT}}', $stamp).Replace('{{MANIFEST_VERSION}}', $manifest.manifestVersion)
$text = $text.Replace('{{COMPONENTS_GB}}', ('{0:N0}' -f ($compBytes / 1e9))).Replace('{{NEEDED_GB}}', ('{0:N0}' -f ($neededBytes / 1e9)))
$text = $text.Replace('{{BUILD_DATE}}', (Get-Date -Format 'yyyy-MM-dd')).Replace('{{INSTALLER}}', $installerName)
Set-Content -Path $readme -Value $text -Encoding ascii -NoNewline

# Hash everything in the disc root (the manifest and sums file describe the rest).
$rootFiles = @()
$rootBytes = 0L
Get-ChildItem -Recurse -File -LiteralPath $disc | Sort-Object FullName | ForEach-Object {
  $path = Rel $disc $_.FullName
  if ($path -in @('setup/disc-manifest.json', 'SHA256SUMS')) { return }
  $rootFiles += [pscustomobject]@{ path = $path; size = [long]$_.Length; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
  $rootBytes += [long]$_.Length
}
$discManifest = [ordered]@{
  format = 1
  app = [ordered]@{ name = $tauriConf.productName; version = $version; commit = $stamp; installer = "setup/$installerName" }
  manifestVersion = $manifest.manifestVersion
  builtAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  wizardFreeBytes = [long]$wizardFree
  components = [ordered]@{ root = 'components'; bytes = $compBytes; files = $compFiles }
  files = $rootFiles
}
$json = $discManifest | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $setup 'disc-manifest.json'), $json, (New-Object Text.UTF8Encoding $false))
$sums = @()
foreach ($f in $compFiles) { $sums += ('{0}  components/{1}' -f $f.sha256, $f.rel) }
foreach ($f in $rootFiles) { $sums += ('{0}  {1}' -f $f.sha256, $f.path) }
[IO.File]::WriteAllText((Join-Path $disc 'SHA256SUMS'), (($sums -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))

$total = $compBytes + $rootBytes
Write-Host ''
Write-Host ("payload {0:N2} GB = components {1:N2} GB + disc root {2:N2} GB" -f ($total / 1e9), ($compBytes / 1e9), ($rootBytes / 1e9))
foreach ($k in @('bd-r', 'bd-r-dl', 'bdxl-100', 'bdxl-128')) {
  $room = $capacities[$k] - $total - $overhead
  $fits = if ($room -ge 0) { 'fits' } else { 'NO  ' }
  Write-Host ("  {0} {1,-9} headroom {2,8:N2} GB" -f $fits, $k, ($room / 1e9))
}
if ($capacities[$Media] - $total - $overhead -lt 0) { Fail "The payload does not fit the selected medium ($Media)." }
Write-Host ("a target PC needs {0:N0} GB free: {1:N0} GB of components plus the 40 GB the setup wizard checks for" -f ($neededBytes / 1e9), ($compBytes / 1e9))
Write-Host "disc root: $disc"

# --- 6. media -----------------------------------------------------------------
if ($Iso -or $Burn -or $Usb) {
  Step 6 'Media'
  $imgArgs = @{ DiscRoot = $disc; ComponentsDir = $discComponents; VolumeLabel = "Stillsong $version"; CapacityBytes = $capacities[$Media] }
  if ($Iso) { $imgArgs.Iso = Join-Path $OutDir ("Stillsong-{0}-{1}.iso" -f $version, $stamp) }
  if ($Burn) { $imgArgs.Burn = $true; $imgArgs.RecorderIndex = $RecorderIndex }
  if ($Usb) { $imgArgs.Usb = $Usb }
  & (Join-Path $PSScriptRoot 'make-image.ps1') @imgArgs
}

# --- 7. verify -----------------------------------------------------------------
if ($VerifyDrive) {
  Step 7 "Verify $VerifyDrive"
  $root = $VerifyDrive.TrimEnd('\') + '\'
  & (Join-Path $root 'setup\verify-disc.ps1') -Root $root
  if ($LASTEXITCODE -ne 0) { Fail 'verification failed' }
}
Write-Host ''
Write-Host 'done.' -ForegroundColor Green
