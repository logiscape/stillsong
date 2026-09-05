// The Stillsong overlay integration: SSC1 codes blobs, the edit-prefix cut
// heuristic, graph selection, and the engine round-trip (capture on render,
// teacher-forced prefix on re-run, graceful degradation).

import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/index';
import { AUDIO_FRAMES_PER_SECOND, CAP, defaultSpec } from '@engine/domain/types';
import { editPrefixFrames } from '@engine/domain/editPrefix';
import { b64ToBytes, bytesToB64, parseCodesHeader, sliceCodes } from '@engine/comfy/codes';
import { buildGraph } from '@engine/comfy/graphBuilder';
import { flush, makePorts } from './fakes';

/** SSC1 blob with `frames` frames of 8 codebooks (values are frame*8+book, mod u16). */
function testCodes(frames: number, books = 8): Uint8Array {
  const bytes = new Uint8Array(12 + frames * books * 2);
  const view = new DataView(bytes.buffer);
  bytes.set([0x53, 0x53, 0x43, 0x31]); // "SSC1"
  view.setUint16(4, 1, true);
  view.setUint16(6, books, true);
  view.setUint32(8, frames, true);
  for (let i = 0; i < frames * books; i++) view.setUint16(12 + i * 2, i & 0xffff, true);
  return bytes;
}

const spec = () => ({
  ...defaultSpec(),
  title: 'Test',
  caption: 'Global Metadata: a\n\nVocal Details: b\n\nArrangement: c',
  lyrics: '[verse]\nhello',
  targetSec: 20,
  durationSec: 20,
  seed: '7',
});

describe('SSC1 codes blobs', () => {
  it('parses its header and rejects junk', () => {
    const blob = testCodes(10);
    expect(parseCodesHeader(blob)).toEqual({ version: 1, books: 8, frames: 10 });
    expect(() => parseCodesHeader(blob.subarray(0, 20))).toThrow(/length/);
    expect(() => parseCodesHeader(new TextEncoder().encode('not an SSC1 blob'))).toThrow(/magic/);
  });

  it('slices a frame prefix, preserving the body bytes', () => {
    const blob = testCodes(10);
    const sliced = sliceCodes(blob, 4);
    expect(parseCodesHeader(sliced).frames).toBe(4);
    expect([...sliced.subarray(12)]).toEqual([...blob.subarray(12, 12 + 4 * 8 * 2)]);
    // Asking for >= all frames returns the blob unchanged.
    expect(sliceCodes(blob, 10)).toBe(blob);
    expect(sliceCodes(blob, 99)).toBe(blob);
  });

  it('round-trips through base64', () => {
    const blob = testCodes(700); // > one 32k chunk of the b64 encoder
    expect([...b64ToBytes(bytesToB64(blob))]).toEqual([...blob]);
  });
});

describe('editPrefixFrames', () => {
  const lyrics = '[verse]\nline one\nline two\n[chorus]\ngold in the light\n[outro]';
  const total = 1000;

  it('keeps everything when the lyrics are unchanged', () => {
    expect(editPrefixFrames(lyrics, lyrics, total)).toBe(Infinity);
  });

  it('cuts before the edited section, erring early', () => {
    const edited = lyrics.replace('gold', 'green');
    const frames = editPrefixFrames(lyrics, edited, total);
    // verse 2 lines (9s) of 9 + 4.5 + 15 (wordless outro) = 28.5s total, * 0.9 safety
    expect(frames).toBeGreaterThan(0);
    expect(frames).toBeLessThan(total * 0.5);
    expect(frames).toBe(Math.floor((9 / 28.5) * total * 0.9));
  });

  it('keeps nothing when the opening section or preamble changed', () => {
    expect(editPrefixFrames(lyrics, lyrics.replace('line one', 'line 1'), total)).toBe(0);
    expect(editPrefixFrames('loose line\n' + lyrics, 'other line\n' + lyrics, total)).toBe(0);
  });

  it('keeps the whole original when sections are only appended', () => {
    expect(editPrefixFrames(lyrics, lyrics + '\n[bridge]\nnew words', total)).toBe(total);
  });

  it('cuts at a removed section', () => {
    const removed = '[verse]\nline one\nline two\n[chorus]\ngold in the light';
    const frames = editPrefixFrames(lyrics, removed, total);
    expect(frames).toBe(Math.floor(((9 + 4.5) / 28.5) * total * 0.9));
  });
});

describe('buildGraph with the overlay', () => {
  it('uses the official node without opts and the overlay node with them', () => {
    const plain = buildGraph(spec(), 'audio/stillsong/x').graph;
    expect(plain.encode.class_type).toBe('MiniMaxMusic3TextEncode');
    expect(plain.encode.inputs.prefix_codes).toBeUndefined();

    const g = buildGraph(spec(), 'audio/stillsong/x', { kvCapacityFrames: 7500, prefixCodesB64: 'QUJD' }).graph;
    expect(g.encode.class_type).toBe('StillsongMusic3TextEncode');
    expect(g.encode.inputs).toMatchObject({
      seed: 7,
      max_duration: 20,
      save_codes_prefix: 'audio/stillsong/x',
      prefix_codes: 'QUJD',
      kv_capacity_frames: 7500,
    });
    // Same node id either way — progress phases key on it.
    expect(Object.keys(g)).toContain('encode');
  });
});

