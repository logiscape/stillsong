// Takes and "keep the rest" edits: every render saves its take when the
// studio's own nodes are present, and an edit performs a source take again
// with only the changed lines re-sung (align -> perform -> check).

import { describe, expect, it } from 'vitest';
import { Engine, takeRelPath } from '@engine/index';
import { defaultSpec, type Song, type SongSpec } from '@engine/domain/types';
import { editWindows, mergeWindows } from '@engine/domain/editWindows';
import { frameRanges } from '@engine/comfy/nodes';
import { dipSeries, flush, makePorts, type FakeClock, type FakeWorld } from './fakes';

const OLD_LINE = 'The room is cold and wide';
const NEW_LINE = 'The river runs with gold';

const spec = (over: Partial<SongSpec> = {}): SongSpec => ({
  ...defaultSpec(),
  title: 'Test',
  caption: 'Global Metadata: a\n\nVocal Details: b\n\nArrangement: c',
  lyrics: `[verse]\n${OLD_LINE}\nWith nowhere left to hide`,
  targetSec: 20,
  seed: '7',
  ...over,
});

const FRAMES = 1060;
const FLAT = dipSeries(FRAMES, 0, 0);
const LINE = dipSeries(FRAMES, 500, 550);
const TAIL = dipSeries(FRAMES, 570, 590);

/** Lets every prompt of the current job finish (each needs one history poll). */
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

async function rendered(over: Partial<SongSpec> = {}) {
  const made = makePorts();
  made.world.takeNodes = true;
  const engine = await Engine.create(made.ports);
  const queued = await engine.enqueueSong(spec(over));
  await flush();
  const original = await settle(engine, made.world, made.clock, queued.id);
  made.world.historyStatus = 'running';
  return { ...made, engine, original };
}

const editOf = (original: Song): SongSpec => ({
  ...original.spec,
  lyrics: original.spec.lyrics.replace(OLD_LINE, NEW_LINE),
  abc: original.planAbc,
  edit: { sourceId: original.id },
});

describe('takes', () => {
  it('saves a take with every render when the studio has its own nodes', async () => {
    const { world, files, runtime, original } = await rendered();
    const graph = world.submittedGraphs[0];
    expect(graph.perform.class_type).toBe('Stillsong2Perform');
    expect(graph.take).toEqual({
      class_type: 'Stillsong2SaveTake',
      inputs: { samples: ['sample', 0], tokens: ['perform', 2], filename_prefix: `audio/stillsong2/${original.id.slice(0, 8)}` },
    });
    expect(original.status).toBe('done');
    expect(original.takePath).toBe(`C:\\lib\\${takeRelPath(original.id)}`);
    expect(files.downloaded.some((url) => url.includes('take.safetensors'))).toBe(true);
    // ComfyUI's copies of both files are removed once the library has them.
    expect(runtime.removedOutputs.map((f) => f.filename).sort()).toEqual(['x_00001_.mp3', 'x_00002_.take.safetensors']);
  });

  it('renders through the core nodes, without a take, when they are absent', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const queued = await engine.enqueueSong(spec());
    await flush();
    const song = await settle(engine, world, clock, queued.id);
    expect(world.submittedGraphs[0].perform.class_type).toBe('YuE2GenerateMusic');
    expect(world.submittedGraphs[0].take).toBeUndefined();
    expect(song.status).toBe('done');
    expect(song.takePath).toBeUndefined();
  });

  it('a song whose take could not be copied is still done', async () => {
    const made = makePorts();
    made.world.takeNodes = true;
    const download = made.files.download.bind(made.files);
    made.files.download = async (url, relPath) => {
      if (relPath.endsWith('.take.safetensors')) throw new Error('disk full');
      return download(url, relPath);
    };
    const engine = await Engine.create(made.ports);
    const queued = await engine.enqueueSong(spec());
    await flush();
    const song = await settle(engine, made.world, made.clock, queued.id);
    expect(song.status).toBe('done');
    expect(song.takePath).toBeUndefined();
  });

  it('deleting a song removes its take', async () => {
    const { engine, files, original } = await rendered();
    await engine.deleteSong(original.id);
    expect(files.removed).toContain(original.takePath);
  });
});

