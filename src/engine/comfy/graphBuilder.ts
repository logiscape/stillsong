// Builds the flat API-format Music 3 graph (port of the stock
// audio_minimax_music_3.json template, subgraph unwrapped). Node ids are
// stable strings: the WS `executing {node}` / `progress {node}` events map
// id -> phase label, so renaming an id silently degrades progress text.

import { MODEL_FILES, type SongSpec } from '../domain/types';
import { snapDuration } from '../domain/validate';
import * as N from './nodes';
import type { ApiGraph } from './nodes';

export const NODE_PHASES: Record<string, string> = {
  clip: 'Loading models',
  unet: 'Loading models',
  vae: 'Loading models',
  encode: 'Composing (writing the song)',
  neg: 'Composing (writing the song)',
  latent: 'Composing (writing the song)',
  sample: 'Rendering audio',
  decode: 'Decoding',
  save: 'Saving',
};

/**
 * Present only when the Stillsong overlay node is installed (probe
 * `ComfyClient.hasNode`). Every render then captures its composition codes;
 * a prefix teacher-forces the first N frames of a saved composition.
 */
export interface StillsongGraphOpts {
  /** Base64 SSC1 blob to teacher-force (omit for a free render). */
  prefixCodesB64?: string;
  /** Fixed KV capacity in frames (0/omit = size from the cap, upstream behavior). */
  kvCapacityFrames?: number;
}

export function buildGraph(spec: SongSpec, filenamePrefix: string, stillsong?: StillsongGraphOpts): { graph: ApiGraph } {
  const seed = Number(spec.seed);
  const encodeInputs = {
    clip: ['clip', 0] as N.Link,
    caption: spec.caption,
    lyrics: spec.instrumental && !spec.lyrics.trim() ? '' : spec.lyrics,
    seed,
    maxDuration: snapDuration(spec.durationSec),
    cfgScale: spec.encodeCfg,
    topK: spec.topK,
  };
  const graph: ApiGraph = {
    unet: N.unetLoader(spec.ditFile),
    clip: N.clipLoader(MODEL_FILES.textEncoder),
    vae: N.vaeLoader(MODEL_FILES.vae),
    // Node id stays 'encode' either way — NODE_PHASES and progress tracking
    // key on the id, not the class.
    encode: stillsong
      ? N.stillsongMusic3TextEncode({
          ...encodeInputs,
          saveCodesPrefix: filenamePrefix,
          prefixCodesB64: stillsong.prefixCodesB64,
          kvCapacityFrames: stillsong.kvCapacityFrames,
        })
      : N.music3TextEncode(encodeInputs),
    neg: N.conditioningZeroOut(['encode', 0]),
    latent: N.emptyMusic3Latent(['encode', 1]),
    sample: N.kSampler({
      model: ['unet', 0],
      positive: ['encode', 0],
      negative: ['neg', 0],
      latent: ['latent', 0],
      seed,
      steps: spec.steps,
      cfg: spec.cfg,
    }),
    decode: spec.tiledDecode ? N.vaeDecodeAudioTiled(['sample', 0], ['vae', 0]) : N.vaeDecodeAudio(['sample', 0], ['vae', 0]),
    save: N.saveAudioMp3(['decode', 0], filenamePrefix, spec.quality),
  };
  return { graph };
}
