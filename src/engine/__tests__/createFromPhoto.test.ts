// The one-shot creation pipeline against the scripted fake world: photo in,
// rendered song out, with the auto-accept, the silent repair round, the one
// full re-compose retry, and the instrumental tag-only contract.

import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/index';
import { instrumentalSkeleton } from '@engine/cowriter/cowriter';
import { renderCap } from '@engine/domain/duration';
import { DURATION, RENDER_STEPS } from '@engine/domain/types';
import { flush, makePorts } from './fakes';

const PHOTO_CARD = `Subjects: an old rowboat tied to a dock.
Setting: a still lake at dawn.
Time of day & light: first light, soft golden mist.
Visible text: none.
Story: someone left at first light and the boat waits.
Mood words: quiet, patient, amber, still, tender.
Era & culture cues: timeless.
Song angles: 1. A waltz from the boat's point of view.`;

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

const INSTRUMENTAL_CAPTION = `Global Metadata: Instrumental, no vocals. Ambient felt piano, slow and unhurried. Begins calm, gathers warmth, settles to stillness. Early-morning listening. Soft hall reverb, wide gentle soundstage.

Vocal Details: Instrumental, no vocals, no humming. A felt piano carries the lead melody.

Arrangement: Intro: sparse felt-piano notes. Instrumental sections: flowing arpeggios with a simple melody above, strings gathering underneath. Solo: a cello takes the melody. Outro: the piano slows to a final sustained chord.`;

const BAD_CAPTION = 'just a vibe, no structure at all';

const compose = (title: string, caption: string, lyrics: string) => JSON.stringify({ title, caption, lyrics, notes: 'n' });

