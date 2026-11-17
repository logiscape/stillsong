// Extensions: a phrase played once more in the plan, what two plans differ by,
// where the take is cut and what is performed, the longer recording's bar
// grid, how a take is chosen, and the engine's pipeline around them.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '@engine/index';
import { defaultSpec, type Song, type SongSpec } from '@engine/domain/types';
import { parsePlan, stepNote } from '@engine/domain/melodyPlan';
import { barFrame, readBarGrid, type BarGrid } from '@engine/domain/barGrid';
import { buildSongMap } from '@engine/domain/songMap';
import {
  addedPhrases, bestNewBars, canRepeatPhrase, extendedGrid, extensionCut, extensionSeam, MAX_TAKE_FRAMES, planBefore, readNewBars, repeatPhrase, repeatsOffered,
  roomForBars, smoothestTake, type NewBars,
} from '@engine/domain/extension';
import { EDIT_PHASES, TAKES_OUT, WRITE_OUT } from '@engine/comfy/graphBuilder';
import { frameRanges } from '@engine/comfy/nodes';
import { flush, makePorts, type FakeClock, type FakeWorld } from './fakes';

interface Example { spec: { title: string; lyrics: string }; abc: string; actualSec: number }
const examples = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../examples/examples.json', import.meta.url)), 'utf8')) as { songs: Example[] }).songs;
const example = (title: string) => examples.find((s) => s.spec.title === title)!;
/** What the studio's plan writer wrote, live, going on from the end of a phrase of a starter song (see the file's note). */
const WRITTEN = (JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/writtenBars.json', import.meta.url)), 'utf8')) as {
  written: Record<string, Record<'free' | 'ins', Record<string, string>>>;
}).written;
const phrasesOf = (abc: string) => parsePlan(abc).sections.flatMap((s) => s.phrases);

// 4/4 at 120: a bar is 2 s, 50 frames. Phrases: 0 sung, 1 and 2 played (2 the same tune as 1), 3 played and tied into 4, 4 played, 5 sung.
const HEAD = 'X:1\nM:4/4\nL:1/8\nQ:1/4=120\nK:G\n';
const SUNG = 'V: Vocal\n"G"G2A2B2c2|"D"d8|\nV: Ins\nz8|z8|';
const RIFF = 'V: Vocal\n"G"z8|"D"z8|\nV: Ins\nG2B2d2B2|A2d2f2d2|';
const HELD = 'V: Vocal\n"C"z8|"G"z8|\nV: Ins\nc4e4|g8-|';
const AFTER = 'V: Vocal\n"G"z8|"D"z8|\nV: Ins\ng4d4|B8|';
const LAST = 'V: Vocal\n"G"B4A4|"G"G8|\nV: Ins\nz8|z8|';
const PLAN = `${HEAD}% verse\n${SUNG}\n% interlude\n${RIFF}\n${RIFF}\n${HELD}\n${AFTER}\n% outro\n${LAST}\n`;
const LYRICS = '[verse]\nA line to sing\n[interlude]\n[outro]\nAnd one more';
const map = (abc: string) => buildSongMap(abc, LYRICS)!;
const GRID: BarGrid = { v: 1, shifts: [10, 10, 10, 10, 10, 10] };

describe('playing a phrase once more', () => {
  it('writes the phrase again right after itself, and nothing else changes', () => {
    const longer = repeatPhrase(PLAN, 1)!;
    expect(longer).toBe(`${HEAD}% verse\n${SUNG}\n% interlude\n${RIFF}\n${RIFF}\n${RIFF}\n${HELD}\n${AFTER}\n% outro\n${LAST}\n`);
    expect(phrasesOf(longer)).toHaveLength(7);
    expect(map(longer).bars).toBe(map(PLAN).bars + 2);
    expect(map(longer).sections.map((s) => s.name)).toEqual(map(PLAN).sections.map((s) => s.name));
    // Twice more, in one go.
    expect(phrasesOf(repeatPhrase(PLAN, 1, 2)!)).toHaveLength(8);
  });

  it('is for a part that is played, not sung, with something after it', () => {
    const phrases = phrasesOf(PLAN);
    expect(phrases.map((_, i) => canRepeatPhrase(phrases, i))).toEqual([false, true, true, false, false, false]);
    expect(repeatPhrase(PLAN, 0)).toBeNull(); // sung: new bars would need words
    expect(repeatPhrase(PLAN, 3)).toBeNull(); // its last note is tied into the next phrase
    expect(repeatPhrase(PLAN, 4)).toBeNull(); // a note is tied into it
    expect(repeatPhrase(PLAN, 5)).toBeNull(); // sung, and the last phrase: nothing to hand back to
    expect(repeatPhrase(PLAN, 9)).toBeNull();
    expect(repeatPhrase('not a plan', 0)).toBeNull();
    // One bar is too little to play again, and a phrase that neither voice plays has nothing to play.
    const short = `${HEAD}% intro\nV: Vocal\n"G"z8|\nV: Ins\nG8|\n${RIFF}\n`;
    expect(repeatPhrase(short, 0)).toBeNull();
    const silent = `${HEAD}% intro\nV: Vocal\n"G"z8|"D"z8|\nV: Ins\nz8|z8|\n${RIFF}\n`;
    expect(repeatPhrase(silent, 0)).toBeNull();
  });

  it('offers eight new bars at most in one go, and always once', () => {
    const phrases = phrasesOf(PLAN);
    expect(repeatsOffered(phrases, 1)).toBe(4); // two bars a time
    expect(repeatsOffered(phrases, 0)).toBe(0);
    expect(repeatPhrase(PLAN, 1, 4)).toBeTruthy();
    expect(repeatPhrase(PLAN, 1, 5)).toBeNull();
    expect(repeatPhrase(PLAN, 1, 0)).toBeNull();
    expect(repeatPhrase(PLAN, 1, 1.5)).toBeNull();
    const twelve = `${HEAD}% intro\nV: Vocal\n${'"G"z8|'.repeat(12)}\nV: Ins\n${'G4B4|'.repeat(12)}\n${RIFF}\n`;
    expect(repeatsOffered(phrasesOf(twelve), 0)).toBe(1);
  });

  it('can be done to the instrumental phrases of the starter songs, and the plans still read', () => {
    for (const s of examples) {
      const phrases = phrasesOf(s.abc);
      const original = buildSongMap(s.abc, s.spec.lyrics)!;
      let offered = 0;
      phrases.forEach((p, i) => {
        const longer = repeatPhrase(s.abc, i);
        if (!longer) return;
        offered++;
        const after = buildSongMap(longer, s.spec.lyrics)!;
        expect(after.bars, `${s.spec.title} phrase ${i}`).toBe(original.bars + p.bars);
        expect(addedPhrases(original, after, i), `${s.spec.title} phrase ${i}`).toEqual({ after: i, phrases: 1, bars: p.bars, sung: false });
      });
      expect(offered, s.spec.title).toBeGreaterThan(1);
      expect(phrases.every((p, i) => p.vocal.length === 0 || !canRepeatPhrase(phrases, i)), s.spec.title).toBe(true);
    }
  });
});

