// The bundled examples folder itself (examples/ in the repo): every file the
// manifest names must be there. The importer forgives a missing take (a broken
// copy must not block the first boot), so a take left out of the repo, e.g. by
// an ignore rule, would otherwise ship unnoticed and cost every starter song
// its "Keep the rest" edits.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AUDIO_FRAMES_PER_SECOND } from '@engine/domain/types';
import type { ExamplesManifest } from '@engine/examples';

const DIR = fileURLToPath(new URL('../../../examples/', import.meta.url));
const manifest = JSON.parse(readFileSync(DIR + 'examples.json', 'utf8')) as ExamplesManifest;

/** A take file's header (safetensors): tensor name -> dtype and shape, plus metadata. */
function takeHeader(file: string): Record<string, { dtype: string; shape: number[] }> & { __metadata__?: Record<string, string> } {
  const bytes = readFileSync(file);
  const length = Number(bytes.readBigUInt64LE(0));
  return JSON.parse(bytes.subarray(8, 8 + length).toString('utf8'));
}

describe('the examples folder', () => {
  it('holds every file its manifest names', () => {
    expect(manifest.songs.length).toBeGreaterThan(0);
    for (const song of manifest.songs) {
      for (const file of [song.audio, song.photo.file, song.take]) {
        expect(file, `${song.spec.title}: a file name is missing from the manifest`).toBeTruthy();
        expect(existsSync(DIR + file), `examples/${file} is missing`).toBe(true);
      }
    }
  });

  it('ships a take of the right length with every song', () => {
    for (const song of manifest.songs) {
      const header = takeHeader(DIR + song.take);
      const frames = Math.round((song.actualSec ?? 0) * AUDIO_FRAMES_PER_SECOND);
      expect(header.__metadata__).toMatchObject({ format: 'stillsong2-take', version: '1' });
      expect(header.codes, song.take).toMatchObject({ dtype: 'I16', shape: [frames] });
      expect(header.latent, song.take).toMatchObject({ dtype: 'F32', shape: [64, frames] });
    }
  });
});
