// Where the bars of a melody plan fall in a recording, found from the audio.
//
// The studio keeps the plan's tempo exactly, so the bars of a recording are
// the plan's bars shifted by some number of frames: a lead-in, bars played
// that the plan does not write, or a start the recording skips. The shift is
// found by ear, in effect: the notes and chords the plan writes for a phrase
// are slid along the recording's pitch content (which pitch classes sound,
// frame by frame), and the phrase sits where the two agree best. One phrase
// alone can be fooled, by a pattern that repeats or a singer who strays; all
// of them together are not, so a path is chosen through every phrase that
// changes its shift only where the evidence pays for it.
//
// Pure: the caller decodes the audio. Measured 2026-11-16 on the starter
// songs: one shift fits each song from start to end (142, 19 and -76 frames),
// within 3 frames of bar grids measured by hand.

import { AUDIO_FRAMES_PER_SECOND } from './types';
import { chordNotes } from './melodyPlan';
import type { MapTiming, SongMap } from './songMap';

const FPS = AUDIO_FRAMES_PER_SECOND;
/** Seconds of sound one pitch reading looks at: long enough to tell semitones apart down to the bass. */
const WINDOW_SEC = 0.186;
/** Melody and harmony are read from this band; the chords' bass notes from the one below. */
const MID_HZ = [180, 2000];
const LOW_HZ = [50, 260];
/**
 * How far from the plan's own position a phrase is looked for, either way: 8
 * bars, and never more than 30 seconds (the starter songs sit 6 s late at
 * most). With the plan read only as far as the recording can reach, this
 * bounds the work by the recording's length whatever the plan says.
 */
const SEARCH_BARS = 8;
const SEARCH_SEC = 30;
/**
 * What a change of shift between two phrases must be worth, in standard
 * deviations of a phrase's agreement. High on purpose: a song whose phrases
 * repeat agrees almost as well a whole phrase early or late, and at 3 or 6
 * the last phrases of two starter songs slid onto such a copy. A real change
 * (a bar played twice mid-song) pays this back within a few phrases.
 */
const CHANGE_COST = 10;
/** Around the shift a run of phrases settles on, each phrase's own best shift is looked for this many frames either way. */
const REFINE = 8;
/** A grid is trusted when the phrases the recording holds agree with it at least this well (median, in standard deviations). */
const MIN_FIT = 2;
/** And when the recording holds at least this many phrases: fewer can agree by chance. */
const MIN_HEARD = 4;

/** Which pitch classes sound in each 25 Hz frame: 12 numbers a frame (C to B), zero-mean and unit length. */
export interface PitchContent {
  frames: number;
  mid: Float32Array;
  low: Float32Array;
}

/** One shift per phrase of the map, in frames: where the phrase starts in the recording, less where the plan's tempo alone would put it. */
export interface BarGrid {
  v: 1;
  shifts: number[];
}

function unit(values: Float32Array, at: number): void {
  let mean = 0;
  for (let k = 0; k < 12; k++) mean += values[at + k];
  mean /= 12;
  let norm = 0;
  for (let k = 0; k < 12; k++) {
    values[at + k] -= mean;
    norm += values[at + k] * values[at + k];
  }
  norm = Math.sqrt(norm);
  // Silence, or nothing written: no pitch content at all.
  for (let k = 0; k < 12; k++) values[at + k] = norm < 1e-9 ? 0 : values[at + k] / norm;
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const r = re[i]; re[i] = re[j]; re[j] = r;
      const m = im[i]; im[i] = im[j]; im[j] = m;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const stride = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * stride];
        const s = sin[k * stride];
        const a = start + k;
        const b = a + half;
        const tr = re[b] * c + im[b] * s;
        const ti = im[b] * c - re[b] * s;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

/**
 * The pitch content of mono audio, one reading per 25 Hz frame of the take
 * (frame t is read from a window centred on that frame). 11,025 Hz is plenty:
 * nothing above 2 kHz is used.
 */
