// Engine facade — the only object the UI talks to. Owns the one-shot creation
// pipeline (photo -> analyze -> compose -> render) and the job pipeline:
// enqueue -> stop the LLM -> build graph -> submit to ComfyUI -> track via WS
// (history polling as fallback) -> harvest the mp3 into the library.
// Constructed via Engine.create(ports) so tests inject fakes and the desktop
// shell injects Tauri adapters.

import { newId, type Ports } from './ports';
import { migrate } from './migrations';
import type { FrameWindow, Job, PhotoAsset, Song, SongSpec, VocalPref } from './domain/types';
import { AUDIO_FRAMES_PER_SECOND, DURATION, defaultSpec, randomSeed } from './domain/types';
import { validateSpec, type ValidationIssue } from './domain/validate';
import { hardwareTier, type HardwareTier } from './domain/duration';
import type { HardwareInfo, RuntimeInstallState } from './ports';
import { ALIGN_OUT, buildAlignGraph, buildEditGraph, buildGraph, EDIT_PHASES, PLAN_OUT, SECONDS_OUT, type EditSource } from './comfy/graphBuilder';
import { TAKE_NODE, type ApiGraph } from './comfy/nodes';
import { editWindows, mergeWindows, parseAlignSeries } from './domain/editWindows';
import { ComfyClient, type HistoryEntry } from './comfy/client';
import { ProgressTracker, type ProgressEvent } from './comfy/events';
import { SongRepo, type ComposedLength } from './repo/songs';
import { PhotoRepo } from './repo/photos';
import { JobRepo } from './repo/jobs';
import { SettingsRepo, type AppSettings } from './repo/settings';
import { LlmClient } from './cowriter/llmClient';
import { Cowriter, type CowriteRequest, type CowriteResult } from './cowriter/cowriter';
import { lintSong, type LintIssue } from './cowriter/linter';
import { VramArbiter } from './orchestrator/vram';
import { seedExamples } from './examples';

/** Where our renders land under ComfyUI's output dir (the graph's filename_prefix folder). */
export const RENDER_OUTPUT_SUBFOLDER = 'audio/stillsong2';

/** `filename_prefix` for a song's render: ComfyUI appends `_NNNNN` + extension. */
export function renderFilePrefix(songId: string): string {
  return `${RENDER_OUTPUT_SUBFOLDER}/${songId.slice(0, 8)}`;
}

/** A render's outputs, told apart by name: the audio, and the take saved beside it. */
const AUDIO_FILE = /\.(mp3|flac|opus|wav)$/i;
const TAKE_FILE = /\.take\.safetensors$/i;

/** Library path of a song's take (tokens + latent). */
export function takeRelPath(songId: string): string {
  return `songs/${songId}.take.safetensors`;
}

/** Where an edit's source take is sent, under ComfyUI's temp folder (emptied at every ComfyUI start). */
const TAKE_UPLOAD_FOLDER = 'stillsong2';

type ProgressFn = (phase: string, extra?: Partial<JobProgress>) => void;
type PromptOutcome = { kind: 'success'; perform?: PerformProgress } | { kind: 'interrupted' } | { kind: 'error'; message: string };

export interface JobProgress {
  jobId: string;
  songId: string;
  phase: string;
  stepValue?: number;
  stepMax?: number;
  etaSeconds?: number | null;
  /**
   * Which bar is moving: 'plan' (melody plan tokens), 'perform' (music
   * tokens, 25 per second of song) or 'sample' (diffusion steps).
   */
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
  /**
   * Whether ComfyUI has the studio's own nodes (comfy-nodes/ComfyUI-Stillsong2).
   * Probed when a render starts, until seen: with them every render saves its
   * take; without them (the package refused to load) songs still render
   * through the core nodes, and can only be remixed whole.
   */
  private takeNodes = false;
  /** Id of the running job the user asked to stop (see `runPrompt`). */
  private cancelling: string | null = null;

