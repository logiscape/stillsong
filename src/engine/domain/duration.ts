// The co-writer's length budget. Stillsong 2 keeps Stillsong 1's songwriting
// byte-identical (prompts, lint, repair), and the lint judges lyrics against
// this target + headroom cap. It is NOT what ComfyUI receives: every song is
// performed with max_duration = MAX_DURATION_SEC (domain/types.ts), because
// YuE2's output for a seed depends on that value.

import { CAP } from './types';
import { estimateSeconds } from '../cowriter/lyrics';

/** The writer's cap for a target length and lyrics: max(target, lyric estimate) × headroom + pad, capped. */
export function renderCap(targetSec: number, lyrics: string, ceiling: number = CAP.max): number {
  const need = Math.max(targetSec, estimateSeconds(lyrics));
  const cap = Math.round(need * CAP.headroom + CAP.pad);
  return Math.max(targetSec, Math.min(Math.min(ceiling, CAP.max), cap));
}

import type { HardwareInfo } from '../ports';

export type HardwareTier = 'fast' | 'patient' | 'unsupported';

/**
 * The support tiers. Stillsong 1 validated 8–16 GB (dynamic VRAM, slower but
 * identical output) under emulation. Stillsong 2 keeps the same gates; on a
 * 16 GB RTX 5080 YuE2 int8 peaked at 12–16 GB of the card (500 s cap, long
 * songs highest) with ComfyUI's dynamic VRAM offloading, so sub-16 GB cards
 * rely on that offload. Re-measure the patient tier for YuE2 before release.
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
