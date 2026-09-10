<#
.SYNOPSIS
  Assembles the licenses/ folder for the physical release.

.DESCRIPTION
  A disc redistributes every component the app would otherwise download, so
  every component's license text has to travel with it. This script gathers:

    licenses/Stillsong/   the app's own GPL-3.0 text and the notices the
                          repository already maintains
    licenses/runtimes/    LICENSE / COPYING / NOTICE files found inside the
                          uv, CPython, ComfyUI and llama.cpp archives
    licenses/python/      per-wheel license texts pulled from each wheel's
                          .dist-info (METADATA when a wheel carries no file),
                          plus an INDEX.md
    licenses/models/      MiniMax-Music3 Community License, Apache-2.0 for
    licenses/runtimes/NVIDIA-CUDA/  Gemma 4, and the CUDA EULA — fetched from
                          the pinned URLs in licenses.json and hash-checked

  Nothing here is interpreted; it is the notice-and-copy obligation of each
  license, discharged mechanically. THIRD-PARTY-NOTICES.md remains the human
  explanation.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ComponentsStage,
  [Parameter(Mandatory)][string]$OutDir,
  [string]$RepoRoot,
  [string]$DownloadCache
)
$ErrorActionPreference = 'Stop'
if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
if (-not $DownloadCache) { $DownloadCache = Join-Path $PSScriptRoot 'out\stage\licenses' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$manifest = Get-Content -Raw (Join-Path $RepoRoot 'components.json') | ConvertFrom-Json
$extras = (Get-Content -Raw (Join-Path $PSScriptRoot 'licenses.json') | ConvertFrom-Json).extra
$licenseName = '^(LICENSE|LICENCE|COPYING|NOTICE|AUTHORS|COPYRIGHT)'
# Windows' own bsdtar, by full path: a Git Bash / MSYS tar earlier on PATH reads "C:" as a host name.
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'

function New-Dir($p) { New-Item -ItemType Directory -Force -Path $p | Out-Null; $p }
function Rel($base, $path) { $path.Substring($base.Length).TrimStart('\', '/') -replace '\\', '/' }

if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
New-Dir $OutDir | Out-Null

# --- Stillsong itself ------------------------------------------------------
$app = New-Dir (Join-Path $OutDir 'Stillsong')
Copy-Item (Join-Path $RepoRoot 'LICENSE') (Join-Path $app 'LICENSE-GPL-3.0.txt')
Copy-Item (Join-Path $RepoRoot 'THIRD-PARTY-LICENSES.txt') $app
Copy-Item (Join-Path $RepoRoot 'THIRD-PARTY-NOTICES.md') $app
Copy-Item (Join-Path $RepoRoot 'docs\THIRD-PARTY-PYTHON.md') $app
Copy-Item (Join-Path $RepoRoot 'examples\LICENSE.md') (Join-Path $app 'example-songs-LICENSE.md')
Write-Host "Stillsong: 5 files"

# --- Runtime archives -----------------------------------------------------
$runtimes = New-Dir (Join-Path $OutDir 'runtimes')
$tmp = New-Dir (Join-Path ([IO.Path]::GetTempPath()) ("stillsong-licenses-" + [guid]::NewGuid().ToString('N')))
try {
  foreach ($item in $manifest.items | Where-Object { $_.extract }) {
    $archive = Join-Path $ComponentsStage ('_downloads\' + (($item.url -split '/')[-1] -replace '%2B', '+'))
    if (-not (Test-Path $archive)) { throw "staged archive missing: $archive (run stage-components.mjs first)" }
    $dest = New-Dir (Join-Path $runtimes $item.id)
    $found = 0
    if ($item.extract -eq 'zip') {
      $zip = [IO.Compression.ZipFile]::OpenRead($archive)
      try {
        foreach ($e in $zip.Entries) {
          if ($e.FullName.EndsWith('/')) { continue }   # directory entry
          $parts = $e.FullName -split '/'
          if ($parts.Count -gt 4 -or -not ($parts[-1] -match $licenseName)) { continue }
          $target = Join-Path $dest ($e.FullName -replace '/', '\')
          New-Dir (Split-Path -Parent $target) | Out-Null
          [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true)
          $found++
        }
      } finally { $zip.Dispose() }
    } else {
      $members = @(& $tar -tzf $archive | Where-Object {
        $parts = $_ -split '/'
        ($parts.Count -le 4) -and ($parts[-1] -match $licenseName) -and (-not $_.EndsWith('/'))
      })
      if ($members.Count -gt 0) {
        $x = New-Dir (Join-Path $tmp $item.id)
        & $tar -xzf $archive -C $x @members
        if ($LASTEXITCODE -ne 0) { throw "tar failed extracting license files from $archive" }
        Get-ChildItem -Recurse -File $x | ForEach-Object {
          $target = Join-Path $dest (Rel $x $_.FullName)
          New-Dir (Split-Path -Parent $target) | Out-Null
          Copy-Item $_.FullName $target
          $found++
        }
      }
    }
    $lic = if ($item.license) { $item.license } else { '(see THIRD-PARTY-NOTICES.md)' }
    Set-Content -Encoding utf8 (Join-Path $dest 'SOURCE.txt') @(
      "$($item.id)",
      "License: $lic",
      "Fetched from: $($item.url)",
      "sha256: $($item.sha256)",
      "",
      "License files found inside the archive: $found"
    )
    Write-Host ("runtime {0}: {1} license file(s)" -f $item.id, $found)
  }
} finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }

# --- Python wheels --------------------------------------------------------
$py = New-Dir (Join-Path $OutDir 'python')
$index = @('# Python packages', '', 'Every wheel the setup wizard installs, with the license text found in its `.dist-info`. `THIRD-PARTY-PYTHON.md` under `../Stillsong/` is the human-readable summary.', '', '| Package | Version | License | Files |', '|---|---|---|---|')
$wheelhouse = Join-Path $ComponentsStage ($manifest.python.wheelhouse -replace '/', '\')
foreach ($w in $manifest.python.wheels) {
  $whl = Join-Path $wheelhouse $w.filename
  if (-not (Test-Path $whl)) { throw "staged wheel missing: $whl (run stage-components.mjs first)" }
  $dest = New-Dir (Join-Path $py ("{0}-{1}" -f $w.name, $w.version))
  $files = @()
  $zip = [IO.Compression.ZipFile]::OpenRead($whl)
  try {
    $meta = $null
    foreach ($e in $zip.Entries) {
      if ($e.FullName.EndsWith('/')) { continue }   # directory entry
      if ($e.FullName -notmatch '^[^/]+\.dist-info/(.+)$') { continue }
      $inner = $Matches[1]
      $leaf = ($inner -split '/')[-1]
      if ($inner -eq 'METADATA') { $meta = $e; continue }
      if ($inner -match '^licenses?/' -or $leaf -match $licenseName) {
        $target = Join-Path $dest ($inner -replace '/', '\')
        New-Dir (Split-Path -Parent $target) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true)
        $files += $inner
      }
    }
    if ($files.Count -eq 0 -and $meta) {
      [IO.Compression.ZipFileExtensions]::ExtractToFile($meta, (Join-Path $dest 'METADATA.txt'), $true)
      $files += 'METADATA.txt (no license file in the wheel; license is named in its metadata)'
    }
  } finally { $zip.Dispose() }
  $index += ('| {0} | {1} | {2} | {3} |' -f $w.name, $w.version, $w.license, ($files -join ', '))
}
Set-Content -Encoding utf8 (Join-Path $py 'INDEX.md') $index
Write-Host ("python: {0} wheels" -f $manifest.python.wheels.Count)

# --- Model and runtime licenses that live outside the archives -------------
New-Dir $DownloadCache | Out-Null
foreach ($x in $extras) {
  $cached = Join-Path $DownloadCache $x.id
  $ok = $false
  if (Test-Path $cached) {
    $ok = ((Get-Item $cached).Length -eq $x.size) -and ((Get-FileHash -Algorithm SHA256 $cached).Hash.ToLowerInvariant() -eq $x.sha256)
  }
  if (-not $ok) {
    Write-Host "fetching $($x.id) from $($x.url)"
    Invoke-WebRequest -UseBasicParsing -Uri $x.url -OutFile $cached
    $len = (Get-Item $cached).Length
    $hash = (Get-FileHash -Algorithm SHA256 $cached).Hash.ToLowerInvariant()
    if ($len -ne $x.size -or $hash -ne $x.sha256) {
      Remove-Item $cached
      throw "$($x.id): downloaded file does not match licenses.json (size $len, sha256 $hash). If the upstream text legitimately changed, re-pin it there after reading the new version."
    }
  }
  $target = Join-Path $OutDir ($x.dest -replace '/', '\')
  New-Dir (Split-Path -Parent $target) | Out-Null
  Copy-Item $cached $target
  Write-Host ("license {0} -> {1}" -f $x.id, $x.dest)
}

Set-Content -Encoding utf8 (Join-Path $OutDir 'models\Gemma-4\NOTICE.txt') @(
  'Gemma 4 12B (instruction-tuned), GGUF conversion published by ggml-org',
  'https://huggingface.co/ggml-org/gemma-4-12B-it-GGUF',
  '',
  'Gemma is provided by Google under the Apache License, Version 2.0',
  '(https://ai.google.dev/gemma/apache_2). The license text is in',
  'LICENSE-Apache-2.0.txt beside this notice. Stillsong redistributes the',
  'weights unmodified; the pinned files and hashes are listed in',
  'setup/components.json on this disc.'
)
Set-Content -Encoding utf8 (Join-Path $OutDir 'models\MiniMax-Music3\NOTICE.txt') @(
  'MiniMax-Music3 weights (Comfy-Org repack of MiniMaxAI/MiniMax-Music3)',
  'https://huggingface.co/Comfy-Org/MiniMax-Music-3',
  'https://huggingface.co/MiniMaxAI/MiniMax-Music3',
  '',
  'Governed by the MiniMax-Music3 Community License in LICENSE.txt beside',
  'this notice, whose section 1 requires that notice to accompany every copy.',
  'Stillsong is a free, non-commercial GPL application; it credits',
  'MiniMax-Music3 on its About screen and writes the machine-generated',
  'disclosure the license asks for into every exported song.'
)
Set-Content -Encoding utf8 (Join-Path $OutDir 'runtimes\NVIDIA-CUDA\NOTICE.txt') @(
  'NVIDIA CUDA runtime libraries (cudart and companions)',
  '',
  'Present in two places on this disc: the llama.cpp "cudart" release zip',
  '(components/_downloads/) and inside the PyTorch wheel',
  '(components/_downloads/wheelhouse/). Both are the unmodified files',
  'published by ggml-org and by PyTorch respectively. They are redistributed',
  'here as part of the Stillsong application under the CUDA Toolkit EULA',
  '(EULA.pdf beside this notice), Attachment A, and are not offered as a',
  'stand-alone product.'
)

# --- Index ---------------------------------------------------------------
Set-Content -Encoding utf8 (Join-Path $OutDir 'README.md') @(
  '# Licenses',
  '',
  'Stillsong is free software under the GNU General Public License v3.0.',
  'Everything else on this disc is a third-party component that the online',
  'installer would download at first run; here it is redistributed so that',
  'setup can finish on a computer with no internet connection. This folder',
  'carries the license of every one of them.',
  '',
  '| Folder | What | Terms |',
  '|---|---|---|',
  '| `Stillsong/` | The app, its bundled libraries and fonts, the example songs | GPL-3.0; per-library MIT/Apache/ISC/OFL; CC BY 4.0 |',
  '| `runtimes/` | uv, CPython (python-build-standalone), ComfyUI, llama.cpp, CUDA runtime | MIT/Apache-2.0, PSF-2.0, GPL-3.0, MIT, NVIDIA CUDA EULA |',
  '| `python/` | Every Python wheel in the wheelhouse (PyTorch and ComfyUI''s dependencies) | Per package, see `python/INDEX.md` |',
  '| `models/` | MiniMax-Music3 and Gemma 4 weights | MiniMax-Music3 Community License; Apache-2.0 |',
  '',
  'Corresponding source for the GPL-licensed software on this disc',
  '(Stillsong itself, and ComfyUI, which is shipped as its source archive)',
  'is in the `source/` folder at the disc root, per GPL-3.0 section 6(a).',
  '',
  'Read `Stillsong/THIRD-PARTY-NOTICES.md` for the explanation of how each',
  'license applies.'
)
Write-Host "licenses assembled in $OutDir"
