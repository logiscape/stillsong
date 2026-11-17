// A longer song: phrases added to a plan at one place, and performed into a
// gap opened in the kept take. Pure: the new phrases (written by the studio's
// plan writer going on from the middle of the plan, or a phrase played once
// more), what was added between two plans, where the take is cut and what is
// performed, where the bars of the longer recording fall, and which of several
// takes hands back best.
//
// New bars are written, not copied (the user, 2026-11-17: more of a part "with
// a similar sound" is worth more than the same segment twice). Asked to go on
// from the end of a phrase, the plan writer writes what it would have next:
// often the phrase that already follows, varied, and then new figures over the
// part's chords (measured that day on the three starter songs).
//
// The recipe was found by ear (2026-11-16, two songs, the interludes of "Where
// the Old Gods Stood" and "Iron Ghost"): the new bars go in at a phrase
// boundary, so the kept recording resumes at the start of a phrase; the bar
// before them is performed again with them, as a lead-in; and of several
// takes, the ones the studio's own scoring marks down in the kept second
// after the new bars are the ones that sound rough.

import { AUDIO_FRAMES_PER_SECOND, MAX_DURATION_SEC, type FrameWindow } from './types';
import { barFrame, type BarGrid } from './barGrid';
import { PlanError, parsePlan, serializePlan, type MelodyPlan, type PlanPhrase } from './melodyPlan';
import { buildSongMap, type SongMap } from './songMap';

/** The cut sits this many frames before the bar line, so the attack of the first kept note stays with it (as a melody edit's window does). */
const LEAD = 2;
/** The kept music right after the new bars is scored over this many frames. */
const SEAM = AUDIO_FRAMES_PER_SECOND;
/** The longest take the studio performs: every song is made with the same cap. */
export const MAX_TAKE_FRAMES = MAX_DURATION_SEC * AUDIO_FRAMES_PER_SECOND;
/** A phrase can be played this many more times in one go: eight new bars is the most that was tried by ear. */
export const MAX_NEW_BARS = 8;
/** And no more than this many seconds of new music: in a slow song eight bars are far longer than anything tried. */
export const MAX_NEW_SECONDS = 16;

const lastTied = (p: PlanPhrase | undefined): boolean => !!p && [p.vocal, p.ins].some((notes) => notes.length > 0 && notes[notes.length - 1].tie);

/**
 * Whether a phrase can be played once more. It must be played, not sung (new
 * sung bars would need words of their own), at least two bars long, followed
 * by another phrase (the kept recording has to resume somewhere), and no note
 * may be tied into it or out of it: a copy would tie onto another pitch.
 */
export function canRepeatPhrase(phrases: readonly PlanPhrase[], index: number): boolean {
  const p = phrases[index];
  if (!p || index >= phrases.length - 1) return false;
  if (p.vocal.length > 0 || p.ins.length === 0 || p.bars < 2) return false;
  return !lastTied(p) && !lastTied(phrases[index - 1]);
}

/** How many more times a phrase can be played in one go (0: not at all). */
export function repeatsOffered(phrases: readonly PlanPhrase[], index: number): number {
  return canRepeatPhrase(phrases, index) ? Math.max(1, Math.floor(MAX_NEW_BARS / phrases[index].bars)) : 0;
}

/** The plan with one phrase played `times` more: its lines again, right after it. Null when it cannot be (see canRepeatPhrase). */
export function repeatPhrase(abc: string, phrase: number, times = 1): string | null {
  let plan;
  try {
    plan = parsePlan(abc);
  } catch (err) {
    if (err instanceof PlanError) return null;
    throw err;
  }
  const all = plan.sections.flatMap((s) => s.phrases);
  if (!Number.isInteger(times) || times < 1 || times > repeatsOffered(all, phrase)) return null;
  let index = 0;
  const sections = plan.sections.map((s) => ({
    headLine: s.headLine,
    phrases: s.phrases.flatMap((p) => (index++ === phrase ? Array.from({ length: times + 1 }, () => ({ lines: p.lines })) : [{ lines: p.lines }])),
  }));
  return serializePlan(plan.header, sections, plan.tail);
}

