// Canvas drawings entering the pipeline as photo assets: bytes-import with
// real sha dedupe, source:'drawing' on the row, the drawing-variant vision
// prompt, and the {card, source} cache guard (sha-deduped assets must never
// reuse a card from the other prompt).

import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/index';
import { flush, makePorts } from './fakes';

const DRAWING_CARD = `Subjects: a stick figure holding a sword, a dragon with a heart above it.
What's happening: the figure faces the dragon but the heart hangs between them.
Story they want to tell: a fight that is really a friendship.
Visible text: none.
Mood words: brave, tender, playful, bold, warm.
Song angles: 1. An anthem about befriending what scares you.`;

const GOOD_CAPTION = `Global Metadata: Acoustic folk, slow waltz feel, warm and quiet. Opens hushed and patient, warms through the middle, ends unresolved. Early-morning listening. Narrow soundstage, warm mids, gentle dynamics.

Vocal Details: Female lead, soft warm alto, intimate conversational delivery, lifting slightly in the chorus. No backing vocals. Subtle room reverb.

Arrangement: Intro: lone fingerpicked acoustic guitar. Verse: guitar under the vocal. Chorus: strumming widens, vocal lifts. Outro: the opening figure returns and rings out.`;

const GOOD_LYRICS = `[intro]
[verse]
Rope on the cleat pulled tight
Water the colour of light
[chorus]
Wait for me where the water bends
I always come back when the morning ends
[outro]`;

const compose = (title: string) => JSON.stringify({ title, caption: GOOD_CAPTION, lyrics: GOOD_LYRICS, notes: 'n' });

const png = (content: string) => Buffer.from(content).toString('base64');

describe('Engine.importDrawing', () => {
  it('writes the bytes, inserts a drawing-source asset, and makes a thumbnail', async () => {
    const { ports, files } = makePorts();
    const engine = await Engine.create(ports);
    const b64 = png('fake-png-bytes');
    const asset = await engine.importDrawing(b64);
    expect(asset.source).toBe('drawing');
    expect(asset.localPath).toMatch(/^C:\\lib\\photos\/[0-9a-f]{16}\.png$/);
    expect(asset.originalName).toBe('drawing.png');
    expect(asset.thumbPath).toBeTruthy();
    expect(files.written).toEqual([{ relPath: asset.localPath.replace(/^C:\\lib\\/, ''), b64 }]);
  });

  it('dedupes identical bytes to one asset; different bytes get their own', async () => {
    const { ports } = makePorts();
    const engine = await Engine.create(ports);
    const a = await engine.importDrawing(png('same-drawing'));
    const b = await engine.importDrawing(png('same-drawing'));
    const c = await engine.importDrawing(png('other-drawing'));
    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
  });

  it('creates a song from a drawing with the drawing prompt end to end', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const asset = await engine.importDrawing(png('story-drawing'));
    world.llmResponses = [DRAWING_CARD, compose('Sword and Heart')];

    const song = await engine.createFromPhoto({
      photoPath: asset.localPath,
      photoId: asset.id,
      vocalPref: 'female',
    });
    expect(song.spec.photo?.id).toBe(asset.id);
    expect(song.spec.photo?.source).toBe('drawing');

    // Vision call carries the drawing variant, not the photo one.
    const vision = world.llmCalls[0].messages.find((m) => Array.isArray(m.content))!;
    const text = (vision.content as { type: string; text?: string }[]).find((p) => p.type === 'text')!.text!;
    expect(text).toContain('nothing in a drawing is accidental');
    expect(text).toContain('stick figure holding a sword');
    expect(text).not.toContain('Era & culture cues');

    // Compose brief speaks of the drawing, and feeds the drawing card through.
    const composeMsg = world.llmCalls[1].messages.find((m) => m.role === 'user')!.content as string;
    expect(composeMsg).toContain('ABOUT this drawing');
    expect(composeMsg).toContain('strongest song angle from the drawing card');
    expect(composeMsg).toContain(DRAWING_CARD);

    world.historyStatus = 'success';
    await flush();
    await clock.advance(10_000);
    await flush();
    expect((await engine.songs.byId(song.id))?.status).toBe('done');
  });

  it('re-analyzes when the cached card came from the other prompt variant', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const asset = await engine.importDrawing(png('re-analyzed-drawing'));
    // A legacy {card} cache predates the split and was always the photo prompt.
    await engine.photos.setAnalysis(asset.id, JSON.stringify({ card: 'stale photo card' }));

    world.llmResponses = [DRAWING_CARD, compose('Fresh Eyes')];
    const song = await engine.createFromPhoto({ photoPath: asset.localPath, photoId: asset.id, vocalPref: 'female' });
    // Both scripted responses consumed: the stale card was not reused.
    expect(world.llmResponses.length).toBe(0);
    const cached = JSON.parse((await engine.photos.byId(asset.id))!.analysisJson!) as { card: string; source: string };
    expect(cached).toEqual({ card: DRAWING_CARD, source: 'drawing' });

    world.historyStatus = 'success';
    await flush();
    await clock.advance(10_000);
    await flush();
    expect((await engine.songs.byId(song.id))?.status).toBe('done');
  });
});
