// The song map: a melody plan laid out as the song runs, with the phrases
// that share a tune marked as one pattern and the lyrics placed under the
// phrases that sing them. Pure; the Song map screen draws it and the music
// box plays it.

import { parseLyrics, tagFamily } from '../cowriter/lyrics';
import { PlanError, parsePlan, type MelodyPlan, type PlanContext, type PlanPhrase } from './melodyPlan';

export interface MapPhrase {
  phrase: PlanPhrase;
  /** Index into `SongMap.sections`. */
  section: number;
  /** Place within its section, from 0, and how many phrases the section has. */
  index: number;
  count: number;
  /** The bar it starts on, counted from the start of the song. */
  start: number;
  /** Phrases with the same number play the same tune; -1 is a tune heard once (or silence). */
  pattern: number;
  /** The lyric lines sung over it: an estimate, placed by syllable count. */
  words: string[];
}

export interface MapSection {
  name: string;
  start: number;
  bars: number;
}

export interface SongMap {
  ctx: PlanContext;
  sections: MapSection[];
  phrases: MapPhrase[];
  /** Bars in the whole plan. */
  bars: number;
  /** Lowest and highest pitch written anywhere, so every drawing shares one scale. */
  lo: number;
  hi: number;
}

// ---- "the same tune" -------------------------------------------------------

interface Shape {
  silent: boolean;
  sung: boolean;
  /** Pitch sounding in each note-length unit (0: none): the singer's line, or the instrument's when nobody sings. */
  grid: number[];
}

function shapeOf(p: PlanPhrase, barUnits: number): Shape {
  const sung = p.vocal.length > 0;
  const grid = new Array<number>(Math.round(p.bars * barUnits)).fill(0);
  for (const n of sung ? p.vocal : p.ins) {
    for (let u = Math.floor(n.pos); u < Math.min(grid.length, Math.ceil(n.pos + n.dur)); u++) grid[u] = n.midi;
  }
  return { silent: p.silent, sung, grid };
}

/** Share of the time either phrase sounds in which both sound the same pitch. */
function similarity(a: Shape, b: Shape): number {
  if (a.silent || b.silent) return a.silent && b.silent ? 1 : 0;
  if (a.sung !== b.sung) return 0;
  const n = Math.max(a.grid.length, b.grid.length);
  let active = 0;
  let match = 0;
  for (let u = 0; u < n; u++) {
    const x = a.grid[u] ?? 0;
    const y = b.grid[u] ?? 0;
    if (x || y) {
      active++;
      if (x === y) match++;
    }
  }
  return active ? match / active : 0;
}

/**
 * Groups phrases that play the same tune, in song order: each phrase joins
 * the earlier group it resembles most (at least `threshold`), or starts its
 * own. Returns one number per phrase: groups heard more than once are
 * numbered 0, 1, 2… by first appearance; everything else is -1.
 */
export function findPatterns(phrases: PlanPhrase[], barUnits: number, threshold = 0.7): number[] {
  const firsts: Shape[] = [];
  const ids = phrases.map((p) => {
    const shape = shapeOf(p, barUnits);
    if (shape.silent) return -1;
    let best = -1;
    let bestSim = threshold;
    firsts.forEach((f, fi) => {
      const sim = similarity(f, shape);
      if (sim >= bestSim) {
        best = fi;
        bestSim = sim;
      }
    });
    if (best < 0) {
      firsts.push(shape);
      best = firsts.length - 1;
    }
    return best;
  });
  const heard = new Map<number, number>();
  for (const id of ids) if (id >= 0) heard.set(id, (heard.get(id) ?? 0) + 1);
  const numbers = new Map<number, number>();
  for (const id of ids) if (id >= 0 && heard.get(id)! > 1 && !numbers.has(id)) numbers.set(id, numbers.size);
  return ids.map((id) => numbers.get(id) ?? -1);
}

// ---- lyrics ----------------------------------------------------------------

interface LyricBlock {
  tag: string;
  lines: string[];
}

function lyricKind(tag: string): 'intro' | 'outro' | 'chorus' | 'verse' | 'interlude' {
  if (/^intro/.test(tag)) return 'intro';
  if (/^outro/.test(tag)) return 'outro';
  if (/chorus/.test(tag) && !/pre/.test(tag)) return 'chorus';
  if (/verse|pre/.test(tag)) return 'verse';
  return 'interlude';
}

/**
 * Which lyric blocks belong to which part of the plan. The plan names fewer
 * kinds of part than the lyrics do (a pre-chorus is sung inside a verse; a
 * bridge, solo or outro is an interlude), so blocks are handed out in order.
 */
