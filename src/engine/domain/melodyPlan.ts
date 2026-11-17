// Reads a melody plan (the ABC score YuE2 performs) into sections, phrases and
// notes. Pure. The plan is kept line for line, so serializePlan gives back
// exactly the text that was read.
//
// A plan as the studio writes it: header fields (M, L, Q, K and two long
// `V:` voice definitions), then `% section` comments, and under each a run of
// phrases. One phrase is the singer's line (`V: Vocal`, with the chord
// symbols) and the instrument's line beneath it (`V: Ins`). No lyrics.

export interface PlanNote {
  /** Start, in units of the plan's note length (L), from the start of the phrase. */
  pos: number;
  dur: number;
  midi: number;
  /** Tied into the next note. */
  tie: boolean;
  /** Where the note is written: which of the phrase's lines, which bar of its voice, and the characters of its pitch (accidental, letter, octave marks). */
  line: number;
  bar: number;
  at: [start: number, end: number];
}

export interface PlanChord {
  pos: number;
  name: string;
  /** The bar of the phrase it is written in, from 0. */
  bar: number;
}

export interface PlanPhrase {
  /** The plan's own lines for this phrase, voice markers included, untouched. */
  lines: string[];
  bars: number;
  vocal: PlanNote[];
  ins: PlanNote[];
  chords: PlanChord[];
  /** Sung note starts (a tied note counts once): what words can sit on. */
  onsets: number;
  /** Neither voice plays: the band holds the chords. */
  silent: boolean;
}

export interface PlanSection {
  /** The `% name` line, or null for music written before any section comment. */
  headLine: string | null;
  name: string;
  phrases: PlanPhrase[];
}

export interface PlanContext {
  meterNum: number;
  meterDen: number;
  /** Note-length units in one bar. */
  barUnits: number;
  /** Beats a minute, as written in Q. */
  tempo: number;
  secPerBar: number;
  /** "D minor", "E♭ major". */
  keyLabel: string;
  /** The key signature: note letter -> +1 (sharp) or -1 (flat). */
  keyAcc: Record<string, number>;
}

export interface MelodyPlan {
  header: string[];
  ctx: PlanContext;
  sections: PlanSection[];
  /** Blank lines after the last phrase. */
  tail: string[];
}

const SHARPS = 'FCGDAEB';
const FLATS = 'BEADGCF';
const KEYSIG: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
  Am: 0, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7,
  Dm: -1, Gm: -2, Cm: -3, Fm: -4, Bbm: -5, Ebm: -6, Abm: -7,
};
const BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const VOICE_LINE = /^V:\s*(\w+)\s*$/;

/**
 * Thrown by parsePlan for a plan whose numbers are outside anything a song
 * could be. The plan is text the studio wrote or a person edited, and its
 * numbers size what the reader builds: a whole-bar rest carries its own count
 * (`Z4`), so one stray `Z4000000` would otherwise mean four million bars.
 */
export class PlanError extends Error {}

// A song is at most 500 s. At a quarter of a second per bar that is 2,000
// bars in each of the two voices; the starter songs write about 350 in all.
const MAX_WRITTEN_BARS = 4000;
// Note-length units in a bar: up to 32 in the starter songs; 256 is L:1/256 in 4/4.
const MAX_BAR_UNITS = 256;
// Seconds in a bar: 1.7 to 3.2 in the starter songs.
const BAR_SECONDS = { min: 0.1, max: 120 };