describe('what a longer plan adds', () => {
  const original = map(PLAN);

  it('finds the new phrases and the bars they hold', () => {
    expect(addedPhrases(original, map(repeatPhrase(PLAN, 2)!))).toEqual({ after: 2, phrases: 1, bars: 2, sung: false });
    expect(addedPhrases(original, map(repeatPhrase(PLAN, 2, 3)!))).toEqual({ after: 2, phrases: 3, bars: 6, sung: false });
  });

  it('takes the place that was meant when the phrase already repeats', () => {
    // Phrases 1 and 2 are the same: one more could follow either. Unsaid, it follows the last.
    const longer = map(repeatPhrase(PLAN, 1)!);
    expect(addedPhrases(original, longer)?.after).toBe(2);
    expect(addedPhrases(original, longer, 1)?.after).toBe(1);
    expect(addedPhrases(original, longer, 2)?.after).toBe(2);
    // Ahead of the run is a place too: the plans read the same.
    expect(addedPhrases(original, longer, 0)?.after).toBe(0);
    // A place the plans rule out is not believed.
    expect(addedPhrases(original, longer, 3)?.after).toBe(2);
    expect(addedPhrases(original, longer, -1)?.after).toBe(2);
    expect(addedPhrases(original, longer, 1.5)?.after).toBe(2);
  });

  it('takes new phrases that are not copies, and says when one is sung', () => {
    const varied = stepNote(repeatPhrase(PLAN, 2)!, { phrase: 3, voice: 'ins', note: 0 }, 1)!;
    expect(addedPhrases(original, map(varied))).toEqual({ after: 2, phrases: 1, bars: 2, sung: false });
    const sung = PLAN.replace(`${HELD}\n`, `${SUNG}\n${HELD}\n`);
    expect(addedPhrases(original, map(sung))).toEqual({ after: 2, phrases: 1, bars: 2, sung: true });
  });

  it('is nothing else: notes moved, phrases taken out, another song, or new bars that open or close the song', () => {
    expect(addedPhrases(original, original)).toBeNull();
    expect(addedPhrases(original, map(stepNote(PLAN, { phrase: 0, voice: 'vocal', note: 0 }, 1)!))).toBeNull();
    expect(addedPhrases(map(repeatPhrase(PLAN, 1)!), original)).toBeNull(); // shorter
    // A phrase added and a note moved elsewhere: not one change.
    expect(addedPhrases(original, map(stepNote(repeatPhrase(PLAN, 1)!, { phrase: 0, voice: 'vocal', note: 0 }, 1)!))).toBeNull();
    // Before the first phrase or after the last there is nothing to lead in from, or to hand back to.
    expect(addedPhrases(original, map(`${HEAD}% verse\n${RIFF}\n${SUNG}\n% interlude\n${RIFF}\n${RIFF}\n${HELD}\n${AFTER}\n% outro\n${LAST}\n`))).toBeNull();
    expect(addedPhrases(original, map(PLAN.replace(`${LAST}\n`, `${LAST}\n${RIFF}\n`)))).toBeNull();
    // A part of the song that was not there, or another tempo.
    expect(addedPhrases(original, map(PLAN.replace('% outro', `% bridge\n${RIFF}\n% outro`)))).toBeNull();
    expect(addedPhrases(original, map(repeatPhrase(PLAN, 1)!.replace('Q:1/4=120', 'Q:1/4=100')))).toBeNull();
  });
});

describe('where the take is cut', () => {
  const original = map(PLAN);
  const ext = addedPhrases(original, map(repeatPhrase(PLAN, 2)!))!; // two new bars before phrase 3 (bar 6)

  it('opens the gap at the next phrase and performs the bar before it too', () => {
    // Bar 6 starts at 6 x 50 + 10 = 310; the cut is 2 frames early, with the first kept note's attack.
    expect(extensionCut(original, GRID, ext, 1060)).toEqual({ layout: '0-308,+100,308-1060', gap: [308, 408], window: [258, 408], frames: 1160 });
  });

  it('follows the bar grid, phrase by phrase', () => {
    const cut = extensionCut(original, { v: 1, shifts: [10, 10, 14, 30, 30, 30] }, ext, 1060)!;
    // The cut is where phrase 3 starts (its own shift); the lead-in bar belongs to phrase 2.
    expect(cut.gap[0]).toBe(6 * 50 + 30 - 2);
    expect(cut.window[0]).toBe(5 * 50 + 14 - 2);
  });

  it('rounds the gap to whole frames', () => {
    const ghost = example('Iron Ghost');
    const m = buildSongMap(ghost.abc, ghost.spec.lyrics)!;
    const grid: BarGrid = { v: 1, shifts: m.phrases.map(() => 19) };
    const e = addedPhrases(m, buildSongMap(repeatPhrase(ghost.abc, 33)!, ghost.spec.lyrics)!, 33)!;
    const cut = extensionCut(m, grid, e, 7308)!;
    // Four bars of 41.667 frames are 166.67: 167 go in (as the live run on 2026-11-17 had it).
    expect(cut).toEqual({ layout: '0-5309,+167,5309-7308', gap: [5309, 5476], window: [5267, 5476], frames: 7475 });
  });

  it('needs the recording to reach the place, with a second of it after', () => {
    expect(extensionCut(original, GRID, ext, 332)).toBeNull(); // the recording stops 24 frames after the cut
    expect(extensionCut(original, GRID, ext, 333)).toBeTruthy();
    expect(extensionCut(original, { v: 1, shifts: GRID.shifts.map(() => -400) }, ext, 1060)).toBeNull(); // the place is before the recording
    expect(extensionCut(original, GRID, { ...ext, after: 5 }, 1060)).toBeNull(); // nothing after the last phrase
  });

  it('never starts the window before the recording', () => {
    const early = addedPhrases(original, map(repeatPhrase(PLAN, 1)!), 1)!; // before bar 4
    expect(extensionCut(original, { v: 1, shifts: GRID.shifts.map(() => -160) }, early, 1060)?.window).toEqual([0, 138]);
  });
});

