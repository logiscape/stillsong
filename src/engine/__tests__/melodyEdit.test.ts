// Melody edits: a note of the plan moved, the bars that changed, the windows
// sung again, how takes are chosen, and the engine's pipeline around them.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine } from '@engine/index';
import { defaultSpec, type Song, type SongSpec } from '@engine/domain/types';
import { parsePlan, stepNote } from '@engine/domain/melodyPlan';
import { changedBars, chooseTake, melodyWindows, parseScoreSeries, scoreTake } from '@engine/domain/melodyEdit';
import { buildSongMap } from '@engine/domain/songMap';
import { frameRanges } from '@engine/comfy/nodes';
import { dipSeries, flush, makePorts, type FakeClock, type FakeWorld } from './fakes';

interface Example { spec: { title: string; lyrics: string }; abc: string }
const examples = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../examples/examples.json', import.meta.url)), 'utf8')) as { songs: Example[] }).songs;
const ghost = examples.find((s) => s.spec.title === 'Iron Ghost')!;

// 4/4 in G (F is sharp), 8 units a bar.
const HEAD = 'X:1\nM:4/4\nL:1/8\nQ:1/4=120\nK:G\n';
const plan = (...phrases: string[]) => `${HEAD}% verse\n${phrases.map((p) => `V: Vocal\n${p}`).join('\n')}\n`;
const sung = (abc: string, phrase = 0) => parsePlan(abc).sections.flatMap((s) => s.phrases)[phrase].vocal.map((n) => n.midi);
const line = (abc: string, phrase = 0) => parsePlan(abc).sections.flatMap((s) => s.phrases)[phrase].lines[1];