function attachLyrics(sectionNames: string[], blocks: LyricBlock[]): LyricBlock[][] {
  const out: LyricBlock[][] = sectionNames.map(() => []);
  if (!out.length) return out;
  let i = 0;
  const accepts = (want: string, b: LyricBlock, taken: number): boolean => {
    const k = lyricKind(b.tag);
    if (want === 'intro') return k === 'intro' && taken === 0;
    // A verse part takes one verse and what follows it (a pre-chorus). The
    // next verse, numbered or not ("verse 2"), belongs to the next verse part.
    if (want === 'verse') return k === 'verse' && (taken === 0 || tagFamily(b.tag) !== 'verse');
    if (want === 'chorus') return k === 'chorus' && taken === 0;
    if (want === 'outro') return k === 'outro' || k === 'interlude';
    return k === 'interlude' || k === 'outro' || (k === 'intro' && taken === 0);
  };
  sectionNames.forEach((name, si) => {
    const want = /verse/.test(name) ? 'verse' : /chorus/.test(name) ? 'chorus' : /^intro/.test(name) ? 'intro' : /^outro/.test(name) ? 'outro' : 'interlude';
    // Look a little ahead when the next block belongs somewhere else; what is
    // skipped stays with the part before.
    let j = i;
    while (j < blocks.length && j < i + 2 && !accepts(want, blocks[j], 0)) j++;
    if (j < blocks.length && j > i && accepts(want, blocks[j], 0)) {
      const home = si > 0 ? si - 1 : si;
      while (i < j) out[home].push(blocks[i++]);
    }
    let taken = 0;
    while (i < blocks.length && accepts(want, blocks[i], taken)) {
      out[si].push(blocks[i++]);
      taken++;
    }
  });
  while (i < blocks.length) out[out.length - 1].push(blocks[i++]);
  return out;
}

function syllables(line: string): number {
  let n = 0;
  for (const raw of line.split(/\s+/)) {
    const w = raw.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) continue;
    n += Math.max(1, w.replace(/e$/, '').match(/[aeiouy]+/g)?.length ?? 1);
  }
  return n;
}

/** Lays a part's lines under its phrases by syllable count against sung notes. An estimate. */
function placeLines(phrases: PlanPhrase[], lines: string[]): string[][] {
  const out: string[][] = phrases.map(() => []);
  if (!lines.length || !phrases.length) return out;
  // A phrase with a few stray notes is not where a line is sung.
  let room = phrases.map((p) => (p.onsets > 3 ? p.onsets : 0));
  let total = room.reduce((a, b) => a + b, 0);
  if (!total) {
    room = phrases.map((p) => p.bars);
    total = room.reduce((a, b) => a + b, 0);
  }
  const syl = lines.map((l) => Math.max(1, syllables(l)));
  const all = syl.reduce((a, b) => a + b, 0);
  let before = 0;
  lines.forEach((line, li) => {
    const mid = ((before + syl[li] / 2) / all) * total;
    before += syl[li];
    let reach = 0;
    let k = 0;
    for (; k < room.length; k++) {
      reach += room[k];
      if (room[k] > 0 && mid < reach) break;
    }
    if (k >= room.length) {
      k = room.length - 1;
      while (k > 0 && room[k] === 0) k--;
    }
    out[k].push(line);
  });
  return out;
}

// ---- the map ---------------------------------------------------------------

/** The map of a song, or null when its plan holds no music that can be read. */
export function buildSongMap(abc: string, lyrics: string): SongMap | null {
  let plan: MelodyPlan;
  try {
    plan = parsePlan(abc);
  } catch (err) {
    if (err instanceof PlanError) return null;
    throw err;
  }
  const all = plan.sections.flatMap((s) => s.phrases);
  if (!all.length) return null;
  const patterns = findPatterns(all, plan.ctx.barUnits);

  const parsed = parseLyrics(lyrics);
  const blocks: LyricBlock[] = [
    ...(parsed.preamble.length ? [{ tag: '', lines: parsed.preamble }] : []),
    ...parsed.sections,
  ];
  const attached = attachLyrics(plan.sections.map((s) => s.name), blocks);

  const sections: MapSection[] = [];
  const phrases: MapPhrase[] = [];
  // Words of parts written before any music, waiting for the first phrase.
  const opening: string[] = [];
  let bar = 0;
  let lo = 127;
  let hi = 0;
  plan.sections.forEach((s, si) => {
    if (!s.phrases.length) {
      // A part with no phrases has nowhere to show its words: they follow
      // the words of the last phrase before it, or lead the first phrase.
      const lines = attached[si].flatMap((b) => b.lines);
      (phrases.length ? phrases[phrases.length - 1].words : opening).push(...lines);
      return;
    }
    const words = placeLines(s.phrases, attached[si].flatMap((b) => b.lines));
    const section = sections.length;
    const start = bar;
    s.phrases.forEach((p, pi) => {
      for (const n of [...p.vocal, ...p.ins]) {
        lo = Math.min(lo, n.midi);
        hi = Math.max(hi, n.midi);
      }
      phrases.push({ phrase: p, section, index: pi, count: s.phrases.length, start: bar, pattern: patterns[phrases.length], words: words[pi] });
      bar += p.bars;
    });
    sections.push({ name: s.name, start, bars: bar - start });
  });
  phrases[0].words.unshift(...opening);
  if (lo > hi) [lo, hi] = [60, 72];
  return { ctx: plan.ctx, sections, phrases, bars: bar, lo, hi };
}

/** The phrase playing at a bar position. */
export function phraseAt(map: SongMap, bar: number): number {
  for (let i = map.phrases.length - 1; i > 0; i--) if (bar >= map.phrases[i].start - 1e-6) return i;
  return 0;
}