describe('the bars of the longer recording', () => {
  it('start where they did before the new bars, and later by the gap after them', () => {
    const ghost = example('Iron Ghost');
    const before = buildSongMap(ghost.abc, ghost.spec.lyrics)!;
    const after = buildSongMap(repeatPhrase(ghost.abc, 33)!, ghost.spec.lyrics)!;
    const grid: BarGrid = { v: 1, shifts: before.phrases.map((_, i) => 19 + (i % 3)) };
    const ext = addedPhrases(before, after, 33)!;
    const cut = extensionCut(before, grid, ext, 7308)!;
    const longer = extendedGrid(before, grid, ext, cut);
    expect(longer.shifts).toHaveLength(after.phrases.length);
    expect(readBarGrid(JSON.stringify(longer), after.phrases.length)).toEqual(longer);
    const added = cut.gap[1] - cut.gap[0];
    before.phrases.forEach((p, i) => {
      const was = barFrame(before, grid, p.start);
      const now = barFrame(after, longer, after.phrases[i <= 33 ? i : i + 1].start);
      expect(now, `phrase ${i}`).toBeCloseTo(i <= 33 ? was : was + added, 6);
    });
    // The new phrase starts where the one after it used to.
    expect(barFrame(after, longer, after.phrases[34].start)).toBeCloseTo(barFrame(before, grid, before.phrases[34].start), 6);
  });

  it('does not drift when a song is made longer again and again', () => {
    // A bar of "Iron Ghost" is 41.667 frames: each gap is rounded, and the rounding must not add up.
    const ghost = example('Iron Ghost');
    let abc = ghost.abc;
    let m = buildSongMap(abc, ghost.spec.lyrics)!;
    let grid: BarGrid = { v: 1, shifts: m.phrases.map(() => 19) };
    let frames = 7308;
    const lastWas = barFrame(m, grid, m.phrases[m.phrases.length - 1].start);
    let added = 0;
    for (let round = 0; round < 6; round++) {
      const longerAbc = repeatPhrase(abc, 33)!;
      const next = buildSongMap(longerAbc, ghost.spec.lyrics)!;
      const ext = addedPhrases(m, next, 33)!;
      const cut = extensionCut(m, grid, ext, frames)!;
      grid = extendedGrid(m, grid, ext, cut);
      added += cut.gap[1] - cut.gap[0];
      [abc, m, frames] = [longerAbc, next, cut.frames];
    }
    expect(frames).toBe(7308 + added);
    expect(barFrame(m, grid, m.phrases[m.phrases.length - 1].start)).toBeCloseTo(lastWas + added, 6);
  });
});

describe('choosing a take of the new bars', () => {
  const cut = { layout: '0-308,+100,308-1060', gap: [308, 408] as [number, number], window: [258, 408] as [number, number], frames: 1160 };

  it('scores the kept second after the new bars against the same music where it used to be', () => {
    const base = new Array<number>(1060).fill(-1);
    const under = new Array<number>(1160).fill(-1);
    for (let f = 408; f < 433; f++) under[f] = -3; // the second after the gap
    under[433] = -50; // past it: not counted
    under[300] = -50; // before it: not counted
    expect(extensionSeam(cut, base, under)).toBe(-50);
    base[308] = -11; // the first kept frame, where it used to be
    expect(extensionSeam(cut, base, under)).toBe(-40);
  });

  it('refuses series that are not the takes it asked about', () => {
    expect(extensionSeam(cut, new Array(1060).fill(0), new Array(1060).fill(0))).toBeNull();
    expect(extensionSeam(cut, new Array(1160).fill(0), new Array(1160).fill(0))).toBeNull();
  });

  it('takes the one that hands back best', () => {
    expect(smoothestTake([-60, -35, -90, -35.5])).toBe(1);
    expect(smoothestTake([-60])).toBe(0);
    expect(smoothestTake([])).toBe(-1);
  });
});

// ---- the engine --------------------------------------------------------------

const spec = (over: Partial<SongSpec> = {}): SongSpec => ({
  ...defaultSpec(),
  title: 'Test',
  caption: 'Global Metadata: a\n\nVocal Details: b\n\nArrangement: c',
  lyrics: LYRICS,
  targetSec: 20,
  seed: '7',
  ...over,
});

async function settle(engine: Engine, world: FakeWorld, clock: FakeClock, id: string): Promise<Song> {
  world.historyStatus = 'success';
  for (let i = 0; i < 12; i++) {
    await clock.advance(10_000);
    await flush();
    const song = (await engine.songs.byId(id))!;
    if (song.status !== 'queued' && song.status !== 'running') return song;
  }
  throw new Error('the job did not finish');
}

/** A finished song with a take, this plan, and its bars found (12 bars of 2 s; the take is 42.4 s, 1060 frames). */
async function rendered() {
  const made = makePorts();
  made.world.takeNodes = true;
  made.world.planText = PLAN;
  const engine = await Engine.create(made.ports);
  const queued = await engine.enqueueSong(spec());
  await flush();
  let original = await settle(engine, made.world, made.clock, queued.id);
  await engine.saveBarGrid(original.id, GRID);
  original = (await engine.songs.byId(original.id))!;
  made.world.historyStatus = 'running';
  return { ...made, engine, original };
}

