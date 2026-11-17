import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { barFrame, gridTiming, locateBars, pitchContent, readBarGrid, type BarGrid, type PitchContent } from '@engine/domain/barGrid';
import { buildSongMap, type SongMap } from '@engine/domain/songMap';
import { defaultSpec } from '@engine/domain/types';
import { Engine } from '@engine/index';
import { makePorts } from './fakes';

// The starter songs' plans, and the pitch content of their recordings as this
// code read it from the MP3s on 2026-11-16 (the audio decoded at 11,025 Hz;
// 12 numbers a frame for each band, stored as int8).
interface Example { spec: { title: string; lyrics: string }; abc: string; audio: string; actualSec: number }
const examples = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../examples/examples.json', import.meta.url)), 'utf8')) as { songs: Example[] }).songs;
const recordings = (() => {
  const data = gunzipSync(readFileSync(fileURLToPath(new URL('./fixtures/pitchContent.bin.gz', import.meta.url))));
  const headLength = data.readUInt32LE(0);
  const head = JSON.parse(data.subarray(4, 4 + headLength).toString('utf8')) as { slug: string; frames: number }[];
  let at = 4 + headLength;
  const out = new Map<string, PitchContent>();
  for (const { slug, frames } of head) {
    const band = () => {
      const values = Float32Array.from(new Int8Array(data.buffer, data.byteOffset + at, frames * 12), (v) => v / 127);
      at += frames * 12;
      return values;
    };
    out.set(slug, { frames, mid: band(), low: band() });
  }
  return out;
})();
function song(title: string): { map: SongMap; audio: PitchContent; total: number } {
  const s = examples.find((x) => x.spec.title === title)!;
  return { map: buildSongMap(s.abc, s.spec.lyrics)!, audio: recordings.get(s.audio.replace(/\.mp3$/, ''))!, total: s.actualSec };
}
const sameShift = (grid: BarGrid | null) => (grid && new Set(grid.shifts).size === 1 ? grid.shifts[0] : null);

function tone(hz: number, seconds: number, rate = 11025): Float32Array {
  return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate));
}
const strongest = (band: Float32Array, frame: number) => {
  let best = 0;
  for (let k = 1; k < 12; k++) if (band[frame * 12 + k] > band[frame * 12 + best]) best = k;
  return best;
};

describe('pitchContent', () => {
  it('reads one frame for every 25th of a second', () => {
    expect(pitchContent(tone(440, 2), 11025).frames).toBe(50);
    expect(pitchContent(tone(440, 2, 22050), 22050).frames).toBe(50);
  });

  it('hears which pitch class sounds, in the band it sounds in', () => {
    const a4 = pitchContent(tone(440, 2), 11025);
    expect(strongest(a4.mid, 25)).toBe(9); // A
    const e5 = pitchContent(tone(659.26, 2, 22050), 22050);
    expect(strongest(e5.mid, 25)).toBe(4); // E
    const d2 = pitchContent(tone(73.42, 2), 11025);
    expect(strongest(d2.low, 25)).toBe(2); // D, in the bass band
  });

  it('gives silence no pitch content', () => {
    const silent = pitchContent(new Float32Array(11025), 11025);
    expect(silent.mid.every((v) => v === 0) && silent.low.every((v) => v === 0)).toBe(true);
  });
});

