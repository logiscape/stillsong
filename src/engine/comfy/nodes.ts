// Typed constructors for the ComfyUI API-format nodes the YuE2 graphs use:
// ComfyUI core nodes, plus Stillsong 2's own first-party package
// (comfy-nodes/ComfyUI-Stillsong2, the Stillsong2* nodes at the end). No
// third-party custom nodes. Link = [sourceNodeId, outputIndex].

export type Link = [string, number];
export type NodeInputs = Record<string, string | number | boolean | Link>;
export interface ApiNode {
  class_type: string;
  inputs: NodeInputs;
}
export type ApiGraph = Record<string, ApiNode>;

/** Outputs: 0 MODEL, 1 CLIP (the YuE2 language model), 2 VAE. */
export const checkpointLoader = (ckptName: string): ApiNode => ({
  class_type: 'CheckpointLoaderSimple',
  inputs: { ckpt_name: ckptName },
});

/**
 * Writes the melody plan: an ABC score (melody, plus chords in `full` mode)
 * from caption + lyrics. Sampling settings are the node's defaults, which the
 * official template uses. Output 0: the ABC text.
 */
export const yue2GenerateAbc = (p: { clip: Link; style: string; lyrics: string; seed: number; mode: 'full' | 'melody' }): ApiNode => ({
  class_type: 'YuE2GenerateABC',
  inputs: {
    clip: p.clip,
    style: p.style,
    lyrics: p.lyrics,
    seed: p.seed,
    mode: p.mode,
    max_abc_tokens: 8192,
    temperature: 0.7,
    top_p: 0.9,
    top_k: 30,
    repetition_penalty: 1.005,
    penalty_window: 100,
  },
});

/**
 * Performs the song: music tokens + acoustic conditioning from caption,
 * lyrics and the plan. An empty `abc` means no plan (the node switches to
 * `off`). Outputs: 0 CONDITIONING, 1 seconds actually written (FLOAT).
 */
export const yue2GenerateMusic = (p: {
  clip: Link;
  style: string;
  lyrics: string;
  abc: string | Link;
  seed: number;
  mode: 'full' | 'melody';
  maxDuration: number;
}): ApiNode => ({
  class_type: 'YuE2GenerateMusic',
  inputs: {
    clip: p.clip,
    style: p.style,
    lyrics: p.lyrics,
    abc: p.abc,
    seed: p.seed,
    mode: p.mode,
    max_duration: p.maxDuration,
    temperature: 1.0,
    top_p: 0.95,
    top_k: 100,
    repetition_penalty: 1.2,
  },
});

/** The latent must be exactly `seconds` long: always wire YuE2GenerateMusic output 1 in. */
export const emptyYue2Latent = (seconds: Link): ApiNode => ({
  class_type: 'EmptyYuE2LatentAudio',
  inputs: { seconds, batch_size: 1 },
});

/**
 * Echoes any value into the prompt's /history outputs as `{ text: [value] }`.
 * The only way to read a non-file node output (the plan, the length) back
 * over the API, and it is in history even when ComfyUI served it from cache.
 */
export const previewAny = (source: Link): ApiNode => ({
  class_type: 'PreviewAny',
  inputs: { source },
});

export const conditioningZeroOut = (conditioning: Link): ApiNode => ({
  class_type: 'ConditioningZeroOut',
  inputs: { conditioning },
});

export const kSampler = (p: {
  model: Link;
  positive: Link;
  negative: Link;
  latent: Link;
  seed: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}): ApiNode => ({
  class_type: 'KSampler',
  inputs: {
    model: p.model,
    positive: p.positive,
    negative: p.negative,
    latent_image: p.latent,
    seed: p.seed,
    steps: p.steps,
    cfg: p.cfg,
    sampler_name: p.sampler,
    scheduler: p.scheduler,
    denoise: 1.0,
  },
});

export const vaeDecodeAudio = (samples: Link, vae: Link): ApiNode => ({
  class_type: 'VAEDecodeAudio',
  inputs: { samples, vae },
});

