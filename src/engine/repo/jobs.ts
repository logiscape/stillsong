import type { Db } from '../ports';
import { newId } from '../ports';
import type { Job, JobState } from '../domain/types';

interface Row {
  id: string;
  song_id: string;
  state: string;
  queue_pos: number;
  comfy_prompt_id: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
}

function rowToJob(r: Row): Job {
  return {
    id: r.id,
    songId: r.song_id,
    state: r.state as JobState,
    queuePos: r.queue_pos,
    comfyPromptId: r.comfy_prompt_id ?? undefined,
    createdAt: r.created_at,
    startedAt: r.started_at ?? undefined,
    finishedAt: r.finished_at ?? undefined,
    error: r.error ?? undefined,
  };
}

export class JobRepo {
  constructor(private readonly db: Db) {}

  async enqueue(songId: string, now: number): Promise<Job> {
    const id = newId();
    const rows = await this.db.select<{ maxPos: number | null }>(`SELECT MAX(queue_pos) as maxPos FROM job WHERE state = 'queued'`);
    const pos = (rows[0]?.maxPos ?? -1) + 1;
    await this.db.execute(`INSERT INTO job (id, song_id, state, queue_pos, created_at) VALUES (?, ?, 'queued', ?, ?)`, [
      id, songId, pos, now,
    ]);
    return (await this.byId(id))!;
  }

  async byId(id: string): Promise<Job | null> {
    const rows = await this.db.select<Row>(`SELECT * FROM job WHERE id = ?`, [id]);
    return rows.length ? rowToJob(rows[0]) : null;
  }

  async queued(): Promise<Job[]> {
    const rows = await this.db.select<Row>(`SELECT * FROM job WHERE state = 'queued' ORDER BY queue_pos`);
    return rows.map(rowToJob);
  }

  async active(): Promise<Job[]> {
    const rows = await this.db.select<Row>(`SELECT * FROM job WHERE state IN ('submitted','running','harvesting') ORDER BY queue_pos`);
    return rows.map(rowToJob);
  }

  async setState(
    id: string,
    state: JobState,
    patch: { comfyPromptId?: string; error?: string; startedAt?: number; finishedAt?: number } = {},
  ): Promise<void> {
    await this.db.execute(
      `UPDATE job SET state = ?,
        comfy_prompt_id = COALESCE(?, comfy_prompt_id),
        error = COALESCE(?, error),
        started_at = COALESCE(?, started_at),
        finished_at = COALESCE(?, finished_at)
       WHERE id = ?`,
      [state, patch.comfyPromptId ?? null, patch.error ?? null, patch.startedAt ?? null, patch.finishedAt ?? null, id],
    );
  }

  async reorder(idsInOrder: string[]): Promise<void> {
    for (let i = 0; i < idsInOrder.length; i++) {
      await this.db.execute(`UPDATE job SET queue_pos = ? WHERE id = ? AND state = 'queued'`, [i, idsInOrder[i]]);
    }
  }

  async deleteForSong(songId: string): Promise<void> {
    await this.db.execute(`DELETE FROM job WHERE song_id = ?`, [songId]);
  }
}
