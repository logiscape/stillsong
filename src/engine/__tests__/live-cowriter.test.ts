// Live songwriter tests (STILLSONG_LIVE=1): llama-server boot + JSON-schema
// conformance + vision + the full one-button pipeline. Needs the llama.cpp
// build and Gemma GGUFs provisioned under the components dir, and ComfyUI up
// for the full-pipeline test.

import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Engine, type CreationStage } from '@engine/index';
import { LlmClient } from '@engine/cowriter/llmClient';
import { Cowriter } from '@engine/cowriter/cowriter';
import { COMPOSE_SCHEMA, analysisPrompt } from '@engine/cowriter/guides';
import { PhotoRepo } from '@engine/repo/photos';
import { llamaAvailable, livePorts, nodeRuntime } from './livePorts';

const LIVE = process.env.STILLSONG_LIVE === '1' && llamaAvailable();
// Any picture works; the app icon is the one image guaranteed to be in the repo.
const PHOTO = process.env.STILLSONG_PHOTO ?? fileURLToPath(new URL('../../../src-tauri/icons/icon.png', import.meta.url));

const runtime = nodeRuntime();

afterAll(async () => {
  await runtime.dispose();
});

async function llmUp(ports: ReturnType<typeof livePorts>): Promise<LlmClient> {
  await runtime.startLlm();
  const llm = new LlmClient(ports.http, (await runtime.urls()).llm);
  const deadline = Date.now() + 180_000;
  while (!(await llm.isHealthy())) {
    if (Date.now() > deadline) throw new Error('llama-server never became healthy');
    await new Promise((r) => setTimeout(r, 1000));
  }
  return llm;
}

describe.runIf(LIVE)('live: llama-server songwriter', () => {
  it('boots, answers /health, and returns schema-constrained JSON', { timeout: 300_000 }, async () => {
    const ports = livePorts({ runtime });
    const llm = await llmUp(ports);
    const raw = await llm.chat(
      [
        { role: 'system', content: 'You write song packages as JSON.' },
        { role: 'user', content: 'A short lullaby about rain. Return JSON with keys title, caption, lyrics, notes.' },
      ],
      { temperature: 0.8, format: COMPOSE_SCHEMA as unknown as Record<string, unknown> },
    );
    const j = JSON.parse(raw) as Record<string, unknown>;
    expect(typeof j.title).toBe('string');
    expect(typeof j.caption).toBe('string');
    expect(typeof j.lyrics).toBe('string');
  });

  it('sees a photo (vision through the OpenAI content array)', { timeout: 300_000 }, async () => {
    const exists = await fs.access(PHOTO).then(() => true).catch(() => false);
    if (!exists) return; // no sample photo on this machine
    const ports = livePorts({ runtime });
    const llm = await llmUp(ports);
    const b64 = await ports.files.readBase64(PHOTO);
    const card = await llm.chat([{ role: 'user', content: analysisPrompt('photo'), images: [b64] }], { temperature: 0.3 });
    expect(card).toMatch(/Subjects/i);
    expect(card).toMatch(/Mood words/i);
  });

  it('composes an instrumental with tag-only lyrics', { timeout: 300_000 }, async () => {
    const ports = livePorts({ runtime });
    const llm = await llmUp(ports);
    const writer = new Cowriter(llm, ports.files, new PhotoRepo(ports.db, ports.files));
    const result = await writer.compose({
      idea: 'calm piano for studying',
      durationSec: 45,
      instrumental: true,
      vocalPref: 'instrumental',
    });
    expect(result.caption.toLowerCase()).toMatch(/instrumental|no vocals/);
    expect(result.lyrics.replace(/\[[^\]]+\]/g, '').trim()).toBe('');
    expect(result.lintIssues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('creates a song from a photo with zero interaction (the whole product)', { timeout: 900_000 }, async () => {
    const exists = await fs.access(PHOTO).then(() => true).catch(() => false);
    if (!exists) return; // no sample photo on this machine
    const engine = await Engine.create(livePorts({ ws: true, runtime }));
    const stages: CreationStage[] = [];
    const done = new Promise<{ ok: boolean; error?: string }>((resolve) => {
      engine.on((e) => {
        if (e.kind === 'creation_stage') stages.push(e.stage);
        if (e.kind === 'song_done') resolve({ ok: true });
        if (e.kind === 'song_failed') resolve({ ok: false, error: e.song.error });
      });
    });

    const song = await engine.createFromPhoto({ photoPath: PHOTO, vocalPref: 'female' });
    expect(song.spec.title.length).toBeGreaterThan(0);
    expect(song.spec.caption).toMatch(/Global Metadata/);
    expect(song.spec.lyrics).toMatch(/\[(verse|chorus)\]/i);
    expect(stages).toEqual(['preparing', 'looking', 'writing', 'studio']);

    const result = await done;
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    const final = await engine.songs.byId(song.id);
    expect(final?.status).toBe('done');
    const stat = await fs.stat(final!.outputPath!);
    expect(stat.size).toBeGreaterThan(100_000);
  });
});
