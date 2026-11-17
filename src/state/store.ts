// App store (useSyncExternalStore pattern).
// Subscribes to engine events; the render-phase creation stages are derived
// here from job progress (NODE_PHASES text), the earlier stages arrive as
// `creation_stage` events from the one-shot pipeline. Also owns the single
// shared audio element (card audition and the Song-view player are one
// instance) — the only Tauri import here is convertFileSrc for asset URLs.

import { useSyncExternalStore } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { CreationStage, Engine, JobProgress } from '@engine/index';
import type { Job, PhotoAsset, Song, SongSpec } from '@engine/domain/types';
import { randomSeed } from '@engine/domain/types';
import { b64ToBytes } from '@engine/base64';
import { locateBars, pitchContent, type BarGrid } from '@engine/domain/barGrid';
import type { SongMap } from '@engine/domain/songMap';
import type { AppSettings } from '@engine/repo/settings';
import { clearPaintSession } from './paintSession';
import { beyondStopping, type MapEditState, type MorePhrase } from './mapEdit';
import { longerTake, melodyEditTake } from './remix';
import { routeForBoot } from './route';

export type Screen = 'setup' | 'update' | 'create' | 'sanctuary' | 'song' | 'map' | 'remix' | 'about' | 'draw';

export interface CreationState {
  stage: CreationStage;
  title?: string;
  progress?: JobProgress;
  /** The photo being turned into a song (for the status experience). */
  photo?: PhotoAsset;
}

export interface PlaybackState {
  songId: string;
  positionSec: number;
  durationSec: number;
  isPlaying: boolean;
  volume: number;
}

export interface AppState {
  ready: boolean;
  screen: Screen;
  songs: Song[];
  queuedJobs: Job[];
  activeJobs: Job[];
  /** Non-null while a creation (or remix render) is in flight. */
  creation: CreationState | null;
  /** Sticky failure from the last creation attempt (the Create flow shows it). */
  creationError: string | null;
  /** The song whose render failed, when one exists — it can be sent back to the studio as is. */
  failedSong: Song | null;
  /** Photo chosen on the Create screen, imported immediately (thumb + ambiance ready). */
  pendingPhoto: PhotoAsset | null;
  playback: PlaybackState | null;
  settings: AppSettings | null;
  comfyOnline: boolean | null;
  llmOnline: boolean | null;
  selectedSongId: string | null;
  /** Autoplay when the Song view was entered from a finished creation. */
  autoplayOnOpen: boolean;
  /** A melody edit asked for from the Song map, while it is sung or after it failed. The map shows it; the Create screen does not. */
  mapEdit: MapEditState | null;
  /** The version a melody edit just made: its map opens at the bars that were sung again, once. */
  mapArrival: string | null;
  lastError: string | null;
}

let state: AppState = {
  ready: false,
  screen: 'create',
  songs: [],
  queuedJobs: [],
  activeJobs: [],
  creation: null,
  creationError: null,
  failedSong: null,
  pendingPhoto: null,
  playback: null,
  settings: null,
  comfyOnline: null,
  llmOnline: null,
  selectedSongId: null,
  autoplayOnOpen: false,
  mapEdit: null,
  mapArrival: null,
  lastError: null,
};

let engine: Engine | null = null;
const listeners = new Set<() => void>();

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

/** The state as it is now, for code that is not a React component. */
export function appState(): AppState {
  return state;
}

export function getEngine(): Engine {
  if (!engine) throw new Error('engine not ready');
  return engine;
}

export function photoSrc(p?: PhotoAsset | null): string | undefined {
  if (!p) return undefined;
  return convertFileSrc(p.localPath);
}

export function thumbSrc(p?: PhotoAsset | null): string | undefined {
  if (!p) return undefined;
  return convertFileSrc(p.thumbPath ?? p.localPath);
}

// ---- shared audio element --------------------------------------------------