/** Phrase 2 of the song played once more. */
const longer = (original: Song, over: Partial<SongSpec> = {}): SongSpec => ({
  ...original.spec,
  seed: '1000',
  abc: repeatPhrase(original.planAbc!, 2)!,
  edit: { sourceId: original.id, after: 2 },
  ...over,
});

describe('an extension in the engine', () => {
  it('opens a gap in the take, sings several takes of the new bars, performs the smoothest and keeps the rest', async () => {
    const { engine, world, clock, original } = await rendered();
    expect(original.planAbc).toBe(PLAN);
    world.takeScores = [{ fit: 0, seam: -60 }, { fit: 0, seam: -45 }, { fit: 0, seam: -31 }, { fit: 0, seam: -90 }, { fit: 0, seam: -40 }];
    const phases: string[] = [];
    engine.on((e) => { if (e.kind === 'progress' && phases[phases.length - 1] !== e.progress.phase) phases.push(e.progress.phase); });
    const before = world.submittedGraphs.length;
    const queued = await engine.enqueueSong(longer(original), original.id);
    await flush();
    const done = await settle(engine, world, clock, queued.id);
    expect(done.status).toBe('done');
    expect(phases).toContain(EDIT_PHASES.extending);

    const [takes, perform] = world.submittedGraphs.slice(before);
    expect(world.submittedGraphs.length - before).toBe(2);
    const layout = '0-308,+100,308-1060';
    const redo = frameRanges([[258, 408]]);
    // The takes: the take laid out anew, the window sung once per seed under the longer plan, each scored; no audio.
    expect(takes.arrange).toEqual({ class_type: 'Stillsong2ArrangeTake', inputs: { tokens: ['source', 0], samples: ['source', 1], layout } });
    const singers = Object.values(takes).filter((n) => n.class_type === 'Stillsong2Resing');
    expect(singers.map((n) => n.inputs.seed)).toEqual([1000, 1001, 1002, 1003, 1004]);
    expect(singers.every((n) => n.inputs.redo === redo && n.inputs.abc === queued.spec.abc && (n.inputs.tokens as unknown[])[0] === 'arrange')).toBe(true);
    expect(takes[TAKES_OUT.base].inputs).toMatchObject({ abc: PLAN, tokens: ['source', 0] });
    expect(Object.values(takes).filter((n) => n.class_type === 'Stillsong2Score')).toHaveLength(6);
    expect(Object.values(takes).some((n) => n.class_type === 'KSampler')).toBe(false);

    // The third take hands back best. It is performed from the same layout, the kept frames held and put back.
    expect(perform.arrange.inputs.layout).toBe(layout);
    expect(perform.perform.inputs).toMatchObject({ seed: 1002, abc: queued.spec.abc, redo, tokens: ['arrange', 0], lyrics: original.spec.lyrics });
    expect(perform.hold.inputs).toEqual({ samples: ['arrange', 1], redo });
    expect(perform.restore.inputs).toEqual({ samples: ['sample', 0], take: ['arrange', 1], redo });
    expect(perform.take.inputs).toMatchObject({ samples: ['restore', 0], tokens: ['perform', 2] });

    expect(done.spec.seed).toBe('1002');
    expect(done.planAbc).toBe(queued.spec.abc);
    expect(done.editWindows).toEqual([[258, 408]]);
    expect(done.actualSec).toBeCloseTo(original.actualSec! + 4, 9); // two bars of two seconds
    expect(done.takePath).toBeTruthy();
    // The bars of the longer recording: one phrase more, and everything after the new bars 100 frames later.
    const grid = readBarGrid(done.barGrid, 7)!;
    expect(grid.shifts).toEqual([10, 10, 10, 10, 10, 10, 10]);
    const after = buildSongMap(done.planAbc!, LYRICS)!;
    expect(barFrame(after, grid, after.phrases[4].start)).toBe(410);
  });

  it('puts the new bars where it was told when the phrase already repeats', async () => {
    const { engine, world, clock, original } = await rendered();
    const queued = await engine.enqueueSong(longer(original, { abc: repeatPhrase(original.planAbc!, 1)!, edit: { sourceId: original.id, after: 1 } }), original.id);
    await flush();
    const done = await settle(engine, world, clock, queued.id);
    expect(done.status).toBe('done');
    // After phrase 1: the next phrase starts on bar 4, frame 210.
    expect(world.submittedGraphs[world.submittedGraphs.length - 1].arrange.inputs.layout).toBe('0-208,+100,208-1060');
    expect(done.editWindows).toEqual([[158, 308]]);
  });

  it('a version made longer can be made longer again, from its own take and bars', async () => {
    const { engine, world, clock, original } = await rendered();
    let queued = await engine.enqueueSong(longer(original), original.id);
    await flush();
    const first = await settle(engine, world, clock, queued.id);
    world.historyStatus = 'running';
    // The fake studio's takes are always 1060 frames: say so for the version it "made".
    await engine.songs.setOutput(first.id, { outputPath: first.outputPath!, composed: { actualSec: 42.4, hitCeiling: false }, planAbc: first.planAbc, takePath: first.takePath, editWindows: first.editWindows });
    const again = (await engine.songs.byId(first.id))!;
    queued = await engine.enqueueSong(longer(again, { abc: repeatPhrase(again.planAbc!, 2)!, edit: { sourceId: again.id, after: 2 } }), again.id);
    await flush();
    const second = await settle(engine, world, clock, queued.id);
    expect(second.status).toBe('done');
    expect(buildSongMap(second.planAbc!, LYRICS)!.phrases).toHaveLength(8);
    expect(readBarGrid(second.barGrid, 8)).toBeTruthy();
  });

  it('refuses, in plain words, what it cannot perform', async () => {
    const { engine, world, clock, original } = await rendered();
    const before = world.submittedGraphs.length;
    const fail = async (over: Partial<SongSpec>, prepare?: () => Promise<void>) => {
      world.historyStatus = 'running';
      await prepare?.();
      const queued = await engine.enqueueSong(longer(original, over), original.id);
      await flush();
      return (await settle(engine, world, clock, queued.id)).error;
    };
    // New bars that are sung would need words.
    expect(await fail({ abc: PLAN.replace(`${HELD}\n`, `${SUNG}\n${HELD}\n`) })).toMatch(/without singing/);
    expect(await fail({ lyrics: LYRICS.replace('A line', 'A word') })).toMatch(/one at a time/);
    // A phrase added and a note moved: neither an extension nor a melody edit.
    expect(await fail({ abc: stepNote(repeatPhrase(PLAN, 2)!, { phrase: 0, voice: 'vocal', note: 0 }, 1)! })).toMatch(/Only the notes/);
    expect(await fail({}, () => engine.songs.setBarGrid(original.id, 'not a grid'))).toMatch(/Open its Song map/);
    await engine.saveBarGrid(original.id, GRID);
    // A recording that stops before the place.
    const short = { outputPath: original.outputPath!, composed: { actualSec: 12, hitCeiling: false }, planAbc: original.planAbc, takePath: original.takePath };
    expect(await fail({}, () => engine.songs.setOutput(original.id, short))).toMatch(/not in the recording/);
    // A song at the studio's limit.
    const full = { ...short, composed: { actualSec: (MAX_TAKE_FRAMES - 50) / 25, hitCeiling: false } };
    expect(await fail({}, () => engine.songs.setOutput(original.id, full))).toMatch(/as long as the studio can make it/);
    expect(world.submittedGraphs.length - before).toBe(0); // nothing was sent to the studio for any of them
  });

  it('fails when the studio answers about another take', async () => {
    const { engine, world, clock, original } = await rendered();
    world.takeSeriesFrames = 999;
    const before = world.submittedGraphs.length;
    const queued = await engine.enqueueSong(longer(original), original.id);
    await flush();
    const failed = await settle(engine, world, clock, queued.id);
    expect(failed.error).toMatch(/did not say how the new takes went/);
    expect(world.submittedGraphs.length - before).toBe(1); // nothing was performed
  });

  it('a melody edit still goes its own way', async () => {
    const { engine, world, clock, original } = await rendered();
    const before = world.submittedGraphs.length;
    const moved = { ...original.spec, seed: '1000', abc: stepNote(original.planAbc!, { phrase: 0, voice: 'vocal', note: 1 }, 1)!, edit: { sourceId: original.id } };
    const queued = await engine.enqueueSong(moved, original.id);
    await flush();
    const done = await settle(engine, world, clock, queued.id);
    expect(done.status).toBe('done');
    const [takes, perform] = world.submittedGraphs.slice(before);
    expect(takes.arrange).toBeUndefined();
    expect(perform.arrange).toBeUndefined();
    expect(perform.hold.inputs.samples).toEqual(['source', 1]);
    expect(done.actualSec).toBe(original.actualSec);
    expect(done.barGrid).toBe(original.barGrid);
  });
});

