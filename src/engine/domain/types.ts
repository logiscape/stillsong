// Domain model for Stillsong 2. A Song is one render request (the
// full spec is denormalized as JSON on the row so re-run/remix is trivial).

export type VocalPref = 'any' | 'female' | 'male' | 'instrumental';

export type Mp3Quality = 'V0' | '128k' | '320k';

/**
 * YuE2 melody planning (YuE2GenerateABC `mode`): `full` writes a melody +
 * chord score before the song is performed, `melody` a melody-only score,
 * `off` performs straight from caption + lyrics with no score.
 */
export type PlanMode = 'full' | 'melody' | 'off';

export interface PhotoAsset {
  id: string;
  sha256: string;
  /** Copy under library/photos/ — imports survive deletion of the source file. */
  localPath: string;
  originalName: string;
  /** Cached vision "reference card" (JSON), keyed by sha256. */
  analysisJson?: string;
  /** 512 px WebP under library/thumbs/, generated at import. */
  thumbPath?: string;
  /** Average luminance 0..1, measured with the thumbnail; drives the lyric scrim. */
  luminance?: number;
  /** Dominant colour #rrggbb, measured with the thumbnail; drives the ambient wash. */
  dominantColor?: string;
  /** Where the image came from; undefined = photo (legacy rows predate the column). Steers the vision prompt. */
  source?: 'photo' | 'drawing';
  createdAt: number;
}

export interface SongSpec {
  title: string;
  /** The user's raw idea (LLM input, kept for remix). */
  idea: string;
  /** Inspiration photo, if any. Never sent to ComfyUI. */
  photo?: PhotoAsset;
  /** The style text YuE2 performs to (the co-writer's three-section caption). */
  caption: string;
  lyrics: string;
  instrumental: boolean;
  /** What the user asked for / the writer wrote to: "about this long". 10..360. */
  targetSec: number;
  /**
   * max_duration sent to YuE2GenerateMusic: the most it may write. Fixed at
   * MAX_DURATION_SEC for every song — the value changes the performance for
   * the same seed, so it must never vary between a song and its remixes. The
   * model ends the song on its own before this; if it doesn't, the song is
   * truncated (song.hitCeiling).
   */
  durationSec: number;
  /** Stored as a string end-to-end: ComfyUI seeds can exceed 2^53. */
  seed: string;
  /** The YuE2 checkpoint (CheckpointLoaderSimple ckpt_name). */
  checkpoint: string;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  planMode: PlanMode;
  /**
   * A melody plan (ABC score) to perform verbatim — a kept or hand-edited plan
   * on a remix. Empty/undefined: write a new one (unless planMode is 'off').
   */
  abc?: string;
  /**
   * Set on a "keep the rest" edit: perform the source song's saved take again
   * with these lyrics, re-singing only the lines that changed. Seed and plan
   * are the source's. Unlike every other spec, this one is not a recipe for
   * the whole recording (the kept parts come from the source's take), so a
   * full remix must drop it.
   */
  edit?: { sourceId: string };
  quality: Mp3Quality;
  /** Co-writer controls, kept so a remix starts from the same brief. */
  vocalPref: VocalPref;
  genreHint?: string;
  language?: string;
}

export type SongStatus = 'draft' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** A half-open span of 25 Hz audio frames: [start, end). */
export type FrameWindow = [start: number, end: number];

export interface Song {
  id: string;
  createdAt: number;
  spec: SongSpec;
  status: SongStatus;
  outputPath?: string;
  /** Seconds YuE2 actually wrote (the music node's `seconds` output), when known. */
  actualSec?: number;
  /**
   * True when the composer ran into `durationSec` without writing its own
   * ending — the song was truncated. Undefined when unknown.
   */
  hitCeiling?: boolean;
  /** The melody plan this take performed (generated, kept or hand-edited); absent for planMode 'off'. */
  planAbc?: string;
  /**
   * The saved take (music tokens + final latent, `songs/<id>.take.safetensors`):
   * what lets a later edit re-sing some lines and keep the rest of this
   * recording exactly. Absent for songs made without the studio's own nodes.
   */
  takePath?: string;
  /** On a "keep the rest" edit: the frame windows that were sung again. */
  editWindows?: FrameWindow[];
  comfyPromptId?: string;
  /** Wall-clock job time (submit through harvest), recorded when the render finishes. */
  renderMs?: number;
  error?: string;
  /** re-run / new take / remix lineage */
  parentId?: string;
}

export type JobState = 'queued' | 'submitted' | 'running' | 'harvesting' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  songId: string;
  state: JobState;
  queuePos: number;
  comfyPromptId?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

/** The pinned YuE2 checkpoint (components.json `music-checkpoint`). */
export const YUE2_CHECKPOINT = 'yue2_3b_int8_convrot.safetensors';

/** Target-length bounds (the co-writer's "about this long"). */
export const DURATION = { min: 10, max: 360, uiMin: 30, uiMax: 300, default: 120, draft: 40 } as const;

/**
 * max_duration for every song (the user's tested workflow value). Measured
 * 2026-11-10 on an RTX 5080: v1-length lyrics end on their own at 215–330 s,
 * 300 s truncated 2 in 8; a 9-tag instrumental ran to 404 s at 500. The value
 * also sizes the music KV cache, so changing it changes every same-seed
 * performance — never vary it per song.
 */
export const MAX_DURATION_SEC = 500;

/** YuE2 writes 25 music tokens per second of audio (comfy/text_encoders/yue2.py FRAMES_PER_SECOND). */
export const AUDIO_FRAMES_PER_SECOND = 25;

/**
 * The co-writer's length budget (cowriter lint + repair, unchanged from
 * Stillsong 1 so Gemma writes exactly as it did there). Not sent to ComfyUI.
 */
export const CAP = { headroom: 2, pad: 40, max: 300 } as const;

/** YuE2 defaults (the official audio_yue2_text2music template). */
export const RENDER_DEFAULTS = { steps: 32, cfg: 1, sampler: 'dpm_2', scheduler: 'sgm_uniform', planMode: 'full' as PlanMode };

export function randomSeed(): string {
  // < 2^53 so Number(seed) is exact when it reaches the graph.
  return String(Math.floor(Math.random() * 9_007_199_254_740_000));
}

export function defaultSpec(checkpoint: string = YUE2_CHECKPOINT): SongSpec {
  return {
    title: '',
    idea: '',
    caption: '',
    lyrics: '',
    instrumental: false,
    targetSec: DURATION.default,
    durationSec: MAX_DURATION_SEC,
    seed: randomSeed(),
    checkpoint,
    steps: RENDER_DEFAULTS.steps,
    cfg: RENDER_DEFAULTS.cfg,
    sampler: RENDER_DEFAULTS.sampler,
    scheduler: RENDER_DEFAULTS.scheduler,
    planMode: RENDER_DEFAULTS.planMode,
    quality: 'V0',
    vocalPref: 'any',
  };
}

/** "Lo-fi hip-hop, chillhop" from the first words of Global Metadata. */
export function genreTag(caption: string): string {
  const m = /global metadata\s*:?\s*([^\n.]+)/i.exec(caption);
  const head = (m?.[1] ?? caption.split('\n')[0] ?? '').trim();
  return head.length > 48 ? `${head.slice(0, 45).trimEnd()}…` : head;
}