describe('stepNote', () => {
  it('moves a note one step of the key, and writes only that note anew', () => {
    const abc = plan('"G"G2A2B2c2|"D"d8|');
    const up = stepNote(abc, { phrase: 0, voice: 'vocal', note: 1 }, 1)!;
    expect(line(up)).toBe('"G"G2B2B2c2|"D"d8|');
    expect(sung(up)).toEqual([67, 71, 71, 72, 74]);
    const down = stepNote(abc, { phrase: 0, voice: 'vocal', note: 0 }, -2)!;
    expect(line(down)).toBe('"G"E2A2B2c2|"D"d8|');
    // Everything else in the plan is untouched.
    expect(up.replace('G2B2', 'G2A2')).toBe(abc);
  });

  it('follows the key signature and crosses octaves', () => {
    const abc = plan('"G"e2B2c2B,2|');
    expect(sung(stepNote(abc, { phrase: 0, voice: 'vocal', note: 0 }, 1)!)[0]).toBe(78); // E to F sharp, as the key has it
    expect(line(stepNote(abc, { phrase: 0, voice: 'vocal', note: 1 }, 1)!)).toBe('"G"e2c2c2B,2|'); // B up to the C above
    expect(line(stepNote(abc, { phrase: 0, voice: 'vocal', note: 2 }, -1)!)).toBe('"G"e2B2B2B,2|');
    expect(line(stepNote(abc, { phrase: 0, voice: 'vocal', note: 3 }, 1)!)).toBe('"G"e2B2c2C2|'); // B, up to middle C
    expect(line(stepNote(abc, { phrase: 0, voice: 'vocal', note: 3 }, -1)!)).toBe('"G"e2B2c2A,2|');
  });

  it('keeps every other note of the bar at its pitch when accidentals are in play', () => {
    // The first C is sharpened, and the sharp holds for the second. Moving the first away must not flatten the second.
    const abc = plan('"A"^c2c2e2c2|');
    expect(sung(abc)).toEqual([73, 73, 76, 73]);
    const moved = stepNote(abc, { phrase: 0, voice: 'vocal', note: 0 }, 1)!;
    expect(sung(moved)).toEqual([74, 73, 76, 73]);
    expect(line(moved)).toBe('"A"d2^c2e2c2|');
    // Moving a note onto a pitch an earlier accidental still governs: it takes the key's pitch, said outright.
    const onto = stepNote(abc, { phrase: 0, voice: 'vocal', note: 2 }, -2)!;
    expect(sung(onto)).toEqual([73, 73, 72, 73]);
    expect(line(onto)).toBe('"A"^c2c2=c2^c2|');
  });

  it('moves a tied note with the notes it is tied to, across a bar line', () => {
    const abc = plan('"G"G4A4-|"G"A4B4|');
    const moved = stepNote(abc, { phrase: 0, voice: 'vocal', note: 2 }, 1)!;
    expect(line(moved)).toBe('"G"G4B4-|"G"B4B4|');
    expect(sung(moved)).toEqual([67, 71, 71, 71]);
  });

  it('moves a tied note across a bar line when its spelling changes length', () => {
    // "B," becomes "C": a character shorter, so the second bar's note is no longer where it was read.
    // Before, the second bar was looked for at its old place in the already-rewritten line, and this threw.
    const low = plan('"G"B,8-|"G"B,8|');
    expect(line(stepNote(low, { phrase: 0, voice: 'vocal', note: 0 }, 1)!)).toBe('"G"C8-|"G"C8|');
    expect(line(stepNote(low, { phrase: 0, voice: 'vocal', note: 1 }, 1)!)).toBe('"G"C8-|"G"C8|');
    expect(line(stepNote(plan('"G"c\'8-|"G"c\'8|'), { phrase: 0, voice: 'vocal', note: 0 }, -1)!)).toBe('"G"b8-|"G"b8|');
    expect(line(stepNote(plan('"G"b8-|"G"b8|'), { phrase: 0, voice: 'vocal', note: 0 }, 1)!)).toBe('"G"c\'8-|"G"c\'8|');
    // Three bars, and a note after the run that must stay put.
    const long = stepNote(plan('"G"A4B,4-|"G"B,8-|"G"B,4d4|'), { phrase: 0, voice: 'vocal', note: 2 }, 1)!;
    expect(line(long)).toBe('"G"A4C4-|"G"C8-|"G"C4d4|');
    expect(sung(long)).toEqual([69, 60, 60, 60, 74]);
    // Spellings that shrink in both bars (each loses its sharp), with a sharp ahead of the run that stays.
    const sharp = stepNote(plan('"G"^c4^c4-|"G"^c4e4|'), { phrase: 0, voice: 'vocal', note: 1 }, -1)!;
    expect(line(sharp)).toBe('"G"^c4B4-|"G"B4e4|');
    expect(sung(sharp)).toEqual([73, 71, 71, 76]);
  });

  it('moves any note of the starter songs, either way, without touching another', () => {
    for (const s of examples) {
      const phrases = parsePlan(s.abc).sections.flatMap((x) => x.phrases);
      let moved = 0;
      phrases.forEach((p, pi) => (['vocal', 'ins'] as const).forEach((voice) => p[voice].forEach((n, ni) => {
        for (const steps of [1, -1, 2, -2]) {
          const where = `${s.spec.title} ${voice} phrase ${pi} note ${ni} step ${steps}`;
          let next: string | null = null;
          expect(() => { next = stepNote(s.abc, { phrase: pi, voice, note: ni }, steps); }, where).not.toThrow();
          if (next === null) continue;
          moved++;
          const after = parsePlan(next).sections.flatMap((x) => x.phrases);
          const others = after.every((q, qi) => (['vocal', 'ins'] as const).every((v) =>
            q[v].length === phrases[qi][v].length && q[v].every((m, mi) => m.midi === phrases[qi][v][mi].midi || (qi === pi && v === voice && phrases[qi][v][mi].midi === n.midi))));
          expect(others, where).toBe(true);
        }
      })));
      expect(moved, s.spec.title).toBeGreaterThan(1000);
    }
    // Every note of three songs, four ways, each a plan read twice: seconds of work, and on a
    // CI runner sharing its cores with the other test files it passed the default 5 s (8.3 s).
  }, 60_000);

  it('takes a second press on a note tied across a bar line', () => {
    // "Where the Old Gods Stood" sings a D tied over a bar line; two steps down it becomes "B,".
    // The map asks whether the next press is possible while it draws: this used to throw there.
    const gods = examples.find((s) => s.spec.title === 'Where the Old Gods Stood')!;
    const phrases = parsePlan(gods.abc).sections.flatMap((x) => x.phrases);
    const pi = phrases.findIndex((p) => p.vocal.some((n, i) => n.tie && n.midi === 62 && p.vocal[i + 1]?.midi === 62 && p.vocal[i + 1].bar !== n.bar));
    const ni = phrases[pi].vocal.findIndex((n, i) => n.tie && n.midi === 62 && phrases[pi].vocal[i + 1]?.bar !== n.bar);
    const ref = { phrase: pi, voice: 'vocal' as const, note: ni };
    const once = stepNote(gods.abc, ref, -1)!;
    const twice = stepNote(once, ref, -1)!;
    const pitch = (abc: string) => parsePlan(abc).sections.flatMap((x) => x.phrases)[pi].vocal.slice(ni, ni + 2).map((n) => n.midi);
    expect([pitch(once), pitch(twice)]).toEqual([[60, 60], [58, 58]]); // C, then the B flat of D minor
    expect(stepNote(stepNote(twice, ref, 1)!, ref, 1)).toBe(gods.abc);
  });

  it('will not move a note tied across a phrase, out of range, or not there', () => {
    const tied = plan('"G"G4A4-|', '"G"A4B4|');
    expect(stepNote(tied, { phrase: 0, voice: 'vocal', note: 1 }, 1)).toBeNull();
    expect(stepNote(tied, { phrase: 1, voice: 'vocal', note: 0 }, 1)).toBeNull();
    expect(stepNote(tied, { phrase: 1, voice: 'vocal', note: 1 }, 1)).not.toBeNull();
    expect(stepNote(plan('"G"c\'\'\'8|'), { phrase: 0, voice: 'vocal', note: 0 }, 1)).toBeNull(); // above C7
    expect(stepNote(tied, { phrase: 0, voice: 'vocal', note: 9 }, 1)).toBeNull();
    expect(stepNote(tied, { phrase: 0, voice: 'ins', note: 0 }, 1)).toBeNull();
  });

  it('there and back again gives the starter plans back, character for character', () => {
    for (const s of examples) {
      const phrases = parsePlan(s.abc).sections.flatMap((x) => x.phrases);
      let tried = 0;
      phrases.forEach((p, pi) => p.vocal.forEach((_, ni) => {
        const up = stepNote(s.abc, { phrase: pi, voice: 'vocal', note: ni }, 1);
        if (!up) return;
        tried++;
        expect(up).not.toBe(s.abc);
        expect(stepNote(up, { phrase: pi, voice: 'vocal', note: ni }, -1), `${s.spec.title} phrase ${pi} note ${ni}`).toBe(s.abc);
      }));
      expect(tried, s.spec.title).toBeGreaterThan(50);
    }
  });
});