  /** Detected hardware and its support tier. */
  public hardware: HardwareInfo = { vendor: 'unknown', vramMb: 0, ramMb: 0 };
  public tier: HardwareTier = 'fast';
  /**
   * Installed components versus this build's manifest, read once at boot.
   * Anything but `ready` keeps the job queue parked: the supervisor refuses
   * to start a studio from another manifest, so pumping would only fail jobs.
   */
  public installState: RuntimeInstallState = { state: 'ready', version: '', currentVersion: '' };

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
    engine.installState = await ports.runtime.installState().catch(() => engine.installState);
    await engine.recoverInFlight();
    // After recovery so an in-flight render being harvested on this boot is
    // never mistaken for an orphan (its song row exists either way).
    void engine.sweepComfyOutputs().catch(() => {});
    // Bundled example songs land in an empty library once (examples.ts) —
    // before the photo sweep, so their assets are referenced when it runs.
    // A failure here must not stop the boot; the seed resumes next time.
    await seedExamples({ files: ports.files, clock: ports.clock, songs: engine.songs, photos: engine.photos, settings: settingsRepo }).catch(() => 0);
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
      // The co-writer's brief is Stillsong 1's, unchanged: a 120 s target.
      const targetSec = DURATION.default;
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

      // durationSec stays defaultSpec's MAX_DURATION_SEC: the same cap for
      // every song, so a remix with the same seed is the same performance.
      const spec: SongSpec = {
        ...defaultSpec(this.settings.checkpoint),
        title: result.title,
        caption: result.caption,
        lyrics: result.lyrics,
        instrumental,
        photo,
        targetSec,
        seed: randomSeed(),
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
   * Validates, persists, enqueues, and kicks the runner. A remix that keeps
   * its parent's melody carries the plan in `spec.abc`.
   */
  async enqueueSong(spec: SongSpec, parentId?: string): Promise<Song> {
    const errors = validateSpec(spec).filter((i) => i.severity === 'error');
    if (errors.length) throw new Error(errors.map((e) => e.message).join(' '));
    if (spec.edit) {
      // Refused here rather than a minute later in the studio.
      const source = await this.songs.byId(spec.edit.sourceId);
      if (!source?.takePath || !source.planAbc?.trim()) throw new Error('The original recording is no longer here to keep.');
    }
    const song = await this.songs.create(spec, this.ports.clock.now(), parentId, 'queued');
    await this.jobs.enqueue(song.id, this.ports.clock.now());
    this.emit({ kind: 'queue_changed' });
    void this.pump();
    return song;
  }

  /**
   * Send a failed render back to the studio as the same song: same id, spec
   * and parent (and so the same kept melody), so a remix that died in ComfyUI
   * (a transient VRAM fault, a crashed process) is retried without the user
   * rebuilding their edit. The song row is reused rather than cloned — a
   * failed row is invisible in the library, and cloning would leave it behind.
   */
  async retrySong(songId: string): Promise<Song> {
    const song = await this.songs.byId(songId);
    if (!song) throw new Error('That song is no longer here.');
    if (song.status !== 'failed') throw new Error('Only a song that failed can be retried.');
    // The job row is the acceptance point: once it exists the runner will pick
    // it up and mark the song running itself. So the status write comes after
    // it (a queued song with no job would be stranded and refuse every later
    // retry) and its failure is not reported — the retry has already happened,
    // and rejecting here would leave the UI showing "Try again" over a render
    // that is in progress.
    await this.jobs.enqueue(song.id, this.ports.clock.now());
    await this.songs.setStatus(song.id, 'queued').catch(() => {});
    this.emit({ kind: 'queue_changed' });
    void this.pump();
    // No further database read: the retry is accepted, and a rejected read
    // here would report it as failed. The row is what the write made it.
    return { ...song, status: 'queued', error: undefined };
  }

  /**
   * A failed "keep the rest" edit, sent back to the studio as an ordinary
   * remix instead: the same row, lyrics, seed and plan, with the whole song
   * performed again. For when the studio could not keep the rest (the lines
   * were not found, old words stayed in, the original's take is gone).
   */
  async retryWhole(songId: string): Promise<Song> {
    const song = await this.songs.byId(songId);
    if (!song) throw new Error('That song is no longer here.');
    if (song.status !== 'failed') throw new Error('Only a song that failed can be retried.');
    if (song.spec.edit) {
      const { edit: _edit, ...whole } = song.spec;
      await this.songs.setSpec(song.id, whole);
    }
    return this.retrySong(songId);
  }

  async cancelJob(jobId: string): Promise<void> {
    const job = await this.jobs.byId(jobId);
    if (!job) return;
    if (job.state === 'queued') {
      await this.jobs.setState(jobId, 'cancelled');
      await this.songs.setStatus(job.songId, 'cancelled');
    } else if (this.currentJob?.id === jobId) {
      this.cancelling = jobId;
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
    if (song.takePath) await this.ports.files.remove(song.takePath).catch(() => {});
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

  /** See `takeNodes`: asked once the studio is up, and again until the nodes are seen. */
  private async hasTakeNodes(): Promise<boolean> {
    if (!this.takeNodes) this.takeNodes = await this.comfy.hasNode(TAKE_NODE);
    return this.takeNodes;
  }

  /** Sequential runner: picks the next queued job whenever idle. */
  private async pump(): Promise<void> {
    if (this.running) return;
    // A studio that is not installed, or is from another build, is never
    // started (the supervisor refuses); jobs wait, queued, until setup or the
    // update screen finishes and calls refreshInstallState.
    if (this.installState.state !== 'ready') return;
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
      // Not left set: createFromPhoto refuses while a job is current.
      this.currentJob = null;
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

      const cancelled = song.spec.edit
        ? (await this.runEdit(job, song, startedAt, progress)) === 'cancelled'
        : (await this.runRender(job, song, startedAt, progress)) === 'cancelled';
      if (cancelled) {
        await this.jobs.setState(job.id, 'cancelled', { finishedAt: this.ports.clock.now() });
        await this.songs.setStatus(song.id, 'cancelled');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.jobs.setState(job.id, 'failed', { error: message, finishedAt: this.ports.clock.now() });
      await this.songs.setStatus(song.id, 'failed', message);
      const failed = (await this.songs.byId(song.id))!;
      this.emit({ kind: 'song_failed', song: failed });
    } finally {
      this.currentJob = null;
      this.cancelling = null;
    }
  }

  /** The ordinary render: one prompt, then the harvest. */
  private async runRender(job: Job, song: Song, startedAt: number, progress: ProgressFn): Promise<'done' | 'cancelled'> {
    const { graph } = buildGraph(song.spec, renderFilePrefix(song.id), { capture: await this.hasTakeNodes() });
    const { promptId, outcome } = await this.runPrompt(job, graph, progress, { record: song, announce: true });
    if (outcome.kind === 'interrupted') return 'cancelled';
    if (outcome.kind === 'error') throw new Error(outcome.message);

    await this.jobs.setState(job.id, 'harvesting');
    this.emit({ kind: 'queue_changed' });
    progress('Downloading song');
    await this.harvest(job, song, promptId, startedAt, outcome.perform);
    return 'done';
  }

  /**
   * Submits one graph and tracks it to a terminal state (WS with history
   * polling as a fallback). A job can run several prompts (an edit does);
   * `record` names the one that makes the song's audio, the only prompt whose
   * id is stored (startup recovery may harvest it). `label`, when given,
   * replaces every phase the prompt reports, so a short helper prompt cannot
   * move the creation stages backwards.
   */
  private async runPrompt(
    job: Job,
    graph: ApiGraph,
    progress: ProgressFn,
    opts: { record?: Song; announce?: boolean; label?: string } = {},
  ): Promise<{ promptId: string; outcome: PromptOutcome }> {
    // ComfyUI forgets an interrupt when its next prompt starts, so a cancel
    // that lands between two prompts is remembered here.
    if (this.cancelling === job.id) return { promptId: '', outcome: { kind: 'interrupted' } };
    const label = opts.label;
    const report: ProgressFn = label ? () => progress(label) : progress;
    let promptId = '';
    const outcome = await this.trackToCompletion(async (clientId) => {
      promptId = await this.comfy.submit(graph, clientId);
      if (opts.record) {
        await this.jobs.setState(job.id, 'submitted', { comfyPromptId: promptId });
        await this.songs.setComfyPromptId(opts.record.id, promptId);
      }
      if (opts.announce) progress('Waiting for ComfyUI');
      await this.jobs.setState(job.id, 'running');
      this.emit({ kind: 'queue_changed' });
      return promptId;
    }, report);
    if (this.cancelling === job.id && outcome.kind === 'success') return { promptId, outcome: { kind: 'interrupted' } };
    return { promptId, outcome };
  }

  /**
   * A "keep the rest" edit (spec.edit): perform the source song's take again
   * with the edited lyrics, re-singing only the lines that changed.
   *
   *  1. Send the source take to the studio.
   *  2. Ask where the take sings words the edited sheet no longer has (two
   *     replays of the take; no audio) -> the windows to sing again.
   *  3. Perform: tokens and latent outside the windows are held.
   *  4. Ask the same question of the new take. Old words still in it (the
   *     tail of a held word just past a window): widen and perform once more.
   *
   * It never falls back to a whole remix on its own: when it cannot keep the
   * rest it fails with a plain reason, and the person decides.
   */
  private async runEdit(job: Job, song: Song, startedAt: number, progress: ProgressFn): Promise<'done' | 'cancelled'> {
    const finding = EDIT_PHASES.finding;
    progress(finding);
    if (!(await this.hasTakeNodes())) throw new Error('The studio cannot keep part of a recording right now.');
    const source = await this.songs.byId(song.spec.edit!.sourceId);
    const abc = source?.planAbc ?? '';
    if (!source?.takePath || !abc.trim() || !(await this.ports.files.exists(source.takePath))) {
      throw new Error('The original recording is no longer here to keep.');
    }
    const take = await this.comfy.uploadTemp(takeRelPath(source.id), `${source.id.slice(0, 8)}.take.safetensors`, TAKE_UPLOAD_FOLDER);
    const from: EditSource = { take, abc };

    const asked = await this.sungWindows(job, song, from, source.spec.lyrics, finding, progress);
    if (asked === 'cancelled') return 'cancelled';
    let windows = asked;
    if (windows.length === 0) throw new Error('We could not find where those lines are sung.');

    for (let attempt = 0; ; attempt++) {
      // A fresh file prefix per attempt: ComfyUI serves an identical save node
      // from its cache, and would name files this job already removed.
      const prefix = `${renderFilePrefix(song.id)}_${newId().slice(0, 6)}`;
      const { graph } = buildEditGraph(song.spec, from, windows, prefix);
      const again = attempt > 0 ? EDIT_PHASES.again : undefined;
      const { promptId, outcome } = await this.runPrompt(job, graph, progress, { record: song, label: again });
      if (outcome.kind === 'interrupted') return 'cancelled';
      if (outcome.kind === 'error') throw new Error(outcome.message);

      const hist = await this.comfy.history(promptId);
      // This attempt's audio and take sit in ComfyUI's output until harvested.
      // Every other way out of the attempt removes them: the sweep keeps a
      // living song's files, and each retry saves under a new prefix, so an
      // unremoved candidate would stay for as long as the song does.
      const discard = async () => {
        for (const f of hist?.files ?? []) await this.ports.runtime.removeComfyOutput(f).catch(() => {});
      };
      const checking = EDIT_PHASES.checking;
      let leftover: FrameWindow[] | 'cancelled';
      try {
        const newTake = hist?.files.find((f) => TAKE_FILE.test(f.filename));
        if (!newTake) throw new Error('Render finished but produced no take');
        progress(checking);
        leftover = await this.sungWindows(job, song, { take: this.comfy.outputName(newTake), abc }, source.spec.lyrics, checking, progress);
      } catch (err) {
        await discard();
        throw err;
      }
      if (leftover === 'cancelled' || (leftover.length > 0 && attempt > 0)) {
        await discard();
        if (leftover === 'cancelled') return 'cancelled';
        throw new Error('Some of the old words stayed in the recording.');
      }
      if (leftover.length === 0) {
        await this.jobs.setState(job.id, 'harvesting');
        this.emit({ kind: 'queue_changed' });
        progress('Downloading song');
        await this.harvest(job, song, promptId, startedAt, outcome.perform, { source, windows });
        return 'done';
      }
      await discard();
      windows = mergeWindows(windows, leftover);
    }
  }

  /**
   * Where does `from.take` sing words of `originalLyrics` that this song's
   * lyrics no longer have? The windows to sing again (empty: nowhere).
   */
  private async sungWindows(
    job: Job,
    song: Song,
    from: EditSource,
    originalLyrics: string,
    label: string,
    progress: ProgressFn,
  ): Promise<FrameWindow[] | 'cancelled'> {
    const { graph } = buildAlignGraph(song.spec, from, originalLyrics, song.spec.lyrics);
    const { promptId, outcome } = await this.runPrompt(job, graph, progress, { label });
    if (outcome.kind === 'interrupted') return 'cancelled';
    if (outcome.kind === 'error') throw new Error(outcome.message);
    const series = parseAlignSeries((await this.comfy.history(promptId))?.texts[ALIGN_OUT]);
    if (!series) throw new Error('The studio did not say where the lines are sung.');
    return editWindows(series.drop);
  }

  private async harvest(
    job: Job,
    song: Song,
    promptId: string,
    startedAt: number | undefined,
    perform?: PerformProgress,
    /** A "keep the rest" edit: what it kept from, and the windows it sang again. */
    edit?: { source: Song; windows: FrameWindow[] },
  ): Promise<void> {
    const hist = await this.comfy.history(promptId);
    const audio = hist?.files.find((f) => AUDIO_FILE.test(f.filename));
    if (!audio) throw new Error('Render finished but produced no audio output');
    const take = hist?.files.find((f) => TAKE_FILE.test(f.filename));
    const outPath = await this.comfy.downloadOutput(audio, `songs/${song.id}.mp3`);
    // The take only matters to a later "keep the rest" edit: a song whose
    // take could not be copied still plays, and can still be remixed whole.
    const takePath = take ? await this.comfy.downloadOutput(take, takeRelPath(song.id)).catch(() => undefined) : undefined;
    const finishedAt = this.ports.clock.now();
    // An edit keeps its source's length exactly, and so whether that take
    // was cut off; a render reports its own.
    const composed = edit
      ? { actualSec: edit.source.actualSec ?? composedLength(hist, song.spec)?.actualSec, hitCeiling: edit.source.hitCeiling ?? false }
      : composedLength(hist, song.spec, perform);
    await this.songs.setOutput(song.id, {
      outputPath: outPath,
      renderMs: startedAt ? finishedAt - startedAt : undefined,
      composed,
      planAbc: edit ? edit.source.planAbc : performedPlan(hist, song.spec),
      takePath,
      editWindows: edit?.windows,
    });
    // The library now holds the only copies that matter. ComfyUI's originals
    // would otherwise accumulate forever (and outlive "delete song" — the
    // mp3's ID3 tag carries the full prompt).
    await this.ports.runtime.removeComfyOutput(audio).catch(() => {});
    if (take) await this.ports.runtime.removeComfyOutput(take).catch(() => {});
    await this.jobs.setState(job.id, 'done', { finishedAt });
    const done = (await this.songs.byId(song.id))!;
    this.emit({ kind: 'song_done', song: done });
  }

  /**
   * Resolves when the prompt reaches a terminal state. Opens a dedicated WS
   * connection with a fresh clientId *before* `start` submits the prompt, so
   * no early events are lost; if the socket is quiet/absent, polls /history
   * every 10s. The music node's last progress (tokens written vs. its budget)
   * tells a truncated song from one that ended on its own.
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
  ): Promise<{ kind: 'success'; perform?: PerformProgress } | { kind: 'interrupted' } | { kind: 'error'; message: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let promptId: string | null = null;
      let perform: PerformProgress | undefined;
      let wsClose: () => Promise<void> = async () => {};
      let cancelPoll: (() => void) | null = null;
      const pending: ProgressEvent[] = [];

      const settle = (v: { kind: 'success' } | { kind: 'interrupted' } | { kind: 'error'; message: string }) => {
        if (settled) return;
        settled = true;
        cancelPoll?.();
        void wsClose();
        if (v.kind === 'success') resolve({ kind: 'success', perform });
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
            if (ev.nodeId === 'perform') perform = { value: ev.value, max: ev.max };
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
   * `audio/stillsong2/<id8>_*` files are considered; anything else in the
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
      if (song?.spec.edit) {
        // A "keep the rest" edit is not finished when its audio prompt is: the
        // check for old words runs after it, and the windows it sang live only
        // in the engine that was running. A studio that outlived that engine
        // (the interface reloaded; the processes did not) may report the
        // prompt done, but harvesting it would accept an unchecked take. The
        // edit starts over instead; its abandoned attempt is cleared away.
        await this.abandonPrompt(job.comfyPromptId, hist);
        await this.jobs.setState(job.id, 'queued');
        await this.songs.setStatus(song.id, 'queued');
        continue;
      }
      if (hist?.status === 'success' && hist.files.some((f) => AUDIO_FILE.test(f.filename)) && song) {
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

  /**
   * Best effort: stop a prompt nobody is waiting for any more (still queued or
   * running in a studio that outlived its engine) and remove what it wrote.
   */
  private async abandonPrompt(promptId: string, hist: HistoryEntry | null): Promise<void> {
    try {
      const queue = await this.comfy.queue();
      if (queue.pendingPromptIds.includes(promptId)) await this.comfy.deleteQueued(promptId);
      if (queue.runningPromptIds.includes(promptId)) await this.comfy.interrupt();
    } catch {
      /* the studio is not answering: nothing is running there */
    }
    for (const f of hist?.files ?? []) await this.ports.runtime.removeComfyOutput(f).catch(() => {});
  }

  /**
   * After first-run setup or the update screen has built the studio: re-read
   * the install state and release the jobs that boot left parked.
   */
  async refreshInstallState(): Promise<void> {
    this.installState = await this.ports.runtime.installState().catch(() => this.installState);
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
        await this.harvest(job, song, job.comfyPromptId, job.startedAt, outcome.perform);
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

/** The music node's last progress event: tokens written (`value`) against its budget (`max`). */
export interface PerformProgress {
  value: number;
  max: number;
}

/**
 * How long the song came out, and whether it was cut off. `seconds_out` is
 * YuE2's own count of what it wrote (in /history even when cached). It hit
 * the ceiling when it filled max_duration, or when the music node's progress
 * reached its budget — which a long caption + lyrics + plan can shrink below
 * max_duration (the node logs "music budget reduced"). The node checks for its
 * end token every 16 tokens, so a natural end can overshoot by up to 15.
 */
export function composedLength(hist: HistoryEntry | null, spec: SongSpec, perform?: PerformProgress): ComposedLength | undefined {
  const seconds = Number(hist?.texts[SECONDS_OUT]);
  const budgetHit = perform != null && perform.max > 0 && perform.value >= perform.max - 16;
  if (!(Number.isFinite(seconds) && seconds > 0)) return perform ? { hitCeiling: budgetHit } : undefined;
  const capHit = seconds * AUDIO_FRAMES_PER_SECOND >= spec.durationSec * AUDIO_FRAMES_PER_SECOND - 16;
  return { actualSec: seconds, hitCeiling: capHit || budgetHit };
}

/** The plan this take performed: the one it wrote (plan_out), else the one it was given. */
export function performedPlan(hist: HistoryEntry | null, spec: SongSpec): string | undefined {
  if (spec.planMode === 'off') return undefined;
  const written = hist?.texts[PLAN_OUT];
  if (written?.trim()) return written;
  return spec.abc?.trim() ? spec.abc : undefined;
}

export type { CowriteRequest, CowriteResult, LintIssue, ComposedLength };
