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
