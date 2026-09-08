// Domain model for Stillsong. A Song is one render request (the
// full spec is denormalized as JSON on the row so re-run/remix is trivial).

export type VocalPref = 'any' | 'female' | 'male' | 'instrumental';

export type Mp3Quality = 'V0' | '128k' | '320k';

/**
 * How new songs are made: sampler steps for the audio pass. Steps touch only
 * the diffusion stage (timbre, clarity) — the composition is fixed by the
 * seed — so an 'enhanced' re-render of a 'fast' song is the same song, clearer.
 */
export type RenderMethod = 'fast' | 'enhanced';
export const RENDER_STEPS: Record<RenderMethod, number> = { fast: 40, enhanced: 80 };

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
  caption: string;
  lyrics: string;
  instrumental: boolean;
  /** What the user asked for / the writer wrote to: "about this long". 10..300. */
  targetSec: number;
  /**
   * Render cap sent to ComfyUI as max_duration: target + headroom (see
   * domain/duration.ts). The model ends the song on its own before this; if it
   * doesn't, the song is truncated (song.hitCeiling). 10..360.
   */
  durationSec: number;
  /** Stored as a string end-to-end: ComfyUI seeds can exceed 2^53. */
  seed: string;
  ditFile: string;
  tiledDecode: boolean;
  steps: number;
  cfg: number;
  /** cfg_scale on the AR encoder (composition guidance). */
  encodeCfg: number;
  topK: number;
  quality: Mp3Quality;
  /** Co-writer controls, kept so a remix starts from the same brief. */
  vocalPref: VocalPref;
  genreHint?: string;
  language?: string;
}

export type SongStatus = 'draft' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Song {
  id: string;
  createdAt: number;
  spec: SongSpec;
  status: SongStatus;
  outputPath?: string;
  /** Seconds the AR model actually wrote (from the encode node), when known. */
  actualSec?: number;
  /**
   * True when the composer ran into `durationSec` without emitting its own
   * ending (<|audio_end|>) — the song was truncated mid-phrase. Undefined when
   * the render was tracked without WebSocket progress (unknown).
   */
  hitCeiling?: boolean;
  comfyPromptId?: string;
  /** Wall-clock job time (submit through harvest), recorded when the render finishes. */
  renderMs?: number;
  error?: string;
  /** re-run / new take / remix lineage */
  parentId?: string;
  /**
   * SSC1 composition blob harvested with the audio (library/songs/<id>.codes.bin)
   * when the render ran through the Stillsong overlay node. The code matrix is
   * the composition itself; it makes "Let it finish" and same-seed edits exact.
   */
  codesPath?: string;
  /** Render instruction: teacher-force this song's saved composition... */
  prefixSongId?: string;
  /** ...for this many frames (undefined = the whole matrix). Meaningless without prefixSongId. */
  prefixFrames?: number;
}

/** Whether "Enhance quality" has anything to offer: a finished song made with fewer steps than 'enhanced'. */
export function canEnhance(song: Song): boolean {
  return song.status === 'done' && !!song.outputPath && song.spec.steps < RENDER_STEPS.enhanced;
}

/**
 * Is `take` an "Enhance quality" version of `song`: its child, the same seed
 * (so the same performance), at the 'enhanced' step count or more.
 */
export function isEnhanceOf(take: Song, song: Song): boolean {
  return take.parentId === song.id && take.spec.seed === song.spec.seed && take.spec.steps >= RENDER_STEPS.enhanced;
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

export const MODEL_FILES = {
  ditFp16: 'minimax_music3_dit_fp16.safetensors',
  ditInt8: 'minimax_music3_dit_int8_convrot.safetensors',
  textEncoder: 'minimax_music3_text_encoder_pruned_int8_convrot.safetensors',
  vae: 'minimax_music3_dav.safetensors',
} as const;

export const DURATION = { min: 10, max: 360, uiMin: 30, uiMax: 300, default: 120, draft: 40 } as const;

/** Render-cap headroom over the target: cap = need × headroom + pad, ≤ max (VRAM: 360 s nearly exhausts 16 GB). */
// Generous on purpose: the cap costs no render time and no quality — only the
// encoder's pre-allocated KV cache — and a roomy cap is what lets the composer
// finish long takes (interludes, outros) instead of truncating them.
export const CAP = { headroom: 2, pad: 40, max: 300 } as const;

/** Hard limit from comfy/ldm/minimax_music/ar.py: MAX_AUDIO_FRAMES = 9000 at 25 fps. */
export const AUDIO_FRAMES_PER_SECOND = 25;

export function randomSeed(): string {
  // < 2^53 so Number(seed) is exact when it reaches the graph.
  return String(Math.floor(Math.random() * 9_007_199_254_740_000));
}

export function defaultSpec(ditFile: string = MODEL_FILES.ditFp16): SongSpec {
  return {
    title: '',
    idea: '',
    caption: '',
    lyrics: '',
    instrumental: false,
    targetSec: DURATION.default,
    durationSec: Math.min(CAP.max, Math.round(DURATION.default * CAP.headroom + CAP.pad)),
    seed: randomSeed(),
    ditFile,
    tiledDecode: true,
    steps: RENDER_STEPS.fast,
    cfg: 1.7,
    encodeCfg: 1.7,
    topK: 50,
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
