// Builds the flat API-format YuE2 graph (port of the stock
// audio_yue2_text2music.json template, subgraph unwrapped). Node ids are
// stable strings: the WS `executing {node}` / `progress {node}` events map
// id -> phase label, and harvest reads `plan_out` / `seconds_out` from
// /history, so renaming an id silently degrades progress text or the harvest.

import type { SongSpec } from '../domain/types';
import { snapDuration } from '../domain/validate';
import * as N from './nodes';
import type { ApiGraph } from './nodes';

export const NODE_PHASES: Record<string, string> = {
  ckpt: 'Loading models',
  plan: 'Composing (writing the melody)',
  plan_out: 'Composing (writing the melody)',
  perform: 'Composing (writing the song)',
  seconds_out: 'Composing (writing the song)',
  neg: 'Composing (writing the song)',
  latent: 'Composing (writing the song)',
  sample: 'Rendering audio',
  decode: 'Decoding',
  save: 'Saving',
};

/** History output ids the harvest reads (PreviewAny text). */
export const PLAN_OUT = 'plan_out';
export const SECONDS_OUT = 'seconds_out';

/** Whether this spec writes a new melody plan in the graph (vs. performing a given one, or none). */
export function writesPlan(spec: SongSpec): boolean {
  return spec.planMode !== 'off' && !spec.abc?.trim();
}

export function buildGraph(spec: SongSpec, filenamePrefix: string): { graph: ApiGraph } {
  // One seed drives the plan, the performance and the sampler (as in the template).
  const seed = Number(spec.seed);
  const mode = spec.planMode === 'melody' ? 'melody' : 'full';
  const lyrics = spec.instrumental && !spec.lyrics.trim() ? '' : spec.lyrics;
  const graph: ApiGraph = { ckpt: N.checkpointLoader(spec.checkpoint) };
  let abc: string | N.Link = '';
  if (writesPlan(spec)) {
    graph.plan = N.yue2GenerateAbc({ clip: ['ckpt', 1], style: spec.caption, lyrics, seed, mode });
    graph[PLAN_OUT] = N.previewAny(['plan', 0]);
    abc = ['plan', 0];
  } else if (spec.planMode !== 'off') {
    abc = spec.abc ?? '';
  }
  graph.perform = N.yue2GenerateMusic({
    clip: ['ckpt', 1],
    style: spec.caption,
    lyrics,
    abc,
    seed,
    mode,
    maxDuration: snapDuration(spec.durationSec),
  });
  graph[SECONDS_OUT] = N.previewAny(['perform', 1]);
  graph.neg = N.conditioningZeroOut(['perform', 0]);
  graph.latent = N.emptyYue2Latent(['perform', 1]);
  graph.sample = N.kSampler({
    model: ['ckpt', 0],
    positive: ['perform', 0],
    negative: ['neg', 0],
    latent: ['latent', 0],
    seed,
    steps: spec.steps,
    cfg: spec.cfg,
    sampler: spec.sampler,
    scheduler: spec.scheduler,
  });
  graph.decode = N.vaeDecodeAudio(['sample', 0], ['ckpt', 2]);
  graph.save = N.saveAudioMp3(['decode', 0], filenamePrefix, spec.quality);
  return { graph };
}
