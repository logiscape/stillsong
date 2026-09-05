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
