// Where a take sings the lines an edit changed, read from the model itself.
//
// The studio replays a take's music tokens under the original lyric sheet and
// under the edited one (the Stillsong2Align node) and reports, per 25 Hz
// frame, log p(token | edited) - log p(token | original). Where the take sings
// a word the edited sheet no longer has, that number drops sharply at the
// word's onset: about -2 against a noise floor of about 0.016 once smoothed
// (measured 2026-11-13; fixtures in __tests__/fixtures/alignment.json).
//
// The same series taken on a re-sung take answers "are any old words still
// in it?", so one function serves both the first look and the check.

import type { FrameWindow } from './types';
import { AUDIO_FRAMES_PER_SECOND } from './types';

/** Centered moving average over this many frames (about half a second). */
const SMOOTH_FRAMES = 13;
/** A smoothed drop must be below this, and below NOISE_SIGMAS of the series' own noise. */
const DROP_FLOOR = -0.25;
const NOISE_SIGMAS = 6;
/**
 * Spans closer than this are sung again as one window: a kept island shorter
 * than five seconds between two re-sung lines is not worth two more seams
 * (and one window per edited verse is the configuration approved by ear).
 */
const MERGE_GAP_FRAMES = 5 * AUDIO_FRAMES_PER_SECOND;
/**
 * Half a second either side. The drops sit on the onsets of the changed
 * words, so the window opens a breath early and lets the last word finish.
 */
const PAD_FRAMES = 12;

export interface AlignSeries {
  frames: number;
  /** Per frame: log p(token | sheet B) - log p(token | sheet A). */
  drop: number[];
}

/** The alignment node's history text; null when it is missing or malformed. */
export function parseAlignSeries(text: string | undefined): AlignSeries | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<AlignSeries>;
    if (!Array.isArray(value.drop) || value.drop.length === 0) return null;
    if (!value.drop.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    return { frames: value.drop.length, drop: value.drop };
  } catch {
    return null;
  }
}

function smooth(drop: readonly number[]): number[] {
  const half = SMOOTH_FRAMES >> 1;
  const out = new Array<number>(drop.length);
  let sum = 0;
  for (let i = 0; i < Math.min(half, drop.length); i++) sum += drop[i];
  for (let i = 0; i < drop.length; i++) {
    if (i + half < drop.length) sum += drop[i + half];
    if (i - half - 1 >= 0) sum -= drop[i - half - 1];
    out[i] = sum / SMOOTH_FRAMES;
  }
  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sorted, non-overlapping windows covering both lists (touching windows join). */
export function mergeWindows(a: readonly FrameWindow[], b: readonly FrameWindow[] = [], gap = 0): FrameWindow[] {
  const all = [...a, ...b].filter(([start, end]) => end > start).sort((x, y) => x[0] - y[0]);
  const out: FrameWindow[] = [];
  for (const [start, end] of all) {
    const last = out[out.length - 1];
    if (last && start - last[1] <= gap) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * The frame spans where the take sings words sheet B lacks: unpadded, close
 * spans joined. Empty when nothing stands out from the noise.
 */
export function sungSpans(drop: readonly number[]): FrameWindow[] {
  const smoothed = smooth(drop);
  // Robust noise estimate: the edited words are a few seconds of a
  // minutes-long series, so the median ignores them.
  const sigma = median(smoothed.map(Math.abs)) * 1.4826;
  const threshold = Math.min(DROP_FLOOR, -NOISE_SIGMAS * sigma);
  const spans: FrameWindow[] = [];
  let start = -1;
  for (let i = 0; i <= smoothed.length; i++) {
    const below = i < smoothed.length && smoothed[i] < threshold;
    if (below && start < 0) start = i;
    if (!below && start >= 0) {
      spans.push([start, i]);
      start = -1;
    }
  }
  return mergeWindows(spans, [], MERGE_GAP_FRAMES - 1);
}

/** Pads spans by half a second either side, inside [0, frames), joining any that now meet. */
export function padWindows(spans: readonly FrameWindow[], frames: number): FrameWindow[] {
  return mergeWindows(spans.map(([start, end]): FrameWindow => [Math.max(0, start - PAD_FRAMES), Math.min(frames, end + PAD_FRAMES)]));
}

/** The windows to sing again for this series: `sungSpans`, padded. */
export function editWindows(drop: readonly number[]): FrameWindow[] {
  return padWindows(sungSpans(drop), drop.length);
}

/** Total length of the windows, in seconds. */
export function windowSeconds(windows: readonly FrameWindow[]): number {
  return windows.reduce((sum, [start, end]) => sum + (end - start), 0) / AUDIO_FRAMES_PER_SECOND;
}
