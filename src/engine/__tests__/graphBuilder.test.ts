import { describe, expect, it } from 'vitest';
import { buildGraph, NODE_PHASES } from '@engine/comfy/graphBuilder';
import { defaultSpec, MAX_DURATION_SEC, YUE2_CHECKPOINT } from '@engine/domain/types';
import { validateSpec } from '@engine/domain/validate';
import { driverShortfall, hardwareTier, renderCap } from '@engine/domain/duration';

describe('buildGraph', () => {
  const spec = { ...defaultSpec(), caption: 'Global Metadata: x\n\nVocal Details: y\n\nArrangement: z', lyrics: '[verse]\nhi', seed: '222', targetSec: 20 };

  it('emits the flat YuE2 graph (the official template) with stable ids and one shared seed', () => {
    const { graph } = buildGraph(spec, 'audio/stillsong2/abcd1234');
    expect(Object.keys(graph).sort()).toEqual(['ckpt', 'decode', 'latent', 'neg', 'perform', 'plan', 'plan_out', 'sample', 'save', 'seconds_out'].sort());
    expect(graph.ckpt).toEqual({ class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: YUE2_CHECKPOINT } });
    expect(graph.plan.inputs).toMatchObject({ clip: ['ckpt', 1], style: spec.caption, lyrics: spec.lyrics, seed: 222, mode: 'full', max_abc_tokens: 8192 });
    expect(graph.plan_out.inputs.source).toEqual(['plan', 0]);
    expect(graph.perform.inputs).toMatchObject({
      clip: ['ckpt', 1], style: spec.caption, lyrics: spec.lyrics, abc: ['plan', 0], seed: 222, mode: 'full', max_duration: MAX_DURATION_SEC,
    });
    expect(graph.seconds_out.inputs.source).toEqual(['perform', 1]);
    expect(graph.latent).toEqual({ class_type: 'EmptyYuE2LatentAudio', inputs: { seconds: ['perform', 1], batch_size: 1 } });
    expect(graph.neg.inputs.conditioning).toEqual(['perform', 0]);
    expect(graph.sample.inputs).toMatchObject({ model: ['ckpt', 0], seed: 222, steps: 32, cfg: 1, sampler_name: 'dpm_2', scheduler: 'sgm_uniform', denoise: 1 });
    expect(graph.decode).toEqual({ class_type: 'VAEDecodeAudio', inputs: { samples: ['sample', 0], vae: ['ckpt', 2] } });
    expect(graph.save.inputs).toMatchObject({ filename_prefix: 'audio/stillsong2/abcd1234', format: 'mp3', 'format.quality': 'V0' });
    for (const id of Object.keys(graph)) expect(NODE_PHASES[id]).toBeTruthy();
  });

  it('performs a given plan verbatim instead of writing one', () => {
    const { graph } = buildGraph({ ...spec, abc: 'X:1\nK:C\nc4|' }, 'p');
    expect(graph.plan).toBeUndefined();
    expect(graph.plan_out).toBeUndefined();
    expect(graph.perform.inputs.abc).toBe('X:1\nK:C\nc4|');
  });

  it('melody-only plans pass the mode to both nodes; no plan at all sends an empty score', () => {
    const melody = buildGraph({ ...spec, planMode: 'melody' }, 'p').graph;
    expect(melody.plan.inputs.mode).toBe('melody');
    expect(melody.perform.inputs.mode).toBe('melody');
    const off = buildGraph({ ...spec, planMode: 'off', abc: 'ignored' }, 'p').graph;
    expect(off.plan).toBeUndefined();
    expect(off.perform.inputs.abc).toBe('');
  });

  it('snaps the cap to 0.04 s and passes quality through', () => {
    const { graph } = buildGraph({ ...spec, durationSec: 33.333, quality: '320k' }, 'p');
    expect(graph.perform.inputs.max_duration).toBeCloseTo(33.32, 5);
    expect(graph.save.inputs['format.quality']).toBe('320k');
  });

  it('sends empty lyrics for instrumental songs without tags', () => {
    const { graph } = buildGraph({ ...spec, instrumental: true, lyrics: '   ' }, 'p');
    expect(graph.perform.inputs.lyrics).toBe('');
    const tagged = buildGraph({ ...spec, instrumental: true, lyrics: '[intro]\n[instrumental]\n[outro]' }, 'p');
    expect(tagged.graph.perform.inputs.lyrics).toBe('[intro]\n[instrumental]\n[outro]');
  });
});

