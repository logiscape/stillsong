// Live end-to-end tests against a running ComfyUI (:8000). Gated: only run
// with STILLSONG_LIVE=1 (npm run test:live). Renders 20-second drafts.

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { Engine, type JobProgress } from '@engine/index';
import { defaultSpec, MODEL_FILES } from '@engine/domain/types';
import { parseCodesHeader } from '@engine/comfy/codes';
import { livePorts } from './livePorts';

const LIVE = process.env.STILLSONG_LIVE === '1';

const STOCK_CAPTION = `Global Metadata: Authentic vocals, acoustic guitar. No background noise, cozy warm performance. No drums. No beat.

Vocal Details: Deep male vocal, calm, raw authentic emotion. Crisp clear vocals.

Arrangement: Beautiful melody of a raw acoustic guitar. Intro: slow and warm opening melody. Verses: guitar supports the vocal with gentle fingerpicking. Outro: calm, slowing guitar melody reaches the last note.`;

const STOCK_LYRICS = `[Intro]
[Verse]
Morning light on the kitchen floor
Coffee steam and an open door
[Outro]`;

describe.runIf(LIVE)('live: ComfyUI end-to-end', () => {
  it('connects and sees the Music 3 nodes and models', async () => {
    const engine = await Engine.create(livePorts());
    const stats = await engine.comfy.systemStats();
    expect(stats).not.toBeNull();
    const unets = await engine.comfy.availableModels('UNETLoader', 'unet_name');
    expect(unets).toContain(MODEL_FILES.ditFp16);
    expect(await engine.comfy.availableModels('CLIPLoader', 'clip_name')).toContain(MODEL_FILES.textEncoder);
    expect(await engine.comfy.availableModels('VAELoader', 'vae_name')).toContain(MODEL_FILES.vae);
    const info = await engine.comfy.objectInfo('MiniMaxMusic3TextEncode');
    expect(Object.keys(info)).toContain('MiniMaxMusic3TextEncode');
  });

  it('renders a 20s draft via WS progress (encode frames + sampler steps) and harvests the mp3', { timeout: 900_000 }, async () => {
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
    const stat = await fs.stat(final!.outputPath!);
    expect(stat.size).toBeGreaterThan(50_000);
    expect(final?.renderMs).toBeGreaterThan(1000);
    // A 20 s cap is far below what this caption needs: the composer must run into the ceiling.
    expect(final?.hitCeiling).toBe(true);
    expect(final?.actualSec).toBeUndefined();

    const encodeSteps = seen.filter((p) => p.stepNode === 'encode');
    const sampleSteps = seen.filter((p) => p.stepNode === 'sample');
    expect(encodeSteps.length).toBeGreaterThan(10);
    expect(encodeSteps[0].stepMax).toBe(500);
    expect(sampleSteps.some((p) => p.stepMax === 30)).toBe(true);
    expect(seen.some((p) => p.phase === 'Composing (writing the song)')).toBe(true);
    expect(seen.some((p) => p.phase === 'Rendering audio')).toBe(true);
  });

  // Needs the ComfyUI-Stillsong overlay installed (scripts/install-comfy-overlay.ps1).
  it('captures the composition and "Let it finish" continues it bit-exactly', { timeout: 900_000 }, async () => {
    const engine = await Engine.create(livePorts({ ws: true }));
    expect(engine.hasStillsongEncode).toBe(true);
    const nextOutcome = () =>
      new Promise<boolean>((resolve) => {
        const off = engine.on((e) => {
          if (e.kind !== 'song_done' && e.kind !== 'song_failed') return;
          off();
          resolve(e.kind === 'song_done');
        });
      });

    const spec = {
      ...defaultSpec(),
      title: 'Continuation draft',
      caption: STOCK_CAPTION,
      lyrics: STOCK_LYRICS,
      targetSec: 10,
      durationSec: 10,
      seed: '777',
    };
    let outcome = nextOutcome();
    const first = await engine.enqueueSong(spec);
    expect(await outcome).toBe(true);
    const a = (await engine.songs.byId(first.id))!;
    expect(a.hitCeiling).toBe(true); // a 10 s cap always truncates this caption
    expect(a.codesPath).toMatch(/\.codes\.bin$/);
    const blobA = new Uint8Array(await fs.readFile(a.codesPath!));
    const headerA = parseCodesHeader(blobA);
    expect(headerA.frames).toBeGreaterThan(200);

    // "Let it finish": force the whole saved composition, double the room.
    outcome = nextOutcome();
    const second = await engine.enqueueSong({ ...spec, durationSec: 20 }, first.id, { songId: first.id });
    expect(await outcome).toBe(true);
    const b = (await engine.songs.byId(second.id))!;
    const blobB = new Uint8Array(await fs.readFile(b.codesPath!));
    const headerB = parseCodesHeader(blobB);
    expect(headerB.frames).toBeGreaterThan(headerA.frames);
    // The continued composition replays the truncated take frame-for-frame.
    expect(Buffer.compare(
      Buffer.from(blobA.subarray(12)),
      Buffer.from(blobB.subarray(12, 12 + headerA.frames * headerA.books * 2)),
    )).toBe(0);
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
      lyrics: '',
      instrumental: true,
      targetSec: 12,
      durationSec: 12,
      seed: '5',
    });
    expect(await done).toBe(true);
  });
});
