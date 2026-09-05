// Typed constructors for the ComfyUI API-format nodes the Music 3 graph uses.
// Official nodes only. Link = [sourceNodeId, outputIndex].

export type Link = [string, number];
export type NodeInputs = Record<string, string | number | boolean | Link>;
export interface ApiNode {
  class_type: string;
  inputs: NodeInputs;
}
export type ApiGraph = Record<string, ApiNode>;

export const unetLoader = (unetName: string): ApiNode => ({
  class_type: 'UNETLoader',
  inputs: { unet_name: unetName, weight_dtype: 'default' },
});

export const clipLoader = (clipName: string): ApiNode => ({
  class_type: 'CLIPLoader',
  inputs: { clip_name: clipName, type: 'minimax', device: 'default' },
});

export const vaeLoader = (vaeName: string): ApiNode => ({
  class_type: 'VAELoader',
  inputs: { vae_name: vaeName },
});

export const music3TextEncode = (p: {
  clip: Link;
  caption: string;
  lyrics: string;
  seed: number;
  maxDuration: number;
  cfgScale: number;
  topK: number;
}): ApiNode => ({
  class_type: 'MiniMaxMusic3TextEncode',
  inputs: {
    clip: p.clip,
    caption: p.caption,
    lyrics: p.lyrics,
    seed: p.seed,
    max_duration: p.maxDuration,
    cfg_scale: p.cfgScale,
    top_k: p.topK,
  },
});

/**
 * Our overlay's encoder (comfy-overlay/ComfyUI-Stillsong): the official node's
 * contract plus composition capture (SSC1 codes file next to the audio),
 * teacher-forced prefixes, and a fixed KV capacity. Only present when the
 * overlay is installed — callers must probe `ComfyClient.hasNode` first.
 */
export const stillsongMusic3TextEncode = (p: {
  clip: Link;
  caption: string;
  lyrics: string;
  seed: number;
  maxDuration: number;
  cfgScale: number;
  topK: number;
  saveCodesPrefix: string;
  prefixCodesB64?: string;
  kvCapacityFrames?: number;
}): ApiNode => ({
  class_type: 'StillsongMusic3TextEncode',
  inputs: {
    clip: p.clip,
    caption: p.caption,
    lyrics: p.lyrics,
    seed: p.seed,
    max_duration: p.maxDuration,
    cfg_scale: p.cfgScale,
    top_k: p.topK,
    prefix_codes: p.prefixCodesB64 ?? '',
    save_codes_prefix: p.saveCodesPrefix,
    kv_capacity_frames: p.kvCapacityFrames ?? 0,
  },
});

export const conditioningZeroOut = (conditioning: Link): ApiNode => ({
  class_type: 'ConditioningZeroOut',
  inputs: { conditioning },
});

export const emptyMusic3Latent = (seconds: Link | number): ApiNode => ({
  class_type: 'EmptyMiniMaxMusic3LatentAudio',
  inputs: { seconds, batch_size: 1 },
});

export const kSampler = (p: {
  model: Link;
  positive: Link;
  negative: Link;
  latent: Link;
  seed: number;
  steps: number;
  cfg: number;
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
    sampler_name: 'euler',
    scheduler: 'simple',
    denoise: 1.0,
  },
});

export const vaeDecodeAudio = (samples: Link, vae: Link): ApiNode => ({
  class_type: 'VAEDecodeAudio',
  inputs: { samples, vae },
});

export const vaeDecodeAudioTiled = (samples: Link, vae: Link): ApiNode => ({
  class_type: 'VAEDecodeAudioTiled',
  inputs: { samples, vae, tile_size: 1536, overlap: 64 },
});

/**
 * SaveAudioAdvanced's `format` is a DynamicCombo; in API format the chosen
 * option's sub-input is addressed with the dotted key `format.quality`
 * (verified live against ComfyUI 0.33.3).
 */
export const saveAudioMp3 = (audio: Link, filenamePrefix: string, quality: 'V0' | '128k' | '320k'): ApiNode => ({
  class_type: 'SaveAudioAdvanced',
  inputs: { audio, filename_prefix: filenamePrefix, format: 'mp3', 'format.quality': quality },
});