describe('what a melody edit sings again', () => {
  const before = buildSongMap(ghost.abc, ghost.spec.lyrics)!;
  // Verse one of "Iron Ghost" starts on bar 29; its second phrase is bars 33-36.
  const phrase = before.phrases.findIndex((p) => p.start === 33);
  const note = before.phrases[phrase].phrase.vocal.findIndex((n) => n.bar === 2);
  const editedAbc = stepNote(ghost.abc, { phrase, voice: 'vocal', note }, 1)!;
  const after = buildSongMap(editedAbc, ghost.spec.lyrics)!;
  const grid = { v: 1 as const, shifts: before.phrases.map(() => 19) };
  const frame = (bar: number) => Math.round(bar * 41.6667 + 19);

  it('knows which bars changed', () => {
    expect(before.phrases[phrase].phrase.bars).toBe(4);
    expect(changedBars(before, after)).toEqual([35]);
    expect(changedBars(before, before)).toEqual([]);
    // Another song is not this song with notes moved.
    const other = examples.find((s) => s.spec.title === 'The Last Ember')!;
    expect(changedBars(before, buildSongMap(other.abc, other.spec.lyrics)!)).toBeNull();
  });

  it('opens a window just before the changed bar and closes it at the next phrase', () => {
    expect(melodyWindows(before, grid, [35], 7308)).toEqual([[frame(35) - 2, frame(37) - 2]]);
    // Two changed bars in one phrase: one window, from the first.
    expect(melodyWindows(before, grid, [36, 34], 7308)).toEqual([[frame(34) - 2, frame(37) - 2]]);
  });

  it('sings two windows as one when little would be kept between them', () => {
    // The next phrase is bars 37-40: a change in bar 39 is 2 bars (3.3 s) after the first window closes.
    expect(melodyWindows(before, grid, [35, 39], 7308)).toEqual([[frame(35) - 2, frame(41) - 2]]);
    // A change in the first chorus (bar 55) is far off: its own window.
    const far = melodyWindows(before, grid, [35, 55], 7308);
    expect(far).toHaveLength(2);
    expect(far[1][0]).toBe(frame(55) - 2);
  });

  it('ends the last phrase\'s window with the take, and leaves out bars the recording never reached', () => {
    const lastBar = before.bars - 1;
    const [window] = melodyWindows(before, grid, [lastBar], 7308);
    expect(window).toEqual([frame(lastBar) - 2, 7308]);
    expect(melodyWindows(before, grid, [35, lastBar], 3000)).toEqual([[frame(35) - 2, frame(37) - 2]]);
    expect(melodyWindows(before, grid, [lastBar], 3000)).toEqual([]);
  });
});