function parseKey(k: string): { acc: Record<string, number>; label: string } {
  const m = /^\s*([A-Ga-g])([#b]?)\s*(m(?!aj)|min|minor)?/.exec(k);
  const tonic = m ? m[1].toUpperCase() + m[2] : 'C';
  const minor = !!m?.[3];
  const n = KEYSIG[tonic + (minor ? 'm' : '')] ?? 0;
  const acc: Record<string, number> = {};
  for (let i = 0; i < n; i++) acc[SHARPS[i]] = 1;
  for (let i = 0; i < -n; i++) acc[FLATS[i]] = -1;
  return { acc, label: `${tonic.replace('#', '\u266F').replace('b', '\u266D')} ${minor ? 'minor' : 'major'}` };
}

function fraction(s: string, fallback: number): number {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(s);
  return m ? Number(m[1]) / Number(m[2]) : fallback;
}

function parseHeader(lines: string[]): PlanContext {
  const h: Record<string, string> = { M: '4/4', L: '1/8', Q: '1/4=90', K: 'C' };
  for (const l of lines) {
    const m = /^([MLQK]):(.*)$/s.exec(l);
    if (m) h[m[1]] = m[2].trim();
  }
  const meter = fraction(h.M, 1);
  const mm = /(\d+)\s*\/\s*(\d+)/.exec(h.M);
  const unit = fraction(h.L, 1 / 8);
  // "1/4=70": seventy quarter notes a minute. A bare number counts quarters.
  const qm = /(?:(\d+)\s*\/\s*(\d+)\s*=\s*)?(\d+(?:\.\d+)?)/.exec(h.Q);
  const tempo = qm ? Number(qm[3]) : 90;
  const beat = qm?.[1] ? Number(qm[1]) / Number(qm[2]) : 1 / 4;
  const key = parseKey(h.K);
  const barUnits = Math.round(meter / unit);
  const secPerBar = (meter / beat) * (60 / tempo);
  // Written so that a NaN (a zero in a fraction, a tempo of 0) fails too.
  if (!(barUnits >= 1 && barUnits <= MAX_BAR_UNITS)) throw new PlanError(`The plan's meter and note length give ${barUnits} notes to a bar.`);
  if (!(secPerBar >= BAR_SECONDS.min && secPerBar <= BAR_SECONDS.max)) throw new PlanError(`The plan's tempo gives bars of ${secPerBar} seconds.`);
  return {
    meterNum: mm ? Number(mm[1]) : 4,
    meterDen: mm ? Number(mm[2]) : 4,
    barUnits,
    tempo,
    secPerBar,
    keyLabel: key.label,
    keyAcc: key.acc,
  };
}

interface RawBar {
  len: number;
  notes: PlanNote[];
  chords: { pos: number; name: string }[];
}

// "chord" | accidental note octave length tie | rest length | bar line
// A length is a count, a fraction, or both: 3, /2, 3/2, and the shorthand / (a half), // (a quarter), 3/ (three halves).
const TOKEN = /"([^"]*)"|(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)(\d+)?(?:(\/+)(\d+)?)?(-)?|([zxZ])(\d+)?(?:(\/+)(\d+)?)?|(\|)/g;
const ACCIDENTAL: Record<string, number> = { '^': 1, '^^': 2, _: -1, __: -2, '=': 0 };

/** A note or rest length in units of L, from its count, its slashes and the number after them. */
function lengthOf(count: string | undefined, slashes: string | undefined, divisor: string | undefined): number {
  const over = !slashes ? 1 : divisor ? Number(divisor) : 2 ** slashes.length;
  const length = (count ? Number(count) : 1) / over;
  // "/0", or digits past what a number holds: one such length would turn every position after it into NaN.
  if (!Number.isFinite(length)) throw new PlanError('The plan writes a note or rest with no usable length.');
  return length;
}

/** `spend(n)` is told of every n bars before they are built, and throws when the plan has written too many. */
function parseLine(text: string, ctx: PlanContext, spend: (bars: number) => void, line: number): RawBar[] {
  const bars: RawBar[] = [];
  let bar: RawBar = { len: 0, notes: [], chords: [] };
  let wholeBars = 0;
  // An accidental holds for the rest of its bar, on that pitch only.
  let held: Record<string, number> = {};
  const close = () => {
    if (wholeBars) {
      spend(wholeBars);
      for (let k = 0; k < wholeBars; k++) bars.push({ len: ctx.barUnits, notes: [], chords: k === 0 ? bar.chords : [] });
    } else if (bar.len > 0 || bar.chords.length) {
      spend(1);
      bars.push(bar);
    }
    bar = { len: 0, notes: [], chords: [] };
    wholeBars = 0;
    held = {};
  };
  for (const m of text.matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      bar.chords.push({ pos: bar.len, name: m[1] });
    } else if (m[3]) {
      const dur = lengthOf(m[5], m[6], m[7]);
      const letter = m[3].toUpperCase();
      let octave = m[3] === letter ? 0 : 1;
      for (const mark of m[4]) octave += mark === ',' ? -1 : 1;
      const pitch = letter + octave;
      if (m[2]) held[pitch] = ACCIDENTAL[m[2]];
      const shift = held[pitch] ?? ctx.keyAcc[letter] ?? 0;
      const at: [number, number] = [m.index, m.index + (m[2]?.length ?? 0) + 1 + m[4].length];
      bar.notes.push({ pos: bar.len, dur, midi: 60 + BASE[letter] + 12 * octave + shift, tie: !!m[8], line, bar: 0, at });
      bar.len += dur;
    } else if (m[9]) {
      // Z is a whole bar of rest (Z3: three of them); z and x are rests of a length, like a note.
      if (m[9] === 'Z') {
        wholeBars = m[10] ? Number(m[10]) : 1;
        bar.len = ctx.barUnits * wholeBars;
      } else {
        bar.len += lengthOf(m[10], m[11], m[12]);
      }
    } else if (m[13]) {
      close();
    }
  }
  close();
  return bars;
}