const audio = typeof Audio !== 'undefined' ? new Audio() : (null as unknown as HTMLAudioElement);
if (audio) {
  audio.addEventListener('timeupdate', () => {
    if (!state.playback) return;
    setState({ playback: { ...state.playback, positionSec: audio.currentTime, durationSec: audio.duration || state.playback.durationSec } });
  });
  audio.addEventListener('ended', () => {
    if (!state.playback) return;
    setState({ playback: { ...state.playback, isPlaying: false, positionSec: 0 } });
  });
  audio.addEventListener('loadedmetadata', () => {
    if (!state.playback) return;
    setState({ playback: { ...state.playback, durationSec: audio.duration || 0 } });
  });
}

/** Starts (or toggles) playback of a song; starting one song stops any other. */
export function playSong(song: Song): void {
  if (!song.outputPath) return;
  if (state.playback?.songId === song.id) {
    togglePlay();
    return;
  }
  audio.src = convertFileSrc(song.outputPath);
  audio.volume = state.playback?.volume ?? 0.8;
  void audio.play();
  setState({
    playback: {
      songId: song.id,
      positionSec: 0,
      durationSec: song.actualSec ?? 0,
      isPlaying: true,
      volume: state.playback?.volume ?? 0.8,
    },
  });
}

/**
 * Plays a song from a given second, loading it first when another song (or
 * none) is in the player. The song map's transport: it starts from wherever
 * its playhead was put.
 */
export function playSongFrom(song: Song, sec: number): void {
  if (!song.outputPath) return;
  const volume = state.playback?.volume ?? 0.8;
  const loaded = state.playback?.songId === song.id;
  if (!loaded) {
    audio.src = convertFileSrc(song.outputPath);
    audio.volume = volume;
  }
  // Before the file's metadata arrives this sets where playback will begin.
  audio.currentTime = Math.max(0, sec);
  void audio.play();
  setState({
    playback: {
      songId: song.id,
      positionSec: Math.max(0, sec),
      durationSec: loaded ? state.playback!.durationSec : song.actualSec ?? 0,
      isPlaying: true,
      volume,
    },
  });
}

export function pausePlayback(): void {
  if (!state.playback) return;
  audio.pause();
  setState({ playback: { ...state.playback, isPlaying: false } });
}

/**
 * Where the shared player is right now, in seconds. `playback.positionSec`
 * follows the player's own progress events (about four a second), too coarse
 * to draw a moving playhead from.
 */
export function playbackTime(): number {
  return audio.currentTime;
}

export function togglePlay(): void {
  if (!state.playback) return;
  if (audio.paused) {
    void audio.play();
    setState({ playback: { ...state.playback, isPlaying: true } });
  } else {
    audio.pause();
    setState({ playback: { ...state.playback, isPlaying: false } });
  }
}

export function stopPlayback(): void {
  audio.pause();
  audio.removeAttribute('src');
  setState({ playback: null });
}

export function seek(sec: number): void {
  if (!state.playback) return;
  audio.currentTime = Math.max(0, sec);
}

export function setVolume(v: number): void {
  const vol = Math.max(0, Math.min(1, v));
  audio.volume = vol;
  if (state.playback) setState({ playback: { ...state.playback, volume: vol } });
}

// ---- version grouping ------------------------------------------------------

export interface SongGroup {
  rootId: string;
  /** Newest finished version — the card. */
  newest: Song;
  /** All finished versions, newest first. */
  versions: Song[];
}

/** Finished songs, collapsed into one card per parent-chain root. */
export function groupVersions(songs: Song[]): SongGroup[] {
  const done = songs.filter((s) => s.status === 'done');
  const byId = new Map(done.map((s) => [s.id, s]));
  const rootOf = (s: Song): string => {
    let cur = s;
    const seen = new Set<string>();
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentId)!;
    }
    return cur.id;
  };
  const groups = new Map<string, Song[]>();
  for (const s of done) {
    const r = rootOf(s);
    const arr = groups.get(r) ?? [];
    arr.push(s);
    groups.set(r, arr);
  }
  return [...groups.entries()]
    .map(([rootId, versions]) => {
      versions.sort((a, b) => b.createdAt - a.createdAt);
      return { rootId, newest: versions[0], versions };
    })
    .sort((a, b) => b.newest.createdAt - a.newest.createdAt);
}