// ---- new bars, written by the studio -------------------------------------------

// What the writer might write after phrase 2 of PLAN (a RIFF over G and D, two bars).
const NEW_RIFF = 'V: Vocal\n"G"z8|"D"z8|\nV: Ins\nB2d2g2d2|A2f2a2f2|';
const NEW_TURN = 'V: Vocal\n"C"z8|"G"z8|\nV: Ins\ne2g2c\'2g2|d2g2b2g2|';
const NEXT = 'V: Vocal\n"C"z8|';
const insLine = (phrase: string) => phrase.split('\n')[3];

describe('the plan so far, for the writer to go on from', () => {
  it('is the plan\'s own text up to the end of the phrase, ending in a line break', () => {
    const before = planBefore(PLAN, 2)!;
    expect(before).toBe(`${HEAD}% verse\n${SUNG}\n% interlude\n${RIFF}\n${RIFF}\n`);
    expect(PLAN.startsWith(before)).toBe(true);
    for (const s of examples) {
      const phrases = phrasesOf(s.abc);
      phrases.forEach((_, i) => {
        const text = planBefore(s.abc, i);
        if (text === null) return expect(canRepeatPhrase(phrases, i), `${s.spec.title} ${i}`).toBe(false);
        expect(s.abc.startsWith(text), `${s.spec.title} ${i}`).toBe(true);
        expect(text.endsWith(`${phrases[i].lines.join('\n')}\n`), `${s.spec.title} ${i}`).toBe(true);
      });
    }
  });

  it('can begin the next phrase for it: the same chords under rests, the instrument\'s line left to write', () => {
    expect(planBefore(PLAN, 2, true)).toBe(`${HEAD}% verse\n${SUNG}\n% interlude\n${RIFF}\n${RIFF}\nV: Vocal\n"G"z8|"D"z8|\nV: Ins\n`);
    // A phrase not written as a singer's line and an instrument's cannot be begun this way.
    const one = `${HEAD}% intro\nV: Ins\nG2B2d2B2|A2d2f2d2|\n${RIFF}\n`;
    expect(planBefore(one, 0)).toBeTruthy();
    expect(planBefore(one, 0, true)).toBeNull();
  });

  it('is not given for a phrase new bars cannot follow', () => {
    expect(planBefore(PLAN, 0)).toBeNull(); // sung
    expect(planBefore(PLAN, 3)).toBeNull(); // tied into the next phrase
    expect(planBefore(PLAN, 5)).toBeNull(); // the last
    expect(planBefore('not a plan', 0)).toBeNull();
  });
});

