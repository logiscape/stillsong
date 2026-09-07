// SQL migrations, applied in order at Engine.create(). Convention (Dragon
// Heart): `?` positional placeholders, TEXT UUID primary keys from newId().

export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS photo_asset (
    id TEXT PRIMARY KEY,
    sha256 TEXT UNIQUE NOT NULL,
    local_path TEXT NOT NULL,
    original_name TEXT NOT NULL,
    analysis_json TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS song (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    title TEXT NOT NULL,
    idea_text TEXT,
    photo_asset_id TEXT REFERENCES photo_asset(id),
    caption TEXT NOT NULL,
    lyrics TEXT NOT NULL,
    instrumental INTEGER NOT NULL DEFAULT 0,
    duration_sec REAL NOT NULL,
    seed TEXT NOT NULL,
    dit_file TEXT NOT NULL,
    tiled_decode INTEGER NOT NULL DEFAULT 1,
    steps INTEGER NOT NULL,
    cfg REAL NOT NULL,
    format TEXT NOT NULL DEFAULT 'mp3',
    quality TEXT NOT NULL DEFAULT 'V0',
    status TEXT NOT NULL,
    output_path TEXT,
    actual_sec REAL,
    render_ms INTEGER,
    comfy_prompt_id TEXT,
    error TEXT,
    parent_id TEXT REFERENCES song(id),
    spec_json TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS job (
    id TEXT PRIMARY KEY,
    song_id TEXT NOT NULL REFERENCES song(id),
    state TEXT NOT NULL,
    queue_pos INTEGER NOT NULL,
    comfy_prompt_id TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    error TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_song_created ON song(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_job_state ON job(state, queue_pos)`,
];

import type { Db } from './ports';

/** ALTER TABLE has no IF NOT EXISTS in SQLite; guard each added column by pragma lookup. */
const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: 'song', column: 'hit_ceiling', ddl: `ALTER TABLE song ADD COLUMN hit_ceiling INTEGER` },
  { table: 'song', column: 'codes_path', ddl: `ALTER TABLE song ADD COLUMN codes_path TEXT` },
  { table: 'song', column: 'prefix_song_id', ddl: `ALTER TABLE song ADD COLUMN prefix_song_id TEXT` },
  { table: 'song', column: 'prefix_frames', ddl: `ALTER TABLE song ADD COLUMN prefix_frames INTEGER` },
  { table: 'song', column: 'replaces_song_id', ddl: `ALTER TABLE song ADD COLUMN replaces_song_id TEXT` },
  { table: 'song', column: 'replace_verified', ddl: `ALTER TABLE song ADD COLUMN replace_verified INTEGER` },
  { table: 'photo_asset', column: 'thumb_path', ddl: `ALTER TABLE photo_asset ADD COLUMN thumb_path TEXT` },
  { table: 'photo_asset', column: 'luminance', ddl: `ALTER TABLE photo_asset ADD COLUMN luminance REAL` },
  { table: 'photo_asset', column: 'dominant_color', ddl: `ALTER TABLE photo_asset ADD COLUMN dominant_color TEXT` },
  { table: 'photo_asset', column: 'source', ddl: `ALTER TABLE photo_asset ADD COLUMN source TEXT` },
];

export async function migrate(db: Db): Promise<void> {
  for (const sql of MIGRATIONS) {
    await db.execute(sql);
  }
  for (const { table, column, ddl } of ADDED_COLUMNS) {
    const rows = await db.select<{ name: string }>(`SELECT name FROM pragma_table_info(?) WHERE name = ?`, [table, column]);
    if (rows.length === 0) await db.execute(ddl);
  }
}
