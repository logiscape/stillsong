// Engine facade — the only object the UI talks to. Owns the one-shot creation
// pipeline (photo -> analyze -> compose -> render) and the job pipeline:
// enqueue -> stop the LLM -> build graph -> submit to ComfyUI -> track via WS
// (history polling as fallback) -> harvest the mp3 into the library.
// Constructed via Engine.create(ports) so tests inject fakes and the desktop
// shell injects Tauri adapters.

import { newId, type Ports } from './ports';
import { migrate } from './migrations';
import type { Job, PhotoAsset, Song, SongSpec, VocalPref } from './domain/types';
import { AUDIO_FRAMES_PER_SECOND, CAP, DURATION, RENDER_STEPS, canEnhance, defaultSpec, randomSeed } from './domain/types';
import { validateSpec, type ValidationIssue } from './domain/validate';
import { capCeiling, hardwareTier, renderCap, type HardwareTier } from './domain/duration';
import type { HardwareInfo } from './ports';
import { buildGraph, type StillsongGraphOpts } from './comfy/graphBuilder';
import { b64ToBytes, bytesToB64, parseCodesHeader, sliceCodes } from './comfy/codes';
import { ComfyClient } from './comfy/client';
import { ProgressTracker, type ProgressEvent } from './comfy/events';
import { SongRepo, type ComposedLength, type RenderPrefix } from './repo/songs';
import { PhotoRepo } from './repo/photos';
import { JobRepo } from './repo/jobs';
import { SettingsRepo, type AppSettings } from './repo/settings';
import { LlmClient } from './cowriter/llmClient';
import { Cowriter, type CowriteRequest, type CowriteResult } from './cowriter/cowriter';
import { lintSong, type LintIssue } from './cowriter/linter';
import { VramArbiter } from './orchestrator/vram';

/** Where our renders land under ComfyUI's output dir (the graph's filename_prefix folder). */
export const RENDER_OUTPUT_SUBFOLDER = 'audio/stillsong';

/** `filename_prefix` for a song's render: ComfyUI appends `_NNNNN` + extension. */
export function renderFilePrefix(songId: string): string {
  return `${RENDER_OUTPUT_SUBFOLDER}/${songId.slice(0, 8)}`;
}

export interface JobProgress {
  jobId: string;
  songId: string;
  phase: string;
  stepValue?: number;
  stepMax?: number;
  etaSeconds?: number | null;
  /** 'encode' (audio frames) or 'sample' (diffusion steps) — which bar is moving. */
  stepNode?: string;
}

/**
 * The stages of the creation status experience. The engine emits the first
 * four; 'composing', 'rendering' and 'finishing' are derived by the UI from
 * `progress` events (NODE_PHASES) once the job pipeline takes over.
 */
export type CreationStage = 'preparing' | 'looking' | 'writing' | 'studio' | 'composing' | 'rendering' | 'finishing';

export type EngineEvent =
  | { kind: 'queue_changed' }
  | { kind: 'creation_stage'; stage: CreationStage; detail?: { title?: string } }
  | { kind: 'progress'; progress: JobProgress }
  | { kind: 'song_done'; song: Song }
  | { kind: 'song_failed'; song: Song };

export interface CreateFromPhotoRequest {
  photoPath: string;
  /** Id of an already-imported asset (skips the path re-import; keeps `source` intact). */
  photoId?: string;
  vocalPref: 'instrumental' | 'female' | 'male';
  genreHint?: string;
  language?: string;
}

export class Engine {
  private listeners = new Set<(e: EngineEvent) => void>();
  private running = false;
  private tracker = new ProgressTracker();
  private currentJob: Job | null = null;
  private creating = false;

  /** Detected hardware and the tier-derived ceiling for render caps. */
  public hardware: HardwareInfo = { vendor: 'unknown', vramMb: 0, ramMb: 0 };
  public tier: HardwareTier = 'fast';
  public capCeilingSec: number = Infinity;
  /**
   * Whether ComfyUI has the Stillsong overlay encoder (comfy-overlay/). With
   * it, every render captures its composition codes and re-runs can
   * teacher-force a prefix; without it (external stock ComfyUI), everything
   * degrades to the official node's behavior.
   */
  public hasStillsongEncode = false;