describe('reading what the writer wrote', () => {
  const read = (written: string, maxBars = 8, lineOnly = false) => readNewBars(PLAN, LYRICS, 2, written, maxBars, lineOnly);

  it('takes the phrases it wrote first and puts them into the plan, after the phrase', () => {
    const found = read(`${NEW_RIFF}\n${NEW_TURN}\n${NEXT}`)!;
    expect(found).toMatchObject({ phrases: 2, bars: 4, fresh: 2, closes: false });
    expect(found.abc).toBe(`${HEAD}% verse\n${SUNG}\n% interlude\n${RIFF}\n${RIFF}\n${NEW_RIFF}\n${NEW_TURN}\n${HELD}\n${AFTER}\n% outro\n${LAST}\n`);
    expect(addedPhrases(map(PLAN), map(found.abc), 2)).toEqual({ after: 2, phrases: 2, bars: 4, sung: false });
    // One phrase that sits on the chords it left from: what came next can come next again.
    expect(read(`${NEW_RIFF}\n${NEXT}`)).toMatchObject({ phrases: 1, bars: 2, fresh: 1, closes: true });
  });

  it('never takes the last phrase written: the text may have been cut off inside it', () => {
    expect(read(`${NEW_RIFF}\n${NEW_TURN}`)).toMatchObject({ phrases: 1 }); // NEW_TURN could be half a phrase
    expect(read(NEW_RIFF)).toBeNull();
    expect(read(`${NEW_RIFF}\nV: Vocal\n"C"z8|"G"z8|\nV: Ins\ne2g2c`)).toMatchObject({ phrases: 1 });
    expect(read('')).toBeNull();
    expect(read('V: Voc')).toBeNull();
  });

  it('stops where the writer moves on: a sung phrase, another part of the song, a phrase of another length', () => {
    const sung = 'V: Vocal\n"G"z8|"D"z4d2f2|\nV: Ins\nB2d2g2d2|A2f2z4|';
    expect(read(`${NEW_RIFF}\n${sung}\n${NEW_TURN}\n${NEXT}`)).toMatchObject({ phrases: 1 });
    expect(read(`${sung}\n${NEW_RIFF}\n${NEXT}`)).toBeNull();
    expect(read(`${NEW_RIFF}\n% chorus\n${NEW_TURN}\n${NEXT}`)).toMatchObject({ phrases: 1 });
    expect(read(`% chorus\n${NEW_RIFF}\n${NEXT}`)).toBeNull();
    // The one-bar tag the writer ends an intro with is not more of a part in two-bar phrases.
    const tag = 'V: Vocal\n"G"z8|\nV: Ins\nB2d2g2d2|';
    expect(read(`${NEW_RIFF}\n${tag}\n${NEXT}`)).toMatchObject({ phrases: 1, bars: 2 });
    expect(read(`${tag}\n${NEW_RIFF}\n${NEXT}`)).toBeNull();
    // Rests in both voices are no bars to add.
    expect(read(`V: Vocal\n"G"z8|"D"z8|\nV: Ins\nz8|z8|\n${NEXT}`)).toBeNull();
  });

  it('takes no more bars than there is room for, and no phrase that would tie onto what follows', () => {
    expect(read(`${NEW_RIFF}\n${NEW_TURN}\n${NEXT}`, 3)).toMatchObject({ phrases: 1, bars: 2 });
    expect(read(`${NEW_RIFF}\n${NEW_TURN}\n${NEXT}`, 1)).toBeNull();
    const tied = 'V: Vocal\n"C"z8|"G"z8|\nV: Ins\ne2g2c\'2g2|d8-|';
    expect(read(`${NEW_RIFF}\n${tied}\n${NEXT}`)).toMatchObject({ phrases: 1 });
    expect(read(`${tied}\n${NEXT}`)).toBeNull();
  });

  it('wants something new: phrases the song already has are the duplicate this avoids', () => {
    expect(read(`${RIFF}\n${NEXT}`)).toBeNull();
    expect(read(`${RIFF}\n${AFTER}\n${NEXT}`)).toBeNull();
    expect(read(`${RIFF}\n${NEW_TURN}\n${NEXT}`)).toMatchObject({ phrases: 2, fresh: 1 });
  });

  it('reads an instrument\'s line written over the phrase\'s own chords', () => {
    const found = read(`${insLine(NEW_RIFF)}\n${NEXT}`, 8, true)!;
    expect(found).toMatchObject({ phrases: 1, bars: 2, fresh: 1, closes: true });
    expect(found.abc).toBe(read(`${NEW_RIFF}\n${NEXT}`)!.abc);
    // Only that line: whatever was written after it belongs to no chords of ours.
    expect(read(`${insLine(NEW_RIFF)}\n${NEW_TURN}\n${NEXT}`, 8, true)).toMatchObject({ phrases: 1 });
    expect(read(`${insLine(RIFF)}\n${NEXT}`, 8, true)).toBeNull(); // the same notes again
    expect(read(insLine(NEW_RIFF), 8, true)).toBeNull(); // cut off before the line ended
    // A line that stops a bar early is still a phrase of two bars (the chords say so): the instrument rests in the second.
    expect(read('B2d2g2d2|\n', 8, true)).toMatchObject({ phrases: 1, bars: 2 });
  });

  it('refuses a text that changes what was already there', () => {
    expect(readNewBars(PLAN, LYRICS, 0, `${NEW_RIFF}\n${NEXT}`, 8)).toBeNull(); // not a phrase new bars can follow
    expect(readNewBars('not a plan', LYRICS, 2, `${NEW_RIFF}\n${NEXT}`, 8)).toBeNull();
  });

  it('reads what the studio really wrote for the starter songs', () => {
    const summary = (key: string, kind: 'free' | 'ins', maxBars = 8) => {
      const [title, phrase] = key.split('|');
      const song = example(title);
      const found = Object.values(WRITTEN[key][kind]).map((text) => readNewBars(song.abc, song.spec.lyrics, Number(phrase), text, maxBars, kind === 'ins'));
      for (const n of found) {
        if (!n) continue;
        // Every longer plan is the song with phrases added after that phrase, none of them sung.
        const added = addedPhrases(buildSongMap(song.abc, song.spec.lyrics)!, buildSongMap(n.abc, song.spec.lyrics)!, Number(phrase));
        expect(added).toEqual({ after: Number(phrase), phrases: n.phrases, bars: n.bars, sung: false });
      }
      return { read: found.map((n) => (n ? `${n.phrases}/${n.bars}/${n.fresh}/${n.closes ? 'closes' : 'open'}` : '-')), best: bestNewBars(found) };
    };
    // phrases / bars / new phrases / whether it comes back to the chords it left from; seeds 11, 22, 33, 44, 55.
    expect(summary('Iron Ghost|33', 'free')).toEqual({ read: ['-', '2/8/2/closes', '2/8/2/open', '-', '2/8/1/closes'], best: 1 });
    expect(summary('Iron Ghost|34', 'free')).toEqual({ read: ['-', '1/4/1/open', '2/8/2/closes', '2/8/2/closes', '2/8/1/open'], best: 2 });
    // A riff the song already plays twice running: four of five attempts only play it again.
    expect(summary('Where the Old Gods Stood|28', 'free')).toEqual({ read: ['-', '2/8/1/open', '-', '-', '-'], best: 1 });
    expect(summary('Where the Old Gods Stood|28', 'ins')).toEqual({ read: ['-', '-', '-', '1/4/1/closes', '-'], best: 3 });
    // A slow song: four bars are 12.8 s, so five bars is the room there is.
    expect(summary('The Last Ember|12', 'free', 5)).toEqual({ read: ['-', '1/4/1/closes', '1/4/1/open', '-', '1/4/1/open'], best: 1 });
    // The intro: most attempts end it (a one-bar tag, then the verse).
    expect(summary('Iron Ghost|4', 'free')).toEqual({ read: ['-', '-', '-', '2/8/2/open', '-'], best: 3 });
    expect(summary('Iron Ghost|33', 'ins').read).toEqual(['1/4/1/closes', '1/4/1/closes', '1/4/1/closes', '1/4/1/closes', '1/4/1/closes']);
  });
});

