import { describe, expect, it } from 'vitest';
import { buildGraph, NODE_PHASES } from '@engine/comfy/graphBuilder';
import { defaultSpec, MODEL_FILES } from '@engine/domain/types';
import { validateSpec } from '@engine/domain/validate';
import { capCeiling, hardwareTier, renderCap } from '@engine/domain/duration';

describe('buildGraph', () => {
  const spec = { ...defaultSpec(), caption: 'Global Metadata: x\n\nVocal Details: y\n\nArrangement: z', lyrics: '[verse]\nhi', seed: '222', targetSec: 20, durationSec: 20 };

  it('emits the flat Music 3 graph with stable ids and shared seed', () => {
    const { graph } = buildGraph(spec, 'audio/stillsong/abcd1234');
    expect(Object.keys(graph).sort()).toEqual(['clip', 'decode', 'encode', 'latent', 'neg', 'sample', 'save', 'unet', 'vae'].sort());
    expect(graph.unet.inputs.unet_name).toBe(MODEL_FILES.ditFp16);
    expect(graph.clip.inputs).toMatchObject({ clip_name: MODEL_FILES.textEncoder, type: 'minimax' });
    expect(graph.encode.inputs).toMatchObject({ clip: ['clip', 0], seed: 222, max_duration: 20, cfg_scale: 1.7, top_k: 50 });
    expect(graph.sample.inputs).toMatchObject({ seed: 222, steps: 30, cfg: 1.7, sampler_name: 'euler', scheduler: 'simple' });
    expect(graph.latent.inputs.seconds).toEqual(['encode', 1]);
    expect(graph.neg.inputs.conditioning).toEqual(['encode', 0]);
    expect(graph.decode.class_type).toBe('VAEDecodeAudioTiled');
    expect(graph.save.inputs).toMatchObject({ filename_prefix: 'audio/stillsong/abcd1234', format: 'mp3', 'format.quality': 'V0' });
    for (const id of Object.keys(graph)) expect(NODE_PHASES[id]).toBeTruthy();
  });

  it('switches to the plain decoder when tiled is off and snaps duration to 0.04s', () => {
    const { graph } = buildGraph({ ...spec, tiledDecode: false, durationSec: 33.333, quality: '320k' }, 'p');
    expect(graph.decode.class_type).toBe('VAEDecodeAudio');
    expect(graph.encode.inputs.max_duration).toBeCloseTo(33.32, 5);
    expect(graph.save.inputs['format.quality']).toBe('320k');
  });

  it('sends empty lyrics for instrumental songs without tags', () => {
    const { graph } = buildGraph({ ...spec, instrumental: true, lyrics: '   ' }, 'p');
    expect(graph.encode.inputs.lyrics).toBe('');
    const tagged = buildGraph({ ...spec, instrumental: true, lyrics: '[intro]\n[instrumental]\n[outro]' }, 'p');
    expect(tagged.graph.encode.inputs.lyrics).toBe('[intro]\n[instrumental]\n[outro]');
  });
});

describe('validateSpec', () => {
  it('rejects out-of-range durations and bad seeds', () => {
    const base = { ...defaultSpec(), caption: 'c' };
    expect(validateSpec({ ...base, durationSec: 5 }).some((i) => i.severity === 'error')).toBe(true);
    expect(validateSpec({ ...base, durationSec: 361 }).some((i) => i.severity === 'error')).toBe(true);
    expect(validateSpec({ ...base, seed: '-1' }).some((i) => i.severity === 'error')).toBe(true);
    expect(validateSpec({ ...base, seed: '18446744073709551615' }).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateSpec({ ...base, seed: '18446744073709551616' }).some((i) => i.severity === 'error')).toBe(true);
    expect(validateSpec({ ...base, caption: '<|audio_end|>' }).some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('renderCap', () => {
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
  it('derives tier and cap ceiling from VRAM/RAM', () => {
    expect(hardwareTier({ vendor: 'nvidia', vramMb: 16_303, ramMb: 65_536 })).toBe('fast');
    expect(hardwareTier({ vendor: 'nvidia', vramMb: 12_288, ramMb: 32_768 })).toBe('patient');
    // 32 GB RAM is a recommendation, not a gate (pagefile-backed commit).
    expect(hardwareTier({ vendor: 'nvidia', vramMb: 12_288, ramMb: 16_384 })).toBe('patient');
    expect(hardwareTier({ vendor: 'nvidia', vramMb: 6_144, ramMb: 65_536 })).toBe('unsupported');
    expect(hardwareTier({ vendor: 'amd', vramMb: 24_576, ramMb: 65_536 })).toBe('unsupported');
    // One ceiling for every supported tier (measured: 300 s caps complete
    // even at emulated 8 GB) — and one KV pin, so codes stay bit-compatible
    // across hardware tiers.
    expect(capCeiling(16_303)).toBe(300);
    expect(capCeiling(12_288)).toBe(300);
    expect(capCeiling(8_192)).toBe(300);
  });
});
