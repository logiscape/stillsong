// Bundled example songs: imported once into an empty library through the
// ordinary repos (fresh thumbnail, absolute paths made on this machine,
// analysis card cached), never into a library that has songs, and never
// again after the marker is written.

import { describe, expect, it } from 'vitest';
import { Engine } from '@engine/index';
import { EXAMPLES_SEEDED_KEY, type ExamplesManifest } from '@engine/examples';
import { defaultSpec, MODEL_FILES } from '@engine/domain/types';
import { makePorts } from './fakes';

const DIR = 'C:\\res\\examples';
const b64 = (s: string) => Buffer.from(s).toString('base64');

function spec(title: string, seed: string) {
  const { photo: _photo, ...rest } = defaultSpec(MODEL_FILES.ditFp16);
  return {
    ...rest,
    title,
    caption: 'Global Metadata: quiet folk.',
    lyrics: '[intro]\n[verse]\nA line\n[outro]',
    targetSec: 120,
    durationSec: 300,
    seed,
    steps: 40,
    vocalPref: 'female' as const,
  };
}

const MANIFEST: ExamplesManifest = {
  version: 1,
  songs: [
    {
      id: 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
      spec: spec('Moonlit', '111'),
      actualSec: 191.5,
      hitCeiling: false,
      photo: { file: 'moonlit-forest.jpg', source: 'photo', analysis: { card: 'Subjects: bare trees.', source: 'photo' } },
      audio: 'moonlit.mp3',
      codes: 'moonlit.codes.bin',
    },
    {
      id: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
      spec: spec('Spark', '222'),
      actualSec: 159.6,
      hitCeiling: false,
      photo: { file: 'spark.png', source: 'drawing', analysis: { card: 'Subjects: a speck.', source: 'drawing' } },
      audio: 'spark.mp3',
    },
  ],
};

function withExamples(files: ReturnType<typeof makePorts>['files']) {
  files.examplesRoot = DIR;
  files.base64ByPath[`${DIR}\\examples.json`] = b64(JSON.stringify(MANIFEST));
  files.base64ByPath[`${DIR}\\spark.png`] = b64('png-bytes');
}

const seededFlag = (db: ReturnType<typeof makePorts>['ports']['db']) =>
  db.select<{ value: string }>(`SELECT value FROM setting WHERE key = ?`, [EXAMPLES_SEEDED_KEY]);

describe('bundled examples', () => {
  it('seeds an empty library once, through the repos', async () => {
    const { ports, files } = makePorts();
    withExamples(files);
    const engine = await Engine.create(ports);

    const songs = await engine.songs.list();
    expect(songs.map((s) => s.spec.title)).toEqual(['Moonlit', 'Spark']); // manifest order, newest first
    expect(songs.map((s) => s.id)).toEqual(MANIFEST.songs.map((s) => s.id));
    expect(songs.every((s) => s.status === 'done')).toBe(true);

    const moonlit = songs[0];
    expect(moonlit.outputPath).toBe(`C:\\lib\\songs/${moonlit.id}.mp3`);
    expect(moonlit.codesPath).toBe(`C:\\lib\\songs/${moonlit.id}.codes.bin`);
    expect(moonlit.actualSec).toBe(191.5);
    expect(moonlit.hitCeiling).toBe(false);
    expect(moonlit.spec.seed).toBe('111');
    expect(files.imported).toContainEqual({ src: `${DIR}\\moonlit.mp3`, relPath: `songs/${moonlit.id}.mp3` });
    expect(files.imported).toContainEqual({ src: `${DIR}\\moonlit-forest.jpg`, relPath: 'photos/moonlit-forest.jpg' });

    // The photo is a real asset row with a thumbnail and the cached card.
    const photo = moonlit.spec.photo!;
    expect(photo.thumbPath).toBe('C:\\lib\\thumbs/moonlit-forest.webp');
    expect(photo.originalName).toBe('moonlit-forest.jpg');
    expect(JSON.parse(photo.analysisJson!)).toEqual({ card: 'Subjects: bare trees.', source: 'photo' });
    expect((await engine.photos.byId(photo.id))?.analysisJson).toBe(photo.analysisJson);

    // The drawing went through the sketchpad path: bytes written, source kept.
    const spark = songs[1];
    expect(spark.spec.photo?.source).toBe('drawing');
    expect(spark.codesPath).toBeUndefined();
    expect(files.written).toContainEqual({ relPath: expect.stringMatching(/^photos\/.*\.png$/), b64: b64('png-bytes') });

    // No job rows: nothing to recover or run.
    expect(await engine.jobs.queued()).toEqual([]);
    expect(await seededFlag(ports.db)).toEqual([{ value: '1' }]);

    // A second boot on the same library adds nothing.
    const again = await Engine.create(ports);
    expect((await again.songs.list()).length).toBe(2);
  });

  it('does nothing when no examples are bundled, and stays unmarked', async () => {
    const { ports, files } = makePorts();
    const engine = await Engine.create(ports);
    expect(await engine.songs.list()).toEqual([]);
    expect(await seededFlag(ports.db)).toEqual([]);

    // Examples showing up later (a build that has them) still seed.
    withExamples(files);
    const later = await Engine.create(ports);
    expect((await later.songs.list()).length).toBe(2);
  });

  it('never touches a library that already has songs, and remembers that', async () => {
    const { ports, files } = makePorts();
    const engine = await Engine.create(ports);
    const mine = await engine.songs.insertFinished({
      id: 'c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3',
      spec: spec('Mine', '333'),
      createdAt: 1,
      outputPath: 'C:\\lib\\songs\\mine.mp3',
    });

    withExamples(files);
    const boot = await Engine.create(ports);
    expect((await boot.songs.list()).map((s) => s.id)).toEqual([mine.id]);
    expect(await seededFlag(ports.db)).toEqual([{ value: 'skipped' }]);

    // Emptying the library afterwards does not bring the examples back.
    await boot.deleteSong(mine.id);
    const empty = await Engine.create(ports);
    expect(await empty.songs.list()).toEqual([]);
  });

  it('deleting an example removes its files and its photo like any song', async () => {
    const { ports, files } = makePorts();
    withExamples(files);
    const engine = await Engine.create(ports);
    const [moonlit] = await engine.songs.list();
    const photoId = moonlit.spec.photo!.id;

    await engine.deleteSong(moonlit.id);
    expect(await engine.songs.byId(moonlit.id)).toBeNull();
    expect(await engine.photos.byId(photoId)).toBeNull();
    expect(files.removed).toEqual(expect.arrayContaining([moonlit.outputPath, moonlit.codesPath, 'C:\\lib\\photos/moonlit-forest.jpg']));

    // Still gone on the next boot.
    const next = await Engine.create(ports);
    expect((await next.songs.list()).map((s) => s.spec.title)).toEqual(['Spark']);
  });
});