describe('choosing among attempts', () => {
  const bars = (over: Partial<NewBars>): NewBars => ({ abc: '', phrases: 1, bars: 4, fresh: 1, closes: false, ...over });

  it('prefers one that comes back to the chords it left from, then the most that is new, then the longer', () => {
    expect(bestNewBars([bars({ fresh: 2, bars: 8 }), bars({ closes: true }), null])).toBe(1);
    expect(bestNewBars([bars({ closes: true }), bars({ closes: true, fresh: 2 })])).toBe(1);
    expect(bestNewBars([bars({ bars: 4 }), bars({ bars: 8 })])).toBe(1);
    expect(bestNewBars([bars({}), bars({})])).toBe(0); // the first of equals
    expect(bestNewBars([null, null])).toBe(-1);
    expect(bestNewBars([])).toBe(-1);
  });
});

describe('the room for new bars', () => {
  const original = map(PLAN);

  it('is eight bars, or sixteen seconds, or what the studio\'s limit leaves', () => {
    expect(roomForBars(original, GRID, 2, 1060)).toBe(8); // 16 s at two seconds a bar
    expect(roomForBars(original, GRID, 2, MAX_TAKE_FRAMES - 160)).toBe(3);
    expect(roomForBars(original, GRID, 2, MAX_TAKE_FRAMES - 60)).toBe(0); // one bar is no room
    expect(roomForBars(original, GRID, 2, 300)).toBe(0); // the recording stops before the place
    const ember = example('The Last Ember');
    const m = buildSongMap(ember.abc, ember.spec.lyrics)!;
    expect(roomForBars(m, { v: 1, shifts: m.phrases.map(() => -76) }, 12, 4900)).toBe(5); // 3.2 s a bar
  });
});

