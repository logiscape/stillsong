// Engine job pipeline against in-process fakes (see fakes.ts). The WS never
// connects, so these paths run on the history-poll fallback.

import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/index';
import { defaultSpec } from '@engine/domain/types';
import { flush, makePorts } from './fakes';

const spec = () => ({
  ...defaultSpec(),
  title: 'Test',
  caption: 'Global Metadata: a\n\nVocal Details: b\n\nArrangement: c',
  lyrics: '[verse]\nhello',
  targetSec: 20,
  durationSec: 20,
  seed: '7',
});

describe('Engine job pipeline', () => {
  it('stops the LLM, submits the graph, polls history, and harvests the mp3', async () => {
    const { ports, world, clock, files, runtime } = makePorts();
    const engine = await Engine.create(ports);
    const events: string[] = [];
    engine.on((e) => events.push(e.kind));

    const song = await engine.enqueueSong(spec());
    expect(song.status).toBe('queued');
    await flush();

    // The songwriter process is stopped, then ComfyUI is ensured up (this is
    // what reaches the supervisor's crash-restart-once), then the graph goes in.
    const stopIdx = world.events.indexOf('stopLlm');
    const startComfyIdx = world.events.indexOf('startComfy');
    const submitIdx = world.events.indexOf('submit');
    expect(stopIdx).toBeGreaterThanOrEqual(0);
    expect(startComfyIdx).toBeGreaterThan(stopIdx);
    expect(submitIdx).toBeGreaterThan(startComfyIdx);
    expect(world.submittedGraph?.encode.inputs).toMatchObject({ seed: 7, max_duration: 20, lyrics: '[verse]\nhello' });
    expect(world.submittedGraph?.save.inputs.filename_prefix).toBe(`audio/stillsong/${song.id.slice(0, 8)}`);

    expect((await engine.jobs.active())[0]?.state).toBe('running');
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();

    const done = await engine.songs.byId(song.id);
    expect(done?.status).toBe('done');
    expect(done?.outputPath).toBe(`C:\\lib\\songs/${song.id}.mp3`);
    expect(done?.renderMs).toBe(10_000);
    expect(files.downloaded[0]).toContain('/view?filename=x_00001_.mp3&subfolder=audio%5Cstillsong&type=output');
    expect(events).toContain('song_done');
    expect(await engine.jobs.active()).toEqual([]);
    // ComfyUI's own copy is deleted once the library holds the render.
    expect(runtime.removedOutputs).toEqual([{ filename: 'x_00001_.mp3', subfolder: 'audio\\stillsong', type: 'output' }]);
  });

  it('sweeps orphaned ComfyUI outputs at startup and keeps files that belong to songs', async () => {
    const { ports, world, runtime } = makePorts();
    const engine = await Engine.create(ports);
    const song = await engine.enqueueSong(spec());
    await flush();
    world.historyStatus = 'success';
    const id8 = song.id.slice(0, 8);
    // Leftovers as ComfyUI writes them on Windows (backslash subfolder), one
    // forward-slash variant, one belonging to a live song, and a stranger.
    runtime.outputs = [
      { filename: `${id8}_00002.mp3`, subfolder: 'audio\\stillsong' },
      { filename: `${id8}_00001_.codes.bin`, subfolder: 'audio\\stillsong' },
      { filename: 'deadbeef_00002.mp3', subfolder: 'audio\\stillsong' },
      { filename: 'deadbeef_00001_.codes.bin', subfolder: 'audio/stillsong' },
      { filename: 'not-ours.png', subfolder: '' },
      { filename: 'x_00001_.mp3', subfolder: 'audio\\stillsong' },
    ];
    // "Restart": a second engine over the same DB recovers the render, then sweeps.
    const engine2 = await Engine.create(ports);
    await flush();
    expect((await engine2.songs.byId(song.id))?.status).toBe('done');
    const removed = runtime.removedOutputs.map((f) => f.filename).sort();
    expect(removed).toEqual(['deadbeef_00001_.codes.bin', 'deadbeef_00002.mp3', 'x_00001_.mp3'].sort());
    expect(runtime.outputs.map((f) => f.filename).sort()).toEqual([`${id8}_00001_.codes.bin`, `${id8}_00002.mp3`, 'not-ours.png'].sort());

    // Deleting the song makes its leftovers orphans for the next boot.
    await engine2.deleteSong(song.id);
    expect(await engine2.sweepComfyOutputs()).toBe(2);
    expect(runtime.outputs.map((f) => f.filename)).toEqual(['not-ours.png']);
  });

  it("marks the song failed with ComfyUI's error message", async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const song = await engine.enqueueSong(spec());
    await flush();
    world.historyStatus = 'error';
    await clock.advance(10_000);
    const failed = await engine.songs.byId(song.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('KSampler: OOM: out of memory');
  });

  it('cancels queued jobs and deletes songs with their files', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const first = await engine.enqueueSong(spec());
    const second = await engine.enqueueSong(spec());
    await flush();
    const queued = await engine.jobs.queued();
    expect(queued.map((j) => j.songId)).toEqual([second.id]);
    await engine.cancelJob(queued[0].id);
    expect((await engine.songs.byId(second.id))?.status).toBe('cancelled');
    world.historyStatus = 'success';
    await clock.advance(10_000);
    expect((await engine.songs.byId(first.id))?.status).toBe('done');
    await engine.deleteSong(first.id);
    expect(await engine.songs.byId(first.id)).toBeNull();
  });

  it('recovers a finished render after a restart', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const song = await engine.enqueueSong(spec());
    await flush();
    // "Crash": build a second engine over the same DB while ComfyUI finished meanwhile.
    world.historyStatus = 'success';
    const engine2 = await Engine.create(ports);
    await flush();
    expect((await engine2.songs.byId(song.id))?.status).toBe('done');
    void clock;
  });

  it('rejects invalid specs before persisting', async () => {
    const { ports } = makePorts();
    const engine = await Engine.create(ports);
    await expect(engine.enqueueSong({ ...spec(), durationSec: 1000 })).rejects.toThrow(/Duration/);
    expect(await engine.songs.list()).toEqual([]);
  });

  it('re-parents children and garbage-collects photos on delete', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const photo = await engine.importPhoto('C:\\pics\\sunset.jpg');
    expect(photo.thumbPath).toBe('C:\\lib\\thumbs/sunset.webp');
    expect(photo.luminance).toBeCloseTo(0.42);
    expect(photo.dominantColor).toBe('#aabbcc');
    const withPhoto = { ...spec(), photo };

    const a = await engine.enqueueSong(withPhoto);
    const b = await engine.enqueueSong(withPhoto, a.id);
    const c = await engine.enqueueSong(withPhoto, b.id);
    world.historyStatus = 'success';
    await clock.advance(60_000);
    await flush();

    // Deleting the middle link re-parents the child to its grandparent.
    await engine.deleteSong(b.id);
    expect((await engine.songs.byId(c.id))?.parentId).toBe(a.id);
    // The photo is still referenced by a and c.
    expect(await engine.photos.byId(photo.id)).not.toBeNull();

    await engine.deleteSong(a.id);
    expect((await engine.songs.byId(c.id))?.parentId).toBeUndefined();
    expect(await engine.photos.byId(photo.id)).not.toBeNull();

    await engine.deleteSong(c.id);
    expect(await engine.photos.byId(photo.id)).toBeNull();
  });

  it('sweeps photos no song references at boot, keeping shared ones', async () => {
    const { ports, world, clock, files } = makePorts();
    const engine = await Engine.create(ports);
    // Chosen, then abandoned before Create: imported, never attached to a song.
    const abandoned = await engine.importPhoto('C:\\pics\\abandoned.jpg');
    // Shared by two songs; deleting one must not free it.
    const shared = await engine.importPhoto('C:\\pics\\shared.jpg');
    const a = await engine.enqueueSong({ ...spec(), photo: shared });
    const b = await engine.enqueueSong({ ...spec(), photo: shared });
    // Referenced only by a failed song — still referenced.
    const failedOnly = await engine.importPhoto('C:\\pics\\failed.jpg');
    const f = await engine.enqueueSong({ ...spec(), photo: failedOnly });
    world.historyStatus = 'success';
    await clock.advance(60_000);
    await flush();
    await engine.songs.setStatus(f.id, 'failed', 'boom');
    await engine.deleteSong(a.id);
    expect(await engine.photos.byId(shared.id)).not.toBeNull();

    // Mid-session nothing touches the abandoned asset (the next boot does).
    expect(await engine.photos.byId(abandoned.id)).not.toBeNull();
    files.removed.length = 0;

    const engine2 = await Engine.create(ports);
    expect(await engine2.photos.byId(abandoned.id)).toBeNull();
    expect(files.removed).toEqual([abandoned.localPath, abandoned.thumbPath]);
    expect(await engine2.photos.byId(shared.id)).not.toBeNull();
    expect(await engine2.photos.byId(failedOnly.id)).not.toBeNull();
    expect((await engine2.songs.byId(b.id))?.spec.photo?.id).toBe(shared.id);
    // Idempotent: a clean library sweeps nothing.
    expect(await engine2.sweepOrphanPhotos()).toBe(0);
  });
});
