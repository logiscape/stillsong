// The store's side of a melody edit asked for from the Song map: it stays on
// the map, apart from an ordinary creation, from the request to the new version.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HARVEST_PHASE, type EngineEvent } from '@engine/index';
import { defaultSpec, type Job, type Song } from '@engine/domain/types';
import { stopReady, STOP_GUARD_MS } from '../mapEdit';

type Store = typeof import('../store');

const song = (id: string, over: Partial<Song> = {}): Song => ({
  id, createdAt: 1, status: 'done', spec: { ...defaultSpec(), title: id, lyrics: '[verse]\nA line' }, planAbc: 'the plan', takePath: 'take', ...over,
});
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

/** A fresh store over a stand-in engine whose queue the test controls. */
async function boot() {
  vi.resetModules();
  // The store keeps a timer to ask after the studio; there is no window here.
  vi.stubGlobal('window', { setInterval: () => 0 });
  const store: Store = await import('../store');
  const songs = [song('orig')];
  const jobs: Job[] = [];
  let emit: (e: EngineEvent) => void = () => {};
  let accept: (s: Song) => void = () => {};
  const engine = {
    on: (cb: (e: EngineEvent) => void) => { emit = cb; return () => {}; },
    installState: { state: 'ready' },
    settings: {},
    songs: { list: async () => songs.map((s) => ({ ...s })) },
    jobs: { queued: async () => [], active: async () => jobs.slice() },
    comfy: { systemStats: async () => null },
    llm: { isHealthy: async () => false },
    enqueueSong: vi.fn(() => new Promise<Song>((resolve) => { accept = resolve; })),
    retrySong: vi.fn(async (id: string) => songs.find((s) => s.id === id)!),
    cancelJob: vi.fn(async () => {}),
  };
  await store.bootstrap(engine as never);
  store.openSong('orig');
  store.navigate('map');
  /** The studio takes the request: the new version's row exists and its job runs. */
  const take = async (id = 'new') => {
    const queued = song(id, { status: 'running', parentId: 'orig', planAbc: undefined, takePath: undefined });
    songs.push(queued);
    jobs.push({ id: `job-${id}`, songId: id, state: 'running', queuePos: 0, createdAt: 1 });
    accept(queued);
    await tick();
    return queued;
  };
  return { store, engine, songs, jobs, emit: (e: EngineEvent) => emit(e), take, state: () => store.appState() };
}

beforeEach(() => vi.unstubAllGlobals());

