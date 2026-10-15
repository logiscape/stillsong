// Target vs cap. The user (and the writer) work with a *target* length; the
// cap sent to ComfyUI as max_duration gets headroom on top so the composer can
// write its own ending instead of being cut off mid-phrase.
//
// Measured (same 4-line song, seed 222): cap 20 s -> truncated; cap 120 s ->
// ended on its own at 65 s; cap 360 s -> ended at 81 s. Render time scales
// with what the composer actually writes, not with the cap; the cap only
// pre-allocates the encoder's KV cache (VRAM: 360 s left 141 MB free on
// 16 GB, hence CAP.max = 300).

import { CAP, type SongSpec } from './types';
import { estimateSeconds } from '../cowriter/lyrics';

/** max_duration for a target length and lyrics: max(target, lyric estimate) × headroom + pad, capped. */
export function renderCap(targetSec: number, lyrics: string, ceiling: number = CAP.max): number {
  const need = Math.max(targetSec, estimateSeconds(lyrics));
  const cap = Math.round(need * CAP.headroom + CAP.pad);
  return Math.max(targetSec, Math.min(Math.min(ceiling, CAP.max), cap));
}

/** Spec with its cap recomputed from target + lyrics. */
export function withRenderCap(spec: SongSpec, ceiling: number = CAP.max): SongSpec {
  return { ...spec, durationSec: renderCap(spec.targetSec, spec.lyrics, ceiling) };
}

import type { HardwareInfo } from '../ports';

export type HardwareTier = 'fast' | 'patient' | 'unsupported';

/**
 * The support tiers. Low-VRAM operation degrades speed, never song length or
 * audio quality (validated under emulation 2026-08-31, see
 * docs/PATIENT-TIER-MEASUREMENT.md).
 *
 * 32 GB system RAM is a recommendation, not a gate: dynamic-VRAM ComfyUI
 * keeps model weights as reclaimable file-backed mappings streamed from disk,
 * so the measured RESIDENT stack peaks at ~16.5 GB (fits 32 GB with room, and
 * degrades toward NVMe speed below that instead of failing). The larger
 * number in the measurements — ~31 GB private commit in the ComfyUI process —
 * is address-space reservation satisfied by RAM *plus pagefile*, so it needs
 * commit limit, not physical RAM; the Windows default system-managed pagefile
 * covers it. (A machine with the pagefile disabled could see commit-failure
 * crashes; the setup screen recommends rather than blocks.)
 */
export function hardwareTier(hw: HardwareInfo): HardwareTier {
  if (hw.vendor !== 'nvidia') return 'unsupported';
  if (hw.vramMb >= 16_000) return 'fast';
  if (hw.vramMb >= 8_000) return 'patient';
  return 'unsupported';
}

/**
 * Minimum NVIDIA driver (major) for the bundled runtimes. Both PyTorch
 * (cu130) and the llama.cpp build (CUDA 13.4) are CUDA 13 binaries, which
 * NVIDIA's minor-version compatibility runs on any 13.x-capable driver, i.e.
 * 580 or newer.
 */
export const DRIVER_FLOOR = 580;

/**
 * Turing (compute capability 7.x: RTX 20, GTX 16) is the exception. The
 * llama.cpp release build ships machine code only for Ampere, Ada and
 * Blackwell and PTX for Turing (ggml-cuda's default architecture set), and
 * PTX is JIT-compiled by the driver, so it needs the driver branch that
 * matches the CUDA 13.4 toolkit the build used: R615.
 */
export const DRIVER_FLOOR_TURING = 615;

/**
 * The driver version this card needs but lacks, or null when it is new
 * enough or unknown (the DXGI fallback reports no version). Advisory: the
 * setup check shows it and lets setup continue, since an older driver fails
 * loudly at first use rather than silently.
 */
export function driverShortfall(hw: HardwareInfo): { have: string; need: number } | null {
  if (hw.vendor !== 'nvidia' || !hw.driverVersion) return null;
  const major = Number.parseInt(hw.driverVersion, 10);
  if (!Number.isFinite(major)) return null;
  const turing = /^7\./.test(hw.computeCap ?? '');
  const need = turing ? DRIVER_FLOOR_TURING : DRIVER_FLOOR;
  return major < need ? { have: hw.driverVersion, need } : null;
}

/**
 * Ceiling on the render cap: CAP.max for every supported tier. Measured
 * 2026-08-31 (docs/PATIENT-TIER-MEASUREMENT.md): with dynamic VRAM, every cap
 * to 300 s completes on an emulated 8 GB card (--reserve-vram 8 on the 5080) —
 * the KV pre-allocation fits and pressure degrades encode speed (~2.6–3.7×),
 * never output or stability. A single ceiling also pins kv_capacity_frames
 * identically everywhere, so same-seed renders and continuations are
 * bit-compatible ACROSS hardware tiers. Sub-16 GB is validated under
 * emulation only; a real 8 GB card keeps ~2 GB of streaming headroom at the
 * ~4.6 GB KV floor (≈0.61 MB/frame) — revisit if hardware reports disagree.
 */
export function capCeiling(_vramMb: number): number {
  return CAP.max;
}
