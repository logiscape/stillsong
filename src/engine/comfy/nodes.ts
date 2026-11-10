// Typed constructors for the ComfyUI API-format nodes the YuE2 graph uses.
// ComfyUI core nodes only (no custom nodes). Link = [sourceNodeId, outputIndex].

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
