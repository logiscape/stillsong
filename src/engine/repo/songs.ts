import type { Db } from '../ports';
import { newId } from '../ports';
import type { Song, SongSpec, SongStatus } from '../domain/types';

/** What the encoder reported: natural end (actualSec) or ran into the duration cap. */
export interface ComposedLength {
  actualSec?: number;
  hitCeiling: boolean;
}

interface Row {
  id: string;
  created_at: number;
  status: string;
  output_path: string | null;
  actual_sec: number | null;
  hit_ceiling: number | null;
  render_ms: number | null;
  comfy_prompt_id: string | null;
  error: string | null;
  parent_id: string | null;
  spec_json: string;
  codes_path: string | null;
  prefix_song_id: string | null;
  prefix_frames: number | null;
  replaces_song_id: string | null;
  replace_verified: number | null;
}

/** Render instruction: teacher-force `songId`'s saved composition for `frames` frames (undefined = all). */
export interface RenderPrefix {
  songId: string;
  frames?: number;
}

/** Rows written before the target/cap split only have durationSec (which was the cap). */
function normalizeSpec(spec: SongSpec): SongSpec {
  return spec.targetSec == null ? { ...spec, targetSec: spec.durationSec } : spec;
}

function rowToSong(r: Row): Song {
  return {
    id: r.id,
    createdAt: r.created_at,
    spec: normalizeSpec(JSON.parse(r.spec_json) as SongSpec),
    status: r.status as SongStatus,
    outputPath: r.output_path ?? undefined,
    actualSec: r.actual_sec ?? undefined,
    hitCeiling: r.hit_ceiling == null ? undefined : r.hit_ceiling === 1,
    renderMs: r.render_ms ?? undefined,
    comfyPromptId: r.comfy_prompt_id ?? undefined,
    error: r.error ?? undefined,
    parentId: r.parent_id ?? undefined,
    codesPath: r.codes_path ?? undefined,
    prefixSongId: r.prefix_song_id ?? undefined,
    prefixFrames: r.prefix_frames ?? undefined,
    replacesSongId: r.replaces_song_id ?? undefined,
    replaceVerified: r.replace_verified === 1 || undefined,
  };
}

export class SongRepo {
  constructor(private readonly db: Db) {}