describe('locateBars on the starter recordings', () => {
  it('finds one shift for each song, from its first phrase to its last', () => {
    expect(sameShift(locateBars(song('Where the Old Gods Stood').map, song('Where the Old Gods Stood').audio))).toBe(142);
    expect(sameShift(locateBars(song('Iron Ghost').map, song('Iron Ghost').audio))).toBe(19);
    // This recording starts almost a bar into its plan.
    expect(sameShift(locateBars(song('The Last Ember').map, song('The Last Ember').audio))).toBe(-76);
  });

  it('puts the bars within 3 frames of where they were measured by hand', () => {
    // Beat tracking and note checks on the recordings, 2026-11-16.
    const gods = song('Where the Old Gods Stood');
    const godsGrid = locateBars(gods.map, gods.audio)!;
    for (const bar of [25, 60, 101, 150]) expect(Math.abs(barFrame(gods.map, godsGrid, bar) - (13.75 + (bar + 3) * 42.857)), `bar ${bar}`).toBeLessThan(3);
    const ghost = song('Iron Ghost');
    const ghostGrid = locateBars(ghost.map, ghost.audio)!;
    for (const bar of [35, 100, 123]) expect(Math.abs(barFrame(ghost.map, ghostGrid, bar) - (21 + bar * 41.667)), `bar ${bar}`).toBeLessThan(3);
  });

  it('follows a bar that the recording plays twice', () => {
    // Bar 72 of "Iron Ghost", the last before its second verse, heard twice over.
    const { map, audio } = song('Iron Ghost');
    const from = Math.round(19 + 72 * 41.667);
    const to = Math.round(19 + 73 * 41.667);
    const again = (band: Float32Array) => Float32Array.from([...band.subarray(0, to * 12), ...band.subarray(from * 12, to * 12), ...band.subarray(to * 12)]);
    const grid = locateBars(map, { frames: audio.frames + to - from, mid: again(audio.mid), low: again(audio.low) })!;
    // The two-bar phrase that ends on the doubled bar (bars 71 and 72) can be heard either way.
    const before = map.phrases.map((p, i) => (p.start < 71 ? grid.shifts[i] : null)).filter((s) => s !== null);
    const after = map.phrases.map((p, i) => (p.start >= 73 ? grid.shifts[i] : null)).filter((s) => s !== null);
    expect(new Set(before)).toEqual(new Set([19]));
    expect(new Set(after).size).toBe(1);
    expect(Math.abs((after[0] as number) - (19 + to - from))).toBeLessThanOrEqual(2);
  });

  it('does not place a plan in a recording of another song', () => {
    expect(locateBars(song('Iron Ghost').map, song('The Last Ember').audio)).toBeNull();
    expect(locateBars(song('The Last Ember').map, song('Where the Old Gods Stood').audio)).toBeNull();
  });

  it('has nothing to say about a recording too short to hold a phrase', () => {
    const { map, audio } = song('Iron Ghost');
    expect(locateBars(map, { frames: 20, mid: audio.mid.subarray(0, 240), low: audio.low.subarray(0, 240) })).toBeNull();
  });
});

describe('a recording that stops before its plan does', () => {
  const cut = (a: PitchContent, frames: number): PitchContent => ({ frames, mid: a.mid.subarray(0, frames * 12), low: a.low.subarray(0, frames * 12) });
  const songs = [['Where the Old Gods Stood', 142], ['Iron Ghost', 19], ['The Last Ember', -76]] as const;

  it('is placed by the phrases it holds, and the phrases it never reaches follow them', () => {
    // Before, one phrase more than 8 bars past the end left the whole song without a grid.
    for (const [title, shift] of songs) {
      const { map, audio } = song(title);
      for (const keep of [0.9, 0.75, 0.5, 0.3]) {
        expect(sameShift(locateBars(map, cut(audio, Math.round(audio.frames * keep)))), `${title} cut to ${keep * 100}%`).toBe(shift);
      }
    }
  });

  it('ends its map where the recording ends', () => {
    const { map, audio } = song('Iron Ghost');
    const frames = Math.round(audio.frames / 2);
    const t = gridTiming(map, locateBars(map, cut(audio, frames))!, frames / 25);
    expect(t.lastBar).toBeCloseTo((frames - 19) / 41.667, 1);
    expect(t.lastBar).toBeLessThan(map.bars / 2 + 1);
  });

  it('is left alone when it holds too little to go by', () => {
    for (const [title] of songs) {
      const { map, audio } = song(title);
      expect(locateBars(map, cut(audio, 250)), title).toBeNull(); // ten seconds: two or three phrases
    }
  });
});

describe('the work of placing a plan', () => {
  it('is bounded by the recording, however much the plan writes', () => {
    // A thousand bars of 120 s, the slowest the plan reader accepts: 3,000,000
    // frames of plan against a recording of 7,308. Read whole, the plan's pitch
    // content alone took 288 MB; only the stretch the recording can reach is read.
    const abc = `X:1\nM:4/4\nL:1/8\nQ:1/4=2\nK:Dm\n% verse\n${Array.from({ length: 250 }, () => 'V: Vocal\n"Dm"d2a2a2d2|"Dm"d8|"Bb"f8|"C"e8|').join('\n')}\n`;
    const map = buildSongMap(abc, '')!;
    expect([map.bars, map.ctx.secPerBar]).toEqual([1000, 120]);
    const { audio } = song('Iron Ghost');
    const before = process.memoryUsage().arrayBuffers;
    expect(locateBars(map, audio)).toBeNull();
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(10e6);
  });

  it('finds music that starts late by less than its reach, and not by more', () => {
    // The reach is 8 bars (25.6 s for this song), and never more than 30 s. 40 s late is out of it.
    const { map, audio } = song('The Last Ember');
    const late = 1000;
    const pad = (band: Float32Array) => Float32Array.from([...new Float32Array(late * 12), ...band]);
    expect(sameShift(locateBars(map, { frames: audio.frames + 500, mid: pad(audio.mid).subarray(0, (audio.frames + 500) * 12), low: pad(audio.low).subarray(0, (audio.frames + 500) * 12) }))).not.toBe(-76 + late);
    // The same music 20 s late is found.
    const near = (band: Float32Array) => Float32Array.from([...new Float32Array(500 * 12), ...band]);
    expect(sameShift(locateBars(map, { frames: audio.frames + 500, mid: near(audio.mid), low: near(audio.low) }))).toBe(-76 + 500);
  });
});

