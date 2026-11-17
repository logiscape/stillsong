// A melody edit: some notes of a song's plan are changed and only the bars
// that hold them are sung again, the rest of the recording kept. Pure: which
// bars changed, the frame windows to sing again, and how to pick among several
// takes of them.
//
// The recipe was found by ear (2026-11-16, two songs): a window may start
// anywhere, but it should hand back to the kept recording at the start of a
// phrase; the seed must not be the original's (it clings to the old tune);
// and of several takes, the ones the studio's own scoring marks down at the
// seam are the ones that sound rough.

import { AUDIO_FRAMES_PER_SECOND, type FrameWindow } from './types';
import { barFrame, type BarGrid } from './barGrid';
import type { PlanNote } from './melodyPlan';
import type { SongMap } from './songMap';

/** A window opens this many frames before its first bar line, to take in the note's attack. */
const LEAD = 2;
/** Two windows closer than this are sung as one: a few seconds of kept music are not worth two more seams. */
const JOIN = 5 * AUDIO_FRAMES_PER_SECOND;
/** The kept music right after a window is scored over this many frames. */
const SEAM = AUDIO_FRAMES_PER_SECOND;
/** A take whose seam scores this far below the best take's is heard as rougher; closer than that, not (measured by ear). */
const SEAM_SLACK = 20;

const sameNotes = (a: PlanNote[], b: PlanNote[]): boolean =>
  a.length === b.length && a.every((n, i) => n.pos === b[i].pos && n.dur === b[i].dur && n.midi === b[i].midi && n.tie === b[i].tie);

/**
 * The bars (counted through the whole song) whose notes differ between two
 * maps of one song. Null when the two do not have the same phrases and bars:
 * that is another song's shape, not this one with some notes moved.
 */
export function changedBars(original: SongMap, edited: SongMap): number[] | null {
  if (original.bars !== edited.bars || original.phrases.length !== edited.phrases.length || original.ctx.barUnits !== edited.ctx.barUnits) return null;
  const units = original.ctx.barUnits;
  const bars: number[] = [];
  for (let i = 0; i < original.phrases.length; i++) {
    const a = original.phrases[i];
    const b = edited.phrases[i];
    if (a.start !== b.start || a.phrase.bars !== b.phrase.bars) return null;
    for (let bar = 0; bar < a.phrase.bars; bar++) {
      const inBar = (n: PlanNote) => n.pos >= bar * units && n.pos < (bar + 1) * units;
      const same = sameNotes(a.phrase.vocal.filter(inBar), b.phrase.vocal.filter(inBar)) && sameNotes(a.phrase.ins.filter(inBar), b.phrase.ins.filter(inBar));
      if (!same) bars.push(a.start + bar);
    }
  }
  return bars;
}

/**
 * The frame windows to sing again for a set of changed bars. Each opens just
 * before its first changed bar and closes at the start of the next phrase:
 * the studio hears what came before a window, but must hand back blind, and a
 * phrase start is where that goes smoothly. `frames` is the take's length.
 */
export function melodyWindows(map: SongMap, grid: BarGrid, bars: readonly number[], frames: number): FrameWindow[] {
  const at = (bar: number) => (bar >= map.bars ? frames : Math.max(0, Math.round(barFrame(map, grid, bar)) - LEAD));
  const windows: FrameWindow[] = [];
  for (const bar of [...bars].sort((x, y) => x - y)) {
    const phrase = [...map.phrases].reverse().find((p) => p.start <= bar);
    if (!phrase) continue;
    const start = at(bar);
    const end = Math.min(frames, at(phrase.start + phrase.phrase.bars));
    if (end <= start) continue; // a bar the recording never reached
    const last = windows[windows.length - 1];
    if (last && start - last[1] < JOIN) last[1] = Math.max(last[1], end);
    else windows.push([start, end]);
  }
  return windows;
}

/** A score series as the scoring node reports it: `{"frames": n, "logp": [...]}`. */
export function parseScoreSeries(text: string | undefined): number[] | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as { frames?: number; logp?: unknown };
    const logp = parsed.logp;
    return Array.isArray(logp) && logp.length > 0 && logp.length === parsed.frames && logp.every((v) => typeof v === 'number' && Number.isFinite(v)) ? (logp as number[]) : null;
  } catch {
    return null;
  }
}

export interface TakeScore {
  /** How much better the re-sung frames fit the edited plan than the original one (nats). Zero for a take that ignored the change. */
  fit: number;
  /** How the kept second after each window fares against the same frames of the original take (nats; always below zero, less so for a smooth hand-back). */
  seam: number;
}

/**
 * Scores one take of the windows. `base`: the original take under the
 * original plan; `underEdited` / `underOriginal`: the new take under each plan.
 */
export function scoreTake(windows: readonly FrameWindow[], base: readonly number[], underEdited: readonly number[], underOriginal: readonly number[]): TakeScore {
  let fit = 0;
  let seam = 0;
  for (const [start, end] of windows) {
    for (let f = start; f < end; f++) fit += underEdited[f] - underOriginal[f];
    for (let f = end; f < Math.min(end + SEAM, base.length); f++) seam += underEdited[f] - base[f];
  }
  return { fit, seam };
}

/**
 * Which take to perform: of those whose seam is not audibly worse than the
 * best one's, the take that follows the new notes most. -1 when none of them
 * follows the new notes at all.
 */
export function chooseTake(scores: readonly TakeScore[]): number {
  if (!scores.length) return -1;
  const best = Math.max(...scores.map((s) => s.seam));
  let pick = -1;
  scores.forEach((s, i) => {
    if (s.seam >= best - SEAM_SLACK && (pick < 0 || s.fit > scores[pick].fit)) pick = i;
  });
  return pick >= 0 && scores[pick].fit > 0 ? pick : -1;
}
