import type { Db } from '../ports';
import { newId } from '../ports';
import { RENDER_DEFAULTS, YUE2_CHECKPOINT, type FrameWindow, type Song, type SongSpec, type SongStatus } from '../domain/types';

/** What the composer reported: natural end (actualSec) and/or ran into the duration cap. */
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
  plan_abc: string | null;
  take_path: string | null;
  edit_windows: string | null;
}

/** What a finished render adds to its song row. */
export interface RenderOutput {
  outputPath: string;
  renderMs?: number;
  composed?: ComposedLength;
  planAbc?: string;
  takePath?: string;
  editWindows?: FrameWindow[];
}

function parseWindows(json: string | null): FrameWindow[] | undefined {
  if (!json) return undefined;
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? (value as FrameWindow[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Fills spec fields a stored row may predate (e.g. the bundled examples' manifest). */
function normalizeSpec(spec: SongSpec): SongSpec {
  return {
    ...spec,
    targetSec: spec.targetSec ?? spec.durationSec,
    checkpoint: spec.checkpoint ?? YUE2_CHECKPOINT,
    sampler: spec.sampler ?? RENDER_DEFAULTS.sampler,
    scheduler: spec.scheduler ?? RENDER_DEFAULTS.scheduler,
    planMode: spec.planMode ?? RENDER_DEFAULTS.planMode,
  };
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
    planAbc: r.plan_abc ?? undefined,
    takePath: r.take_path ?? undefined,
    editWindows: parseWindows(r.edit_windows),
  };
}

export class SongRepo {
  constructor(private readonly db: Db) {}

  // `dit_file` / `tiled_decode` are the original song table's columns: the
  // checkpoint name goes in dit_file, tiled_decode is unused (0).
  async create(spec: SongSpec, now: number, parentId?: string, status: SongStatus = 'queued'): Promise<Song> {
    const id = newId();
    await this.db.execute(
      `INSERT INTO song (id, created_at, title, idea_text, photo_asset_id, caption, lyrics, instrumental, duration_sec,
         seed, dit_file, tiled_decode, steps, cfg, format, quality, status, parent_id, spec_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'mp3', ?, ?, ?, ?)`,
      [
        id, now, spec.title, spec.idea || null, spec.photo?.id ?? null, spec.caption, spec.lyrics,
        spec.instrumental ? 1 : 0, spec.durationSec, spec.seed, spec.checkpoint,
        spec.steps, spec.cfg, spec.quality, status, parentId ?? null, JSON.stringify(spec),
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
    planAbc?: string;
    actualSec?: number;
    hitCeiling?: boolean;
    takePath?: string;
  }): Promise<Song> {
    const { id, spec } = input;
    await this.db.execute(
      `INSERT INTO song (id, created_at, title, idea_text, photo_asset_id, caption, lyrics, instrumental, duration_sec,
         seed, dit_file, tiled_decode, steps, cfg, format, quality, status, spec_json,
         output_path, plan_abc, actual_sec, hit_ceiling, take_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'mp3', ?, 'done', ?, ?, ?, ?, ?, ?)`,
      [
        id, input.createdAt, spec.title, spec.idea || null, spec.photo?.id ?? null, spec.caption, spec.lyrics,
        spec.instrumental ? 1 : 0, spec.durationSec, spec.seed, spec.checkpoint,
        spec.steps, spec.cfg, spec.quality, JSON.stringify(spec),
        input.outputPath, input.planAbc ?? null, input.actualSec ?? null,
        input.hitCeiling == null ? null : input.hitCeiling ? 1 : 0,
        input.takePath ?? null,
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

  /** The single harvest write: everything a finished render produced, and status 'done'. */
  async setOutput(id: string, out: RenderOutput): Promise<void> {
    const { composed } = out;
    await this.db.execute(
      `UPDATE song SET output_path = ?, render_ms = ?, actual_sec = ?, hit_ceiling = ?, plan_abc = ?, take_path = ?, edit_windows = ?,
         status = 'done', error = NULL WHERE id = ?`,
      [
        out.outputPath, out.renderMs ?? null, composed?.actualSec ?? null, composed ? (composed.hitCeiling ? 1 : 0) : null,
        out.planAbc ?? null, out.takePath ?? null, out.editWindows?.length ? JSON.stringify(out.editWindows) : null, id,
      ],
    );
  }

  async setTitle(id: string, title: string): Promise<void> {
    const song = await this.byId(id);
    if (!song) return;
    const spec = { ...song.spec, title };
    await this.db.execute(`UPDATE song SET title = ?, spec_json = ? WHERE id = ?`, [title, JSON.stringify(spec), id]);
  }

  /**
   * Replaces the stored spec of a song that has not rendered (turning a
   * failed edit into a whole remix). Only fields the columns do not mirror
   * may differ; lyrics are written too, as the one column an edit changes.
   */
  async setSpec(id: string, spec: SongSpec): Promise<void> {
    await this.db.execute(`UPDATE song SET lyrics = ?, spec_json = ? WHERE id = ?`, [spec.lyrics, JSON.stringify(spec), id]);
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
