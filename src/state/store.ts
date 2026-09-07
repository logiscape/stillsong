// App store (useSyncExternalStore pattern).
// Subscribes to engine events; the render-phase creation stages are derived
// here from job progress (NODE_PHASES text), the earlier stages arrive as
// `creation_stage` events from the one-shot pipeline. Also owns the single
// shared audio element (card audition and the Song-view player are one
// instance) — the only Tauri import here is convertFileSrc for asset URLs.

import { useSyncExternalStore } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { CreationStage, Engine, JobProgress, RenderPrefix } from '@engine/index';
import type { Job, PhotoAsset, Song, SongSpec } from '@engine/domain/types';
import { CAP, randomSeed } from '@engine/domain/types';
import { compositionFrames, editPrefixFrames } from '@engine/domain/editPrefix';
import type { AppSettings } from '@engine/repo/settings';
import { clearPaintSession } from './paintSession';

export type Screen = 'setup' | 'create' | 'sanctuary' | 'song' | 'remix' | 'about' | 'draw';

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
  /** Photo chosen on the Create screen, imported immediately (thumb + ambiance ready). */
  pendingPhoto: PhotoAsset | null;
  playback: PlaybackState | null;
  settings: AppSettings | null;
  comfyOnline: boolean | null;
  llmOnline: boolean | null;
  selectedSongId: string | null;
  /** Autoplay when the Song view was entered from a finished creation. */
  autoplayOnOpen: boolean;
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
  pendingPhoto: null,
  playback: null,
  settings: null,
  comfyOnline: null,
  llmOnline: null,
  selectedSongId: null,
  autoplayOnOpen: false,
  lastError: null,
};

let engine: Engine | null = null;
const listeners = new Set<() => void>();

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
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
        if (state.creation) {
          setState({
            creation: { ...state.creation, stage: stageForProgress(e.progress), progress: e.progress },
          });
        }
        break;
      case 'song_done':
        // The drawing's job is done once the song exists; a failed render
        // keeps pendingPhoto (and the paint session with it) for the retry.
        clearPaintSession();
        setState({ creation: null, creationError: null, pendingPhoto: null, selectedSongId: e.song.id, screen: 'song', autoplayOnOpen: true });
        void refreshLists();
        break;
      case 'song_failed':
        setState({ creation: null, creationError: e.song.error ?? 'Something went wrong.', screen: 'create' });
        void refreshLists();
        break;
    }
  });
  const installComplete = engine.settings.installComplete;
  setState({ ready: true, settings: engine.settings, screen: installComplete ? 'create' : 'setup' });
  await refreshLists();
  await probeServices();
  // A reachable studio means the install exists (covers dev mode and repaired
  // installs); remember it so setup never shows again.
  if (!installComplete && state.comfyOnline) {
    await saveSettings({ ...engine.settings, installComplete: true });
    setState({ screen: 'create' });
  }
  window.setInterval(() => void probeServices(), 15_000);
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
    setState({ creationError: null });
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
    setState({ creationError: null });
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
    setState({ creationError: null, creation: { stage: 'preparing', photo } });
    await getEngine().createFromPhoto({ photoPath: photo.localPath, photoId: photo.id, vocalPref, genreHint, language });
  } catch (err) {
    setState({ creation: null, creationError: err instanceof Error ? err.message : String(err) });
  }
}

/** Remix / edited-spec render (no LLM stages; parented to the original). */
export async function enqueueRemix(spec: SongSpec, parentId: string, prefix?: RenderPrefix): Promise<void> {
  try {
    setState({ creationError: null, creation: { stage: 'studio', title: spec.title, photo: spec.photo }, screen: 'create' });
    await getEngine().enqueueSong(spec, parentId, prefix);
  } catch (err) {
    setState({ creation: null, creationError: err instanceof Error ? err.message : String(err) });
  }
}

export async function cancelCreation(): Promise<void> {
  const active = [...state.activeJobs, ...state.queuedJobs];
  for (const j of active) await getEngine().cancelJob(j.id);
  setState({ creation: null });
  await refreshLists();
}

/**
 * "Let it finish": teacher-force the truncated take's entire saved composition
 * and raise the cap, so the composer replays the song bit-exactly and keeps
 * writing past where the cap cut it off (verified: the continuation matches
 * what an uncapped run would have produced). Without saved codes (legacy song,
 * stock ComfyUI) it degrades to a same-seed re-run, which usually — not
 * always — resembles the original. Capped at CAP.max: above it the KV cache
 * exhausts 16 GB VRAM (360 s left 141 MB free).
 */
export async function rerunLonger(song: Song, extraSec = 30): Promise<void> {
  const durationSec = Math.min(CAP.max, Math.round(song.spec.durationSec + extraSec));
  if (durationSec <= song.spec.durationSec) return; // already at the ceiling — the notice should be hidden
  const prefix = song.codesPath ? { songId: song.id } : undefined;
  await enqueueRemix({ ...song.spec, durationSec }, song.id, prefix);
}

/**
 * "Enhance quality": the same song re-taken with the 'enhanced' step count.
 * It replaces the version it was made from when it finishes (the old one was
 * just a rougher audio pass of the same composition), so no new version appears.
 */
export async function enhanceSong(song: Song): Promise<void> {
  try {
    setState({ creationError: null, creation: { stage: 'studio', title: song.spec.title, photo: song.spec.photo }, screen: 'create' });
    await getEngine().enhanceSong(song.id);
  } catch (err) {
    setState({ creation: null, creationError: err instanceof Error ? err.message : String(err) });
  }
}

/** An "Enhance quality" re-take of this song is queued or rendering (the original stays listed until it lands). */
export function enhancePending(song: Song, songs: Song[] = state.songs): boolean {
  return songs.some((s) => s.replacesSongId === song.id && (s.status === 'queued' || s.status === 'running'));
}

/** Whether "Let it finish" can actually buy the song more room. */
export function canRerunLonger(song: Song): boolean {
  return song.spec.durationSec < CAP.max;
}

/** Starting spec for the Remix editor: same everything, fresh seed. */
export function remixSpec(song: Song): SongSpec {
  return { ...song.spec, seed: randomSeed() };
}

/**
 * Same-seed remix: how much of the original performance can be kept. The part
 * before the first edited lyric section is teacher-forced (bit-exact);
 * everything after is re-composed to fit the new words. Undefined when nothing
 * can be forced: new seed, no saved codes, a changed caption (it conditions
 * the whole song), or an edit in the opening section.
 */
export function remixPrefix(original: Song, spec: SongSpec, keepSeed: boolean): RenderPrefix | undefined {
  if (!keepSeed || !original.codesPath) return undefined;
  if (spec.caption !== original.spec.caption) return undefined;
  const total = compositionFrames(original.actualSec, original.spec.durationSec);
  const frames = editPrefixFrames(original.spec.lyrics, spec.lyrics, total);
  if (frames <= 0) return undefined;
  return Number.isFinite(frames) ? { songId: original.id, frames } : { songId: original.id };
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
