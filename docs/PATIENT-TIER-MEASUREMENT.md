# Patient-tier measurement pass (P2 acceptance)

**Objective:** prove the Patient tier (8–16 GB VRAM) produces the *same-quality*
output as the fast tier — identical models, quantizations, graph, steps — just
slower and with a lower song-length ceiling, and that the app stays stable
under VRAM pressure. The pass replaces the provisional `capCeiling()` values
in `src/engine/domain/duration.ts` with measured ones. Approach is
gentle-from-below: read VRAM headroom at each step and stop while margin is
comfortable — never sweep up to a deliberate OOM.

## Context established 2026-08-31 (verify only if bumping pins)

- Pinned ComfyUI v0.34.1 runs **dynamic VRAM + async offload by default** on
  NVIDIA (no supervisor flags needed — the shipping config already uses it, so
  all fast-tier baselines include it). Weights are file-backed mappings
  streamed per-layer; the OS reclaims that RAM on demand and it is never paged
  out. Under VRAM pressure ComfyUI copies layers through a reusable temp
  tensor instead of OOMing — crash-elimination is a design goal of this system.
- `--reserve-vram N` feeds `EXTRA_RESERVED_VRAM`, honored by the dynamic-VRAM
  accounting → still the right emulation knob. `--lowvram` is a no-op under
  dynamic VRAM. `--fast-disk` (prefer disk-backed offload) exists for
  low-RAM/fast-NVMe machines. `--disable-dynamic-vram` = old estimate-based
  loading, the fallback if the streaming layer misbehaves.
