// Builds the flat API-format YuE2 graph (port of the stock
// audio_yue2_text2music.json template, subgraph unwrapped). Node ids are
// stable strings: the WS `executing {node}` / `progress {node}` events map
// id -> phase label, and harvest reads `plan_out` / `seconds_out` from
// /history, so renaming an id silently degrades progress text or the harvest.

import type { FrameWindow, SongSpec } from '../domain/types';
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
  take: 'Saving',
  // "Keep the rest" edits (buildEditGraph).
  source: 'Composing (writing the song)',
  hold: 'Composing (writing the song)',
  restore: 'Rendering audio',
};

/**
 * Phases of a "keep the rest" edit that the engine names itself (its helper
 * prompts report one phase each, so the creation stages only move forward).
 * The prefixes pick the stage, as with NODE_PHASES.
 */
export const EDIT_PHASES = {
  finding: 'Composing (finding your lines)',
  checking: 'Saving (checking the new lines)',
  again: 'Saving (singing those lines once more)',
} as const;

/** History output ids the harvest reads (PreviewAny text). */
export const PLAN_OUT = 'plan_out';
export const SECONDS_OUT = 'seconds_out';
/** The alignment node: its history text is the series (JSON). */
export const ALIGN_OUT = 'align';

export interface GraphOptions {
  /**
   * Use the studio's own perform node and save the take (tokens + latent)
   * beside the audio. Same performance as the core graph for the same seed.
   */
  capture?: boolean;
}

/** Whether this spec writes a new melody plan in the graph (vs. performing a given one, or none). */
export function writesPlan(spec: SongSpec): boolean {
  return spec.planMode !== 'off' && !spec.abc?.trim();
}

export function buildGraph(spec: SongSpec, filenamePrefix: string, options: GraphOptions = {}): { graph: ApiGraph } {
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
  graph.perform = (options.capture ? N.stillsong2Perform : N.yue2GenerateMusic)({
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
  if (options.capture) graph.take = N.stillsong2SaveTake(['sample', 0], ['perform', 2], filenamePrefix);
  graph.decode = N.vaeDecodeAudio(['sample', 0], ['ckpt', 2]);
  graph.save = N.saveAudioMp3(['decode', 0], filenamePrefix, spec.quality);
  return { graph };
}

/** What an edit performs with: the uploaded source take and the plan it performed. */
export interface EditSource {
  /** The take as the load node names it, e.g. "stillsong2/ab12cd34.take.safetensors [temp]". */
  take: string;
  /** The plan the source performed (an edit never writes a new one). */
  abc: string;
}

/**
 * Where does `source.take` sing words that `lyricsB` no longer has (relative
 * to `lyricsA`)? No audio is made: two replays of the take, a fraction of a
 * second each. The series comes back as the `align` node's history text.
 */
export function buildAlignGraph(spec: SongSpec, source: EditSource, lyricsA: string, lyricsB: string): { graph: ApiGraph } {
  return {
    graph: {
      ckpt: N.checkpointLoader(spec.checkpoint),
      source: N.stillsong2LoadTake(source.take),
      [ALIGN_OUT]: N.stillsong2Align({
        clip: ['ckpt', 1],
        style: spec.caption,
        abc: source.abc,
        mode: spec.planMode === 'melody' ? 'melody' : 'full',
        tokens: ['source', 0],
        lyricsA,
        lyricsB,
      }),
    },
  };
}

/**
 * Performs the source take again with `spec.lyrics`, singing only `windows`
 * anew: tokens and latent outside them are held, so the rest of the recording
 * is unchanged and the song keeps its length. Saves the new take beside the
 * audio. The source's lyrics are deliberately not in this graph: the MP3
 * carries its whole prompt, and removed words should not travel with it.
 */
export function buildEditGraph(spec: SongSpec, source: EditSource, windows: FrameWindow[], filenamePrefix: string): { graph: ApiGraph } {
  const seed = Number(spec.seed);
  const redo = N.frameRanges(windows);
  const graph: ApiGraph = {
    ckpt: N.checkpointLoader(spec.checkpoint),
    source: N.stillsong2LoadTake(source.take),
    perform: N.stillsong2Perform({
      clip: ['ckpt', 1],
      style: spec.caption,
      lyrics: spec.lyrics,
      abc: source.abc,
      seed,
      mode: spec.planMode === 'melody' ? 'melody' : 'full',
      // The same cap as every song (it sizes the KV cache); the take's own
      // length is kept by forcing its end.
      maxDuration: snapDuration(spec.durationSec),
      tokens: ['source', 0],
      redo,
    }),
  };
  graph[SECONDS_OUT] = N.previewAny(['perform', 1]);
  graph.neg = N.conditioningZeroOut(['perform', 0]);
  graph.hold = N.stillsong2HoldLatent(['source', 1], redo);
  graph.sample = N.kSampler({
    model: ['ckpt', 0],
    positive: ['perform', 0],
    negative: ['neg', 0],
    latent: ['hold', 0],
    seed,
    steps: spec.steps,
    cfg: spec.cfg,
    sampler: spec.sampler,
    scheduler: spec.scheduler,
  });
  graph.restore = N.stillsong2RestoreLatent(['sample', 0], ['source', 1], redo);
  graph.take = N.stillsong2SaveTake(['restore', 0], ['perform', 2], filenamePrefix);
  graph.decode = N.vaeDecodeAudio(['restore', 0], ['ckpt', 2]);
  graph.save = N.saveAudioMp3(['decode', 0], filenamePrefix, spec.quality);
  return { graph };
}