  private constructor(
    private readonly ports: Ports,
    public settings: AppSettings,
    public readonly comfy: ComfyClient,
    public readonly llm: LlmClient,
    public readonly vram: VramArbiter,
    public readonly songs: SongRepo,
    public readonly photos: PhotoRepo,
    public readonly jobs: JobRepo,
    private readonly settingsRepo: SettingsRepo,
  ) {}

  static async create(ports: Ports): Promise<Engine> {
    await migrate(ports.db);
    const settingsRepo = new SettingsRepo(ports.db);
    const settings = await settingsRepo.load();
    const urls = await ports.runtime.urls();
    const comfy = new ComfyClient(ports.http, ports.files, urls.comfy);
    const llm = new LlmClient(ports.http, urls.llm);
    const engine = new Engine(
      ports,
      settings,
      comfy,
      llm,
      new VramArbiter(ports.runtime, comfy, llm, ports.clock),
      new SongRepo(ports.db),
      new PhotoRepo(ports.db, ports.files),
      new JobRepo(ports.db),
      settingsRepo,
    );
    engine.hardware = await ports.runtime.hardware().catch(() => engine.hardware);
    engine.tier = hardwareTier(engine.hardware);
    engine.capCeilingSec = capCeiling(engine.hardware.vramMb);
    engine.hasStillsongEncode = await comfy.hasNode('StillsongMusic3TextEncode');
    await engine.recoverInFlight();
    await engine.finishReplacements().catch(() => {});
    // After recovery so an in-flight render being harvested on this boot is
    // never mistaken for an orphan (its song row exists either way).
    void engine.sweepComfyOutputs().catch(() => {});
    // Awaited: nothing can import a photo until create() returns, so a photo
    // chosen right after boot can't be swept between its import and its song.
    await engine.sweepOrphanPhotos().catch(() => 0);
    return engine;
  }

  on(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: EngineEvent): void {
    for (const l of this.listeners) l(e);
  }

  async saveSettings(s: AppSettings): Promise<void> {
    this.settings = s;
    await this.settingsRepo.save(s);
  }

  lint(spec: SongSpec): LintIssue[] {
    return lintSong(spec);
  }

  validate(spec: SongSpec): ValidationIssue[] {
    return validateSpec(spec);
  }

  async importPhoto(srcPath: string): Promise<PhotoAsset> {
    return this.photos.import(srcPath, this.ports.clock.now());
  }

  /** Imports a canvas drawing (PNG bytes as base64) as a photo asset with source 'drawing'. */
  async importDrawing(b64Png: string): Promise<PhotoAsset> {
    return this.photos.importBytes(b64Png, 'drawing.png', this.ports.clock.now());
  }

  // ---- one-shot creation ---------------------------------------------------

