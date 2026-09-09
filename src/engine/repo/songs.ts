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
  };
}

export class SongRepo {
  constructor(private readonly db: Db) {}

  async create(spec: SongSpec, now: number, parentId?: string, status: SongStatus = 'queued', prefix?: RenderPrefix): Promise<Song> {
    const id = newId();
    await this.db.execute(
      `INSERT INTO song (id, created_at, title, idea_text, photo_asset_id, caption, lyrics, instrumental, duration_sec,
         seed, dit_file, tiled_decode, steps, cfg, format, quality, status, parent_id, spec_json, prefix_song_id, prefix_frames)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mp3', ?, ?, ?, ?, ?, ?)`,
      [
        id, now, spec.title, spec.idea || null, spec.photo?.id ?? null, spec.caption, spec.lyrics,
        spec.instrumental ? 1 : 0, spec.durationSec, spec.seed, spec.ditFile, spec.tiledDecode ? 1 : 0,
        spec.steps, spec.cfg, spec.quality, status, parentId ?? null, JSON.stringify(spec),
        prefix?.songId ?? null, prefix?.frames ?? null,
      ],
    );
    return (await this.byId(id))!;
  }

  /**
   * A finished song arriving from outside the render pipeline (the bundled
   * examples): caller-chosen id, status 'done', no job row. The files must
   * already be in the library.
   */
  async insertFinished(input: {
    id: string;
    spec: SongSpec;
    createdAt: number;
    outputPath: string;
    codesPath?: string;
    actualSec?: number;
    hitCeiling?: boolean;
  }): Promise<Song> {
    const { id, spec } = input;
    await this.db.execute(
      `INSERT INTO song (id, created_at, title, idea_text, photo_asset_id, caption, lyrics, instrumental, duration_sec,
         seed, dit_file, tiled_decode, steps, cfg, format, quality, status, spec_json,
         output_path, codes_path, actual_sec, hit_ceiling)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mp3', ?, 'done', ?, ?, ?, ?, ?)`,
      [
        id, input.createdAt, spec.title, spec.idea || null, spec.photo?.id ?? null, spec.caption, spec.lyrics,
        spec.instrumental ? 1 : 0, spec.durationSec, spec.seed, spec.ditFile, spec.tiledDecode ? 1 : 0,
        spec.steps, spec.cfg, spec.quality, JSON.stringify(spec),
        input.outputPath, input.codesPath ?? null, input.actualSec ?? null,
        input.hitCeiling == null ? null : input.hitCeiling ? 1 : 0,
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

  /** Versions of `songId` that are still queued or rendering, oldest first. */
  async pendingChildrenOf(songId: string): Promise<Song[]> {
    const rows = await this.db.select<Row>(
      `SELECT * FROM song WHERE parent_id = ? AND status IN ('queued', 'running') ORDER BY created_at`,
      [songId],
    );
    return rows.map(rowToSong);
  }

  async delete(id: string): Promise<void> {
    await this.db.execute(`DELETE FROM song WHERE id = ?`, [id]);
  }
}