describe('Engine.createFromPhoto', () => {
  it('runs photo -> analyze -> compose -> render with zero interaction', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    world.llmResponses = [PHOTO_CARD, compose('First Light', GOOD_CAPTION, GOOD_LYRICS)];

    const stages: string[] = [];
    let revealedTitle: string | undefined;
    engine.on((e) => {
      if (e.kind === 'creation_stage') {
        stages.push(e.stage);
        if (e.detail?.title) revealedTitle = e.detail.title;
      }
    });

    const song = await engine.createFromPhoto({ photoPath: 'C:\\pics\\boat.jpg', vocalPref: 'female', language: 'English' });
    expect(stages).toEqual(['preparing', 'looking', 'writing', 'studio']);
    expect(revealedTitle).toBe('First Light');
    expect(song.spec.title).toBe('First Light');
    expect(song.spec.photo?.thumbPath).toBeTruthy();
    expect(song.spec.vocalPref).toBe('female');
    expect(song.spec.targetSec).toBe(DURATION.default);
    expect(song.spec.durationSec).toBe(renderCap(DURATION.default, GOOD_LYRICS));
    expect(song.spec.steps).toBe(RENDER_STEPS.fast);

    // The GPU handoff happened in order: LLM started, stopped, then submit.
    const calls = world.events;
    expect(calls.indexOf('startLlm')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('stopLlm')).toBeGreaterThan(calls.indexOf('startLlm'));
    await flush();
    expect(calls.indexOf('submit')).toBeGreaterThan(calls.indexOf('stopLlm'));

    // Vision message shape: image part before text.
    const vision = world.llmCalls[0].messages.find((m) => Array.isArray(m.content));
    const parts = vision!.content as { type: string }[];
    expect(parts[0].type).toBe('image_url');
    expect(parts[1].type).toBe('text');

    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    expect((await engine.songs.byId(song.id))?.status).toBe('done');
  });

  it('makes new songs with the enhanced step count when the setting says so', async () => {
    const { ports, world } = makePorts();
    const engine = await Engine.create(ports);
    await engine.saveSettings({ ...engine.settings, renderMethod: 'enhanced' });
    world.llmResponses = [PHOTO_CARD, compose('First Light', GOOD_CAPTION, GOOD_LYRICS)];
    const song = await engine.createFromPhoto({ photoPath: 'C:\pics\boat.jpg', vocalPref: 'female' });
    expect(song.spec.steps).toBe(RENDER_STEPS.enhanced);
    // The setting survives a reload.
    const again = await Engine.create(ports);
    expect(again.settings.renderMethod).toBe('enhanced');
  });

  it('keeps instrumental songs tag-only end to end', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    // Whatever tag list the LLM returns, the engine replaces it with the
    // deterministic skeleton sized to the target — the sequence is a contract.
    world.llmResponses = [PHOTO_CARD, compose('Still Water', INSTRUMENTAL_CAPTION, '[intro]\n[instrumental]\n[outro]')];

    const song = await engine.createFromPhoto({ photoPath: 'C:\\pics\\boat.jpg', vocalPref: 'instrumental' });
    const skeleton = instrumentalSkeleton(DURATION.default);
    expect(song.spec.instrumental).toBe(true);
    expect(song.spec.lyrics).toBe(skeleton);
    await flush();
    // Never empty lyrics on the wire — the tags are the structural anchor.
    expect(world.submittedGraph?.encode.inputs.lyrics).toBe(skeleton);
    world.historyStatus = 'success';
    await clock.advance(10_000);
  });

  it('re-composes from scratch once when the repair round still fails', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    world.llmResponses = [
      PHOTO_CARD,
      compose('Bad', BAD_CAPTION, GOOD_LYRICS), // compose #1 -> lint errors
      compose('Bad', BAD_CAPTION, GOOD_LYRICS), // silent repair -> still bad
      compose('Third Time', GOOD_CAPTION, GOOD_LYRICS), // full retry -> good
    ];
    const song = await engine.createFromPhoto({ photoPath: 'C:\\pics\\boat.jpg', vocalPref: 'male' });
    expect(song.spec.title).toBe('Third Time');
    expect(world.llmCalls.length).toBe(4); // vision + compose + repair + retry
    world.historyStatus = 'success';
    await clock.advance(10_000);
  });

  it('fails cleanly (and releases the LLM) when composing never lints clean', async () => {
    const { ports, world, runtime } = makePorts();
    const engine = await Engine.create(ports);
    world.llmResponses = [
      PHOTO_CARD,
      compose('Bad', BAD_CAPTION, GOOD_LYRICS),
      compose('Bad', BAD_CAPTION, GOOD_LYRICS),
      compose('Bad', BAD_CAPTION, GOOD_LYRICS),
      compose('Bad', BAD_CAPTION, GOOD_LYRICS),
    ];
    await expect(engine.createFromPhoto({ photoPath: 'C:\\pics\\boat.jpg', vocalPref: 'female' })).rejects.toThrow(/Caption/);
    expect(await engine.songs.list()).toEqual([]);
    // releaseLlm ran even on the failure path.
    expect(runtime.calls.filter((c) => c === 'stopLlm').length).toBeGreaterThan(0);
  });

  it('refuses a second creation while one is in flight', async () => {
    const { ports, world } = makePorts();
    const engine = await Engine.create(ports);
    world.llmResponses = [PHOTO_CARD, compose('One', GOOD_CAPTION, GOOD_LYRICS)];
    const first = engine.createFromPhoto({ photoPath: 'C:\\pics\\boat.jpg', vocalPref: 'female' });
    await expect(engine.createFromPhoto({ photoPath: 'C:\\pics\\other.jpg', vocalPref: 'male' })).rejects.toThrow(/one at a time/);
    await first;
  });

  it('reuses the cached photo analysis on a second creation from the same photo', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    world.llmResponses = [PHOTO_CARD, compose('One', GOOD_CAPTION, GOOD_LYRICS)];
    const a = await engine.createFromPhoto({ photoPath: 'C:\\pics\\boat.jpg', vocalPref: 'female' });
    world.historyStatus = 'success';
    await flush();
    await clock.advance(10_000);
    await flush();
    expect((await engine.songs.byId(a.id))?.status).toBe('done');

    // Same sha256 -> same asset; no new vision call (only one compose).
    world.llmResponses = [compose('Two', GOOD_CAPTION, GOOD_LYRICS)];
    const b = await engine.createFromPhoto({ photoPath: 'C:\\pics\\boat.jpg', vocalPref: 'female' });
    expect(b.spec.photo?.id).toBe(a.spec.photo?.id);
    expect(world.llmResponses.length).toBe(0); // the only scripted response was the compose — no second vision call
    await flush();
    await clock.advance(10_000);
    await flush();
    expect((await engine.songs.byId(b.id))?.status).toBe('done');
  });
});