/**
 * SaveAudioAdvanced's `format` is a DynamicCombo; in API format the chosen
 * option's sub-input is addressed with the dotted key `format.quality`
 * (verified live against ComfyUI 0.33.3, again on 0.42.4).
 */
export const saveAudioMp3 = (audio: Link, filenamePrefix: string, quality: 'V0' | '128k' | '320k'): ApiNode => ({
  class_type: 'SaveAudioAdvanced',
  inputs: { audio, filename_prefix: filenamePrefix, format: 'mp3', 'format.quality': quality },
});

// ---- Stillsong 2's own nodes (comfy-nodes/ComfyUI-Stillsong2) --------------

/** The node whose presence means the studio's own package loaded. */
export const TAKE_NODE = 'Stillsong2Perform';

/**
 * Frame windows as the nodes take them: "583-662,2264-2338" (half-open,
 * ascending). Always a string: ComfyUI reads a two-element array as a link.
 */
export const frameRanges = (windows: readonly (readonly [number, number])[]): string =>
  windows.map(([a, b]) => `${a}-${b}`).join(',');

/**
 * YuE2GenerateMusic with a third output, the music tokens it wrote (the same
 * performance for the same seed: it runs upstream's own sampling). With
 * `tokens` + `redo` it performs that take again, singing only the redo
 * windows anew. Outputs: 0 CONDITIONING, 1 seconds, 2 tokens.
 */
export const stillsong2Perform = (p: {
  clip: Link;
  style: string;
  lyrics: string;
  abc: string | Link;
  seed: number;
  mode: 'full' | 'melody';
  maxDuration: number;
  tokens?: Link;
  redo?: string;
}): ApiNode => ({
  class_type: 'Stillsong2Perform',
  inputs: {
    clip: p.clip,
    style: p.style,
    lyrics: p.lyrics,
    abc: p.abc,
    seed: p.seed,
    mode: p.mode,
    max_duration: p.maxDuration,
    temperature: 1.0,
    top_p: 0.95,
    top_k: 100,
    repetition_penalty: 1.2,
    ...(p.tokens ? { tokens: p.tokens, redo: p.redo ?? '' } : {}),
  },
});

/** Writes the take (tokens + final latent) next to the audio; reported in /history as a file. */
export const stillsong2SaveTake = (samples: Link, tokens: Link, filenamePrefix: string): ApiNode => ({
  class_type: 'Stillsong2SaveTake',
  inputs: { samples, tokens, filename_prefix: filenamePrefix },
});

/** Reads a take from ComfyUI's temp or output folder. Outputs: 0 tokens, 1 LATENT. */
export const stillsong2LoadTake = (take: string): ApiNode => ({
  class_type: 'Stillsong2LoadTake',
  inputs: { take },
});

/** Marks the redo windows for the sampler; every other frame of the latent is held. */
export const stillsong2HoldLatent = (samples: Link, redo: string): ApiNode => ({
  class_type: 'Stillsong2HoldLatent',
  inputs: { samples, redo },
});

/** After sampling: puts the take's own frames back outside the redo windows (bit-equal). */
export const stillsong2RestoreLatent = (samples: Link, take: Link, redo: string): ApiNode => ({
  class_type: 'Stillsong2RestoreLatent',
  inputs: { samples, take, redo },
});

/**
 * Where does a take sing words that sheet B no longer has? Its /history
 * `text` is JSON `{ frames, drop: number[] }` (see domain/editWindows.ts).
 */
export const stillsong2Align = (p: {
  clip: Link;
  style: string;
  abc: string;
  mode: 'full' | 'melody';
  tokens: Link;
  lyricsA: string;
  lyricsB: string;
}): ApiNode => ({
  class_type: 'Stillsong2Align',
  inputs: { clip: p.clip, style: p.style, abc: p.abc, mode: p.mode, tokens: p.tokens, lyrics_a: p.lyricsA, lyrics_b: p.lyricsB },
});
