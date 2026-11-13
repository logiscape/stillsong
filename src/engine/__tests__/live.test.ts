// Live end-to-end tests against a running ComfyUI (:8000). Gated: only run
// with STILLSONG2_LIVE=1 (npm run test:live). Renders 20-second drafts.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Engine, type JobProgress } from '@engine/index';
import { defaultSpec, YUE2_CHECKPOINT } from '@engine/domain/types';
import { livePorts } from './livePorts';

const LIVE = process.env.STILLSONG2_LIVE === '1';

const STOCK_CAPTION = `Global Metadata: Authentic vocals, acoustic guitar. No background noise, cozy warm performance. No drums. No beat.

Vocal Details: Deep male vocal, calm, raw authentic emotion. Crisp clear vocals.

Arrangement: Beautiful melody of a raw acoustic guitar. Intro: slow and warm opening melody. Verses: guitar supports the vocal with gentle fingerpicking. Outro: calm, slowing guitar melody reaches the last note.`;

const STOCK_LYRICS = `[Intro]
[Verse]
Morning light on the kitchen floor
Coffee steam and an open door
[Outro]`;

/** sha256 of an MP3's audio frames: the ID3 tag (prompt metadata, file name) is skipped. */
async function audioHash(path: string): Promise<string> {
  const buf = await fs.readFile(path);
  let off = 0;
  if (buf.subarray(0, 3).toString() === 'ID3') off = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
  return createHash('sha256').update(buf.subarray(off)).digest('hex');
}

/** A take file (safetensors): the per-frame codec codes and the raw float32 latent [64, frames]. */
async function readTake(path: string): Promise<{ codes: Int16Array; latent: Buffer }> {
  const buf = await fs.readFile(path);
  const headerLength = Number(buf.readBigUInt64LE(0));
  const header = JSON.parse(buf.subarray(8, 8 + headerLength).toString('utf8')) as Record<string, { data_offsets: [number, number] }>;
  const data = buf.subarray(8 + headerLength);
  const codes = data.subarray(...header.codes.data_offsets);
  return {
    codes: new Int16Array(codes.buffer.slice(codes.byteOffset, codes.byteOffset + codes.byteLength)),
    latent: data.subarray(...header.latent.data_offsets),
  };
}