export function pitchContent(pcm: Float32Array, sampleRate: number): PitchContent {
  const size = 2 ** Math.round(Math.log2(WINDOW_SEC * sampleRate));
  const hop = sampleRate / FPS;
  const frames = Math.floor(pcm.length / hop);
  const window = new Float64Array(size);
  let windowSum = 0;
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
    windowSum += window[i];
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sin[i] = Math.sin((2 * Math.PI * i) / size);
  }
  // Each bin's pitch class, and the bands it counts in.
  const bins = size / 2;
  const pitchClass = new Int8Array(bins);
  const inMid = new Uint8Array(bins);
  const inLow = new Uint8Array(bins);
  for (let b = 1; b < bins; b++) {
    const hz = (b * sampleRate) / size;
    pitchClass[b] = ((Math.round(69 + 12 * Math.log2(hz / 440)) % 12) + 12) % 12;
    inMid[b] = hz >= MID_HZ[0] && hz <= MID_HZ[1] ? 1 : 0;
    inLow[b] = hz >= LOW_HZ[0] && hz <= LOW_HZ[1] ? 1 : 0;
  }
  const mid = new Float32Array(frames * 12);
  const low = new Float32Array(frames * 12);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let t = 0; t < frames; t++) {
    const first = Math.round((t + 0.5) * hop) - size / 2;
    for (let i = 0; i < size; i++) {
      const at = first + i;
      re[i] = at >= 0 && at < pcm.length ? pcm[at] * window[i] : 0;
      im[i] = 0;
    }
    fft(re, im, cos, sin);
    for (let b = 1; b < bins; b++) {
      if (!inMid[b] && !inLow[b]) continue;
      // Loudness is compressed so that a loud drum does not outweigh a held note.
      const level = Math.log1p((50 * Math.hypot(re[b], im[b])) / windowSum);
      if (inMid[b]) mid[t * 12 + pitchClass[b]] += level;
      if (inLow[b]) low[t * 12 + pitchClass[b]] += level;
    }
    unit(mid, t * 12);
    unit(low, t * 12);
  }
  return { frames, mid, low };
}

interface PlanContent {
  barFrames: number;
  /** The notes of both voices and, more quietly, the chords' notes. */
  all: Float32Array;
  /** The chords' bass notes. */
  bass: Float32Array;
}

/** What the plan writes in its first `limit` frames, as pitch content at the plan's own tempo. */
function planContent(map: SongMap, limit: number): PlanContent {
  const barFrames = map.ctx.secPerBar * FPS;
  const units = map.ctx.barUnits;
  const frames = Math.min(Math.round(map.bars * barFrames) + 1, limit);
  const all = new Float32Array(frames * 12);
  const bass = new Float32Array(frames * 12);
  const add = (into: Float32Array, fromBar: number, toBar: number, pitch: number, weight: number) => {
    const a = Math.round(fromBar * barFrames);
    const b = Math.max(a + 1, Math.round(toBar * barFrames));
    for (let f = a; f < b && f < frames; f++) into[f * 12 + (((pitch % 12) + 12) % 12)] += weight;
  };
  for (const it of map.phrases) {
    if (it.start * barFrames >= frames) break;
    const p = it.phrase;
    for (const n of [...p.vocal, ...p.ins]) add(all, it.start + n.pos / units, it.start + (n.pos + n.dur) / units, n.midi, 1);
    p.chords.forEach((c, ci) => {
      const voiced = chordNotes(c.name);
      if (!voiced) return;
      const from = it.start + c.pos / units;
      const to = it.start + (ci + 1 < p.chords.length ? p.chords[ci + 1].pos : p.bars * units) / units;
      for (const note of voiced.notes) add(all, from, to, note, 0.5);
      add(bass, from, to, voiced.bass, 1);
    });
  }
  for (let f = 0; f < frames; f++) {
    unit(all, f * 12);
    unit(bass, f * 12);
  }
  return { barFrames, all, bass };
}