// ---- engine wiring ---------------------------------------------------------

/** NODE_PHASES progress text -> the user-facing render stage. */
function stageForProgress(p: JobProgress): CreationStage {
  if (p.phase.startsWith('Composing')) return 'composing';
  if (p.phase.startsWith('Rendering')) return 'rendering';
  if (p.phase.startsWith('Decoding') || p.phase.startsWith('Saving') || p.phase.startsWith('Downloading')) return 'finishing';
  return 'studio';
}

export async function bootstrap(created: Engine): Promise<void> {
  engine = created;
  engine.on((e) => {
    switch (e.kind) {
      case 'queue_changed':
        void refreshLists();
        break;
      case 'creation_stage':
        setState({
          creation: { ...(state.creation ?? {}), stage: e.stage, title: e.detail?.title ?? state.creation?.title },
        });
        break;
      case 'progress':
        if (state.mapEdit && e.progress.songId === state.mapEdit.songId) {
          setState({ mapEdit: { ...state.mapEdit, progress: e.progress } });
        } else if (state.creation && !stoppedEdits.has(e.progress.songId)) {
          setState({
            creation: { ...state.creation, stage: stageForProgress(e.progress), progress: e.progress },
          });
        }
        break;
      case 'song_done':
        if (state.mapEdit && e.song.id === state.mapEdit.songId) {
          void finishMapEdit(state.mapEdit, e.song.id);
          break;
        }
        // Stopped too late to stop: the version is in the library, and that is all.
        // Whoever stopped it is not taken to it, and it does not start playing.
        if (stoppedEdits.delete(e.song.id)) {
          void refreshLists();
          break;
        }
        // The drawing's job is done once the song exists; a failed render
        // keeps pendingPhoto (and the paint session with it) for the retry.
        clearPaintSession();
        setState({ creation: null, creationError: null, failedSong: null, pendingPhoto: null, selectedSongId: e.song.id, screen: 'song', autoplayOnOpen: true });
        void refreshLists();
        break;
      case 'song_failed':
        if (state.mapEdit && e.song.id === state.mapEdit.songId) {
          // The map is still showing the notes that were moved: the reason goes there.
          setState({ mapEdit: { ...state.mapEdit, progress: undefined, error: e.song.error ?? 'Something went wrong.' } });
          void refreshLists();
          break;
        }
        // It failed just as it was stopped: nobody is waiting for the reason.
        if (stoppedEdits.delete(e.song.id)) {
          void refreshLists();
          break;
        }
        // The failed row keeps its spec and parent, so the Create flow
        // can offer to send that exact render back to the studio.
        setState({ creation: null, creationError: e.song.error ?? 'Something went wrong.', failedSong: e.song, screen: 'create' });
        void refreshLists();
        break;
    }
  });
  const screen = routeForBoot(engine.installState);
  setState({ ready: true, settings: engine.settings, screen });
  await refreshLists();
  await probeServices();
  // A reachable studio means the install exists (covers dev mode and repaired
  // installs); remember it so setup never shows again. Never overrides the
  // update screen: that one is about *which* studio is installed.
  if (screen === 'setup' && state.comfyOnline) {
    await saveSettings({ ...engine.settings, installComplete: true });
    await finishSetup();
  }
  window.setInterval(() => void probeServices(), 15_000);
}

/**
 * The last step of first-run setup and of the studio update alike: the
 * engine re-reads the install state it cached at boot (which parked the job
 * queue) and goes to Create.
 */
export async function finishSetup(): Promise<void> {
  await getEngine().refreshInstallState();
  navigate('create');
}

export async function probeServices(): Promise<void> {
  if (!engine) return;
  const [stats, llm] = await Promise.all([engine.comfy.systemStats(), engine.llm.isHealthy()]);
  setState({ comfyOnline: stats !== null, llmOnline: llm });
}

let refreshSeq = 0;