describe('singing new notes from the map', () => {
  it('keeps the request, with the plan it sent, and stays on the map while the studio works', async () => {
    const { store, engine, emit, take, state } = await boot();
    void store.singNewNotes(song('orig'), 'the plan, edited');
    expect(state().mapEdit).toMatchObject({ sourceId: 'orig', songId: '', taken: false, abc: 'the plan, edited' });
    await take();
    expect(engine.enqueueSong.mock.calls[0]).toMatchObject([{ abc: 'the plan, edited', edit: { sourceId: 'orig' } }, 'orig']);
    expect(state().mapEdit).toMatchObject({ sourceId: 'orig', songId: 'new', taken: true, abc: 'the plan, edited' });
    emit({ kind: 'progress', progress: { jobId: 'job-new', songId: 'new', phase: 'Rendering audio' } });
    expect(state().mapEdit?.progress?.phase).toBe('Rendering audio');
    expect([state().screen, state().creation]).toEqual(['map', null]);
  });

  it('turns the map to the new version when it is done', async () => {
    const { store, songs, emit, take, state } = await boot();
    void store.singNewNotes(song('orig'), 'edited');
    const queued = await take();
    Object.assign(songs[1], { status: 'done', planAbc: 'edited' });
    emit({ kind: 'song_done', song: { ...queued, status: 'done' } });
    await tick();
    expect(state()).toMatchObject({ screen: 'map', selectedSongId: 'new', mapArrival: 'new', mapEdit: null, autoplayOnOpen: false });
    expect(state().songs.find((s) => s.id === 'new')?.planAbc).toBe('edited'); // the finished row is there before the map asks for it
    store.clearMapArrival();
    expect(state().mapArrival).toBeNull();
  });

  it('does not pull back someone who left the map', async () => {
    const { store, emit, take, state } = await boot();
    void store.singNewNotes(song('orig'), 'edited');
    const queued = await take();
    store.navigate('sanctuary');
    emit({ kind: 'song_done', song: { ...queued, status: 'done' } });
    await tick();
    expect(state()).toMatchObject({ screen: 'sanctuary', selectedSongId: 'orig', mapArrival: null, mapEdit: null });
  });

  it('keeps a failure, and the plan it was for, until it is dealt with', async () => {
    const { store, engine, emit, take, state } = await boot();
    void store.singNewNotes(song('orig'), 'edited');
    const queued = await take();
    store.navigate('song');
    emit({ kind: 'song_failed', song: { ...queued, status: 'failed', error: 'The studio kept to the old notes.' } });
    await tick();
    // Not the Create screen's failure: the map's, waiting for whoever comes back to it.
    expect(state()).toMatchObject({ screen: 'song', creationError: null, failedSong: null });
    expect(state().mapEdit).toMatchObject({ sourceId: 'orig', songId: 'new', abc: 'edited', error: 'The studio kept to the old notes.' });

    const failedAt = state().mapEdit!.since;
    await new Promise((r) => setTimeout(r, 5));
    await store.retryMapEdit();
    expect(engine.retrySong).toHaveBeenCalledWith('new');
    expect(state().mapEdit).toMatchObject({ songId: 'new', taken: true, abc: 'edited' });
    expect(state().mapEdit!.error).toBeUndefined();
    expect(state().mapEdit!.since).toBeGreaterThan(failedAt); // Stop's guard starts over

    await store.dropMapEdit();
    expect(state().mapEdit).toBeNull();
  });

  it('stopping one that is being sung cancels its job', async () => {
    const { store, engine, take, state } = await boot();
    void store.singNewNotes(song('orig'), 'edited');
    await take();
    await store.dropMapEdit();
    expect(engine.cancelJob).toHaveBeenCalledWith('job-new');
    expect(state().mapEdit).toBeNull();
  });

  it('stopping one the studio has not taken yet cancels it as soon as it has', async () => {
    const { store, engine, take, state } = await boot();
    void store.singNewNotes(song('orig'), 'edited');
    await store.dropMapEdit();
    expect(engine.cancelJob).not.toHaveBeenCalled(); // nothing to cancel yet
    expect(state().mapEdit).toBeNull();
    await take();
    expect(engine.cancelJob).toHaveBeenCalledWith('job-new');
    expect(state().mapEdit).toBeNull(); // and it does not come back on screen
  });

  it('trying again has nothing to stop until the studio has taken it; stopped before that, it is cancelled once it has', async () => {
    const { store, engine, jobs, emit, take, state } = await boot();
    void store.singNewNotes(song('orig'), 'edited');
    const queued = await take();
    jobs.length = 0; // the failed job is over
    emit({ kind: 'song_failed', song: { ...queued, status: 'failed', error: 'The studio kept to the old notes.' } });
    await tick();

    let accept: () => void = () => {};
    engine.retrySong.mockImplementationOnce(() => new Promise<Song>((resolve) => { accept = () => resolve(queued); }));
    void store.retryMapEdit();
    expect(state().mapEdit).toMatchObject({ songId: 'new', taken: false });
    expect(stopReady(state().mapEdit!, state().mapEdit!.since + 60_000)).toBe(false); // so Stop is not offered yet

    // Put away all the same (by a call the map does not make while Stop is off): nothing to cancel yet.
    await store.dropMapEdit();
    expect(engine.cancelJob).not.toHaveBeenCalled();
    jobs.push({ id: 'job-again', songId: 'new', state: 'queued', queuePos: 0, createdAt: 2 });
    accept();
    await tick();
    expect(engine.cancelJob).toHaveBeenCalledWith('job-again'); // it does not run on untracked
    expect(state().mapEdit).toBeNull();
  });

  it('a retry the studio takes can be stopped like any other', async () => {
    const { store, engine, jobs, emit, take, state } = await boot();
    void store.singNewNotes(song('orig'), 'edited');
    const queued = await take();
    emit({ kind: 'song_failed', song: { ...queued, status: 'failed', error: 'no' } });
    await tick();
    await store.retryMapEdit();
    expect(state().mapEdit).toMatchObject({ songId: 'new', taken: true });
    expect(stopReady(state().mapEdit!, state().mapEdit!.since + STOP_GUARD_MS)).toBe(true);
    expect(jobs).toHaveLength(1);
    await store.dropMapEdit();
    expect(engine.cancelJob).toHaveBeenCalledWith('job-new');
  });

  it('once the version is being copied into the library, Stop does nothing and the map still turns to it', async () => {
    const { store, engine, songs, emit, take, state } = await boot();
    void store.singNewNotes(song('orig'), 'edited');
    const queued = await take();
    emit({ kind: 'progress', progress: { jobId: 'job-new', songId: 'new', phase: HARVEST_PHASE } });
    expect(stopReady(state().mapEdit!, state().mapEdit!.since + 60_000)).toBe(false);
    await store.dropMapEdit();
    expect(engine.cancelJob).not.toHaveBeenCalled();
    expect(state().mapEdit).toMatchObject({ songId: 'new' }); // still the map's edit
    Object.assign(songs[1], { status: 'done', planAbc: 'edited' });
    emit({ kind: 'song_done', song: { ...queued, status: 'done' } });
    await tick();
    expect(state()).toMatchObject({ screen: 'map', selectedSongId: 'new', mapArrival: 'new', mapEdit: null });
  });

  it('a version that is finished although it was stopped is saved to the library and nothing else happens', async () => {
    const { store, engine, songs, emit, take, state } = await boot();
    void store.singNewNotes(song('orig'), 'edited');
    const queued = await take();
    // Stop lands just before the studio says it is copying: the cancel comes too late to stop anything.
    await store.dropMapEdit();
    expect(engine.cancelJob).toHaveBeenCalledWith('job-new');
    Object.assign(songs[1], { status: 'done', planAbc: 'edited' });
    emit({ kind: 'progress', progress: { jobId: 'job-new', songId: 'new', phase: HARVEST_PHASE } });
    emit({ kind: 'song_done', song: { ...queued, status: 'done' } });
    await tick();
    // Still on the map of the song that was edited: not taken to the Song view, and nothing starts playing.
    expect(state()).toMatchObject({ screen: 'map', selectedSongId: 'orig', autoplayOnOpen: false, mapArrival: null, mapEdit: null, creation: null });
    expect(state().songs.find((s) => s.id === 'new')?.status).toBe('done'); // and it is there to keep or delete
  });

  it('an edit that fails just as it is stopped does not open the Create screen', async () => {
    const { store, emit, take, state } = await boot();
    void store.singNewNotes(song('orig'), 'edited');
    const queued = await take();
    await store.dropMapEdit();
    emit({ kind: 'song_failed', song: { ...queued, status: 'failed', error: 'The studio kept to the old notes.' } });
    await tick();
    expect(state()).toMatchObject({ screen: 'map', selectedSongId: 'orig', creationError: null, failedSong: null, mapEdit: null });
  });

  it('a stopped edit is forgotten once its end is known: the same song, sung later, is handled as usual', async () => {
    const { store, emit, take, state } = await boot();
    void store.singNewNotes(song('orig'), 'edited');
    const queued = await take();
    await store.dropMapEdit();
    emit({ kind: 'song_failed', song: { ...queued, status: 'failed', error: 'no' } });
    await tick();
    // Retried from elsewhere (the library), it is an ordinary creation again.
    emit({ kind: 'song_done', song: { ...queued, status: 'done' } });
    await tick();
    expect(state()).toMatchObject({ screen: 'song', selectedSongId: 'new', autoplayOnOpen: true });
  });

  it('asks for new bars after a phrase: the request says where, and comes back with whoever returns to the map', async () => {
    const HEAD = 'X:1\nM:4/4\nL:1/8\nQ:1/4=120\nK:G\n';
    const SUNG = 'V: Vocal\n"G"G2A2B2c2|"D"d8|\nV: Ins\nz8|z8|';
    const RIFF = 'V: Vocal\n"G"z8|"D"z8|\nV: Ins\nG2B2d2B2|A2d2f2d2|';
    const plan = `${HEAD}% verse\n${SUNG}\n% interlude\n${RIFF}\n${RIFF}\n% outro\n${SUNG}\n`;
    const { store, engine, songs, emit, take, state } = await boot();
    const source = song('orig', { planAbc: plan });
    void store.playLonger(source, { phrase: 1 });
    expect(state().mapEdit).toMatchObject({ sourceId: 'orig', songId: '', taken: false, longer: { phrase: 1 } });
    const queued = await take();
    const sent = engine.enqueueSong.mock.calls[0] as unknown as [{ abc: string; edit: unknown }, string];
    // The studio writes the bars: what is sent is the song's own plan, and where the new bars go.
    expect(sent[0].edit).toEqual({ sourceId: 'orig', after: 1, write: true });
    expect(sent[0].abc).toBe(plan);
    expect(sent[1]).toBe('orig');
    expect(state().mapEdit).toMatchObject({ songId: 'new', taken: true, longer: { phrase: 1 } });

    // A failure keeps what was asked for, and trying again is still that.
    emit({ kind: 'song_failed', song: { ...queued, status: 'failed', error: 'The studio found nothing new to play there.' } });
    await tick();
    expect(state().mapEdit).toMatchObject({ error: 'The studio found nothing new to play there.', longer: { phrase: 1 } });
    await store.retryMapEdit();
    expect(state().mapEdit).toMatchObject({ songId: 'new', taken: true, longer: { phrase: 1 } });
    expect(state().mapEdit!.error).toBeUndefined();

    // Done: the map turns to the longer version, as for new notes.
    Object.assign(songs[1], { status: 'done' });
    emit({ kind: 'song_done', song: { ...queued, status: 'done' } });
    await tick();
    expect(state()).toMatchObject({ screen: 'map', selectedSongId: 'new', mapArrival: 'new', mapEdit: null });
  });

  it('asks nothing of the studio for a phrase new bars cannot follow', async () => {
    const { store, engine, state } = await boot();
    await store.playLonger(song('orig'), { phrase: 0 }); // "the plan" is no plan at all
    expect(engine.enqueueSong).not.toHaveBeenCalled();
    expect(state().mapEdit).toBeNull();
  });

  it('asks for one edit at a time', async () => {
    const { store, engine, take } = await boot();
    void store.singNewNotes(song('orig'), 'edited');
    await take();
    await store.singNewNotes(song('orig'), 'edited again');
    expect(engine.enqueueSong).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary creation alone: that still opens the Song view', async () => {
    const { songs, emit, state } = await boot();
    songs.push(song('made'));
    emit({ kind: 'song_done', song: song('made') });
    await tick();
    expect(state()).toMatchObject({ screen: 'song', selectedSongId: 'made', autoplayOnOpen: true, mapArrival: null });
  });
});