/**
 * How well each phrase agrees with the recording at every shift from -reach to
 * +reach frames, as standard deviations from that phrase's own average. A
 * phrase may hang over either end of the recording by up to half its length
 * (a recording that skips the plan's first bar, or stops short of its last);
 * -Infinity where less than half of it would be heard, which for a phrase the
 * recording stops well short of is everywhere.
 */
function phraseCurves(map: SongMap, plan: PlanContent, audio: PitchContent, reach: number): Float32Array[] {
  const unheard = new Float32Array(2 * reach + 1).fill(-Infinity);
  return map.phrases.map((it) => {
    const a = Math.round(it.start * plan.barFrames);
    const b = Math.round((it.start + it.phrase.bars) * plan.barFrames);
    if (a >= audio.frames + reach) return unheard;
    const curve = new Float32Array(2 * reach + 1).fill(-Infinity);
    let sum = 0;
    let squares = 0;
    let count = 0;
    for (let s = -reach; s <= reach; s++) {
      const from = Math.max(a, -s);
      const to = Math.min(b, audio.frames - s);
      if (to - from < (b - a) / 2) continue;
      let agree = 0;
      for (let f = from; f < to; f++) {
        const p = f * 12;
        const q = (f + s) * 12;
        for (let k = 0; k < 12; k++) agree += plan.all[p + k] * audio.mid[q + k] + 0.5 * plan.bass[p + k] * audio.low[q + k];
      }
      agree /= to - from;
      curve[s + reach] = agree;
      sum += agree;
      squares += agree * agree;
      count++;
    }
    if (!count) return curve;
    const mean = sum / count;
    const spread = Math.sqrt(Math.max(0, squares / count - mean * mean)) || 1;
    for (let i = 0; i < curve.length; i++) if (curve[i] !== -Infinity) curve[i] = (curve[i] - mean) / spread;
    return curve;
  });
}

/**
 * One shift per phrase: the path through the phrases' agreement that is worth
 * most, where moving to another shift between two phrases costs CHANGE_COST.
 * A phrase the recording does not hold at some shift says nothing there,
 * for or against: a recording that stops mid-song is placed by the phrases it
 * has, and the rest follow them. Null when even the best path agrees poorly
 * (the recording does not follow the plan closely enough to be placed by it).
 */
function bestPath(curves: Float32Array[], reach: number): BarGrid | null {
  const width = 2 * reach + 1;
  const from: Int32Array[] = [];
  const worth = (v: number) => (v === -Infinity ? 0 : v);
  let score = Float64Array.from(curves[0], worth);
  for (let i = 1; i < curves.length; i++) {
    let top = 0;
    for (let s = 1; s < width; s++) if (score[s] > score[top]) top = s;
    const next = new Float64Array(width);
    const back = new Int32Array(width);
    for (let s = 0; s < width; s++) {
      const stay = score[s];
      const move = score[top] - CHANGE_COST;
      back[s] = stay >= move ? s : top;
      next[s] = worth(curves[i][s]) + Math.max(stay, move);
    }
    from.push(back);
    score = next;
  }
  let at = 0;
  for (let s = 1; s < width; s++) if (score[s] > score[at]) at = s;
  const shifts = new Array<number>(curves.length);
  for (let i = curves.length - 1; i >= 0; i--) {
    shifts[i] = at - reach;
    if (i > 0) at = from[i - 1][at];
  }
  const heard = shifts.map((s, i) => curves[i][s + reach]).filter((v) => v !== -Infinity).sort((x, y) => x - y);
  if (heard.length < MIN_HEARD || !(heard[heard.length >> 1] >= MIN_FIT)) return null;

  // The path's shift is the one that suits a whole run of phrases best in
  // sum, which broad agreement can pull a frame or two off. Each phrase that
  // agrees clearly also has its own best shift close by: the run takes their median.
  for (let start = 0; start < shifts.length;) {
    let stop = start + 1;
    while (stop < shifts.length && shifts[stop] === shifts[start]) stop++;
    const own: number[] = [];
    for (let i = start; i < stop; i++) {
      const lo = Math.max(0, shifts[start] + reach - REFINE);
      const hi = Math.min(width - 1, shifts[start] + reach + REFINE);
      let best = lo;
      for (let s = lo + 1; s <= hi; s++) if (curves[i][s] > curves[i][best]) best = s;
      // A peak, not the edge of a slope that keeps rising outside the neighbourhood.
      if (curves[i][best] >= MIN_FIT && best > lo && best < hi) own.push(best - reach);
    }
    if (own.length >= 3) shifts.fill(own.sort((x, y) => x - y)[own.length >> 1], start, stop);
    start = stop;
  }
  return { v: 1, shifts };
}