export async function refreshLists(): Promise<void> {
  if (!engine) return;
  const seq = ++refreshSeq;
  const [songs, queuedJobs, activeJobs] = await Promise.all([engine.songs.list(), engine.jobs.queued(), engine.jobs.active()]);
  // Concurrent refreshes can resolve out of order; never let a stale read
  // overwrite a newer one.
  if (seq !== refreshSeq) return;
  setState({ songs, queuedJobs, activeJobs });
}

// ---- navigation ------------------------------------------------------------

export function navigate(screen: Screen): void {
  setState({ screen, autoplayOnOpen: false });
}

export function openSong(id: string, autoplay = false): void {
  setState({ selectedSongId: id, screen: 'song', autoplayOnOpen: autoplay });
}

export function setError(message: string | null): void {
  setState({ lastError: message });
}

// ---- creation --------------------------------------------------------------

/** Import the chosen photo right away: preview, thumbnail and ambiance land before creation. */
export async function choosePhoto(path: string): Promise<void> {
  try {
    setState({ creationError: null, failedSong: null });
    const photo = await getEngine().importPhoto(path);
    clearPaintSession(); // a photo replaces any in-progress drawing
    setState({ pendingPhoto: photo });
  } catch (err) {
    setState({ creationError: err instanceof Error ? err.message : String(err) });
  }
}

/** Import a finished canvas drawing (PNG base64) exactly like a chosen photo. */
export async function chooseDrawing(b64Png: string): Promise<void> {
  try {
    setState({ creationError: null, failedSong: null });
    const photo = await getEngine().importDrawing(b64Png);
    setState({ pendingPhoto: photo });
  } catch (err) {
    setState({ creationError: err instanceof Error ? err.message : String(err) });
  }
}

export function clearPhoto(): void {
  if (state.pendingPhoto?.source === 'drawing') clearPaintSession();
  setState({ pendingPhoto: null });
}

/** The one-button pipeline: photo in, song (eventually) out. */
export async function createFromPhoto(
  vocalPref: 'instrumental' | 'female' | 'male',
  genreHint?: string,
  language?: string,
): Promise<void> {
  const photo = state.pendingPhoto;
  if (!photo) return;
  try {
    setState({ creationError: null, failedSong: null, creation: { stage: 'preparing', photo } });
    await getEngine().createFromPhoto({ photoPath: photo.localPath, photoId: photo.id, vocalPref, genreHint, language });
  } catch (err) {
    setState({ creation: null, creationError: err instanceof Error ? err.message : String(err) });
  }
}

/** Remix / edited-spec render (no LLM stages; parented to the original). */
export async function enqueueRemix(spec: SongSpec, parentId: string): Promise<void> {
  try {
    setState({ creationError: null, failedSong: null, creation: { stage: 'studio', title: spec.title, photo: spec.photo }, screen: 'create' });
    await getEngine().enqueueSong(spec, parentId);
  } catch (err) {
    setState({ creation: null, creationError: err instanceof Error ? err.message : String(err) });
  }
}

// ---- melody edits from the Song map ----------------------------------------

/**
 * "Sing the new notes": queues a melody edit of `source` and stays on its
 * map. The map shows the studio at work; when the new version is done the map
 * turns to it, at the bars that were sung again.
 */
export async function singNewNotes(source: Song, editedAbc: string): Promise<void> {
  await askMapEdit(source, melodyEditTake(source, editedAbc));
}

/**
 * Has the studio write new bars to follow one phrase of `source`, perform
 * them, and keep everything else: the song gets longer by those bars. As
 * singNewNotes, it all happens on the map.
 */
export async function playLonger(source: Song, more: MorePhrase): Promise<void> {
  const spec = longerTake(source, more.phrase);
  if (spec) await askMapEdit(source, spec, more);
}