function buildPhrase(lines: string[], ctx: PlanContext, spend: (bars: number) => void): PlanPhrase {
  const lanes: { Vocal: RawBar[]; Ins: RawBar[] } = { Vocal: [], Ins: [] };
  let voice: 'Vocal' | 'Ins' = 'Vocal';
  lines.forEach((l, li) => {
    const v = VOICE_LINE.exec(l);
    if (v) voice = v[1] === 'Ins' ? 'Ins' : 'Vocal';
    else if (l.trim()) for (const b of parseLine(l, ctx, spend, li)) lanes[voice].push(b);
  });
  const units = ctx.barUnits;
  // A bar written too long is squeezed into its bar so later bars stay in place.
  const squeeze = (b: RawBar) => (b.len > units ? units / b.len : 1);
  const flat = (bars: RawBar[]): PlanNote[] =>
    bars.flatMap((b, bi) => {
      const s = squeeze(b);
      return b.notes.map((n) => ({ ...n, pos: bi * units + n.pos * s, dur: n.dur * s, bar: bi }));
    });
  const vocal = flat(lanes.Vocal);
  const ins = flat(lanes.Ins);
  // Chords are written on the singer's line; a melody with no singer carries them itself.
  const chords = (lanes.Vocal.length ? lanes.Vocal : lanes.Ins).flatMap((b, bi) => {
    const s = squeeze(b);
    return b.chords.map((c) => ({ pos: bi * units + c.pos * s, name: c.name, bar: bi }));
  });
  let onsets = 0;
  let tied = false;
  for (const n of vocal) {
    if (!tied) onsets++;
    tied = n.tie;
  }
  return {
    lines,
    bars: Math.max(lanes.Vocal.length, lanes.Ins.length, 1),
    vocal,
    ins,
    chords,
    onsets,
    silent: vocal.length === 0 && ins.length === 0,
  };
}