describe('new bars written and performed, in the engine', () => {
  /** New bars asked for after phrase 2: the plan is still the song's own. */
  const asked = (original: Song, over: Partial<SongSpec> = {}): SongSpec => ({
    ...original.spec,
    seed: '1000',
    abc: original.planAbc,
    edit: { sourceId: original.id, after: 2, write: true },
    ...over,
  });
  const LONGER = `${HEAD}% verse\n${SUNG}\n% interlude\n${RIFF}\n${RIFF}\n${NEW_RIFF}\n${HELD}\n${AFTER}\n% outro\n${LAST}\n`;

  it('has the studio write on from the phrase, takes the attempt that reads best, and performs it', async () => {
    const { engine, world, clock, original } = await rendered();
    // Attempt 1 only repeats the riff; 2 is new but does not come back; 3 is new and does.
    world.writtenBars = (_before, attempt) => [``, `${RIFF}\n${NEXT}`, `${NEW_TURN}\n${NEXT}`, `${NEW_RIFF}\n${NEXT}`, ''][attempt];
    const phases: string[] = [];
    engine.on((e) => { if (e.kind === 'progress' && phases[phases.length - 1] !== e.progress.phase) phases.push(e.progress.phase); });
    const before = world.submittedGraphs.length;
    const queued = await engine.enqueueSong(asked(original), original.id);
    await flush();
    const done = await settle(engine, world, clock, queued.id);
    expect(done.status).toBe('done');

    const [writing, takes, perform] = world.submittedGraphs.slice(before);
    expect(world.submittedGraphs.length - before).toBe(3);
    const writers = Object.entries(writing).filter(([, n]) => n.class_type === 'Stillsong2ContinuePlan');
    expect(writers.map(([id]) => id)).toEqual([0, 1, 2, 3, 4].map(WRITE_OUT));
    expect(writers.map(([, n]) => n.inputs.seed)).toEqual([1000, 1001, 1002, 1003, 1004]);
    expect(writers.every(([, n]) => n.inputs.abc === planBefore(PLAN, 2) && n.inputs.lyrics === LYRICS && n.inputs.mode === 'full')).toBe(true);
    expect(Object.keys(writing).sort()).toEqual(['ckpt', ...[0, 1, 2, 3, 4].map(WRITE_OUT)].sort()); // nothing is sung or recorded for it
    // From here on it is an extension like any other, with the plan that was written.
    expect(takes.arrange.inputs.layout).toBe('0-308,+100,308-1060');
    expect(Object.values(takes).filter((n) => n.class_type === 'Stillsong2Resing').every((n) => n.inputs.abc === LONGER)).toBe(true);
    expect(perform.perform.inputs).toMatchObject({ abc: LONGER, tokens: ['arrange', 0] });
    expect(done.planAbc).toBe(LONGER);
    expect(done.spec.abc).toBe(LONGER);
    expect(done.spec.edit).toEqual({ sourceId: original.id, after: 2 }); // written: no longer asked for
    expect(done.actualSec).toBeCloseTo(original.actualSec! + 4, 9);
    expect(readBarGrid(done.barGrid, 7)).toBeTruthy();
    expect(phases.indexOf(EDIT_PHASES.writing)).toBeGreaterThanOrEqual(0);
    expect(phases.indexOf(EDIT_PHASES.writing)).toBeLessThan(phases.indexOf(EDIT_PHASES.extending));
  });

  it('asks for an instrument\'s line over the same chords when nothing usable was written', async () => {
    const { engine, world, clock, original } = await rendered();
    const lineOnly = planBefore(PLAN, 2, true)!;
    world.writtenBars = (before, attempt) => (before === lineOnly && attempt === 4 ? `${insLine(NEW_RIFF)}\n${NEXT}` : `${RIFF}\n${NEXT}`);
    const before = world.submittedGraphs.length;
    const queued = await engine.enqueueSong(asked(original), original.id);
    await flush();
    const done = await settle(engine, world, clock, queued.id);
    expect(done.status).toBe('done');
    const [first, second] = world.submittedGraphs.slice(before);
    expect(world.submittedGraphs.length - before).toBe(4); // two rounds of writing, the takes, the performance
    expect(first[WRITE_OUT(0)].inputs.abc).toBe(planBefore(PLAN, 2));
    expect(second[WRITE_OUT(0)].inputs.abc).toBe(lineOnly);
    expect(done.planAbc).toBe(LONGER);
  });

  it('fails plainly when the studio writes nothing new, and tries other attempts the next time', async () => {
    const { engine, world, clock, original } = await rendered();
    world.writtenBars = () => `${RIFF}\n${NEXT}`;
    const before = world.submittedGraphs.length;
    const queued = await engine.enqueueSong(asked(original), original.id);
    await flush();
    const failed = await settle(engine, world, clock, queued.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/found nothing new to play there/);
    expect(world.submittedGraphs.length - before).toBe(2); // both rounds of writing; nothing sung
    expect(failed.spec.edit).toEqual({ sourceId: original.id, after: 2, write: true }); // still to be written
    expect(failed.spec.abc).toBe(PLAN);

    world.historyStatus = 'running';
    world.writtenBars = () => `${NEW_RIFF}\n${NEXT}`;
    await engine.retrySong(failed.id);
    await flush();
    const done = await settle(engine, world, clock, failed.id);
    expect(done.status).toBe('done');
    expect(world.submittedGraphs[before + 2][WRITE_OUT(0)].inputs.seed).toBe(1005);
    expect(done.planAbc).toBe(LONGER);
  });

  it('performs the bars that were written when a later step failed and it is tried again', async () => {
    const { engine, world, clock, original } = await rendered();
    world.writtenBars = () => `${NEW_RIFF}\n${NEXT}`;
    world.takeSeriesFrames = 999; // the takes prompt answers about another take
    const before = world.submittedGraphs.length;
    const queued = await engine.enqueueSong(asked(original), original.id);
    await flush();
    const failed = await settle(engine, world, clock, queued.id);
    expect(failed.error).toMatch(/did not say how the new takes went/);
    expect(failed.spec.abc).toBe(LONGER);
    expect(failed.spec.edit).toEqual({ sourceId: original.id, after: 2 });

    world.historyStatus = 'running';
    world.takeSeriesFrames = undefined;
    world.writtenBars = () => { throw new Error('nothing should be written again'); };
    const sent = world.submittedGraphs.length;
    await engine.retrySong(failed.id);
    await flush();
    const done = await settle(engine, world, clock, failed.id);
    expect(done.status).toBe('done');
    expect(done.planAbc).toBe(LONGER);
    expect(world.submittedGraphs.length - sent).toBe(2); // the takes and the performance
    expect(world.submittedGraphs.length - before).toBe(4);
  });

  it('writes nothing for a song that cannot be made longer there', async () => {
    const { engine, world, clock, original } = await rendered();
    world.writtenBars = () => `${NEW_RIFF}\n${NEXT}`;
    const before = world.submittedGraphs.length;
    const fail = async (over: Partial<SongSpec>, prepare?: () => Promise<void>) => {
      world.historyStatus = 'running';
      await prepare?.();
      const queued = await engine.enqueueSong(asked(original, over), original.id);
      await flush();
      return (await settle(engine, world, clock, queued.id)).error;
    };
    expect(await fail({ edit: { sourceId: original.id, after: 0, write: true } })).toMatch(/cannot follow that phrase/); // sung
    expect(await fail({ edit: { sourceId: original.id, after: 5, write: true } })).toMatch(/cannot follow that phrase/); // the last
    expect(await fail({ edit: { sourceId: original.id, write: true } })).toMatch(/cannot follow that phrase/); // no place given
    expect(await fail({ lyrics: LYRICS.replace('A line', 'A word') })).toMatch(/one at a time/);
    expect(await fail({}, () => engine.songs.setBarGrid(original.id, 'not a grid'))).toMatch(/Open its Song map/);
    await engine.saveBarGrid(original.id, GRID);
    const short = { outputPath: original.outputPath!, composed: { actualSec: 12, hitCeiling: false }, planAbc: original.planAbc, takePath: original.takePath };
    expect(await fail({}, () => engine.songs.setOutput(original.id, short))).toMatch(/not in the recording/);
    const full = { ...short, composed: { actualSec: (MAX_TAKE_FRAMES - 60) / 25, hitCeiling: false } };
    expect(await fail({}, () => engine.songs.setOutput(original.id, full))).toMatch(/as long as the studio can make it/);
    expect(world.submittedGraphs.length - before).toBe(0);
  });

  it('gives the writer only as much room as the song has left', async () => {
    const { engine, world, clock, original } = await rendered();
    // Three bars of room: of two phrases written, one fits.
    await engine.songs.setOutput(original.id, { outputPath: original.outputPath!, composed: { actualSec: (MAX_TAKE_FRAMES - 160) / 25, hitCeiling: false }, planAbc: original.planAbc, takePath: original.takePath });
    world.writtenBars = () => `${NEW_RIFF}\n${NEW_TURN}\n${NEXT}`;
    world.takeSeriesFrames = 0; // stop it after the writing: the fake studio's takes are not that long
    const queued = await engine.enqueueSong(asked(original), original.id);
    await flush();
    const failed = await settle(engine, world, clock, queued.id);
    expect(failed.spec.abc).toBe(LONGER); // NEW_RIFF alone
  });
});
