# Samples memory while a measurement run is in flight: GPU dedicated + shared
# usage, system commit/available/standby cache, and the Stillsong stack's
# working set vs private commit (python = ComfyUI, llama-server, Stillsong).
#
#   .\scripts\mem-sampler.ps1                      # 2 s ticks until Ctrl+C
#   .\scripts\mem-sampler.ps1 -IntervalSec 5 -OutFile run1.csv
#
# Reading the numbers under dynamic VRAM (ComfyUI >= 2026): model weights are
# file-backed mappings the OS can reclaim, so a huge working set / standby
# cache is HEALTHY and reclaimable - the number to hold against the Patient
# tier's 32 GB budget is stackPrivateGB (+ sysCommitGB for the whole picture).
# gpuSharedMB creeping up during a render means WDDM is spilling past
# dedicated VRAM - expect the corresponding slowdown in the phase timings.

param(
    [double]$IntervalSec = 2,
    [string]$OutFile = (Join-Path $env:TEMP ("stillsong-mem-{0}.csv" -f (Get-Date -Format 'yyyyMMdd-HHmmss')))
)

$procPatterns = @('python*', 'llama-server*', 'Stillsong*')

'time,gpuDedUsedMB,gpuDedTotalMB,gpuSharedMB,sysCommitGB,sysAvailGB,standbyGB,stackWsGB,stackPrivateGB,procs' |
    Out-File $OutFile -Encoding utf8
Write-Host "sampling every $IntervalSec s -> $OutFile  (Ctrl+C to stop)"

$gb = 1GB
while ($true) {
    $t = Get-Date -Format 'HH:mm:ss'

    $dedUsed = ''; $dedTotal = ''
    try {
        $smi = & nvidia-smi '--query-gpu=memory.used,memory.total' '--format=csv,noheader,nounits' 2>$null
        if ($smi) {
            $parts = ($smi | Select-Object -First 1) -split ','
            $dedUsed = $parts[0].Trim(); $dedTotal = $parts[1].Trim()
        }
    } catch {}

    $sharedMB = ''; $commitGB = ''; $availGB = ''; $standbyGB = ''
    try {
        $counters = Get-Counter -Counter @(
            '\GPU Adapter Memory(*)\Shared Usage',
            '\Memory\Committed Bytes',
            '\Memory\Available Bytes',
            '\Memory\Standby Cache Normal Priority Bytes',
            '\Memory\Standby Cache Reserve Bytes',
            '\Memory\Standby Cache Core Bytes'
        ) -ErrorAction Stop
        $samples = $counters.CounterSamples
        $sharedMB = [math]::Round((($samples | Where-Object Path -like '*shared usage*' | Measure-Object CookedValue -Sum).Sum) / 1MB)
        $commitGB = [math]::Round((($samples | Where-Object Path -like '*committed bytes*').CookedValue) / $gb, 2)
        $availGB = [math]::Round((($samples | Where-Object Path -like '*available bytes*').CookedValue) / $gb, 2)
        $standbyGB = [math]::Round((($samples | Where-Object Path -like '*standby cache*' | Measure-Object CookedValue -Sum).Sum) / $gb, 2)
    } catch {}

    $procs = @()
    foreach ($pat in $procPatterns) {
        try { $procs += Get-Process -Name $pat -ErrorAction Stop } catch {}
    }
    $procs = $procs | Sort-Object Id -Unique
    $wsGB = [math]::Round((($procs | Measure-Object WorkingSet64 -Sum).Sum) / $gb, 2)
    $privGB = [math]::Round((($procs | Measure-Object PrivateMemorySize64 -Sum).Sum) / $gb, 2)
    $detail = ($procs | ForEach-Object {
        '{0}:{1}={2}/{3}MB' -f $_.Name, $_.Id, [math]::Round($_.WorkingSet64 / 1MB), [math]::Round($_.PrivateMemorySize64 / 1MB)
    }) -join ';'

    $line = "$t,$dedUsed,$dedTotal,$sharedMB,$commitGB,$availGB,$standbyGB,$wsGB,$privGB,$detail"
    Add-Content $OutFile $line -Encoding utf8
    Write-Host $line
    Start-Sleep -Seconds $IntervalSec
}