export interface Extension {
  /** The phrase of the original plan the new ones follow. */
  after: number;
  /** How many phrases are new, and the bars they hold. */
  phrases: number;
  bars: number;
  /** One of the new phrases is sung. */
  sung: boolean;
}

const sameLines = (a: PlanPhrase, b: PlanPhrase): boolean => a.lines.length === b.lines.length && a.lines.every((l, i) => l === b.lines[i]);

/**
 * What `edited` adds to `original`: new phrases at one place, every phrase of
 * the original still there, in order and untouched. Null when that is not the
 * difference between the two, or when the new phrases would open or close the
 * song (nothing to lead in from, or nothing to hand back to).
 *
 * Phrases that repeat leave the place open: one more "A" in "A A A B" could
 * follow any of the three. `after` says which was meant; without it, or when
 * it cannot be, the last place that fits is taken.
 */
export function addedPhrases(original: SongMap, edited: SongMap, after?: number): Extension | null {
  const a = original.phrases;
  const b = edited.phrases;
  const count = b.length - a.length;
  if (count < 1 || original.ctx.barUnits !== edited.ctx.barUnits || original.ctx.secPerBar !== edited.ctx.secPerBar) return null;
  if (original.sections.length !== edited.sections.length || original.sections.some((s, i) => s.name !== edited.sections[i].name)) return null;
  let head = 0;
  while (head < a.length && sameLines(a[head].phrase, b[head].phrase)) head++;
  let tail = 0;
  while (tail < a.length && sameLines(a[a.length - 1 - tail].phrase, b[b.length - 1 - tail].phrase)) tail++;
  // The new phrases can sit after any `before` phrases with a.length - tail <= before <= head.
  const lo = Math.max(1, a.length - tail);
  const hi = Math.min(a.length - 1, head);
  if (lo > hi) return null;
  const before = after !== undefined && Number.isInteger(after) && after + 1 >= lo && after + 1 <= hi ? after + 1 : hi;
  // The new ones must stay in the section of a neighbour: a part of the song that was not there is another kind of change.
  const added = b.slice(before, before + count);
  if (added.some((p) => p.section !== a[before - 1].section && p.section !== a[before].section)) return null;
  return { after: before - 1, phrases: count, bars: added.reduce((n, p) => n + p.phrase.bars, 0), sung: added.some((p) => p.phrase.vocal.length > 0) };
}

export interface ExtensionCut {
  /** How the take is laid out anew: kept, a gap of new frames, kept (see Stillsong2ArrangeTake). */
  layout: string;
  /** The new frames, in the longer take. */
  gap: FrameWindow;
  /** What is performed, in the longer take: the bar before the new ones, and the new ones. */
  window: FrameWindow;
  /** The longer take's length. */
  frames: number;
}

/**
 * Where a take of `frames` frames is cut for an extension, by the original's
 * map and bar grid. Null when the recording does not reach the place.
 */
export function extensionCut(original: SongMap, grid: BarGrid, ext: Extension, frames: number): ExtensionCut | null {
  const next = original.phrases[ext.after + 1];
  if (!next || ext.bars < 1) return null;
  const barFrames = original.ctx.secPerBar * AUDIO_FRAMES_PER_SECOND;
  const cut = Math.round(barFrame(original, grid, next.start)) - LEAD;
  const added = Math.round(ext.bars * barFrames);
  // Something must be kept on both sides, and a second of it after the new bars is what tells takes apart.
  if (cut < 1 || cut + SEAM > frames || added < 1) return null;
  const lead = Math.round(barFrame(original, grid, next.start - 1)) - LEAD;
  const start = Math.max(0, Math.min(lead, cut - 1));
  return { layout: `0-${cut},+${added},${cut}-${frames}`, gap: [cut, cut + added], window: [start, cut + added], frames: frames + added };
}

/**
 * The bar grid of the longer recording. The new phrases start where the next
 * one used to; everything after them is later by the frames that went in,
 * which are a whole number while the bars they hold are not: the difference
 * (under half a frame) is carried in the shifts, so it never adds up.
 */