// ---- time ------------------------------------------------------------------

/** Where the bars of the map fall in time. */
export interface MapTiming {
  /** Seconds of sound: the recording's length, or the plan's at its own tempo. */
  total: number;
  /**
   * The bar where the sound ends: the last bar of the map, or an earlier one
   * when the recording was cut short before the plan's ending. Past it there
   * is nothing to play, and `secAt` runs beyond `total`.
   */
  lastBar: number;
  secAt(bar: number): number;
  barAt(sec: number): number;
}

/** Every bar the same length. Exact for the music box: bars × the plan's tempo. */
export function evenTiming(bars: number, totalSec: number): MapTiming {
  const perBar = bars > 0 ? totalSec / bars : 0;
  return {
    total: totalSec,
    lastBar: bars,
    secAt: (bar) => bar * perBar,
    barAt: (sec) => (perBar > 0 ? sec / perBar : 0),
  };
}

/**
 * Where the bars fall in a recording. An estimate, until bars are located by
 * measurement. The studio keeps the plan's tempo exactly (measured), so every
 * bar gets its written length; what the recording runs over or under
 * bars × tempo is taken up by the first phrase, where the starter songs have
 * it (a lead-in, an opening bar played more than once). On the two songs
 * whose bars were measured this lands within half a second from the second
 * phrase on; spreading the bars evenly was up to three bars early.
 *
 * `cutShort`: the song ran out of room before its ending, so its length says
 * nothing about a lead-in and the bars are counted from the start.
 */
export function recordingTiming(map: SongMap, totalSec: number, cutShort = false): MapTiming {
  const spb = map.ctx.secPerBar;
  const written = map.bars * spb;
  const over = cutShort ? 0 : totalSec - written;
  const first = map.phrases[0].phrase.bars;
  const opening = over + first * spb;
  // Further apart than an opening can explain (or one that would squeeze the
  // first phrase to under half its length): the tempo alone cannot place the bars.
  if (Math.abs(over) > 0.05 * written || opening < 0.5 * first * spb) return evenTiming(map.bars, totalSec);
  return {
    total: totalSec,
    // Counted from the start, a song cut short stops partway through its plan.
    lastBar: cutShort ? Math.min(map.bars, totalSec / spb) : map.bars,
    secAt: (bar) => (bar < first ? (bar / first) * opening : over + bar * spb),
    barAt: (sec) => (sec < opening ? (sec / opening) * first : (sec - over) / spb),
  };
}

// ---- music box -------------------------------------------------------------

export type BoxEvent =
  | { kind: 'singer' | 'instrument'; t: number; d: number; midi: number }
  | { kind: 'chord'; t: number; d: number; name: string };

/**
 * The plan from bar `from` to bar `to` as timed notes and chords, in seconds
 * from `from`, at the plan's own tempo.
 *
 * Tied notes sound once, also when the tie runs from one phrase into the
 * next. A sung note or a chord already sounding at `from` (playback started
 * in the middle of it) is held for what remains of it, so the box does not
 * open on silence; a plucked instrument note has mostly rung out by then and
 * is not struck again.
 */
export function musicBoxEvents(map: SongMap, from: number, to: number): BoxEvent[] {
  const spb = map.ctx.secPerBar;
  const units = map.ctx.barUnits;
  const EPS = 1e-6;
  const out: BoxEvent[] = [];
  /** Where a sound spanning bars [start, end) falls in the range: its time and length in seconds, or null. */
  const place = (start: number, end: number, resume: boolean): { t: number; d: number } | null => {
    if (start >= to) return null;
    if (start >= from - EPS) return { t: (start - from) * spb, d: (end - start) * spb };
    return resume && end > from + EPS ? { t: 0, d: (end - from) * spb } : null;
  };

  const voice = (lane: 'vocal' | 'ins', kind: 'singer' | 'instrument') => {
    // The whole voice as one line, in bars from the start of the song.
    const notes = map.phrases.flatMap((it) => it.phrase[lane].map((n) => ({
      start: it.start + n.pos / units, end: it.start + (n.pos + n.dur) / units, midi: n.midi, tie: n.tie,
    })));
    for (let i = 0; i < notes.length; i++) {
      const { start, midi } = notes[i];
      // A tie joins a note to the same pitch right after it.
      while (notes[i].tie && i + 1 < notes.length && notes[i + 1].midi === midi && Math.abs(notes[i + 1].start - notes[i].end) < EPS) i++;
      const at = place(start, notes[i].end, kind === 'singer');
      if (at) out.push({ kind, ...at, midi });
    }
  };
  voice('vocal', 'singer');
  voice('ins', 'instrument');

  for (const it of map.phrases) {
    const p = it.phrase;
    p.chords.forEach((c, ci) => {
      const until = ci + 1 < p.chords.length ? p.chords[ci + 1].pos : p.bars * units;
      const at = place(it.start + c.pos / units, it.start + until / units, true);
      if (at) out.push({ kind: 'chord', ...at, name: c.name });
    });
  }
  return out.sort((a, b) => a.t - b.t);
}
