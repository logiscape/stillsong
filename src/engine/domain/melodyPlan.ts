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
function parseLine(text: string, ctx: PlanContext, spend: (bars: number) => void): RawBar[] {
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
      bar.notes.push({ pos: bar.len, dur, midi: 60 + BASE[letter] + 12 * octave + shift, tie: !!m[8] });
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
  for (const l of lines) {
    const v = VOICE_LINE.exec(l);
    if (v) {
      voice = v[1] === 'Ins' ? 'Ins' : 'Vocal';
      continue;
    }
    if (l.trim()) for (const b of parseLine(l, ctx, spend)) lanes[voice].push(b);
  }
  const units = ctx.barUnits;
  // A bar written too long is squeezed into its bar so later bars stay in place.
  const squeeze = (b: RawBar) => (b.len > units ? units / b.len : 1);
  const flat = (bars: RawBar[]): PlanNote[] =>
    bars.flatMap((b, bi) => {
      const s = squeeze(b);
      return b.notes.map((n) => ({ pos: bi * units + n.pos * s, dur: n.dur * s, midi: n.midi, tie: n.tie }));
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