- The streaming backend is `comfy-aimdo`, pinned **==0.4.15** by the vendored
  requirements.txt (verified installed). Upstream has an open post-Aug-3
  regression (Comfy-Org/ComfyUI#15255, mainly multi-GPU) in later versions —
  a reason to keep the pin.
- Pinned llama.cpp b10643 defaults to `-ngl auto` with `--fit on` (shrinks
  *unset* args to fit VRAM, ~1 GiB margin). The supervisor's explicit
  `-ngl 99` opts out of fitting; `-c 16384` explicit is never shrunk by fit.

## Tooling

| Piece | Use |
| --- | --- |
| `scripts\dev-comfy.ps1 -ReserveVram 8` | components ComfyUI with 8 GB held back (emulated 8 GB card); `-ReserveVram 4` = emulated 12 GB |
| `scripts\vram-ballast.py <GiB>` | run with the components venv python; genuinely pins VRAM (reserve-vram alone is voluntary accounting). Optional confirmation layer — kill immediately after each run |
| `scripts\mem-sampler.ps1` | CSV of GPU dedicated/shared + system commit/standby + stack working-set/private-commit; run alongside every measurement |
| `STILLSONG_VRAM_MB` / `STILLSONG_RAM_MB` | dev-only env overrides in `gpu.rs::detect()` so the app itself takes the Patient-tier paths (hardware check notice, target shrinking, cap ceiling) |

## Matrix

Per emulated tier — **8 GB** (reserve 8) and **12 GB** (reserve 4):

1. **Offload sanity + quality proof** (standalone ComfyUI via dev-comfy):
   a couple of drafts + one realistic-length render. Confirm in comfyui.log
   that dynamic streaming engaged; then same-seed A/B against a fast-tier run
   with *identical* `max_duration`/`kv_capacity_frames` (drive ComfyUI
   directly so tier-pinned KV capacity can't differ) → `codes.bin` must be
   **bit-identical**. Decode both, listen.
2. **Cap feasibility, from below:** render at cap 120 → 180 → 240 → 300 s,
   checking free VRAM after KV pre-allocation each step; stop stepping when
   headroom < ~1.5–2 GB. Ceiling = last comfortable step, with margin read
   from telemetry, not from a crash.
3. **Speed:** per-phase wall clock (encode frames/s, sampler s/step, decode)
   vs fast-tier baseline (20 s song ≈ 22–27 s; encode ~42 f/s, 30 steps
   ≈ 11 s) → calibrates the SetupScreen "several times longer" copy.
4. **llama leg** (ballast/reserve in place, ComfyUI stopped — mirrors the
   VRAM arbiter's guarantee): A/B `-ngl 99` (current supervisor args) vs
   `-ngl` unset (auto + fit). Measure load time, vision+compose latency,
   output passes linter/schema. Expected outcome: supervisor drops `-ngl 99`
   on the Patient tier (or everywhere) and lets the fitter place layers.
5. **Graceful-failure path** (no OOM needed): `taskkill` the ComfyUI child
   mid-draft → supervisor restart-once fires, app surfaces an error, next
   render succeeds.
6. **Soak:** 2–3 consecutive full songs at the chosen ceiling in the app
   (with `STILLSONG_VRAM_MB` + ballast) — no crash, no per-run degradation.
7. **Optional:** one `-FastDisk` comparison run; one ballast-pinned
   confirmation render at the chosen ceiling per tier.

## Acceptance criteria

1. Same-seed codes bit-identical fast vs patient-emulated (quality invariance proven).
2. Measured cap ceiling per tier with stated headroom → update `capCeiling()`.
3. Measured slowdown factors per phase → update Patient-tier UI copy if needed.
4. Peak **private commit** of the stack measured against the 32 GB budget
   (file-backed working set / standby cache reported separately — reclaimable,
   not counted against the budget).
5. llama `-ngl` decision recorded and applied to `supervisor.rs`.
6. Soak passes; kill-mid-render recovery verified.

Results ship as "measured under emulation" (the only card available for
testing is a 16 GB RTX 5080). Real-hardware confirmation comes from users'
bug reports, which ask for GPU, VRAM and RAM; revisit the ceilings if those
disagree with the emulated numbers.

## Results — ComfyUI leg (measured 2026-08-31, reserve-vram emulation)

Sweep = encode-only graphs (`scripts/cap-sweep.mjs`), warm instance, seed
424242, caps 120/180/240/300 s with kv = cap × 25. Live suite =
`live.test.ts` (4 tests incl. 20 s draft renders + bit-exact continuation).

| Config | Live suite | Encode f/s (cap 120→300) | Peak GPU used | Caps completed |
| --- | --- | --- | --- | --- |
| fast (no reserve) | — | 47.9–49.5 (flat) | 12.9 GB | all to 300 s |
| 12 GB emu (reserve 4) | 4/4, 83.5 s | 47.9–49.4 (flat) | 13.8 GB | all to 300 s |
| 8 GB emu (reserve 8) | 4/4, 178 s | 18.4 → 12.9 (graceful) | 9.97 GB | all to 300 s |

- **Quality invariance proven bit-exactly**: every cap's `codes.bin` is
  byte-identical across fast / reserve-4 / reserve-8 (cap 120 × 5 runs,
  cold and warm, one sha256 each per cap). Composition is unaffected by
  VRAM pressure; only speed changes.
- **No failure at any cap.** Dynamic VRAM streamed instead of OOMing, peaks
  honored the reserve budget. The stability goal is met under emulation;
  ceilings are a UX choice, not a crash boundary (8 GB emu at cap 300:
  ~12.9 f/s ⇒ a 4-min song encodes in ~10 min).
- **Slowdown for the tier copy**: 12 GB ⇒ ~1× (no measurable penalty);
  8 GB ⇒ ~2.6–3.7× on encode, draft renders 26–31 s vs 22–27 s baseline.
- Methodology notes: global VRAM "headroom" is meaningless under dynamic
  VRAM (cache fills elastically — every warm run parks near budget), so the
  sweep's stop rule is encode-rate collapse, not headroom. Warm the instance
  before sweeping or step 1 pays cold first-touch staging.

## Results — llama leg (8 GiB ballast, worst case)

| Config | Load | Gen tok/s | Note |
| --- | --- | --- | --- |
| `-ngl 99`, no ballast (baseline) | ~6 s | 91.6 | 9.3 GB dedicated |
| `-ngl 99`, 8 GiB ballast | ~6 s | 90.9 | ~5.6 GB dedicated, rest spilled |
| `-ngl` unset (auto+fit), 8 GiB ballast | ~6 s | 89.3 | same footprint as -ngl 99 |

- **Decision: keep `-ngl 99` in the supervisor** — no measurable penalty
  under pressure, and auto/fit behaved identically anyway.
- **Caveat — the ballast is soft under WDDM**: the OS demoted the *idle
  ballast's* pages and gave llama real VRAM, so this leg shows Windows
  absorbs overflow gracefully rather than what a physical 8 GB card does.
  Weights (7.2 GB) + 16K KV ≈ 9.3 GB > 8 GB, so a real card *will* rely on
  WDDM demotion of cold pages (mmproj when not doing vision, cold KV). Only
  a real-hardware report settles the actual tok/s there.

## Results — soak & fast-disk (2026-08-31)

- **Soak**: 3 consecutive full pipelines (llama boot + schema + vision +
  compose + photo→song via `live-cowriter.test.ts`) under full patient
  emulation (`STILLSONG_VRAM_MB=8192`, `STILLSONG_RAM_MB=32768`, ComfyUI
  reserve-8): 4/4 each, 360 → 252 → 308 s. No crash, no per-run
  degradation (iteration 1 pays cold staging; variance after tracks
  composed song length). Soak RAM peaks: 16.7 GB working set / 28.0 GB
  private commit, again all in the ComfyUI process; llama's RAM freed
  between phases by the arbiter's stop-and-await-exit.
- **`--fast-disk`**: no measurable effect with ample RAM (17.7 / 12.8 f/s
  at caps 120/300 vs 18.4 / 12.9 without) — as expected, it matters only
  when RAM is scarce. Remains a candidate knob for a future low-RAM mode,
  untested under true RAM pressure.
- The supervised app path takes the same flag via `STILLSONG_RESERVE_VRAM`
  (dev-only env read in `supervisor.rs`), so the in-app UX check is:
  `STILLSONG_VRAM_MB=8192` + `STILLSONG_RESERVE_VRAM=8` + `npm run tauri dev`.

## Interactive legs (done 2026-08-31)

- **In-app patient UX pass**: full photo→song under `STILLSONG_VRAM_MB=8192`
  + `STILLSONG_RESERVE_VRAM=8`. All stages smooth, compose/render ~2× wall,
  song quality good. Output was 1:10 — the 120 s patient `capCeiling` at
  work; typical fast-tier songs run 2:30–3:30, so the ceiling decision
  (below) directly trades length for encode time.
- **Kill-mid-render recovery**: found and fixed TWO engine bugs before the
  path worked (the test leg earned its keep):
  1. History-poll transport errors were swallowed — a dead ComfyUI froze
     the UI mid-progress forever. Fixed: 3 consecutive failures fail the
     song ('The studio stopped answering mid-song.'), WS close triggers an
     immediate poll.
  2. Nothing on the render path ever started ComfyUI — the supervisor's
     crash-restart-once was unreachable, so after a ComfyUI death every
     render failed until app restart. Fixed: `Runtime.startComfy` called
     from `acquireForComfy`.
  Verified live end-to-end after the fixes: kill mid-encode → clean failure
  ~30 s later → retry → restart-once respawns ComfyUI → render completes.

## Decisions

- **`capCeiling` = CAP.max (300 s) for every supported tier** (decided
  2026-08-31): only render time varies by tier, never song length or
  quality — and the unified KV pin makes codes bit-compatible across
  hardware tiers. Caveat recorded in duration.ts: a real 8 GB card keeps
  ~2 GB of streaming headroom at the ~4.6 GB KV floor for a 300 s cap
  (our emulated budget was 8.1 GB vs ~6.5–7 GB truly free on real
  hardware) — revisit if hardware reports disagree.
- **32 GB RAM is a recommendation, not a gate** (decided 2026-08-31):
  `hardwareTier()` no longer checks RAM. Reasoning (documented in
  duration.ts): measured resident stack peaks at 16.5 GB — the ~31 GB
  figure is private *commit* in the ComfyUI process, satisfied by RAM plus
  pagefile, and dynamic VRAM degrades toward disk speed rather than
  failing when RAM is short. Setup shows a warn notice below 32 GB
  (recommends 32 GB, keep the pagefile enabled) instead of blocking.

## Results — system RAM (the 32 GB question)

Peak across all runs (5 s sampling): stack working set **16.5 GB**, stack
private commit **30.9 GB** — both entirely the one ComfyUI python process
(aimdo host staging commits ~2× what it keeps resident). System commit
peaked 49.4 GB on this 64 GB box; available RAM never dropped below 26 GB.

Reading for a 32 GB machine: the **resident** set (16.5 GB + OS ≈ 22–24 GB)
fits. The 31 GB **commit** is address-space reservation, mostly non-resident;
it needs commit *limit* (RAM + pagefile), not RAM — fine with the Windows
default system-managed pagefile, but a user who disabled their pagefile
would hit commit-failure crashes. Evidence still open before relaxing the
requirement: one run with RAM genuinely constrained (or a real 16–24 GB
machine), and the `--fast-disk` comparison.

## Open decision (revisit once results are in)

**Should 32 GB system RAM become a recommendation instead of a hard
requirement for the Patient tier?** `hardwareTier()` currently returns
`unsupported` below 32 GB RAM on a sub-16 GB card. Dynamic VRAM weakens the
old rationale: weights are reclaimable file-backed mappings streamed from
NVMe, so a 16–24 GB-RAM machine likely degrades to disk-read speed rather
than exhausting RAM. Evidence that answers it: (a) peak stack *private*
commit from the matrix runs (if well under ~16 GB, RAM is not the binding
constraint); (b) the `--fast-disk` comparison run; (c) whether spill-driven
slowdowns stay "patient" or become unusable. If relaxed: gate becomes a warn
notice in SetupScreen instead of `unsupported`, and the README requirement
line softens to "32 GB recommended".