async function askMapEdit(source: Song, spec: SongSpec, longer?: MorePhrase): Promise<void> {
  if (state.mapEdit && !state.mapEdit.error) return;
  const asked: MapEditState = { sourceId: source.id, songId: '', taken: false, abc: spec.abc ?? '', longer, since: Date.now() };
  setState({ mapEdit: asked });
  try {
    const queued = await getEngine().enqueueSong(spec, source.id);
    // Put away while the studio was still taking it: it must not go ahead, and must not come back on screen.
    if (state.mapEdit !== asked) return void (await cancelSong(queued.id));
    setState({ mapEdit: { ...asked, songId: queued.id, taken: true } });
  } catch (err) {
    if (state.mapEdit === asked) setState({ mapEdit: { ...asked, error: err instanceof Error ? err.message : String(err) } });
  }
}

/**
 * Map edits that were stopped, until the studio says how they ended. A stop
 * can come too late (the recording is already being copied into the library)
 * or cross a failure: the song's last event then arrives after the map has
 * put the edit away, and must not be taken for a creation's, which would open
 * the Song view and play it, or show the failure on the Create screen. An
 * edit that is cancelled as asked says nothing more, and its id just stays.
 */
const stoppedEdits = new Set<string>();

/** Cancels whatever job is singing or waiting to sing a song. */
async function cancelSong(songId: string): Promise<void> {
  stoppedEdits.add(songId);
  await refreshLists();
  for (const job of [...state.activeJobs, ...state.queuedJobs]) if (job.songId === songId) await getEngine().cancelJob(job.id);
  await refreshLists();
}

/** The new version exists. Someone still on the map of the song they edited is shown it there; otherwise it is simply in the library. */
async function finishMapEdit(edit: MapEditState, songId: string): Promise<void> {
  // The list first: the map needs the finished row (its recording, its plan) before it turns to it.
  await refreshLists();
  const stillThere = state.screen === 'map' && state.selectedSongId === edit.sourceId;
  setState({ mapEdit: null, ...(stillThere ? { selectedSongId: songId, mapArrival: songId } : {}) });
}

/** The same edit again after it failed: the studio sings other takes (see Engine.runMelodyEdit). */
export async function retryMapEdit(): Promise<void> {
  const edit = state.mapEdit;
  if (!edit?.error) return;
  if (!edit.songId) return setState({ mapEdit: null }); // it never reached the studio: asking again is "Sing the new notes"
  // The song is known already, but there is no job to stop until the studio has taken it again.
  const again: MapEditState = { sourceId: edit.sourceId, songId: edit.songId, taken: false, abc: edit.abc, longer: edit.longer, since: Date.now() };
  const current = () => state.mapEdit?.songId === again.songId && state.mapEdit.since === again.since;
  stoppedEdits.delete(again.songId);
  setState({ mapEdit: again });
  try {
    await getEngine().retrySong(again.songId);
    // Put away while the studio was still taking it: as in singNewNotes, it must not go ahead untracked.
    if (!current()) return void (await cancelSong(again.songId));
    setState({ mapEdit: { ...state.mapEdit!, taken: true } });
  } catch (err) {
    if (current()) setState({ mapEdit: { ...edit, error: err instanceof Error ? err.message : String(err) } });
  }
}

/** Stops an edit that is being sung, or puts away one that failed. The notes that were moved stay on the map. */
export async function dropMapEdit(): Promise<void> {
  const edit = state.mapEdit;
  if (!edit) return;
  // Too late to stop: the version is being saved, and the map will turn to it as it would have.
  if (!edit.error && beyondStopping(edit.progress)) return;
  setState({ mapEdit: null });
  // One the studio has not taken yet is cancelled by whoever asked for it (singNewNotes,
  // retryMapEdit), as soon as there is something to cancel.
  if (edit.error || !edit.taken) return;
  await cancelSong(edit.songId);
}

export function clearMapArrival(): void {
  if (state.mapArrival) setState({ mapArrival: null });
}

/**
 * "Try again" after a render failed in the studio: the same song (same spec,
 * seed, parent and kept melody) goes back to the queue, so a remix that hit
 * a transient ComfyUI fault is not rebuilt by hand.
 */