describe('render tracking when ComfyUI dies', () => {
  it('fails the song after consecutive history-poll transport failures', async () => {
    const { ports, world, clock } = makePorts();
    const engine = await Engine.create(ports);
    const song = await engine.enqueueSong(spec());
    await flush();
    expect(world.submittedGraph).not.toBeNull();

    // One healthy poll while the job runs…
    await clock.advance(10_000);
    expect((await engine.songs.byId(song.id))?.status).toBe('running');

    // …then the server dies. Two failures keep waiting; the third settles.
    world.historyStatus = 'down';
    await clock.advance(10_000);
    await clock.advance(10_000);
    expect((await engine.songs.byId(song.id))?.status).toBe('running');
    await clock.advance(10_000);
    await flush();

    const failed = await engine.songs.byId(song.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('The studio stopped answering mid-song.');
  });
});

describe('engine with the overlay', () => {
  it('captures codes on render and teacher-forces them on a prefixed re-run', async () => {
    const { ports, world, clock, files, runtime } = makePorts();
    world.stillsongNode = true;
    const engine = await Engine.create(ports);
    expect(engine.hasStillsongEncode).toBe(true);

    const song = await engine.enqueueSong(spec());
    await flush();
    expect(world.submittedGraph?.encode.class_type).toBe('StillsongMusic3TextEncode');
    expect(world.submittedGraph?.encode.inputs.save_codes_prefix).toBe(`audio/stillsong/${song.id.slice(0, 8)}`);
    expect(world.submittedGraph?.encode.inputs.prefix_codes).toBe('');
    // 16 GB tier: KV capacity pinned to the cap ceiling.
    expect(world.submittedGraph?.encode.inputs.kv_capacity_frames).toBe(CAP.max * AUDIO_FRAMES_PER_SECOND);

    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    const done = await engine.songs.byId(song.id);
    expect(done?.status).toBe('done');
    expect(done?.codesPath).toBe(`C:\\lib\\songs/${song.id}.codes.bin`);
    expect(files.downloaded.some((u) => u.includes('x_00001_.codes.bin'))).toBe(true);
    expect(runtime.removedOutputs.map((f) => f.filename).sort()).toEqual(['x_00001_.codes.bin', 'x_00001_.mp3']);

    // Re-run forcing the first 4 frames of the saved composition.
    const blob = testCodes(10);
    files.base64Content = bytesToB64(blob);
    await engine.enqueueSong(spec(), song.id, { songId: song.id, frames: 4 });
    await flush();
    const forced = world.submittedGraph?.encode.inputs.prefix_codes as string;
    expect(parseCodesHeader(b64ToBytes(forced)).frames).toBe(4);

    // Full-composition forcing ("Let it finish") sends the blob untouched.
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    await engine.enqueueSong(spec(), song.id, { songId: song.id });
    await flush();
    expect(world.submittedGraph?.encode.inputs.prefix_codes).toBe(bytesToB64(blob));
  });

  it('recovers when the startup probe raced a booting ComfyUI', async () => {
    const { ports, world, clock } = makePorts();
    // ComfyUI "not up yet" at engine start: the probe 404s.
    world.stillsongNode = false;
    const engine = await Engine.create(ports);
    expect(engine.hasStillsongEncode).toBe(false);

    // By render time ComfyUI is serving (the arbiter has already reached it).
    world.stillsongNode = true;
    await engine.enqueueSong(spec());
    await flush();
    expect(world.submittedGraph?.encode.class_type).toBe('StillsongMusic3TextEncode');
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
  });

  it('degrades to a free render when the codes are missing or unreadable', async () => {
    const { ports, world, clock, files } = makePorts();
    world.stillsongNode = true;
    const engine = await Engine.create(ports);
    const song = await engine.enqueueSong(spec());
    await flush();
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();

    // Unreadable blob (readBase64 returns junk by default) — render proceeds unforced.
    await engine.enqueueSong(spec(), song.id, { songId: song.id });
    await flush();
    expect(world.submittedGraph?.encode.inputs.prefix_codes).toBe('');

    // Missing file — same.
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    files.existing = false;
    await engine.enqueueSong(spec(), song.id, { songId: song.id });
    await flush();
    expect(world.submittedGraph?.encode.inputs.prefix_codes).toBe('');
  });

  it('deletes the codes file with the song', async () => {
    const { ports, world, clock, files } = makePorts();
    world.stillsongNode = true;
    const engine = await Engine.create(ports);
    const song = await engine.enqueueSong(spec());
    await flush();
    world.historyStatus = 'success';
    await clock.advance(10_000);
    await flush();
    await engine.deleteSong(song.id);
    expect(files.removed).toContain(`C:\\lib\\songs/${song.id}.codes.bin`);
  });
});