describe('keep the rest', () => {
  it('finds the changed line, sings only that window again, and checks the result', async () => {
    const { engine, world, clock, files, original } = await rendered();
    world.alignSeries = [LINE, FLAT];
    const queued = await engine.enqueueSong(editOf(original), original.id);
    await flush();
    const done = await settle(engine, world, clock, queued.id);

    const [, align, edit, check] = world.submittedGraphs;
    expect(world.submittedGraphs).toHaveLength(4);
    // The source take goes to ComfyUI's temp folder.
    expect(files.uploaded).toEqual([
      {
        url: 'http://comfy.test/upload/image',
        relPath: takeRelPath(original.id),
        fileName: `${original.id.slice(0, 8)}.take.safetensors`,
        fields: { type: 'temp', subfolder: 'stillsong2', overwrite: 'true' },
      },
    ]);
    const tempName = `stillsong2/${original.id.slice(0, 8)}.take.safetensors [temp]`;
    expect(align.source.inputs.take).toBe(tempName);
    expect(align.align.inputs).toMatchObject({ lyrics_a: original.spec.lyrics, lyrics_b: queued.spec.lyrics, abc: original.planAbc, tokens: ['source', 0] });

    const windows = editWindows(LINE);
    const redo = frameRanges(windows);
    expect(edit.perform.class_type).toBe('Stillsong2Perform');
    expect(edit.perform.inputs).toMatchObject({ lyrics: queued.spec.lyrics, abc: original.planAbc, seed: 7, max_duration: 500, tokens: ['source', 0], redo });
    expect(edit.hold.inputs).toEqual({ samples: ['source', 1], redo });
    expect(edit.sample.inputs.latent_image).toEqual(['hold', 0]);
    expect(edit.restore.inputs).toEqual({ samples: ['sample', 0], take: ['source', 1], redo });
    expect(edit.take.inputs.samples).toEqual(['restore', 0]);
    expect(edit.decode.inputs.samples).toEqual(['restore', 0]);
    expect(String(edit.save.inputs.filename_prefix)).toMatch(new RegExp(`^audio/stillsong2/${queued.id.slice(0, 8)}_[0-9a-f]{6}$`));
    // The MP3 carries its whole prompt: the words that were removed are not in it.
    expect(JSON.stringify(edit)).not.toContain(OLD_LINE);

    // The check asks the same question of the new take, read from ComfyUI's output.
    expect(check.source.inputs.take).toBe('audio/stillsong2/x_00002_.take.safetensors [output]');
    expect(check.align.inputs).toMatchObject({ lyrics_a: original.spec.lyrics, lyrics_b: queued.spec.lyrics });

    expect(done.status).toBe('done');
    expect(done.parentId).toBe(original.id);
    expect(done.editWindows).toEqual(windows);
    expect(done.planAbc).toBe(original.planAbc);
    expect(done.actualSec).toBe(original.actualSec);
    expect(done.hitCeiling).toBe(original.hitCeiling);
    expect(done.takePath).toBe(`C:\\lib\\${takeRelPath(done.id)}`);
    // Only the prompt that made the audio is tied to the job.
    expect(done.comfyPromptId).toBe('pid-3');
  });

  it('fails plainly when the lines cannot be found, without rendering', async () => {
    const { engine, world, clock, original } = await rendered();
    world.alignSeries = [FLAT];
    const queued = await engine.enqueueSong(editOf(original), original.id);
    await flush();
    const failed = await settle(engine, world, clock, queued.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('We could not find where those lines are sung.');
    expect(world.submittedGraphs).toHaveLength(2); // the original's render, then one alignment
  });

  it('widens the window once when old words are left in', async () => {
    const { engine, world, clock, runtime, original } = await rendered();
    world.alignSeries = [LINE, TAIL, FLAT];
    const queued = await engine.enqueueSong(editOf(original), original.id);
    await flush();
    const removedBefore = runtime.removedOutputs.length;
    const done = await settle(engine, world, clock, queued.id);

    const [, , first, , second] = world.submittedGraphs;
    expect(world.submittedGraphs).toHaveLength(6); // render, align, edit, check, edit, check
    const widened = mergeWindows(editWindows(LINE), editWindows(TAIL));
    expect(first.perform.inputs.redo).toBe(frameRanges(editWindows(LINE)));
    expect(second.perform.inputs.redo).toBe(frameRanges(widened));
    expect(second.save.inputs.filename_prefix).not.toBe(first.save.inputs.filename_prefix);
    expect(done.status).toBe('done');
    expect(done.editWindows).toEqual(widened);
    // The first attempt's audio and take are discarded, then the kept attempt's originals.
    expect(runtime.removedOutputs.length - removedBefore).toBe(4);
  });

  it('gives up when old words are still there after widening', async () => {
    const { engine, world, clock, original } = await rendered();
    world.alignSeries = [LINE, TAIL];
    const queued = await engine.enqueueSong(editOf(original), original.id);
    await flush();
    const failed = await settle(engine, world, clock, queued.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Some of the old words stayed in the recording.');
    expect(failed.outputPath).toBeUndefined();
  });

  it('removes the attempt when its check cannot be read', async () => {
    const { engine, world, clock, runtime, original } = await rendered();
    world.alignSeries = [LINE, []]; // the check comes back without a series
    const queued = await engine.enqueueSong(editOf(original), original.id);
    await flush();
    const removedBefore = runtime.removedOutputs.length;
    const failed = await settle(engine, world, clock, queued.id);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('The studio did not say where the lines are sung.');
    // The unchecked audio and take do not stay behind in ComfyUI's output.
    expect(runtime.removedOutputs.slice(removedBefore).map((f) => f.filename).sort()).toEqual(['x_00001_.mp3', 'x_00002_.take.safetensors']);
  });

  it('an edit interrupted after its audio was made starts over instead of being accepted unchecked', async () => {
    const { ports, engine, world, clock, runtime, original } = await rendered();
    world.alignSeries = [LINE, LINE, FLAT];
    const queued = await engine.enqueueSong(editOf(original), original.id);
    await flush();
    // The alignment finishes and the edit prompt is submitted...
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    expect(world.submittedGraphs).toHaveLength(3);
    expect((await engine.songs.byId(queued.id))?.comfyPromptId).toBe('pid-3');
    // ...then the interface restarts while the studio keeps running. The old
    // engine is gone (its timers with it); the studio reports the prompt done.
    clock.timers = [];
    const removedBefore = runtime.removedOutputs.length;
    const restarted = await Engine.create(ports);
    await flush();
    const done = await settle(restarted, world, clock, queued.id);

    // Not harvested as it stood: aligned, sung and checked again.
    expect(world.submittedGraphs).toHaveLength(6); // + align, edit, check
    expect(world.submittedGraphs[5].align).toBeDefined();
    expect(done.status).toBe('done');
    expect(done.editWindows).toEqual(editWindows(LINE));
    expect(done.comfyPromptId).toBe('pid-5');
    // The abandoned attempt's files were cleared, then the kept one's originals.
    expect(runtime.removedOutputs.length - removedBefore).toBe(4);
  });

  it('refuses an edit whose source has no take', async () => {
    const { ports, world, clock } = makePorts(); // no studio nodes: the original gets no take
    const engine = await Engine.create(ports);
    const queued = await engine.enqueueSong(spec());
    await flush();
    const original = await settle(engine, world, clock, queued.id);
    await expect(engine.enqueueSong(editOf(original), original.id)).rejects.toThrow('The original recording is no longer here to keep.');
  });

  it('fails plainly when the source is deleted before the edit starts', async () => {
    const { engine, world, clock, files, original } = await rendered();
    files.existing = false; // the take file is gone
    const queued = await engine.enqueueSong(editOf(original), original.id);
    await flush();
    const failed = await settle(engine, world, clock, queued.id);
    expect(failed.error).toBe('The original recording is no longer here to keep.');
    expect(files.uploaded).toEqual([]);
  });

  it('a cancel between two prompts stops the edit', async () => {
    const { engine, world, clock, original } = await rendered();
    world.alignSeries = [LINE, FLAT];
    const queued = await engine.enqueueSong(editOf(original), original.id);
    await flush(); // the alignment prompt is running
    const [job] = await engine.jobs.active();
    await engine.cancelJob(job.id);
    // ComfyUI finishes the alignment anyway (an interrupt can land too late).
    const cancelled = await settle(engine, world, clock, queued.id);
    expect(cancelled.status).toBe('cancelled');
    expect(world.submittedGraphs).toHaveLength(2); // no edit prompt was sent
    // The next job is not affected by the remembered cancel.
    world.historyStatus = 'running';
    const next = await engine.enqueueSong(spec());
    await flush();
    expect((await settle(engine, world, clock, next.id)).status).toBe('done');
  });

  it('a failed edit can be retried as a whole remix', async () => {
    const { engine, world, clock, original } = await rendered();
    world.alignSeries = [FLAT];
    const queued = await engine.enqueueSong(editOf(original), original.id);
    await flush();
    await settle(engine, world, clock, queued.id);

    world.historyStatus = 'running';
    await engine.retryWhole(queued.id);
    await flush();
    const done = await settle(engine, world, clock, queued.id);
    const graph = world.submittedGraphs[world.submittedGraphs.length - 1];
    expect(graph.source).toBeUndefined();
    expect(graph.perform.inputs).toMatchObject({ lyrics: queued.spec.lyrics, abc: original.planAbc, seed: 7 });
    expect(graph.perform.inputs.tokens).toBeUndefined();
    expect(done.status).toBe('done');
    expect(done.spec.edit).toBeUndefined();
    expect(done.editWindows).toBeUndefined();
    expect(done.parentId).toBe(original.id);
  });

  it('a plain retry of a failed edit is still an edit', async () => {
    const { engine, world, clock, original } = await rendered();
    world.alignSeries = [FLAT, LINE, FLAT];
    const queued = await engine.enqueueSong(editOf(original), original.id);
    await flush();
    await settle(engine, world, clock, queued.id);

    world.historyStatus = 'running';
    await engine.retrySong(queued.id);
    await flush();
    const done = await settle(engine, world, clock, queued.id);
    expect(done.status).toBe('done');
    expect(done.editWindows).toEqual(editWindows(LINE));
  });
});