  /**
   * The whole product in one call: photo in, queued song out. Analyze the
   * photo, compose the package (auto-accepted — no review gate), assemble and
   * validate the spec, then hand off to the render pipeline. One creation at
   * a time; the LLM is always stopped before the render starts.
   */
  async createFromPhoto(req: CreateFromPhotoRequest): Promise<Song> {
    if (this.creating) throw new Error('A song is already being created — one at a time.');
    this.creating = true; // set before any await so concurrent calls are refused
    try {
      if (this.currentJob || (await this.jobs.queued()).length > 0) {
        throw new Error('A song is already being created — one at a time.');
      }
      this.emit({ kind: 'creation_stage', stage: 'preparing' });
      const photo = (req.photoId ? await this.photos.byId(req.photoId) : null) ?? (await this.importPhoto(req.photoPath));

      const instrumental = req.vocalPref === 'instrumental';
      // On low-VRAM tiers the cap ceiling is lower; shrink the target so the
      // composer keeps its ending headroom instead of running into the cap.
      const targetSec = Math.min(DURATION.default, Math.floor((this.capCeilingSec - CAP.pad) / CAP.headroom));
      const cowriteReq: CowriteRequest = {
        idea: '',
        photo,
        durationSec: targetSec,
        instrumental,
        vocalPref: req.vocalPref,
        genreHint: req.genreHint,
        language: instrumental ? undefined : req.language,
      };

      this.emit({ kind: 'creation_stage', stage: 'looking' });
      await this.vram.acquireForLlm();
      let result: CowriteResult;
      try {
        const writer = new Cowriter(this.llm, this.ports.files, this.photos);
        const onPhase = (phase: string) => {
          if (phase === 'Writing song') this.emit({ kind: 'creation_stage', stage: 'writing' });
        };
        result = await writer.compose(cowriteReq, onPhase);
        if (result.lintIssues.some((i) => i.severity === 'error')) {
          // The silent repair round already ran inside compose; one full
          // re-compose with fresh sampling is the last automatic retry.
          result = await writer.compose(cowriteReq, onPhase);
        }
      } finally {
        await this.vram.releaseLlm();
      }

      const spec: SongSpec = {
        ...defaultSpec(this.settings.ditFile),
        title: result.title,
        caption: result.caption,
        lyrics: result.lyrics,
        instrumental,
        photo,
        targetSec,
        durationSec: renderCap(targetSec, result.lyrics, this.capCeilingSec),
        seed: randomSeed(),
        tiledDecode: this.settings.tiledDecode,
        steps: RENDER_STEPS[this.settings.renderMethod],
        quality: this.settings.quality,
        vocalPref: req.vocalPref as VocalPref,
        genreHint: req.genreHint?.trim() || undefined,
        language: req.language,
      };
      const lintErrors = result.lintIssues.filter((i) => i.severity === 'error');
      const specErrors = validateSpec(spec).filter((i) => i.severity === 'error');
      if (lintErrors.length || specErrors.length) {
        throw new Error([...lintErrors, ...specErrors].map((e) => e.message).join(' '));
      }

      this.emit({ kind: 'creation_stage', stage: 'studio', detail: { title: result.title } });
      return await this.enqueueSong(spec);
    } finally {
      this.creating = false;
    }
  }

  // ---- queue ---------------------------------------------------------------

  /**
   * Validates, persists, enqueues, and kicks the runner. `prefix` asks the
   * render to teacher-force another song's saved composition ("Let it finish",
   * same-seed lyric edits); it degrades to a free render when the codes or the
   * overlay node are unavailable. `replacesSongId` marks an "Enhance quality"
   * re-take: on harvest it takes that song's place instead of becoming a version.
   */
  async enqueueSong(spec: SongSpec, parentId?: string, prefix?: RenderPrefix, replacesSongId?: string): Promise<Song> {
    const errors = validateSpec(spec).filter((i) => i.severity === 'error');
    if (errors.length) throw new Error(errors.map((e) => e.message).join(' '));
    const song = await this.songs.create(spec, this.ports.clock.now(), parentId, 'queued', prefix, replacesSongId);
    await this.jobs.enqueue(song.id, this.ports.clock.now());
    this.emit({ kind: 'queue_changed' });
    void this.pump();
    return song;
  }

  /**
   * "Enhance quality": re-render a song at the 'enhanced' step count and swap
   * it in for the original. Only the sampler changes — same seed, same cap,
   * and the saved composition is teacher-forced in full when it exists — so
   * the result is the same performance with a cleaner audio pass. The
   * composing stage still runs (the sampler consumes the composer's live
   * hidden states, which are never stored), so this costs about what the
   * original render did, plus the extra steps.
   */
  async enhanceSong(songId: string): Promise<Song> {
    const song = await this.songs.byId(songId);
    if (!song) throw new Error('That song is no longer here.');
    if (!canEnhance(song)) throw new Error('This song is already at its best.');
    // The original stays listed (and enhanceable-looking) until the re-take
    // lands; a second request would leave two 80-step copies behind.
    const pending = await this.songs.pendingReplacementOf(song.id);
    if (pending) return pending;
    const spec: SongSpec = { ...song.spec, steps: RENDER_STEPS.enhanced };
    const prefix = song.codesPath ? { songId: song.id } : undefined;
    return this.enqueueSong(spec, song.id, prefix, song.id);
  }

