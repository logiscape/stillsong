// The YuE2 render round-trip: what the engine harvests from /history (the
// length YuE2 reports, the melody plan it performed), plan reuse on remixes,
// truncation detection, and tracking a ComfyUI that dies mid-song.

import { describe, expect, it } from 'vitest';
import { Engine, composedLength, performedPlan } from '@engine/index';
import { MAX_DURATION_SEC, defaultSpec, type SongSpec } from '@engine/domain/types';
import { b64ToBytes, bytesToB64 } from '@engine/base64';
import type { HistoryEntry } from '@engine/comfy/client';
import { flush, makePorts } from './fakes';

const spec = (over: Partial<SongSpec> = {}): SongSpec => ({
  ...defaultSpec(),
  title: 'Test',
  caption: 'Global Metadata: a\n\nVocal Details: b\n\nArrangement: c',
  lyrics: '[verse]\nhello',
  targetSec: 20,
  seed: '7',
  ...over,
});

const hist = (texts: Record<string, string>): HistoryEntry => ({ status: 'success', files: [], texts });

describe('base64', () => {
  it('round-trips more than one encoder chunk', () => {
    const blob = new Uint8Array(70_000).map((_, i) => i & 0xff);
    expect([...b64ToBytes(bytesToB64(blob))]).toEqual([...blob]);
  });
});

describe('composedLength', () => {
  it('takes the length YuE2 reports and flags a natural end', () => {
    expect(composedLength(hist({ seconds_out: '241.76' }), spec(), { value: 6050, max: 12500 })).toEqual({ actualSec: 241.76, hitCeiling: false });
  });

  it('flags a song that filled max_duration', () => {
    expect(composedLength(hist({ seconds_out: String(MAX_DURATION_SEC) }), spec(), undefined)).toEqual({ actualSec: MAX_DURATION_SEC, hitCeiling: true });
  });

  it('flags a song that ran out of a budget the prompt shrank below the cap', () => {
    // A long caption + plan leaves 9000 tokens: 360 s, well under the 500 s cap.
    expect(composedLength(hist({ seconds_out: '360' }), spec(), { value: 9000, max: 9000 })).toEqual({ actualSec: 360, hitCeiling: true });
  });

  it('is unknown without a length or progress', () => {
    expect(composedLength(null, spec())).toBeUndefined();
    expect(composedLength(hist({}), spec(), { value: 100, max: 12500 })).toEqual({ hitCeiling: false });
  });
});

describe('performedPlan', () => {
  it('prefers the plan the graph wrote, falls back to the one it was given, none when off', () => {
    expect(performedPlan(hist({ plan_out: 'X:1 written' }), spec())).toBe('X:1 written');
    expect(performedPlan(hist({}), spec({ abc: 'X:1 kept' }))).toBe('X:1 kept');
    expect(performedPlan(hist({ plan_out: 'X:1' }), spec({ planMode: 'off' }))).toBeUndefined();
  });
});

describe('engine render round-trip', () => {
  it('harvests the audio, the length and the melody plan', async () => {
    const { ports, world, clock, runtime } = makePorts();
    const engine = await Engine.create(ports);
    const song = await engine.enqueueSong(spec());
    await flush();
    expect(world.submittedGraph?.plan.class_type).toBe('YuE2GenerateABC');
    expect(world.submittedGraph?.save.inputs.filename_prefix).toBe(`audio/stillsong2/${song.id.slice(0, 8)}`);

    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    const done = await engine.songs.byId(song.id);
    expect(done?.status).toBe('done');
    expect(done?.actualSec).toBe(42.4);
    expect(done?.hitCeiling).toBe(false);
    expect(done?.planAbc).toBe(world.planText);
    expect(runtime.removedOutputs.map((f) => f.filename)).toEqual(['x_00001_.mp3']);
  });

  it('a keep-melody remix performs the saved plan without writing a new one', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const original = await engine.enqueueSong(spec());
    await flush();
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    const saved = (await engine.songs.byId(original.id))!.planAbc!;

    world.historyStatus = 'running';
    const remix = await engine.enqueueSong(spec({ abc: saved, lyrics: '[verse]\nhello again' }), original.id);
    await flush();
    expect(world.submittedGraph?.plan).toBeUndefined();
    expect(world.submittedGraph?.perform.inputs.abc).toBe(saved);
    // Same cap as the original: a changed cap changes the performance.
    expect(world.submittedGraph?.perform.inputs.max_duration).toBe(MAX_DURATION_SEC);

    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    const done = await engine.songs.byId(remix.id);
    expect(done?.parentId).toBe(original.id);
    expect(done?.planAbc).toBe(saved);
  });

  it('retry re-queues the same song with its kept plan', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const song = await engine.enqueueSong(spec({ abc: 'X:1 kept' }));
    await flush();
    world.historyStatus = 'error';
    await clock.advance(10_000);
    await flush();
    expect((await engine.songs.byId(song.id))?.status).toBe('failed');

    world.historyStatus = 'running';
    world.submittedGraph = null as typeof world.submittedGraph;
    await engine.retrySong(song.id);
    await flush();
    expect(world.submittedGraph?.perform.inputs.abc).toBe('X:1 kept');
  });
});

describe('render tracking when ComfyUI dies', () => {
  it('fails the song after consecutive history-poll transport failures', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const song = await engine.enqueueSong(spec());
    await flush();
    expect(world.submittedGraph).not.toBeNull();

    // One healthy poll while the job runs…
    await clock.advance(10_000);
    expect((await engine.songs.byId(song.id))?.status).toBe('running');

    // …then the server dies. Two failures keep waiting; the third settles.
    world.historyStatus = 'down';
    await clock.advance(10_000);
    await clock.advance(10_000);
    expect((await engine.songs.byId(song.id))?.status).toBe('running');
    await clock.advance(10_000);
    await flush();

    const failed = await engine.songs.byId(song.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('The studio stopped answering mid-song.');
  });
});