  async create(
    spec: SongSpec, now: number, parentId?: string, status: SongStatus = 'queued', prefix?: RenderPrefix, replacesSongId?: string,
  ): Promise<Song> {
    const id = newId();
    await this.db.execute(
      `INSERT INTO song (id, created_at, title, idea_text, photo_asset_id, caption, lyrics, instrumental, duration_sec,
         seed, dit_file, tiled_decode, steps, cfg, format, quality, status, parent_id, spec_json, prefix_song_id, prefix_frames,
         replaces_song_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mp3', ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, now, spec.title, spec.idea || null, spec.photo?.id ?? null, spec.caption, spec.lyrics,
        spec.instrumental ? 1 : 0, spec.durationSec, spec.seed, spec.ditFile, spec.tiledDecode ? 1 : 0,
        spec.steps, spec.cfg, spec.quality, status, parentId ?? null, JSON.stringify(spec),
        prefix?.songId ?? null, prefix?.frames ?? null, replacesSongId ?? null,
      ],
    );
    return (await this.byId(id))!;
  }

  async byId(id: string): Promise<Song | null> {
    const rows = await this.db.select<Row>(`SELECT * FROM song WHERE id = ?`, [id]);
    return rows.length ? rowToSong(rows[0]) : null;
  }

  /** Every song id regardless of status (the output sweep's keep-list). */
  async allIds(): Promise<string[]> {
    const rows = await this.db.select<{ id: string }>(`SELECT id FROM song`);
    return rows.map((r) => r.id);
  }

  async list(limit = 500): Promise<Song[]> {
    const rows = await this.db.select<Row>(`SELECT * FROM song ORDER BY created_at DESC LIMIT ?`, [limit]);
    return rows.map(rowToSong);
  }

  async setStatus(id: string, status: SongStatus, error?: string): Promise<void> {
    await this.db.execute(`UPDATE song SET status = ?, error = ? WHERE id = ?`, [status, error ?? null, id]);
  }

  async setComfyPromptId(id: string, promptId: string): Promise<void> {
    await this.db.execute(`UPDATE song SET comfy_prompt_id = ? WHERE id = ?`, [promptId, id]);
  }

  async setOutput(id: string, outputPath: string, renderMs?: number, composed?: ComposedLength, codesPath?: string): Promise<void> {
    await this.db.execute(
      `UPDATE song SET output_path = ?, render_ms = ?, actual_sec = ?, hit_ceiling = ?, codes_path = ?, status = 'done', error = NULL WHERE id = ?`,
      [outputPath, renderMs ?? null, composed?.actualSec ?? null, composed ? (composed.hitCeiling ? 1 : 0) : null, codesPath ?? null, id],
    );
  }

  async setTitle(id: string, title: string): Promise<void> {
    const song = await this.byId(id);
    if (!song) return;
    const spec = { ...song.spec, title };
    await this.db.execute(`UPDATE song SET title = ?, spec_json = ? WHERE id = ?`, [title, JSON.stringify(spec), id]);
  }

  /** Songs still referencing a photo asset (drives photo garbage collection). */
  async countByPhoto(photoAssetId: string): Promise<number> {
    const rows = await this.db.select<{ n: number }>(`SELECT COUNT(*) as n FROM song WHERE photo_asset_id = ?`, [photoAssetId]);
    return rows[0]?.n ?? 0;
  }

  /**
   * Point a deleted song's children at its parent so version lineage survives
   * deleting a middle link (grandchildren keep a root to group under).
   */
  async reparentChildren(id: string, newParentId: string | null): Promise<void> {
    await this.db.execute(`UPDATE song SET parent_id = ? WHERE parent_id = ?`, [newParentId, id]);
  }

  /**
   * Make `song` stand where `old` stood: same date (so the version order
   * holds), same parent, same title (a rename during the re-take wins), and
   * old's children now hang off it. Idempotent, and leaves `replaces_song_id`
   * set: the caller removes old's files and row, then clears the marker last
   * so a crash anywhere in between is finished by the boot sweep.
   */
  async takePlaceOf(song: Song, old: Song): Promise<void> {
    const spec = { ...song.spec, title: old.spec.title };
    await this.db.execute(
      `UPDATE song SET created_at = ?, parent_id = ?, title = ?, spec_json = ? WHERE id = ?`,
      [old.createdAt, old.parentId ?? null, old.spec.title, JSON.stringify(spec), song.id],
    );
    await this.reparentChildren(old.id, song.id);
  }

  /** Durable "same composition" verdict, written before the original loses anything. */
  async markReplaceVerified(id: string): Promise<void> {
    await this.db.execute(`UPDATE song SET replace_verified = 1 WHERE id = ?`, [id]);
  }

  /** The replacement is complete (or abandoned): the re-take is an ordinary song from here on. */
  async clearReplaces(id: string): Promise<void> {
    await this.db.execute(`UPDATE song SET replaces_song_id = NULL, replace_verified = NULL WHERE id = ?`, [id]);
  }

  /** An "Enhance quality" re-take of `songId` that is still queued or rendering, if any. */
  async pendingReplacementOf(songId: string): Promise<Song | null> {
    const rows = await this.db.select<Row>(
      `SELECT * FROM song WHERE replaces_song_id = ? AND status IN ('queued', 'running') ORDER BY created_at LIMIT 1`,
      [songId],
    );
    return rows.length ? rowToSong(rows[0]) : null;
  }

  /** Finished re-takes whose swap never completed (crash between harvest and replacement). */
  async unfinishedReplacements(): Promise<Song[]> {
    const rows = await this.db.select<Row>(`SELECT * FROM song WHERE replaces_song_id IS NOT NULL AND status = 'done'`);
    return rows.map(rowToSong);
  }

  async delete(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM song WHERE id = ?`, [id]);
  }
}