/** Reads a plan. Throws PlanError for one whose numbers no song could have. */
export function parsePlan(abc: string): MelodyPlan {
  // Split on \n only: a \r stays on its line, so the text survives a round trip.
  const lines = abc.split('\n');
  let i = 0;
  const header: string[] = [];
  while (i < lines.length && lines[i][0] !== '%' && !VOICE_LINE.test(lines[i]) && /^[A-Za-z]:/.test(lines[i])) {
    header.push(lines[i]);
    i++;
  }
  const ctx = parseHeader(header);

  interface Draft { headLine: string | null; name: string; raw: string[][]; tail: string[] }
  const drafts: Draft[] = [];
  let sec: Draft | null = null;
  let cur: string[] | null = null;
  let has: { Vocal?: boolean; Ins?: boolean } = {};
  let voice: 'Vocal' | 'Ins' = 'Vocal';
  const startSection = (headLine: string | null, name: string): Draft => {
    const next: Draft = { headLine, name, raw: [], tail: [] };
    drafts.push(next);
    cur = null;
    return next;
  };
  const startPhrase = (into: Draft): string[] => {
    const next: string[] = [];
    has = {};
    into.raw.push(next);
    return next;
  };
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l[0] === '%') {
      sec = startSection(l, l.slice(1).trim().toLowerCase() || 'part');
      continue;
    }
    if (!sec) sec = startSection(null, 'song');
    const v = VOICE_LINE.exec(l);
    if (v) {
      voice = v[1] === 'Ins' ? 'Ins' : 'Vocal';
      // A phrase ends where the singer's marker comes round again (or the
      // instrument's, when it plays twice in a row).
      if (!cur || (voice === 'Vocal' && (has.Vocal || has.Ins)) || (voice === 'Ins' && has.Ins)) cur = startPhrase(sec);
      cur.push(l);
      continue;
    }
    if (!l.trim()) {
      if (cur) {
        cur.push(l);
      } else if (i < lines.length - 1) {
        cur = startPhrase(sec);
        cur.push(l);
      } else {
        sec.tail.push(l);
      }
      continue;
    }
    if (!cur || has[voice]) cur = startPhrase(sec);
    has[voice] = true;
    cur.push(l);
  }

  // The empty string after the final newline belongs to the plan, not to a phrase.
  let tail: string[] = [];
  const last = drafts[drafts.length - 1];
  if (last) {
    const lastRaw = last.raw[last.raw.length - 1];
    while (lastRaw?.length && lastRaw[lastRaw.length - 1] === '') tail.unshift(lastRaw.pop()!);
    tail = tail.concat(last.tail);
  }
  let room = MAX_WRITTEN_BARS;
  const spend = (bars: number) => {
    room -= bars;
    if (!(room >= 0)) throw new PlanError(`The plan writes more than ${MAX_WRITTEN_BARS} bars.`);
  };
  const sections = drafts.map((d) => ({
    headLine: d.headLine,
    name: d.name,
    phrases: d.raw.filter((r) => r.length).map((r) => buildPhrase(r, ctx, spend)),
  }));
  return { header, ctx, sections, tail };
}

/** The plan as text. With nothing changed it is the text that was parsed, character for character. */
export function serializePlan(
  header: string[],
  sections: { headLine: string | null; phrases: { lines: string[] }[] }[],
  tail: string[],
): string {
  const out = header.slice();
  for (const s of sections) {
    if (s.headLine !== null) out.push(s.headLine);
    for (const p of s.phrases) out.push(...p.lines);
  }
  return out.concat(tail).join('\n');
}