export function extendedGrid(original: SongMap, grid: BarGrid, ext: Extension, cut: ExtensionCut): BarGrid {
  const barFrames = original.ctx.secPerBar * AUDIO_FRAMES_PER_SECOND;
  const drift = cut.gap[1] - cut.gap[0] - ext.bars * barFrames;
  const at = ext.after + 1;
  return {
    v: 1,
    shifts: [...grid.shifts.slice(0, at), ...Array.from({ length: ext.phrases }, () => grid.shifts[at]), ...grid.shifts.slice(at).map((s) => s + drift)],
  };
}

/**
 * How a take of the new bars hands back: the kept second after them, under
 * the longer plan, against the same frames of the original take under its own
 * plan (nats; below zero, less so for a smooth hand-back). `base` is the
 * original take's score series, `under` the longer take's. Null when either
 * is not the length it should be.
 */
export function extensionSeam(cut: ExtensionCut, base: readonly number[], under: readonly number[]): number | null {
  const added = cut.gap[1] - cut.gap[0];
  if (under.length !== cut.frames || base.length !== cut.frames - added) return null;
  let seam = 0;
  for (let f = cut.gap[1]; f < Math.min(cut.gap[1] + SEAM, under.length); f++) seam += under[f] - base[f - added];
  return seam;
}

/** Which take to perform: the one that hands back best. -1 when there is none. */
export function smoothestTake(seams: readonly number[]): number {
  let pick = -1;
  seams.forEach((s, i) => {
    if (pick < 0 || s > seams[pick]) pick = i;
  });
  return pick;
}

// ---- new bars, written by the studio -------------------------------------------

function readPlan(abc: string): MelodyPlan | null {
  try {
    return parsePlan(abc);
  } catch (err) {
    if (err instanceof PlanError) return null;
    throw err;
  }
}

/**
 * The plan's text up to the end of phrase `after`, ending in a line break:
 * what the plan writer goes on from. With `lineOnly`, the next phrase is begun
 * for it, the singer's line of phrase `after` given again (rests and that
 * phrase's chords), so that only an instrument's line is left to write: new
 * notes over the same chords. Null when the phrase is not one new bars can
 * follow (canRepeatPhrase), or, for `lineOnly`, is not written as a singer's
 * line and an instrument's.
 */
export function planBefore(abc: string, after: number, lineOnly = false): string | null {
  const plan = readPlan(abc);
  if (!plan) return null;
  const all = plan.sections.flatMap((s) => s.phrases);
  if (!canRepeatPhrase(all, after)) return null;
  const lines = plan.header.slice();
  let index = 0;
  for (const s of plan.sections) {
    if (index > after) break;
    if (s.headLine !== null) lines.push(s.headLine);
    for (const p of s.phrases) {
      if (index > after) break;
      lines.push(...p.lines);
      index++;
    }
  }
  if (lineOnly) {
    const own = all[after].lines;
    if (own.length !== 4 || !/^V:/.test(own[0]) || !/^V:/.test(own[2])) return null;
    lines.push(own[0], own[1], own[2]);
  }
  return `${lines.join('\n')}\n`;
}

/** The most new bars that can go in after a phrase: what was tried by ear, what fits before the studio's limit. 0: none can. */
export function roomForBars(original: SongMap, grid: BarGrid, after: number, frames: number): number {
  const barFrames = original.ctx.secPerBar * AUDIO_FRAMES_PER_SECOND;
  if (!extensionCut(original, grid, { after, phrases: 1, bars: 1, sung: false }, frames)) return 0;
  const most = Math.min(MAX_NEW_BARS, Math.floor(MAX_NEW_SECONDS / original.ctx.secPerBar), Math.floor((MAX_TAKE_FRAMES - frames) / barFrames));
  return most >= 2 ? most : 0;
}

export interface NewBars {
  /** The plan with the new phrases in it, after phrase `after`. */
  abc: string;
  phrases: number;
  bars: number;
  /** How many of the new phrases play something no phrase of the song does. */
  fresh: number;
  /** The last new phrase sits on the chords of the phrase the new ones follow, so what came next can come next again. */
  closes: boolean;
}