describe('choosing a take', () => {
  it('scores how the windows fit the new plan, and the kept second after them', () => {
    const base = new Array<number>(200).fill(-2);
    const underEdited = base.map((v, f) => (f >= 50 && f < 80 ? -1 : f >= 80 && f < 105 ? -3 : v)); // sung anew at 50-80
    const underOriginal = base.map((v, f) => (f >= 50 && f < 80 ? -1.5 : v));
    const score = scoreTake([[50, 80]], base, underEdited, underOriginal);
    expect(score.fit).toBeCloseTo(15); // 30 frames, half a nat better under the new plan
    expect(score.seam).toBeCloseTo(-25); // 25 kept frames, a nat worse than in the original take
  });

  it('takes the best fit among the takes that hand back about as well as the best', () => {
    expect(chooseTake([{ fit: 40, seam: -30 }, { fit: 70, seam: -45 }, { fit: 90, seam: -80 }])).toBe(1); // the third is 50 nats rougher
    expect(chooseTake([{ fit: 40, seam: -30 }, { fit: 30, seam: -31 }])).toBe(0);
    expect(chooseTake([{ fit: 10, seam: -90 }])).toBe(0);
  });

  it('chooses none when no take follows the new notes', () => {
    expect(chooseTake([{ fit: 0, seam: -30 }, { fit: -4, seam: -20 }])).toBe(-1);
    expect(chooseTake([{ fit: 60, seam: -70 }, { fit: -4, seam: -20 }])).toBe(-1); // the one that follows them is too rough
    expect(chooseTake([])).toBe(-1);
  });

  it('reads a score series, and nothing else', () => {
    expect(parseScoreSeries('{"frames":3,"logp":[-1,-2.5,0]}')).toEqual([-1, -2.5, 0]);
    expect(parseScoreSeries('{"frames":4,"logp":[-1,-2.5,0]}')).toBeNull();
    expect(parseScoreSeries('{"frames":1,"logp":[null]}')).toBeNull();
    expect(parseScoreSeries('nope')).toBeNull();
    expect(parseScoreSeries(undefined)).toBeNull();
  });
});