describe('gridTiming', () => {
  it('starts every phrase where the grid puts it', () => {
    const { map, audio, total } = song('Where the Old Gods Stood');
    const t = gridTiming(map, locateBars(map, audio)!, total);
    for (const p of map.phrases.filter((x) => x.start >= 1)) expect(t.secAt(p.start)).toBeCloseTo((p.start * map.ctx.secPerBar * 25 + 142) / 25, 5);
    expect(t.secAt(25)).toBeCloseTo(48.54, 1); // the first verse; the plan's tempo alone says 42.9 s
  });

  it('runs from the first second to the last without a jump, both ways', () => {
    for (const title of ['Where the Old Gods Stood', 'Iron Ghost', 'The Last Ember']) {
      const { map, audio, total } = song(title);
      const t = gridTiming(map, locateBars(map, audio)!, total);
      expect(t.secAt(0)).toBe(0);
      expect(t.lastBar, title).toBe(map.bars); // each of these recordings performs its whole plan
      let before = -1;
      for (let bar = 0; bar <= map.bars - 1; bar += 0.25) {
        const sec = t.secAt(bar);
        expect(sec, `${title} bar ${bar}`).toBeGreaterThan(before);
        expect(sec).toBeLessThanOrEqual(total);
        expect(t.barAt(sec)).toBeCloseTo(bar);
        before = sec;
      }
    }
  });

  it('lets the first bar take up a lead-in, and squeezes it when the recording starts inside the plan', () => {
    const gods = song('Where the Old Gods Stood');
    const led = gridTiming(gods.map, { v: 1, shifts: gods.map.phrases.map(() => 142) }, gods.total);
    expect(led.secAt(1)).toBeCloseTo((142 + 42.857) / 25, 2); // 5.7 s of music before the plan's first bar
    expect(led.secAt(0.5)).toBeCloseTo(led.secAt(1) / 2);
    const ember = song('The Last Ember');
    const late = gridTiming(ember.map, { v: 1, shifts: ember.map.phrases.map(() => -76) }, ember.total);
    expect(late.secAt(1)).toBeCloseTo((80 - 76) / 25);
  });

  it('ends where the recording ends', () => {
    const { map } = song('Iron Ghost');
    const grid: BarGrid = { v: 1, shifts: map.phrases.map(() => 19) };
    const short = gridTiming(map, grid, 120);
    expect(short.lastBar).toBeCloseTo((120 * 25 - 19) / 41.667, 1);
    expect(short.secAt(map.bars)).toBe(120);
  });

  it('keeps going past a change of shift', () => {
    const { map, total } = song('Iron Ghost');
    const grid: BarGrid = { v: 1, shifts: map.phrases.map((p) => (p.start < 73 ? 19 : 61)) };
    const t = gridTiming(map, grid, total);
    expect(t.secAt(73)).toBeCloseTo((73 * 41.6667 + 61) / 25, 2);
    expect(t.secAt(72.99)).toBeLessThan(t.secAt(73));
    expect(t.barAt(t.secAt(100.5))).toBeCloseTo(100.5);
  });
});

describe('a stored grid', () => {
  it('is read back only when it is whole and belongs to the map', () => {
    expect(readBarGrid(JSON.stringify({ v: 1, shifts: [5, 5, 6] }), 3)).toEqual({ v: 1, shifts: [5, 5, 6] });
    expect(readBarGrid(JSON.stringify({ v: 1, shifts: [5, 5, 6] }), 4)).toBeNull(); // another plan's
    expect(readBarGrid(JSON.stringify({ v: 2, shifts: [5, 5, 6] }), 3)).toBeNull();
    expect(readBarGrid(JSON.stringify({ v: 1, shifts: [5, null, 6] }), 3)).toBeNull();
    expect(readBarGrid('not json', 3)).toBeNull();
    expect(readBarGrid(undefined, 3)).toBeNull();
  });

  it('is kept on the song', async () => {
    const { ports } = makePorts();
    const engine = await Engine.create(ports);
    const made = await engine.songs.create({ ...defaultSpec(), title: 'A song' }, 1);
    expect(made.barGrid).toBeUndefined();
    await engine.saveBarGrid(made.id, { v: 1, shifts: [142, 142] });
    expect(readBarGrid((await engine.songs.byId(made.id))!.barGrid, 2)).toEqual({ v: 1, shifts: [142, 142] });
  });
});