  async cancelJob(jobId: string): Promise<void> {
    const job = await this.jobs.byId(jobId);
    if (!job) return;
    if (job.state === 'queued') {
      await this.jobs.setState(jobId, 'cancelled');
      await this.songs.setStatus(job.songId, 'cancelled');
    } else if (this.currentJob?.id === jobId) {
      if (job.comfyPromptId) await this.comfy.deleteQueued(job.comfyPromptId).catch(() => {});
      await this.comfy.interrupt();
      // the WS 'interrupted' event (or the history poll) finishes the bookkeeping
    }
    this.emit({ kind: 'queue_changed' });
  }

  async deleteSong(id: string): Promise<void> {
    const song = await this.songs.byId(id);
    if (!song) return;
    if (song.status === 'queued' || song.status === 'running') {
      const jobs = [...(await this.jobs.queued()), ...(await this.jobs.active())].filter((j) => j.songId === id);
      for (const j of jobs) await this.cancelJob(j.id);
    }
    if (song.outputPath) await this.ports.files.remove(song.outputPath).catch(() => {});
    if (song.codesPath) await this.ports.files.remove(song.codesPath).catch(() => {});
    await this.jobs.deleteForSong(id);
    // Children point at the deleted song's parent so lineage survives.
    await this.songs.reparentChildren(id, song.parentId ?? null);
    await this.songs.delete(id);
    // Photo GC: drop the asset once no song references it.
    const photoId = song.spec.photo?.id;
    if (photoId && (await this.songs.countByPhoto(photoId)) === 0) {
      await this.photos.delete(photoId);
    }
    this.emit({ kind: 'queue_changed' });
  }

  async revealSong(song: Song): Promise<void> {
    if (song.outputPath) await this.ports.files.reveal(song.outputPath);
  }

