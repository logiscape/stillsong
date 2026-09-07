// Engine job pipeline against in-process fakes (see fakes.ts). The WS never
// connects, so these paths run on the history-poll fallback.

import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/index';
import { RENDER_STEPS, canEnhance, defaultSpec } from '@engine/domain/types';
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

  it('enhances a song in place: the 80-step re-take inherits its date, lineage and children, and the old files go', async () => {
    const { ports, world, clock, files } = makePorts();
    const engine = await Engine.create(ports);
    const photo = await engine.importPhoto('C:\pics\sunset.jpg');
    const withPhoto = { ...spec(), photo };

    // Each job needs a flush (to schedule its poll) and a tick (to fire it).
    const settle = async (jobs: number) => {
      for (let i = 0; i < jobs; i++) {
        await flush();
        await clock.advance(10_000);
      }
    };
    const root = await engine.enqueueSong(withPhoto);
    await clock.advance(1_000);
    const original = await engine.enqueueSong(withPhoto, root.id);
    await clock.advance(1_000);
    const child = await engine.enqueueSong(withPhoto, original.id);
    world.historyStatus = 'success';
    await settle(3);
    const before = (await engine.songs.byId(original.id))!;
    expect(before.spec.steps).toBe(RENDER_STEPS.fast);
    expect(canEnhance(before)).toBe(true);
    await engine.songs.setTitle(original.id, 'Renamed');

    await clock.advance(1_000);
    world.historyStatus = 'running';
    const take = await engine.enhanceSong(original.id);
    expect(take.replacesSongId).toBe(original.id);
    expect(take.spec.steps).toBe(RENDER_STEPS.enhanced);
    expect(take.spec.seed).toBe(before.spec.seed);
    expect(take.spec.durationSec).toBe(before.spec.durationSec);
    await flush();
    expect(world.submittedGraph?.sample.inputs.steps).toBe(RENDER_STEPS.enhanced);
    // Until it lands, the original is untouched and still plays.
    expect((await engine.songs.byId(original.id))?.status).toBe('done');

    const doneEvents: string[] = [];
    engine.on((e) => { if (e.kind === 'song_done') doneEvents.push(e.song.id); });
    world.historyStatus = 'success';
    await settle(1);

    // The re-take now stands where the original stood.
    const swapped = (await engine.songs.byId(take.id))!;
    expect(doneEvents).toEqual([take.id]);
    expect(swapped.status).toBe('done');
    expect(swapped.createdAt).toBe(before.createdAt);
    expect(swapped.parentId).toBe(root.id);
    expect(swapped.spec.title).toBe('Renamed');
    expect(swapped.replacesSongId).toBeUndefined();
    expect(canEnhance(swapped)).toBe(false);
    expect((await engine.songs.byId(child.id))?.parentId).toBe(take.id);
    expect(await engine.songs.byId(original.id)).toBeNull();
    expect(files.removed).toContain(before.outputPath);
    // The shared photo survives: the re-take references it.
    expect(await engine.photos.byId(photo.id)).not.toBeNull();
    // Nothing to enhance twice.
    await expect(engine.enhanceSong(take.id)).rejects.toThrow(/already/);
  });

  it('keeps an enhance re-take as an ordinary song when its original was deleted mid-render', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const original = await engine.enqueueSong(spec());
    await flush();
    world.historyStatus = 'success';
    await clock.advance(10_000);
    world.historyStatus = 'running';
    const take = await engine.enhanceSong(original.id);
    await flush();
    await engine.deleteSong(original.id);
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    const done = (await engine.songs.byId(take.id))!;
    expect(done.status).toBe('done');
    expect(done.parentId).toBeUndefined();
  });

  it('returns the pending re-take instead of queuing a second enhance of the same song', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const original = await engine.enqueueSong(spec());
    await flush();
    world.historyStatus = 'success';
    await clock.advance(10_000);
    world.historyStatus = 'running';
    const first = await engine.enhanceSong(original.id);
    await flush();
    const second = await engine.enhanceSong(original.id);
    expect(second.id).toBe(first.id);
    expect((await engine.songs.list()).length).toBe(2);
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    const left = await engine.songs.list();
    expect(left.map((x) => x.id)).toEqual([first.id]);
    expect(left[0].spec.steps).toBe(RENDER_STEPS.enhanced);
  });

  it('finishes a replacement interrupted between harvest and swap on the next boot', async () => {
    const { ports, world, clock, files } = makePorts();
    const engine = await Engine.create(ports);
    const original = await engine.enqueueSong(spec());
    await clock.advance(1_000);
    const retake = await engine.enqueueSong({ ...spec(), steps: RENDER_STEPS.enhanced }, original.id);
    world.historyStatus = 'success';
    for (let i = 0; i < 2; i++) {
      await flush();
      await clock.advance(10_000);
    }
    expect((await engine.songs.byId(retake.id))?.status).toBe('done');
    // "Crash" right after the job went done but before the swap ran: the
    // marker is still on the finished re-take.
    await ports.db.execute(`UPDATE song SET replaces_song_id = ? WHERE id = ?`, [original.id, retake.id]);

    const engine2 = await Engine.create(ports);
    await flush();
    expect(await engine2.songs.byId(original.id)).toBeNull();
    const swapped = (await engine2.songs.byId(retake.id))!;
    expect(swapped.replacesSongId).toBeUndefined();
    expect(swapped.parentId).toBeUndefined();
    expect(swapped.createdAt).toBe(original.createdAt);
    expect(files.removed).toContain(`C:\\lib\\songs/${original.id}.mp3`);
  });

  it('finishes a swap interrupted after the original files were removed, using the persisted verdict', async () => {
    const { ports, world, clock, files } = makePorts();
    world.stillsongNode = true;
    const engine = await Engine.create(ports);
    const original = await engine.enqueueSong(spec());
    await clock.advance(1_000);
    const retake = await engine.enqueueSong({ ...spec(), steps: RENDER_STEPS.enhanced }, original.id);
    world.historyStatus = 'success';
    for (let i = 0; i < 2; i++) {
      await flush();
      await clock.advance(10_000);
    }
    const before = (await engine.songs.byId(original.id))!;
    expect(before.codesPath).toBeTruthy();
    // "Crash" after the verdict was written and the original's files were
    // removed, but before its row went: the old codes now read as garbage.
    await ports.db.execute(`UPDATE song SET replaces_song_id = ?, replace_verified = 1 WHERE id = ?`, [original.id, retake.id]);
    files.base64ByPath[before.codesPath!] = 'GONE';

    const engine2 = await Engine.create(ports);
    await flush();
    expect(await engine2.songs.byId(original.id)).toBeNull();
    const swapped = (await engine2.songs.byId(retake.id))!;
    expect(swapped.replacesSongId).toBeUndefined();
    expect(swapped.replaceVerified).toBeUndefined();
    expect(swapped.createdAt).toBe(before.createdAt);

    // Without the persisted verdict the same mismatch is (rightly) a keep.
    const a = await engine2.enqueueSong(spec());
    await clock.advance(1_000);
    const b = await engine2.enqueueSong({ ...spec(), steps: RENDER_STEPS.enhanced }, a.id);
    for (let i = 0; i < 2; i++) {
      await flush();
      await clock.advance(10_000);
    }
    await ports.db.execute(`UPDATE song SET replaces_song_id = ? WHERE id = ?`, [a.id, b.id]);
    files.base64ByPath[(await engine2.songs.byId(a.id))!.codesPath!] = 'DIFFERENT';
    const engine3 = await Engine.create(ports);
    await flush();
    expect((await engine3.songs.byId(a.id))?.status).toBe('done');
    expect((await engine3.songs.byId(b.id))?.parentId).toBe(a.id);
    expect((await engine3.songs.byId(b.id))?.replacesSongId).toBeUndefined();
  });

  it('keeps the re-take as a new version when the composition is not provably the same', async () => {
    // With the overlay both renders save codes; a byte mismatch means the
    // performance changed, so the original must survive.
    const { ports, world, clock, files } = makePorts();
    world.stillsongNode = true;
    const engine = await Engine.create(ports);
    const original = await engine.enqueueSong(spec());
    await flush();
    world.historyStatus = 'success';
    await clock.advance(10_000);
    const before = (await engine.songs.byId(original.id))!;
    expect(before.codesPath).toBeTruthy();
    world.historyStatus = 'running';
    const take = await engine.enhanceSong(original.id);
    await flush();
    files.base64ByPath[before.codesPath!] = 'AAAA';
    files.base64ByPath[`C:\\lib\\songs/${take.id}.codes.bin`] = 'BBBB';
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    expect((await engine.songs.byId(original.id))?.status).toBe('done');
    const kept = (await engine.songs.byId(take.id))!;
    expect(kept.status).toBe('done');
    expect(kept.parentId).toBe(original.id);
    expect(kept.replacesSongId).toBeUndefined();
    expect(files.removed).not.toContain(before.outputPath);

    // Matching codes: the swap goes ahead.
    files.base64ByPath = {};
    world.historyStatus = 'running';
    const take2 = await engine.enhanceSong(original.id);
    await flush();
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    expect(await engine.songs.byId(original.id)).toBeNull();
    expect((await engine.songs.byId(take2.id))?.replacesSongId).toBeUndefined();
    expect((await engine.songs.byId(kept.id))?.parentId).toBe(take2.id);
  });

  it('never replaces a forced render that has no codes to compare', async () => {
    // Stock ComfyUI (no overlay): a song rendered with a prefix has no saved
    // codes, and a same-seed free render would not reproduce its prefix.
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const source = await engine.enqueueSong(spec());
    await clock.advance(1_000);
    const forced = await engine.enqueueSong(spec(), source.id, { songId: source.id, frames: 4 });
    world.historyStatus = 'success';
    for (let i = 0; i < 2; i++) {
      await flush();
      await clock.advance(10_000);
    }
    expect((await engine.songs.byId(forced.id))?.prefixSongId).toBe(source.id);
    world.historyStatus = 'running';
    const take = await engine.enhanceSong(forced.id);
    await flush();
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    expect((await engine.songs.byId(forced.id))?.status).toBe('done');
    expect((await engine.songs.byId(take.id))?.parentId).toBe(forced.id);
    expect((await engine.songs.byId(take.id))?.replacesSongId).toBeUndefined();
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