export async function retryFailedSong(): Promise<void> {
  const song = state.failedSong;
  if (!song) return;
  try {
    setState({ creationError: null, failedSong: null, creation: { stage: 'studio', title: song.spec.title, photo: song.spec.photo }, screen: 'create' });
    await getEngine().retrySong(song.id);
  } catch (err) {
    // The engine only rejects before the job exists (song gone, not failed,
    // or the job insert itself failed), so nothing is running: keep the offer
    // rather than send the user back to rebuild the edit by hand.
    setState({ creation: null, failedSong: song, creationError: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * "Sing it all again" after a "keep the rest" edit failed: the same song goes
 * back to the queue as an ordinary remix (its new words, the original's seed
 * and melody), performed whole.
 */
export async function retryFailedSongWhole(): Promise<void> {
  const song = state.failedSong;
  if (!song) return;
  try {
    setState({ creationError: null, failedSong: null, creation: { stage: 'studio', title: song.spec.title, photo: song.spec.photo }, screen: 'create' });
    await getEngine().retryWhole(song.id);
  } catch (err) {
    setState({ creation: null, failedSong: song, creationError: err instanceof Error ? err.message : String(err) });
  }
}

export async function cancelCreation(): Promise<void> {
  const active = [...state.activeJobs, ...state.queuedJobs];
  for (const j of active) await getEngine().cancelJob(j.id);
  setState({ creation: null });
  await refreshLists();
}

/**
 * Starting spec for the Remix editor: same everything, fresh seed; seed and
 * plan are chosen on Create (`remixTake`, or `keepRestTake` for a partial
 * edit). A song that was itself a partial edit starts as an ordinary draft:
 * its `edit` marker is not inherited.
 */
export function remixSpec(song: Song): SongSpec {
  const { edit: _edit, ...spec } = song.spec;
  return { ...spec, seed: randomSeed(), abc: undefined };
}

// ---- song actions ----------------------------------------------------------

export async function deleteSong(song: Song): Promise<void> {
  if (state.playback?.songId === song.id) stopPlayback();
  await getEngine().deleteSong(song.id);
  setState({ selectedSongId: null, screen: 'sanctuary' });
  await refreshLists();
}

export async function revealSong(song: Song): Promise<void> {
  await getEngine().revealSong(song);
}

/** Save As: copies the MP3 out of the library — the one file uninstall spares. */
export async function exportSong(song: Song): Promise<void> {
  if (!song.outputPath) return;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');
  const dest = await save({
    defaultPath: `${song.spec.title || 'Song'}.mp3`,
    filters: [{ name: 'MP3 audio', extensions: ['mp3'] }],
  });
  if (!dest) return;
  await invoke('files_export', { srcPath: song.outputPath, destPath: dest });
}

/** Pitch is read below 2 kHz, so the recording is decoded at a rate that just covers it. */
const PITCH_RATE = 11025;

/**
 * Finds where the bars of a song's melody plan fall in its recording, from the
 * audio, and stores the grid on the song. The MP3 is read from the library and
 * decoded here in the web view; nothing leaves the PC and the studio is not
 * needed. Null when the song has no recording, the audio cannot be decoded,
 * or it does not follow the plan closely enough to be placed.
 */
export async function locateSongBars(song: Song, map: SongMap): Promise<BarGrid | null> {
  try {
    const b64 = await getEngine().songAudio(song);
    if (!b64) return null;
    const bytes = b64ToBytes(b64);
    const decoded = await new OfflineAudioContext(1, 1, PITCH_RATE).decodeAudioData(bytes.buffer as ArrayBuffer);
    // Both channels as one.
    const pcm = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const channel = decoded.getChannelData(c);
      for (let i = 0; i < pcm.length; i++) pcm[i] += channel[i] / decoded.numberOfChannels;
    }
    const grid = locateBars(map, pitchContent(pcm, decoded.sampleRate));
    if (!grid) return null;
    await getEngine().saveBarGrid(song.id, grid);
    await refreshLists();
    return grid;
  } catch {
    // The map keeps its estimate.
    return null;
  }
}

export async function renameSong(song: Song, title: string): Promise<void> {
  await getEngine().songs.setTitle(song.id, title);
  await refreshLists();
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await getEngine().saveSettings(s);
  setState({ settings: s });
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