describe.runIf(LIVE)('live: ComfyUI end-to-end', () => {
  it('connects and sees the YuE2 nodes and checkpoint', async () => {
    const engine = await Engine.create(livePorts());
    expect(await engine.comfy.systemStats()).not.toBeNull();
    expect(await engine.comfy.availableModels('CheckpointLoaderSimple', 'ckpt_name')).toContain(YUE2_CHECKPOINT);
    for (const node of ['YuE2GenerateABC', 'YuE2GenerateMusic', 'EmptyYuE2LatentAudio', 'PreviewAny']) {
      expect(await engine.comfy.hasNode(node)).toBe(true);
    }
  });

  it('renders a 20s draft via WS progress (plan, perform, sampler) and harvests the mp3, plan and length', { timeout: 900_000 }, async () => {
    const engine = await Engine.create(livePorts({ ws: true }));
    const seen: JobProgress[] = [];
    const done = new Promise<{ ok: boolean; error?: string }>((resolve) => {
      engine.on((e) => {
        if (e.kind === 'progress') seen.push(e.progress);
        if (e.kind === 'song_done') resolve({ ok: true });
        if (e.kind === 'song_failed') resolve({ ok: false, error: e.song.error });
      });
    });
    const song = await engine.enqueueSong({
      ...defaultSpec(),
      title: 'Live draft',
      caption: STOCK_CAPTION,
      lyrics: STOCK_LYRICS,
      targetSec: 20,
      durationSec: 20,
      seed: '222',
    });
    const result = await done;
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);

    const final = await engine.songs.byId(song.id);
    expect(final?.status).toBe('done');
    expect(final?.outputPath).toMatch(/\.mp3$/);
    expect((await fs.stat(final!.outputPath!)).size).toBeGreaterThan(50_000);
    expect(final?.renderMs).toBeGreaterThan(1000);
    // A 20 s cap is far below what this caption needs: the composer runs into it.
    expect(final?.hitCeiling).toBe(true);
    expect(final?.actualSec).toBe(20);
    expect(final?.planAbc).toMatch(/^X:/);

    const perform = seen.filter((p) => p.stepNode === 'perform');
    expect(seen.some((p) => p.stepNode === 'plan')).toBe(true);
    expect(perform.length).toBeGreaterThan(3);
    expect(perform[0].stepMax).toBe(500);
    expect(seen.some((p) => p.stepNode === 'sample' && p.stepMax === defaultSpec().steps)).toBe(true);
    expect(seen.some((p) => p.phase === 'Composing (writing the melody)')).toBe(true);
    expect(seen.some((p) => p.phase === 'Composing (writing the song)')).toBe(true);
    expect(seen.some((p) => p.phase === 'Rendering audio')).toBe(true);
  });

  it('re-performing the saved plan with the same seed is the same take', { timeout: 900_000 }, async () => {
    const engine = await Engine.create(livePorts({ ws: true }));
    const nextOutcome = () =>
      new Promise<boolean>((resolve) => {
        const off = engine.on((e) => {
          if (e.kind !== 'song_done' && e.kind !== 'song_failed') return;
          off();
          resolve(e.kind === 'song_done');
        });
      });
    const spec = { ...defaultSpec(), title: 'Plan draft', caption: STOCK_CAPTION, lyrics: STOCK_LYRICS, targetSec: 20, durationSec: 20, seed: '777' };

    let outcome = nextOutcome();
    const first = await engine.enqueueSong(spec);
    expect(await outcome).toBe(true);
    const a = (await engine.songs.byId(first.id))!;
    expect(a.planAbc).toBeTruthy();

    // "Keep melody", same seed, nothing else changed: the graph has no plan
    // node now (so ComfyUI's cache cannot serve it), yet the audio matches.
    outcome = nextOutcome();
    const second = await engine.enqueueSong({ ...spec, abc: a.planAbc }, first.id);
    expect(await outcome).toBe(true);
    const b = (await engine.songs.byId(second.id))!;
    expect(b.planAbc).toBe(a.planAbc);
    expect(b.actualSec).toBe(a.actualSec);
    expect(await audioHash(b.outputPath!)).toBe(await audioHash(a.outputPath!));
  });

  it('a "keep the rest" edit sings one line again and keeps everything else', { timeout: 900_000 }, async () => {
    const engine = await Engine.create(livePorts({ ws: true }));
    // Without the studio's own nodes this suite would only exercise the
    // fallback: start ComfyUI with scripts/dev-comfy.ps1, which installs them.
    expect(await engine.comfy.hasNode('Stillsong2Perform'), 'comfy-nodes/ComfyUI-Stillsong2 is not loaded').toBe(true);
    const phases: string[] = [];
    engine.on((e) => {
      if (e.kind === 'progress' && phases[phases.length - 1] !== e.progress.phase) phases.push(e.progress.phase);
    });
    const nextOutcome = () =>
      new Promise<string | undefined>((resolve) => {
        const off = engine.on((e) => {
          if (e.kind !== 'song_done' && e.kind !== 'song_failed') return;
          off();
          resolve(e.kind === 'song_done' ? undefined : (e.song.error ?? 'failed'));
        });
      });
    const lyrics = '[Verse]\nMorning light on the kitchen floor\nCoffee steam and an open door\n[Outro]';
    const spec = { ...defaultSpec(), title: 'Edit draft', caption: STOCK_CAPTION, lyrics, targetSec: 30, durationSec: 30, seed: '4242' };

    let outcome = nextOutcome();
    const first = await engine.enqueueSong(spec);
    expect(await outcome).toBeUndefined();
    const a = (await engine.songs.byId(first.id))!;
    expect(a.takePath).toMatch(/\.take\.safetensors$/);
    const before = await readTake(a.takePath!);
    expect(before.codes.length).toBe(Math.round(a.actualSec! * 25));

    outcome = nextOutcome();
    const edited = lyrics.replace('Coffee steam and an open door', 'Winter rain on a rusted roof');
    const second = await engine.enqueueSong({ ...spec, lyrics: edited, abc: a.planAbc, edit: { sourceId: a.id } }, a.id);
    expect(await outcome).toBeUndefined();
    const b = (await engine.songs.byId(second.id))!;
    expect(b.status).toBe('done');
    expect(b.parentId).toBe(a.id);
    expect(b.actualSec).toBe(a.actualSec);
    expect(b.planAbc).toBe(a.planAbc);
    expect(b.editWindows?.length).toBeGreaterThan(0);
    expect(phases).toContain('Composing (finding your lines)');
    expect(phases).toContain('Saving (checking the new lines)');

    // The new take is the old one outside the windows: same tokens, and a
    // bit-equal latent (so the decoded audio there is the same recording).
    const after = await readTake(b.takePath!);
    const frames = before.codes.length;
    expect(after.codes.length).toBe(frames);
    const inside = (i: number) => b.editWindows!.some(([start, end]) => i >= start && i < end);
    let keptTokens = true;
    let changedTokens = 0;
    for (let i = 0; i < frames; i++) {
      if (inside(i)) changedTokens += before.codes[i] !== after.codes[i] ? 1 : 0;
      else if (before.codes[i] !== after.codes[i]) keptTokens = false;
    }
    expect(keptTokens).toBe(true);
    expect(changedTokens).toBeGreaterThan(0);
    let keptLatent = true;
    for (let channel = 0; channel < 64 && keptLatent; channel++) {
      for (let i = 0; i < frames; i++) {
        const at = (channel * frames + i) * 4;
        if (!inside(i) && before.latent.readUInt32LE(at) !== after.latent.readUInt32LE(at)) {
          keptLatent = false;
          break;
        }
      }
    }
    expect(keptLatent).toBe(true);
    expect(await audioHash(b.outputPath!)).not.toBe(await audioHash(a.outputPath!));
  });

  it('renders via the history-poll fallback when WS is unavailable', { timeout: 900_000 }, async () => {
    const engine = await Engine.create(livePorts());
    const done = new Promise<boolean>((resolve) => {
      engine.on((e) => {
        if (e.kind === 'song_done') resolve(true);
        if (e.kind === 'song_failed') resolve(false);
      });
    });
    await engine.enqueueSong({
      ...defaultSpec(),
      title: 'Poll draft',
      caption: STOCK_CAPTION,
      lyrics: '[intro]\n[instrumental]\n[outro]',
      instrumental: true,
      targetSec: 12,
      durationSec: 12,
      seed: '5',
    });
    expect(await done).toBe(true);
  });
});
