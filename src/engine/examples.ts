// Example songs. The repo's examples/ folder (three finished songs, their
// photos and compositions, under CC BY 4.0 — see examples/LICENSE.md) ships
// as a Tauri resource, and on the first boot that finds an empty library the
// engine imports it through the ordinary repos: the photo lands in
// library/photos with a freshly rendered thumbnail, the MP3 and codes in
// library/songs, the song row as 'done' with a fixed, manifest-chosen id.
// Rows are created on the user's machine (never copied from a pre-built
// database) because every path in the database is absolute.
//
// It runs once. A marker setting records the outcome, so a library the user
// has since emptied stays empty and a deleted example stays deleted; a library
// that already has songs is never touched. Ids are fixed so a boot that fails
// midway (the marker is only written on success) resumes without duplicates.

import type { Clock, FileStore } from './ports';
import { b64ToBytes } from './comfy/codes';
import type { PhotoAsset, SongSpec } from './domain/types';
import type { PhotoRepo } from './repo/photos';
import type { SongRepo } from './repo/songs';
import type { SettingsRepo } from './repo/settings';

export const EXAMPLES_MANIFEST = 'examples.json';
/** Setting key: the manifest version imported, or 'skipped' when the library already had songs. */
export const EXAMPLES_SEEDED_KEY = 'examplesSeeded';

export interface ExamplePhoto {
  /** File name inside the examples dir. */
  file: string;
  source: 'photo' | 'drawing';
  /** The cached vision card, exactly as `PhotoRepo.setAnalysis` stores it. */
  analysis: { card: string; source: 'photo' | 'drawing' };
}

export interface ExampleSong {
  /** Fixed 32-hex id (the song keeps it in every library). */
  id: string;
  spec: Omit<SongSpec, 'photo'>;
  actualSec?: number;
  hitCeiling: boolean;
  photo: ExamplePhoto;
  /** MP3 file name inside the examples dir. */
  audio: string;
  /** SSC1 composition file name inside the examples dir (enables exact continuations and same-seed edits). */
  codes?: string;
}

export interface ExamplesManifest {
  version: number;
  songs: ExampleSong[];
}

/** Joins with the separator the directory already uses (the Rust shell hands back Windows paths). */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + name;
}

export interface SeedDeps {
  files: FileStore;
  clock: Clock;
  songs: SongRepo;
  photos: PhotoRepo;
  settings: SettingsRepo;
}

/**
 * Imports the bundled examples into an empty library. Returns how many songs
 * were added (0 when already seeded, skipped, or no examples are bundled).
 */
export async function seedExamples(deps: SeedDeps): Promise<number> {
  const { files, clock, songs, photos, settings } = deps;
  if (await settings.getFlag(EXAMPLES_SEEDED_KEY)) return 0;
  const dir = await files.examplesDir();
  if (!dir) return 0;
  if ((await songs.allIds()).length > 0) {
    await settings.setFlag(EXAMPLES_SEEDED_KEY, 'skipped');
    return 0;
  }

  const manifestB64 = await files.readBase64(joinPath(dir, EXAMPLES_MANIFEST));
  const manifest = JSON.parse(new TextDecoder().decode(b64ToBytes(manifestB64))) as ExamplesManifest;
  if (!Array.isArray(manifest.songs)) throw new Error('examples.json has no songs');

  const now = clock.now();
  let added = 0;
  for (const [i, ex] of manifest.songs.entries()) {
    if (await songs.byId(ex.id)) continue; // a previous attempt got this far
    // Manifest order is newest-first in the Sanctuary.
    const createdAt = now - i * 1000;
    const photo = await importExamplePhoto(ex.photo, dir, files, photos, createdAt);
    const outputPath = await files.importFile(joinPath(dir, ex.audio), `songs/${ex.id}.mp3`);
    const codesPath = ex.codes ? await files.importFile(joinPath(dir, ex.codes), `songs/${ex.id}.codes.bin`) : undefined;
    await songs.insertFinished({
      id: ex.id,
      spec: { ...ex.spec, photo },
      createdAt,
      outputPath,
      codesPath,
      actualSec: ex.actualSec,
      hitCeiling: ex.hitCeiling,
    });
    added += 1;
  }
  await settings.setFlag(EXAMPLES_SEEDED_KEY, String(manifest.version));
  return added;
}

async function importExamplePhoto(
  ex: ExamplePhoto,
  dir: string,
  files: FileStore,
  photos: PhotoRepo,
  now: number,
): Promise<PhotoAsset> {
  const src = joinPath(dir, ex.file);
  // A drawing goes through the sketchpad's own path so the row carries
  // source='drawing' (it steers the vision prompt on a later re-look).
  const asset =
    ex.source === 'drawing'
      ? await photos.importBytes(await files.readBase64(src), 'drawing.png', now)
      : await photos.import(src, now);
  await photos.setAnalysis(asset.id, JSON.stringify(ex.analysis));
  return (await photos.byId(asset.id)) ?? { ...asset, analysisJson: JSON.stringify(ex.analysis) };
}