  /** Sequential runner: picks the next queued job whenever idle. */
  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const queued = await this.jobs.queued();
        if (!queued.length) break;
        await this.runJob(queued[0]);
        this.emit({ kind: 'queue_changed' });
      }
    } finally {
      this.running = false;
    }
  }

  private async runJob(job: Job): Promise<void> {
    this.currentJob = job;
    const song = await this.songs.byId(job.songId);
    if (!song) {
      await this.jobs.setState(job.id, 'failed', { error: 'song missing' });
      return;
    }
    const progress = (phase: string, extra: Partial<JobProgress> = {}) =>
      this.emit({ kind: 'progress', progress: { jobId: job.id, songId: song.id, phase, ...extra } });

    try {
      const startedAt = this.ports.clock.now();
      await this.jobs.setState(job.id, 'submitted', { startedAt });
      await this.songs.setStatus(song.id, 'running');
      // Job has left 'queued': the UI must re-read lists or it keeps rendering
      // it as queued (and hides progress) until the job finishes.
      this.emit({ kind: 'queue_changed' });
      progress('Clearing GPU (stopping the songwriter if running)');
      await this.vram.acquireForComfy();

      const filePrefix = renderFilePrefix(song.id);
      const { graph } = buildGraph(song.spec, filePrefix, await this.stillsongGraphOpts(song));
      let promptId = '';

      // Open the progress socket, submit, then track until terminal
      // (WS with history polling as a fallback).
      const outcome = await this.trackToCompletion(async (clientId) => {
        promptId = await this.comfy.submit(graph, clientId);
        await this.jobs.setState(job.id, 'submitted', { comfyPromptId: promptId });
        await this.songs.setComfyPromptId(song.id, promptId);
        progress('Waiting for ComfyUI');
        await this.jobs.setState(job.id, 'running');
        this.emit({ kind: 'queue_changed' });
        return promptId;
      }, progress);
      if (outcome.kind === 'interrupted') {
        await this.jobs.setState(job.id, 'cancelled', { finishedAt: this.ports.clock.now() });
        await this.songs.setStatus(song.id, 'cancelled');
        return;
      }
      if (outcome.kind === 'error') throw new Error(outcome.message);

      await this.jobs.setState(job.id, 'harvesting');
      this.emit({ kind: 'queue_changed' });
      progress('Downloading song');
      await this.harvest(job, song, promptId, startedAt, outcome.composed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.jobs.setState(job.id, 'failed', { error: message, finishedAt: this.ports.clock.now() });
      await this.songs.setStatus(song.id, 'failed', message);
      const failed = (await this.songs.byId(song.id))!;
      this.emit({ kind: 'song_failed', song: failed });
    } finally {
      this.currentJob = null;
    }
  }

  /**
   * Graph options for the overlay encoder: capture codes on every render;
   * teacher-force the prefix song's composition when asked; pin the KV
   * capacity to this tier's cap ceiling so cap changes can't shift numerics.
   * Undefined (stock node) when the overlay isn't installed.
   */
  private async stillsongGraphOpts(song: Song): Promise<StillsongGraphOpts | undefined> {
    // The startup probe races the supervised ComfyUI's boot (its failure is
    // indistinguishable from a stock ComfyUI), so re-probe at render time —
    // the VRAM arbiter has already talked to ComfyUI by now, so a false here
    // really means the overlay is absent.
    if (!this.hasStillsongEncode) {
      this.hasStillsongEncode = await this.comfy.hasNode('StillsongMusic3TextEncode');
    }
    if (!this.hasStillsongEncode) return undefined;
    const ceilingSec = Math.min(Number.isFinite(this.capCeilingSec) ? this.capCeilingSec : CAP.max, CAP.max);
    const opts: StillsongGraphOpts = { kvCapacityFrames: Math.round(ceilingSec * AUDIO_FRAMES_PER_SECOND) };
    if (!song.prefixSongId) return opts;
    try {
      const source = await this.songs.byId(song.prefixSongId);
      if (!source?.codesPath || !(await this.ports.files.exists(source.codesPath))) return opts;
      const bytes = b64ToBytes(await this.ports.files.readBase64(source.codesPath));
      const sliced = song.prefixFrames != null ? sliceCodes(bytes, song.prefixFrames) : bytes;
      if (parseCodesHeader(sliced).frames > 0) opts.prefixCodesB64 = bytesToB64(sliced);
    } catch {
      /* corrupt/missing codes — degrade to a free render rather than fail the job */
    }
    return opts;
  }

  private async harvest(job: Job, song: Song, promptId: string, startedAt: number | undefined, composed?: ComposedLength): Promise<void> {
    const hist = await this.comfy.history(promptId);
    const audio = hist?.files.filter((f) => !f.filename.endsWith('.codes.bin'));
    const file = audio?.find((f) => /\.(mp3|flac|opus|wav)$/i.test(f.filename)) ?? audio?.[0];
    if (!file) throw new Error('Render finished but produced no audio output');
    const outPath = await this.comfy.downloadOutput(file, `songs/${song.id}.mp3`);
    let codesPath: string | undefined;
    const codesFile = hist?.files.find((f) => f.filename.endsWith('.codes.bin'));
    if (codesFile) {
      codesPath = await this.comfy.downloadOutput(codesFile, `songs/${song.id}.codes.bin`).catch(() => undefined);
    }
    // The library now holds the only copy that matters. ComfyUI's originals
    // would otherwise accumulate forever (and outlive "delete song" — the
    // mp3's ID3 tag carries the full prompt). Only what was copied is removed;
    // a codes file whose copy failed stays for the next boot's sweep.
    await this.ports.runtime.removeComfyOutput(file).catch(() => {});
    if (codesFile && codesPath) await this.ports.runtime.removeComfyOutput(codesFile).catch(() => {});
    const finishedAt = this.ports.clock.now();
    await this.songs.setOutput(song.id, outPath, startedAt ? finishedAt - startedAt : undefined, composed, codesPath);
    await this.jobs.setState(job.id, 'done', { finishedAt });
    if (song.replacesSongId) await this.replaceSong(song.id, song.replacesSongId);
    const done = (await this.songs.byId(song.id))!;
    this.emit({ kind: 'song_done', song: done });
  }

  /**
   * Finish an "Enhance quality" re-take: the new render inherits the old
   * version's date, parent, title and children, then the old files and row
   * go. The old version is only removed once the composition is known to be
   * preserved; otherwise the re-take stays as a new version beside it. If the
   * old song was deleted mid-render, the re-take simply stays as an ordinary
   * song (deleteSong already re-parented it).
   *
   * Every step is idempotent and the `replaces_song_id` marker is cleared
   * last, so a crash at any point is completed by `finishReplacements` on
   * the next boot (the Db port has no transactions). The verdict of the
   * composition check is persisted before anything is removed: re-checking
   * after the original's codes file is gone would wrongly fail.
   */
  private async replaceSong(newId: string, oldId: string): Promise<void> {
    const [song, old] = await Promise.all([this.songs.byId(newId), this.songs.byId(oldId)]);
    if (!song || old?.id === song.id) return;
    if (old && !song.replaceVerified) {
      if (!(await this.compositionPreserved(song, old))) {
        await this.songs.clearReplaces(song.id);
        return;
      }
      await this.songs.markReplaceVerified(song.id);
    }
    if (old) {
      await this.songs.takePlaceOf(song, old);
      if (old.outputPath) await this.ports.files.remove(old.outputPath).catch(() => {});
      if (old.codesPath) await this.ports.files.remove(old.codesPath).catch(() => {});
      await this.jobs.deleteForSong(old.id);
      await this.songs.delete(old.id);
    }
    await this.songs.clearReplaces(song.id);
  }

  /**
   * Did the re-take play the same composition? When both sides saved codes
   * the SSC1 blobs must match byte for byte (the header holds only the
   * shape). Without codes to compare, a free render is reproduced exactly by
   * its seed (measured), but a forced one (Let it finish, a kept section)
   * is not — its prefix came from another song's performance.
   */
  private async compositionPreserved(song: Song, old: Song): Promise<boolean> {
    if (song.codesPath && old.codesPath) {
      try {
        const [a, b] = await Promise.all([this.ports.files.readBase64(song.codesPath), this.ports.files.readBase64(old.codesPath)]);
        return a === b;
      } catch {
        return false;
      }
    }
    return !old.prefixSongId;
  }

  /** Boot: complete any replacement a crash interrupted between harvest and swap. */
  async finishReplacements(): Promise<number> {
    const pending = await this.songs.unfinishedReplacements();
    for (const song of pending) await this.replaceSong(song.id, song.replacesSongId!);
    return pending.length;
  }

  /**
   * Resolves when the prompt reaches a terminal state. Opens a dedicated WS
   * connection with a fresh clientId *before* `start` submits the prompt, so
   * no early events are lost; if the socket is quiet/absent, polls /history
   * every 10s. The encode node's final progress value gives the actual
   * composed length in frames.
   *
   * Why a fresh clientId per job: ComfyUI keys sockets by clientId and, when
   * an old socket disconnects, pops that key from its table. Reusing one id
   * across jobs let the previous job's teardown evict the new job's socket,
   * after which ComfyUI silently dropped every progress message for it
   * (the "stuck on queued until it disappears" symptom).
   *
   * `start` receives the clientId and must return the promptId to track.
   * Events that arrive before the promptId is known are buffered.
   */
  private trackToCompletion(
    start: (clientId: string) => Promise<string>,
    progress: (phase: string, extra?: Partial<JobProgress>) => void,
  ): Promise<{ kind: 'success'; composed?: ComposedLength } | { kind: 'interrupted' } | { kind: 'error'; message: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let promptId: string | null = null;
      let encodeFrames: number | null = null;
      let encodeMax: number | null = null;
      let wsClose: () => Promise<void> = async () => {};
      let cancelPoll: (() => void) | null = null;
      const pending: ProgressEvent[] = [];

      const settle = (v: { kind: 'success' } | { kind: 'interrupted' } | { kind: 'error'; message: string }) => {
        if (settled) return;
        settled = true;
        cancelPoll?.();
        void wsClose();
        if (v.kind === 'success') resolve({ kind: 'success', composed: composedLength(encodeFrames, encodeMax) });
        else resolve(v);
      };

      // history() returns null while the job is queued (no entry yet) and
      // throws only on transport failure. A dead ComfyUI (crash, kill) is a
      // run of transport failures — without counting them the poll loop spins
      // forever and the UI freezes mid-progress (found live: killing ComfyUI
      // mid-render left "Composing…" up indefinitely).
      let pollFailures = 0;
      const poll = async () => {
        if (settled || !promptId) return;
        let hist: Awaited<ReturnType<typeof this.comfy.history>> = null;
        try {
          hist = await this.comfy.history(promptId);
          pollFailures = 0;
        } catch {
          pollFailures += 1;
          if (pollFailures >= 3) {
            return settle({ kind: 'error', message: 'The studio stopped answering mid-song.' });
          }
        }
        if (hist) {
          if (hist.status === 'success') return settle({ kind: 'success' });
          if (hist.status === 'error') return settle({ kind: 'error', message: hist.error ?? 'Execution failed' });
          if (hist.status === 'interrupted') return settle({ kind: 'interrupted' });
        }
        cancelPoll = this.ports.clock.setTimeout(() => void poll(), 10_000);
      };

      const handle = (ev: ProgressEvent) => {
        if (settled) return;
        if (!promptId) {
          pending.push(ev);
          return;
        }
        if ('promptId' in ev && ev.promptId && ev.promptId !== promptId) return;
        switch (ev.kind) {
          case 'phase':
            progress(ev.phase);
            break;
          case 'step':
            if (ev.nodeId === 'encode') {
              encodeFrames = ev.value;
              encodeMax = ev.max;
            }
            progress(ev.phase, { stepValue: ev.value, stepMax: ev.max, etaSeconds: ev.etaSeconds, stepNode: ev.nodeId });
            break;
          case 'completed':
            settle({ kind: 'success' });
            break;
          case 'error':
            settle({ kind: 'error', message: ev.message });
            break;
          case 'interrupted':
            settle({ kind: 'interrupted' });
            break;
        }
      };

      const clientId = `stillsong-${newId()}`;
      const wsUrl = `${this.comfy.baseUrl.replace(/^http/, 'ws')}/ws?clientId=${clientId}`;
      const opened = this.ports.ws
        .connect(wsUrl, (msg) => {
          if (settled) return;
          if (msg.kind === 'close') {
            // The socket dropping is how a ComfyUI death announces itself
            // first — poll immediately instead of waiting out the 10 s timer.
            void poll();
            return;
          }
          if (msg.kind !== 'message') return;
          const ev = this.tracker.parse(msg.data, this.ports.clock.now());
          if (ev) handle(ev);
        })
        .then((id) => {
          wsClose = () => this.ports.ws.close(id);
          if (settled) void wsClose();
        })
        .catch(() => {
          /* WS unavailable — history polling carries the job */
        });

      void opened.then(async () => {
        try {
          promptId = await start(clientId);
        } catch (err) {
          return settle({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
        }
        cancelPoll = this.ports.clock.setTimeout(() => void poll(), 10_000);
        for (const ev of pending.splice(0)) handle(ev);
      });
    });
  }

  /**
   * Deletes render outputs under ComfyUI's output dir that belong to no song:
   * leftovers from harvests that pre-date harvest-time cleanup, from songs
   * deleted since, or from a copy that failed. Only our own
   * `audio/stillsong/<id8>_*` files are considered; anything else in the
   * tree is left alone. A file is kept while any song row (any status —
   * queued, rendering, failed) starts with its 8-hex prefix.
   */
  async sweepComfyOutputs(): Promise<number> {
    const outputs = await this.ports.runtime.comfyOutputs();
    const ours = outputs.filter((f) => f.subfolder.replace(/\\/g, '/').replace(/\/+$/, '') === RENDER_OUTPUT_SUBFOLDER);
    if (ours.length === 0) return 0;
    const ids = await this.songs.allIds();
    let removed = 0;
    for (const f of ours) {
      const prefix = /^([0-9a-f]{8})_/.exec(f.filename)?.[1];
      if (!prefix || ids.some((id) => id.startsWith(prefix))) continue;
      await this.ports.runtime.removeComfyOutput(f).catch(() => {});
      removed += 1;
    }
    return removed;
  }

  /**
   * Boot-time photo GC. Photos are imported the moment they're chosen, before
   * any song exists, so backing out of Create (or a crash mid-pipeline)
   * leaves an asset + thumbnail no song row points at; `deleteSong`'s GC
   * never sees those. One asset serves every song made from the same photo,
   * so only assets with zero song rows of any status are removed. Runs only
   * from `create()`: mid-session, a freshly imported photo is legitimately
   * unreferenced until its song row is written.
   */
  async sweepOrphanPhotos(): Promise<number> {
    const ids = await this.photos.unreferencedIds();
    for (const id of ids) await this.photos.delete(id);
    return ids.length;
  }

  /** Startup crash recovery: reconcile in-flight jobs against ComfyUI history. */
  private async recoverInFlight(): Promise<void> {
    const active = await this.jobs.active();
    for (const job of active) {
      if (!job.comfyPromptId) {
        await this.jobs.setState(job.id, 'queued');
        await this.songs.setStatus(job.songId, 'queued');
        continue;
      }
      const hist = await this.comfy.history(job.comfyPromptId).catch(() => null);
      const song = await this.songs.byId(job.songId);
      if (hist?.status === 'success' && hist.files.length && song) {
        try {
          await this.harvest(job, song, job.comfyPromptId, job.startedAt);
          continue;
        } catch {
          /* fall through to failed */
        }
      }
      if (hist?.status === 'running') {
        await this.jobs.setState(job.id, 'running');
        void this.resumeTracking(job);
        continue;
      }
      await this.jobs.setState(job.id, 'failed', { error: 'App restarted mid-render', finishedAt: this.ports.clock.now() });
      await this.songs.setStatus(job.songId, 'failed', 'App restarted mid-render');
    }
    void this.pump();
  }

  private async resumeTracking(job: Job): Promise<void> {
    const song = await this.songs.byId(job.songId);
    if (!song || !job.comfyPromptId) return;
    const progress = (phase: string, extra: Partial<JobProgress> = {}) =>
      this.emit({ kind: 'progress', progress: { jobId: job.id, songId: song.id, phase, ...extra } });
    const promptId = job.comfyPromptId;
    const outcome = await this.trackToCompletion(async () => promptId, progress);
    if (outcome.kind === 'success') {
      try {
        await this.harvest(job, song, job.comfyPromptId, job.startedAt, outcome.composed);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.jobs.setState(job.id, 'failed', { error: message, finishedAt: this.ports.clock.now() });
        await this.songs.setStatus(song.id, 'failed', message);
        return;
      }
    }
    const cancelled = outcome.kind === 'interrupted';
    await this.jobs.setState(job.id, cancelled ? 'cancelled' : 'failed', {
      error: cancelled ? undefined : outcome.message,
      finishedAt: this.ports.clock.now(),
    });
    await this.songs.setStatus(song.id, cancelled ? 'cancelled' : 'failed', cancelled ? undefined : outcome.message);
    this.emit({ kind: 'queue_changed' });
  }
}

/**
 * Interpret the encoder's final progress. The AR model either emits
 * <|audio_end|> (frames well below max => natural ending, length known) or
 * runs into max_duration (frames within ~1 s of max => truncated mid-phrase).
 * Progress messages are batched, so the last value can sit a few frames short
 * of max even when the cap was hit — hence the one-second tolerance.
 */
export function composedLength(frames: number | null, max: number | null): ComposedLength | undefined {
  if (frames == null || max == null || max <= 0) return undefined;
  const hitCeiling = frames >= max - AUDIO_FRAMES_PER_SECOND;
  return hitCeiling ? { hitCeiling: true } : { hitCeiling: false, actualSec: frames / AUDIO_FRAMES_PER_SECOND };
}

export type { CowriteRequest, CowriteResult, LintIssue, ComposedLength, RenderPrefix };
