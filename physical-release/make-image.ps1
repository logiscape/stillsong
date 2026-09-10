<#
.SYNOPSIS
  Writes the assembled disc tree to a UDF image file, a Blu-ray recorder, or a
  USB drive, using only what Windows ships (IMAPI2 and robocopy).

.DESCRIPTION
  The disc has two roots that are kept apart on the build machine:
  `-DiscRoot` (installer, setup scripts, licenses, source, README) and
  `-ComponentsDir`, which lands on the media as `components\`. Everything
  under both is written, so pass the build's `out\disc-components` view
  (the manifest's files only, hard-linked from the stage), not the stage
  itself, which may hold files from older manifests.

  Optical media is written as UDF 2.50 only. ISO 9660 and Joliet cannot hold a
  file larger than 4 GiB and IMAPI does not implement ISO 9660 level 3, so the
  model files rule them out; every Windows since Vista reads UDF 2.50 natively.

  Burning has no progress bar (IMAPI's events are awkward from PowerShell);
  a 25 GB burn at 4-6x takes roughly 20-40 minutes. Verify afterwards with
  `disc\setup\verify-disc.ps1 -Root <drive>:\`.

.EXAMPLE
  .\make-image.ps1 -DiscRoot out\disc -ComponentsDir out\disc-components -Iso out\Stillsong.iso
  .\make-image.ps1 -DiscRoot out\disc -ComponentsDir out\disc-components -Burn
  .\make-image.ps1 -DiscRoot out\disc -ComponentsDir out\disc-components -Usb E:
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$DiscRoot,
  [Parameter(Mandatory)][string]$ComponentsDir,
  [string]$VolumeLabel = 'Stillsong',
  [string]$Iso,
  [switch]$Burn,
  [int]$RecorderIndex = 0,
  [switch]$ListRecorders,
  [switch]$Eject,
  [string]$Usb,
  # Capacity the image is laid out for; only matters for the free-block budget.
  [long]$CapacityBytes = 50050629632
)
$ErrorActionPreference = 'Stop'
$DiscRoot = (Resolve-Path $DiscRoot).Path
$ComponentsDir = (Resolve-Path $ComponentsDir).Path

$mediaNames = @{ 0 = 'unknown'; 1 = 'CD-ROM'; 2 = 'CD-R'; 3 = 'CD-RW'; 4 = 'DVD-ROM'; 5 = 'DVD-RAM'; 6 = 'DVD+R'; 7 = 'DVD+RW'; 8 = 'DVD+R DL'; 9 = 'DVD-R'; 10 = 'DVD-RW'; 11 = 'DVD-R DL'; 12 = 'disk'; 13 = 'DVD+RW DL'; 14 = 'HD DVD-ROM'; 15 = 'HD DVD-R'; 16 = 'HD DVD-RAM'; 17 = 'BD-ROM'; 18 = 'BD-R'; 19 = 'BD-RE' }

function Get-TreeBytes($dir) {
  $sum = 0L
  Get-ChildItem -Recurse -File -LiteralPath $dir | ForEach-Object { $sum += $_.Length }
  $sum
}

if ($ListRecorders) {
  $dm = New-Object -ComObject IMAPI2.MsftDiscMaster2
  if ($dm.Count -eq 0) { Write-Host 'No optical recorders found.'; return }
  for ($i = 0; $i -lt $dm.Count; $i++) {
    $r = New-Object -ComObject IMAPI2.MsftDiscRecorder2
    $r.InitializeDiscRecorder($dm.Item($i))
    Write-Host ("[{0}] {1} {2}  ({3})" -f $i, $r.VendorId.Trim(), $r.ProductId.Trim(), ($r.VolumePathNames -join ', '))
  }
  return
}
if (-not ($Iso -or $Burn -or $Usb)) { throw 'Nothing to do: pass -Iso <file>, -Burn, or -Usb <drive:> (or -ListRecorders).' }

$rootBytes = Get-TreeBytes $DiscRoot
$compBytes = Get-TreeBytes $ComponentsDir
$total = $rootBytes + $compBytes
Write-Host ("payload: {0:N2} GB ({1:N2} GB components + {2:N2} GB disc root)" -f ($total / 1e9), ($compBytes / 1e9), ($rootBytes / 1e9))

# --- USB: plain copy onto an exFAT/NTFS volume -----------------------------
if ($Usb) {
  $letter = $Usb.TrimEnd(':', '\')
  $vol = Get-Volume -DriveLetter $letter
  if ($vol.FileSystem -notin @('exFAT', 'NTFS')) {
    throw "Drive $letter is $($vol.FileSystem). FAT32 cannot hold files over 4 GB; format the drive as exFAT (or NTFS) first."
  }
  if ($vol.SizeRemaining -lt $total) {
    throw ("Drive {0} has {1:N1} GB free; {2:N1} GB is needed." -f $letter, ($vol.SizeRemaining / 1e9), ($total / 1e9))
  }
  Write-Host "copying to ${letter}:\ ..."
  & robocopy $DiscRoot "${letter}:\" /E /R:3 /W:5 /NP /NFL /NDL /NJH | Out-Host
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE) copying the disc root" }
  & robocopy $ComponentsDir "${letter}:\components" /E /R:3 /W:5 /NP /NFL /NDL /NJH | Out-Host
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE) copying components" }
  Write-Host "done. Verify with:  powershell -File `"${letter}:\setup\verify-disc.ps1`""
}