/** The bar grid of a recording, or null when the audio cannot place the plan. */
export function locateBars(map: SongMap, audio: PitchContent): BarGrid | null {
  if (!map.phrases.length || audio.frames < FPS) return null;
  const reach = Math.min(Math.round(SEARCH_BARS * map.ctx.secPerBar * FPS), SEARCH_SEC * FPS);
  // No phrase is compared with anything past the recording's end plus the reach.
  const plan = planContent(map, audio.frames + reach + 1);
  return bestPath(phraseCurves(map, plan, audio, reach), reach);
}

/** A stored grid, if it is one this build can read and it belongs to this map. */
export function readBarGrid(json: string | null | undefined, phrases: number): BarGrid | null {
  if (!json) return null;
  try {
    const grid = JSON.parse(json) as BarGrid;
    const whole = grid?.v === 1 && Array.isArray(grid.shifts) && grid.shifts.length === phrases && grid.shifts.every((s) => Number.isFinite(s));
    return whole ? { v: 1, shifts: grid.shifts } : null;
  } catch {
    return null;
  }
}

/** The frame a bar starts on, by a grid. */
export function barFrame(map: SongMap, grid: BarGrid, bar: number): number {
  const barFrames = map.ctx.secPerBar * FPS;
  let i = map.phrases.length - 1;
  while (i > 0 && map.phrases[i].start > bar) i--;
  return bar * barFrames + grid.shifts[i];
}

/**
 * Where the bars fall in a recording, by its measured grid. Each phrase starts
 * where the grid puts it and time runs evenly between phrase starts. The
 * recording's first second is the map's first bar whatever lead-in comes
 * before the music the plan writes: the first bar takes it up. Plan bars the
 * recording never reaches lie past `lastBar`.
 */
export function gridTiming(map: SongMap, grid: BarGrid, totalSec: number): MapTiming {
  const spb = map.ctx.secPerBar;
  // Anchors (bar, second), strictly rising in both.
  const bars = [0];
  const secs = [0];
  const anchor = (bar: number, sec: number) => {
    if (bar > bars[bars.length - 1] && sec > secs[secs.length - 1]) {
      bars.push(bar);
      secs.push(sec);
    }
  };
  anchor(Math.min(1, map.bars), barFrame(map, grid, Math.min(1, map.bars)) / FPS);
  for (const it of map.phrases) if (it.start >= 1) anchor(it.start, barFrame(map, grid, it.start) / FPS);
  const last = bars.length - 1;
  const secAt = (bar: number): number => {
    if (bar >= bars[last]) return secs[last] + (bar - bars[last]) * spb;
    let i = last;
    while (i > 0 && bars[i] > bar) i--;
    return secs[i] + ((bar - bars[i]) / (bars[i + 1] - bars[i])) * (secs[i + 1] - secs[i]);
  };
  const barAt = (sec: number): number => {
    if (sec >= secs[last]) return bars[last] + (sec - secs[last]) / spb;
    let i = last;
    while (i > 0 && secs[i] > sec) i--;
    return bars[i] + ((sec - secs[i]) / (secs[i + 1] - secs[i])) * (bars[i + 1] - bars[i]);
  };
  const reached = barAt(totalSec);
  return {
    total: totalSec,
    // A recording that stops within half a bar of the plan's end has performed it all.
    lastBar: reached >= map.bars - 0.5 ? map.bars : reached,
    secAt: (bar) => Math.min(totalSec, secAt(bar)),
    barAt: (sec) => Math.min(map.bars, barAt(sec)),
  };
}