const tune = (p: PlanPhrase): string => p.ins.map((n) => `${n.pos}:${n.dur}:${n.midi}`).join(' ');
const harmony = (p: PlanPhrase): string => p.chords.map((c) => `${c.bar}:${c.pos}:${c.name}`).join(' ');

/**
 * Reads what the plan writer wrote after `planBefore(abc, after, lineOnly)`
 * and makes the longer plan from it. The new phrases are the ones it wrote
 * first: played, not sung, in the same part of the song, each as long as the
 * phrase they follow, `maxBars` at most (and two at least). It stops at the
 * first phrase that is sung or opens another part (there the writer was
 * moving on) or is of another length: a part in four-bar phrases gets
 * four-bar phrases, not the one-bar tag the writer likes to end an intro
 * with. The last phrase it wrote is never taken, since the text may have been
 * cut off inside it.
 *
 * Null when nothing usable was written, or nothing new: a run that only
 * repeats phrases the song already has is the duplicate this is here to avoid.
 */
export function readNewBars(abc: string, lyrics: string, after: number, written: string, maxBars: number, lineOnly = false): NewBars | null {
  const before = planBefore(abc, after, lineOnly);
  const original = readPlan(abc);
  const whole = written.slice(0, written.lastIndexOf('\n') + 1);
  const read = before && whole ? readPlan(before + whole) : null;
  if (!before || !original || !read) return null;
  const was = original.sections.flatMap((s) => s.phrases);
  const now = read.sections.flatMap((s, section) => s.phrases.map((phrase) => ({ phrase, section })));
  // The plan so far must read as it did: the same phrases, the same lines.
  if (now.length < after + 2 || was.slice(0, after + 1).some((p, i) => p.lines.join('\n') !== now[i].phrase.lines.join('\n'))) return null;
  const run: PlanPhrase[] = [];
  let bars = 0;
  for (const { phrase, section } of now.slice(after + 1, lineOnly ? after + 2 : now.length - 1)) {
    if (section !== now[after].section || phrase.vocal.length > 0 || phrase.ins.length === 0) break;
    if (phrase.bars !== was[after].bars || bars + phrase.bars > maxBars) break;
    run.push(phrase);
    bars += phrase.bars;
  }
  // A note tied out of the last new phrase would tie onto whatever the song has next.
  while (run.length && lastTied(run[run.length - 1])) bars -= run.pop()!.bars;
  if (!run.length || bars < 2) return null;
  const known = new Set(was.map(tune));
  const fresh = run.filter((p) => !known.has(tune(p))).length;
  if (!fresh) return null;
  let index = 0;
  const sections = original.sections.map((s) => ({
    headLine: s.headLine,
    phrases: s.phrases.flatMap((p) => (index++ === after ? [p, ...run] : [p]).map((x) => ({ lines: x.lines }))),
  }));
  const longer = serializePlan(original.header, sections, original.tail);
  // The longer plan must be this song with those phrases added, and nothing else.
  const a = buildSongMap(abc, lyrics);
  const b = buildSongMap(longer, lyrics);
  const added = a && b ? addedPhrases(a, b, after) : null;
  if (!added || added.after !== after || added.sung || added.bars !== bars) return null;
  return { abc: longer, phrases: run.length, bars, fresh, closes: harmony(run[run.length - 1]) === harmony(was[after]) };
}

/**
 * Which of several attempts to perform: one that comes back to the chords it
 * left from before one that does not, then the one with most that is new,
 * then the longer. -1 when none wrote anything usable.
 */
export function bestNewBars(found: readonly (NewBars | null)[]): number {
  let pick = -1;
  const rank = (n: NewBars) => [n.closes ? 1 : 0, n.fresh, n.bars];
  found.forEach((n, i) => {
    if (!n) return;
    const best = pick < 0 ? null : rank(found[pick]!);
    if (!best) pick = i;
    else {
      const mine = rank(n);
      const at = mine.findIndex((v, k) => v !== best[k]);
      if (at >= 0 && mine[at] > best[at]) pick = i;
    }
  });
  return pick;
}