// ---- the engine --------------------------------------------------------------

const PLAN = `${HEAD}% verse\nV: Vocal\n"G"G2A2B2c2|"D"d8|"Em"e4d4|"G"B8|\nV: Vocal\n"C"c4e4|"G"d8|"D"A4B4|"G"G8|\n`;
const spec = (over: Partial<SongSpec> = {}): SongSpec => ({
  ...defaultSpec(),
  title: 'Test',
  caption: 'Global Metadata: a\n\nVocal Details: b\n\nArrangement: c',
  lyrics: '[verse]\nA line to sing\nAnd one more',
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

/** A finished song with a take, this plan, and its bars found (8 bars of 2 s; the take is 42.4 s). */
async function rendered() {
  const made = makePorts();
  made.world.takeNodes = true;
  made.world.planText = PLAN;
  const engine = await Engine.create(made.ports);
  const queued = await engine.enqueueSong(spec());
  await flush();
  let original = await settle(engine, made.world, made.clock, queued.id);
  await engine.saveBarGrid(original.id, { v: 1, shifts: [10, 10] });
  original = (await engine.songs.byId(original.id))!;
  made.world.historyStatus = 'running';
  return { ...made, engine, original };
}

/** The second note of the song (bar 0), up a step. */
const edited = (original: Song): SongSpec => ({
  ...original.spec,
  seed: '1000',
  abc: stepNote(original.planAbc!, { phrase: 0, voice: 'vocal', note: 1 }, 1)!,
  edit: { sourceId: original.id },
});

describe('a melody edit in the engine', () => {
  it('sings several takes of the changed bars, performs the best, and keeps the rest', async () => {
    const { engine, world, clock, original } = await rendered();
    expect(original.planAbc).toBe(PLAN);
    world.takeScores = [{ fit: 20, seam: -30 }, { fit: 60, seam: -35 }, { fit: 90, seam: -90 }, { fit: 5, seam: -30 }, { fit: 30, seam: -32 }];
    const before = world.submittedGraphs.length;
    const queued = await engine.enqueueSong(edited(original), original.id);
    await flush();
    const done = await settle(engine, world, clock, queued.id);
    expect(done.status).toBe('done');

    const [takes, perform] = world.submittedGraphs.slice(before);
    expect(world.submittedGraphs.length - before).toBe(2);
    // Bar 0 starts at frame 10 and the next phrase (bar 4) at 4 x 50 + 10; a window opens 2 frames early.
    const redo = frameRanges([[8, 208]]);
    const singers = Object.values(takes).filter((n) => n.class_type === 'Stillsong2Resing');
    expect(singers.map((n) => n.inputs.seed)).toEqual([1000, 1001, 1002, 1003, 1004]);
    expect(singers.every((n) => n.inputs.redo === redo && n.inputs.abc === queued.spec.abc)).toBe(true);
    expect(Object.values(takes).filter((n) => n.class_type === 'Stillsong2Score')).toHaveLength(11);
    expect(Object.values(takes).some((n) => n.class_type === 'KSampler')).toBe(false); // no audio for the takes

    // The second take: it follows the new notes best among those that hand back well.
    expect(perform.perform.inputs).toMatchObject({ seed: 1001, abc: queued.spec.abc, redo, lyrics: original.spec.lyrics });
    expect(perform.hold.inputs.redo).toBe(redo);
    expect(done.spec.seed).toBe('1001');
    expect(done.planAbc).toBe(queued.spec.abc);
    expect(done.editWindows).toEqual([[8, 208]]);
    expect(done.actualSec).toBe(original.actualSec);
    expect(done.barGrid).toBe(original.barGrid); // the bars sit where they did
    expect(done.takePath).toBeTruthy();
  });

  it('sends the take under a new name for every edit of one song', async () => {
    // The studio keeps a loaded take open, and Windows will not write over an
    // open file: the second edit of a song used to fail at the upload (seen live).
    const { engine, world, clock, files, original } = await rendered();
    for (const seed of ['1000', '2000']) {
      world.historyStatus = 'running';
      const queued = await engine.enqueueSong({ ...edited(original), seed }, original.id);
      await flush();
      expect((await settle(engine, world, clock, queued.id)).status).toBe('done');
    }
    const names = files.uploaded.map((u) => u.fileName);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names.every((n) => n.startsWith(original.id.slice(0, 8)) && n.endsWith('.take.safetensors'))).toBe(true);
  });

  it('fails plainly when no take follows the new notes, without performing one', async () => {
    const { engine, world, clock, original } = await rendered();
    world.takeScores = [{ fit: -3, seam: -30 }];
    const before = world.submittedGraphs.length;
    const queued = await engine.enqueueSong(edited(original), original.id);
    await flush();
    const failed = await settle(engine, world, clock, queued.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/kept to the old notes/);
    expect(world.submittedGraphs.length - before).toBe(1);

    // Trying again sings five other takes, not the same five.
    world.historyStatus = 'running';
    world.takeScores = [{ fit: 40, seam: -30 }];
    await engine.retrySong(failed.id);
    await flush();
    const done = await settle(engine, world, clock, failed.id);
    expect(done.status).toBe('done');
    const retried = world.submittedGraphs[before + 1];
    expect(Object.values(retried).filter((n) => n.class_type === 'Stillsong2Resing').map((n) => n.inputs.seed)).toEqual([1005, 1006, 1007, 1008, 1009]);
    expect(done.spec.seed).toBe('1005');
  });

  it('needs the bars of the recording to have been found', async () => {
    const { engine, world, clock, original } = await rendered();
    await engine.songs.setBarGrid(original.id, 'not a grid');
    const before = world.submittedGraphs.length;
    const queued = await engine.enqueueSong(edited(original), original.id);
    await flush();
    const failed = await settle(engine, world, clock, queued.id);
    expect(failed.error).toMatch(/Open its Song map/);
    expect(world.submittedGraphs.length - before).toBe(0);
  });

  it('refuses a plan that is not this song with notes moved, and words changed along with notes', async () => {
    const { engine, world, clock, original } = await rendered();
    const other = { ...edited(original), abc: PLAN.replace('"C"c4e4|"G"d8|"D"A4B4|"G"G8|', '"C"c4e4|"G"d8|') };
    let failed = await settle(engine, world, clock, (await engine.enqueueSong(other, original.id)).id);
    expect(failed.error).toMatch(/Only the notes/);
    world.historyStatus = 'running';
    const both = { ...edited(original), lyrics: original.spec.lyrics.replace('A line', 'A word') };
    await flush();
    failed = await settle(engine, world, clock, (await engine.enqueueSong(both, original.id)).id);
    expect(failed.error).toMatch(/one at a time/);
  });

  it('a lyric edit still goes the old way, and its new version keeps the bar grid', async () => {
    const { engine, world, clock, original } = await rendered();
    world.alignSeries = [dipSeries(1060, 500, 550), dipSeries(1060, 0, 0)];
    const before = world.submittedGraphs.length;
    const reworded = { ...original.spec, lyrics: original.spec.lyrics.replace('A line to sing', 'A line to hum'), abc: original.planAbc, edit: { sourceId: original.id } };
    const queued = await engine.enqueueSong(reworded, original.id);
    await flush();
    const done = await settle(engine, world, clock, queued.id);
    expect(done.status).toBe('done');
    const graphs = world.submittedGraphs.slice(before);
    expect(graphs.some((g) => g.align)).toBe(true);
    expect(graphs.some((g) => g.score_base)).toBe(false);
    expect(done.barGrid).toBe(original.barGrid);
  });
});