describe('validateSpec', () => {
  it('rejects out-of-range durations and bad seeds', () => {
    const base = { ...defaultSpec(), caption: 'c' };
    expect(validateSpec({ ...base, durationSec: 5 }).some((i) => i.severity === 'error')).toBe(true);
    expect(validateSpec({ ...base, durationSec: 901 }).some((i) => i.severity === 'error')).toBe(true);
    expect(validateSpec({ ...base, durationSec: MAX_DURATION_SEC }).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateSpec({ ...base, seed: '-1' }).some((i) => i.severity === 'error')).toBe(true);
    expect(validateSpec({ ...base, seed: '18446744073709551615' }).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateSpec({ ...base, seed: '18446744073709551616' }).some((i) => i.severity === 'error')).toBe(true);
    expect(validateSpec({ ...base, planMode: 'bogus' as never }).some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('renderCap (the co-writer\'s length budget, unchanged from Stillsong 1)', () => {
  it('adds headroom over max(target, lyric estimate), never below target, capped at 300', () => {
    expect(renderCap(120, '')).toBe(280); // 120 × 2 + 40
    expect(renderCap(30, '[verse]\n' + 'la\n'.repeat(20))).toBe(220); // 20 lines × 4.5 s = 90 s > target
    expect(renderCap(300, '')).toBe(300);
    expect(renderCap(20, '')).toBe(80);
  });

  it('respects a lower tier ceiling', () => {
    expect(renderCap(120, '', 180)).toBe(180);
    expect(renderCap(120, '', 120)).toBe(120);
    expect(renderCap(120, '', 9999)).toBe(280); // never above CAP.max math
  });
});

describe('hardware tiers', () => {
  it('derives the tier from VRAM/RAM', () => {
    expect(hardwareTier({ vendor: 'nvidia', vramMb: 16_303, ramMb: 65_536 })).toBe('fast');
    expect(hardwareTier({ vendor: 'nvidia', vramMb: 12_288, ramMb: 32_768 })).toBe('patient');
    // 32 GB RAM is a recommendation, not a gate (pagefile-backed commit).
    expect(hardwareTier({ vendor: 'nvidia', vramMb: 12_288, ramMb: 16_384 })).toBe('patient');
    expect(hardwareTier({ vendor: 'nvidia', vramMb: 6_144, ramMb: 65_536 })).toBe('unsupported');
    expect(hardwareTier({ vendor: 'amd', vramMb: 24_576, ramMb: 65_536 })).toBe('unsupported');
  });

  it('flags a driver older than the CUDA 13 runtimes need', () => {
    const nv = (driverVersion: string | null, computeCap: string | null) => ({ vendor: 'nvidia', vramMb: 16_303, ramMb: 65_536, driverVersion, computeCap });
    // Ampere and newer run the shipped machine code on any CUDA 13 driver (580+).
    expect(driverShortfall(nv('617.42', '12.0'))).toBeNull();
    expect(driverShortfall(nv('581.57', '8.9'))).toBeNull();
    expect(driverShortfall(nv('580.88', '8.6'))).toBeNull();
    expect(driverShortfall(nv('576.02', '8.9'))).toEqual({ have: '576.02', need: 580 });
    // Turing gets PTX only, which the driver must JIT: it needs the CUDA 13.4 branch.
    expect(driverShortfall(nv('581.57', '7.5'))).toEqual({ have: '581.57', need: 615 });
    expect(driverShortfall(nv('617.42', '7.5'))).toBeNull();
    // Unknown driver (DXGI fallback, or an nvidia-smi without the field) is never flagged.
    expect(driverShortfall(nv(null, null))).toBeNull();
    expect(driverShortfall({ vendor: 'nvidia', vramMb: 16_303, ramMb: 65_536 })).toBeNull();
    expect(driverShortfall(nv('[N/A]', '8.9'))).toBeNull();
    expect(driverShortfall({ vendor: 'amd', vramMb: 24_576, ramMb: 65_536, driverVersion: '24.1' })).toBeNull();
  });
});