const LETTERS = 'CDEFGAB';
const WRITTEN: Record<string, string> = { '-2': '__', '-1': '_', '0': '=', '1': '^', '2': '^^' };
const PITCH = /^(\^\^|\^|__|_|=)?([A-Ga-g])([,']*)$/;
/** The lowest and highest pitch a note may be moved to (C2 to C7). */
const REACH = [36, 96];

interface Written { accidental: number | null; letter: string; octave: number }

function readPitch(text: string): Written {
  const m = PITCH.exec(text)!;
  const letter = m[2].toUpperCase();
  let octave = m[2] === letter ? 0 : 1;
  for (const mark of m[3]) octave += mark === ',' ? -1 : 1;
  return { accidental: m[1] ? ACCIDENTAL[m[1]] : null, letter, octave };
}

function writePitch(w: Written): string {
  const name = w.octave >= 1 ? w.letter.toLowerCase() + "'".repeat(w.octave - 1) : w.letter + ','.repeat(-w.octave);
  return (w.accidental === null ? '' : WRITTEN[w.accidental]) + name;
}

/** Which note of a plan: the phrase (counted through the whole song), the voice, and the note within it. */
export interface NoteRef {
  phrase: number;
  voice: 'vocal' | 'ins';
  note: number;
}

/**
 * The plan with one note moved `steps` steps of its key's scale (a note tied
 * to its neighbours moves with them). Only the bars that hold it are
 * rewritten, and every other note in them keeps its pitch: an accidental is
 * added where the move would otherwise change one. Null when the note cannot
 * be moved: it is not there, it is tied into the next phrase or out of the one
 * before, or the move leaves the range.
 */
export function stepNote(abc: string, ref: NoteRef, steps: number): string | null {
  const plan = parsePlan(abc);
  const phrases = plan.sections.flatMap((s) => s.phrases);
  const phrase = phrases[ref.phrase];
  const notes = phrase?.[ref.voice];
  const target = notes?.[ref.note];
  if (!target || !steps) return null;

  // The run of tied notes it belongs to.
  let first = ref.note;
  let last = ref.note;
  while (first > 0 && notes[first - 1].tie && notes[first - 1].midi === target.midi) first--;
  while (notes[last].tie && last + 1 < notes.length && notes[last + 1].midi === target.midi) last++;
  if (notes[last].tie && last === notes.length - 1) return null;
  const before = first === 0 ? phrases[ref.phrase - 1]?.[ref.voice] : undefined;
  if (before?.length && before[before.length - 1].tie && before[before.length - 1].midi === target.midi) return null;

  const from = readPitch(phrase.lines[target.line].slice(target.at[0], target.at[1]));
  const place = LETTERS.indexOf(from.letter) + from.octave * 7 + steps;
  const letter = LETTERS[((place % 7) + 7) % 7];
  const octave = Math.floor(place / 7);
  const natural = (l: string, o: number) => 60 + BASE[l] + 12 * o;
  const moved = natural(letter, octave) + (plan.ctx.keyAcc[letter] ?? 0);
  if (moved < REACH[0] || moved > REACH[1]) return null;

  // Every bar the run touches is spelled anew. The notes are read from the
  // lines as they stand and the new spellings put in afterwards, from the
  // right: a note that grows or shrinks ("B," to "C") would otherwise move
  // everything written after it on its line, and a run tied across a bar line
  // has more to rewrite there.
  const touched = new Set<string>();
  for (let i = first; i <= last; i++) touched.add(`${notes[i].line}:${notes[i].bar}`);
  const rewrites: { n: PlanNote; text: string }[] = [];
  for (const key of touched) {
    const inBar = notes.map((n, i) => ({ n, i })).filter(({ n }) => `${n.line}:${n.bar}` === key);
    const state: Record<string, number> = {};
    for (const { n, i } of inBar) {
      const was = readPitch(phrase.lines[n.line].slice(n.at[0], n.at[1]));
      const run = i >= first && i <= last;
      const now: Written = run ? { accidental: null, letter, octave } : was;
      const want = (run ? moved : n.midi) - natural(now.letter, now.octave);
      const slot = now.letter + now.octave;
      const implied = state[slot] ?? plan.ctx.keyAcc[now.letter] ?? 0;
      // A note that stays keeps what it was written with; an accidental is added only where its pitch would change.
      const accidental = !run && was.accidental !== null ? was.accidental : want === implied ? null : want;
      if (accidental !== null) state[slot] = accidental;
      rewrites.push({ n, text: writePitch({ ...now, accidental }) });
    }
  }
  const lines = phrase.lines.slice();
  for (const { n, text } of rewrites.sort((a, b) => b.n.at[0] - a.n.at[0])) lines[n.line] = lines[n.line].slice(0, n.at[0]) + text + lines[n.line].slice(n.at[1]);
  let index = 0;
  const sections = plan.sections.map((s) => ({ headLine: s.headLine, phrases: s.phrases.map((p) => ({ lines: index++ === ref.phrase ? lines : p.lines })) }));
  return serializePlan(plan.header, sections, plan.tail);
}

/** A chord symbol as pitches for the music box: a bass note and a close voicing above it. */
export function chordNotes(name: string): { bass: number; notes: number[] } | null {
  const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?/.exec(name);
  if (!m) return null;
  const pc = (letter: string, mark: string) => (BASE[letter] + (mark === '#' ? 1 : mark === 'b' ? -1 : 0) + 12) % 12;
  const root = pc(m[1], m[2]);
  const q = m[3];
  const third = /^m(?!aj)/.test(q) || /dim/.test(q) ? 3 : /sus4/.test(q) ? 5 : /sus2/.test(q) ? 2 : 4;
  const fifth = /dim/.test(q) ? 6 : /aug|\+/.test(q) ? 8 : 7;
  const steps = [0, third, fifth];
  if (/maj7/.test(q)) steps.push(11);
  else if (/7/.test(q)) steps.push(10);
  return {
    bass: 36 + (m[4] ? pc(m[4], m[5]) : root),
    notes: steps.map((s) => 48 + ((root + s) % 12)),
  };
}