if (-not ($Iso -or $Burn)) { return }

# --- Optical: build the UDF file system image in IMAPI2FS ------------------
function New-Image {
  $fsi = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
  $fsi.FileSystemsToCreate = 4           # FsiFileSystemUDF only (see .DESCRIPTION)
  $fsi.UDFRevision = 0x250
  $fsi.VolumeName = $VolumeLabel
  $fsi.FreeMediaBlocks = [int][math]::Ceiling($CapacityBytes / 2048)
  $fsi.StrictFileSystemCompliance = $false
  $fsi.UseRestrictedCharacterSet = $false
  Write-Host 'laying out the file system (this walks every file once)...'
  $fsi.Root.AddTree($DiscRoot, $false)
  $fsi.Root.AddDirectory('components')          # returns nothing; fetch the item back
  $fsi.Root.Item('components').AddTree($ComponentsDir, $false)
  $result = $fsi.CreateResultImage()
  Write-Host ("image: {0:N0} blocks x {1} bytes = {2:N2} GB" -f $result.TotalBlocks, $result.BlockSize, ($result.TotalBlocks * $result.BlockSize / 1e9))
  $result
}

if ($Iso) {
  if (-not ('Stillsong.IsoWriter' -as [type])) {
    $cp = New-Object CodeDom.Compiler.CompilerParameters
    $cp.CompilerOptions = '/unsafe'
    Add-Type -CompilerParameters $cp -TypeDefinition @'
namespace Stillsong {
  public static class IsoWriter {
    public unsafe static void Write(string path, object stream, int blockSize, int totalBlocks) {
      int read = 0;
      byte[] buf = new byte[blockSize];
      System.IntPtr pRead = (System.IntPtr)(&read);
      var s = (System.Runtime.InteropServices.ComTypes.IStream)stream;
      using (var o = System.IO.File.Create(path)) {
        while (totalBlocks-- > 0) {
          s.Read(buf, blockSize, pRead);
          o.Write(buf, 0, read);
        }
      }
    }
  }
}
'@
  }
  $img = New-Image
  $isoPath = [IO.Path]::GetFullPath($Iso)
  New-Item -ItemType Directory -Force (Split-Path -Parent $isoPath) | Out-Null
  Write-Host "writing $isoPath ..."
  [Stillsong.IsoWriter]::Write($isoPath, $img.ImageStream, $img.BlockSize, $img.TotalBlocks)
  Write-Host ("wrote {0:N2} GB" -f ((Get-Item $isoPath).Length / 1e9))
}

if ($Burn) {
  $dm = New-Object -ComObject IMAPI2.MsftDiscMaster2
  if ($dm.Count -eq 0) { throw 'No optical recorder found.' }
  $rec = New-Object -ComObject IMAPI2.MsftDiscRecorder2
  $rec.InitializeDiscRecorder($dm.Item($RecorderIndex))
  $fmt = New-Object -ComObject IMAPI2.MsftDiscFormat2Data
  $fmt.Recorder = $rec
  $fmt.ClientName = 'Stillsong physical release'
  $fmt.ForceMediaToBeClosed = $true      # finalize: no further sessions, best compatibility
  if (-not $fmt.IsCurrentMediaSupported($rec)) { throw 'The inserted medium is not writable by this recorder (or the tray is empty).' }
  $type = [int]$fmt.CurrentPhysicalMediaType
  Write-Host ("recorder: {0} {1}; medium: {2}; free: {3:N2} GB" -f $rec.VendorId.Trim(), $rec.ProductId.Trim(), $mediaNames[$type], ($fmt.FreeSectorsOnMedia * 2048 / 1e9))
  if ($type -notin @(18, 19)) { throw "Expected a BD-R or BD-RE; found $($mediaNames[$type])." }
  if (-not $fmt.MediaHeuristicallyBlank) { throw 'The disc is not blank.' }
  $img = New-Image
  if ($fmt.FreeSectorsOnMedia -lt $img.TotalBlocks) {
    throw ("The disc has {0:N0} free sectors; the image needs {1:N0}. Use a dual-layer (50 GB) BD-R." -f $fmt.FreeSectorsOnMedia, $img.TotalBlocks)
  }
  Write-Host 'burning (no progress display; the drive light shows activity)...'
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $fmt.Write($img.ImageStream)
  Write-Host ("burn finished in {0:N0} minutes" -f $sw.Elapsed.TotalMinutes)
  if ($Eject) { $rec.EjectMedia() }
  Write-Host 'Re-insert the disc and run its setup\verify-disc.ps1 before labelling it.'
}
