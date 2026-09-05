// Inspiration photos: imported into library/photos/{sha16}.{ext}, deduped by
// sha256, with the vision analysis cached on the row. Import also renders a
// 512 px thumbnail and measures luminance + dominant colour (they drive the
// Sanctuary ambiance and the Song-view scrim).

import type { Db, FileStore } from '../ports';
import { newId } from '../ports';
import type { PhotoAsset } from '../domain/types';

interface Row {
  id: string;
  sha256: string;
  local_path: string;
  original_name: string;
  analysis_json: string | null;
  thumb_path: string | null;
  luminance: number | null;
  dominant_color: string | null;
  source: string | null;
  created_at: number;
}

function rowToAsset(r: Row): PhotoAsset {
  return {
    id: r.id,
    sha256: r.sha256,
    localPath: r.local_path,
    originalName: r.original_name,
    analysisJson: r.analysis_json ?? undefined,
    thumbPath: r.thumb_path ?? undefined,
    luminance: r.luminance ?? undefined,
    dominantColor: r.dominant_color ?? undefined,
    source: r.source === 'drawing' ? 'drawing' : undefined,
    createdAt: r.created_at,
  };
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif']);

export const THUMB_MAX_DIM = 512;

export class PhotoRepo {
  constructor(
    private readonly db: Db,
    private readonly files: FileStore,
  ) {}

  async import(srcPath: string, now: number): Promise<PhotoAsset> {
    const name = srcPath.replace(/\\/g, '/').split('/').pop() ?? 'photo';
    const ext = (name.includes('.') ? name.split('.').pop()! : 'bin').toLowerCase();
    if (!IMAGE_EXTS.has(ext)) throw new Error(`Unsupported image type .${ext} (use png/jpg/webp/bmp/gif).`);
    const sha = await this.files.sha256(srcPath);
    const existing = await this.bySha(sha);
    if (existing && (await this.files.exists(existing.localPath))) {
      return existing.thumbPath ? existing : this.ensureThumbnail(existing);
    }
    const localPath = await this.files.importFile(srcPath, `photos/${sha.slice(0, 16)}.${ext}`);
    if (existing) {
      await this.db.execute(`UPDATE photo_asset SET local_path = ? WHERE id = ?`, [localPath, existing.id]);
      return this.ensureThumbnail({ ...existing, localPath });
    }
    const id = newId();
    await this.db.execute(
      `INSERT INTO photo_asset (id, sha256, local_path, original_name, created_at) VALUES (?, ?, ?, ?, ?)`,
      [id, sha, localPath, name, now],
    );
    return this.ensureThumbnail((await this.byId(id))!);
  }

  /**
   * Imports in-memory PNG bytes (a canvas drawing) — same dedupe, layout and
   * thumbnail path as `import`, but the content never existed as a source
   * file, so the sha is computed here and the bytes are written directly.
   */
  async importBytes(b64Png: string, originalName: string, now: number): Promise<PhotoAsset> {
    const bytes = Uint8Array.from(atob(b64Png), (c) => c.charCodeAt(0));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const sha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    const existing = await this.bySha(sha);
    if (existing && (await this.files.exists(existing.localPath))) {
      return existing.thumbPath ? existing : this.ensureThumbnail(existing);
    }
    const localPath = await this.files.writeBase64(`photos/${sha.slice(0, 16)}.png`, b64Png);
    if (existing) {
      await this.db.execute(`UPDATE photo_asset SET local_path = ? WHERE id = ?`, [localPath, existing.id]);
      return this.ensureThumbnail({ ...existing, localPath });
    }
    const id = newId();
    await this.db.execute(
      `INSERT INTO photo_asset (id, sha256, local_path, original_name, source, created_at) VALUES (?, ?, ?, ?, 'drawing', ?)`,
      [id, sha, localPath, originalName, now],
    );
    return this.ensureThumbnail((await this.byId(id))!);
  }

  /** Renders the thumbnail + ambiance measurements if the asset lacks them. */
  private async ensureThumbnail(asset: PhotoAsset): Promise<PhotoAsset> {
    const thumb = await this.files.makeThumbnail(asset.localPath, `thumbs/${asset.sha256.slice(0, 16)}.webp`, THUMB_MAX_DIM);
    await this.db.execute(`UPDATE photo_asset SET thumb_path = ?, luminance = ?, dominant_color = ? WHERE id = ?`, [
      thumb.path, thumb.luminance, thumb.dominantColor, asset.id,
    ]);
    return { ...asset, thumbPath: thumb.path, luminance: thumb.luminance, dominantColor: thumb.dominantColor };
  }

  async byId(id: string): Promise<PhotoAsset | null> {
    const rows = await this.db.select<Row>(`SELECT * FROM photo_asset WHERE id = ?`, [id]);
    return rows.length ? rowToAsset(rows[0]) : null;
  }

  async bySha(sha: string): Promise<PhotoAsset | null> {
    const rows = await this.db.select<Row>(`SELECT * FROM photo_asset WHERE sha256 = ?`, [sha]);
    return rows.length ? rowToAsset(rows[0]) : null;
  }

  async setAnalysis(id: string, analysisJson: string): Promise<void> {
    await this.db.execute(`UPDATE photo_asset SET analysis_json = ? WHERE id = ?`, [analysisJson, id]);
  }

  /**
   * Assets no song row points at — any status, any count. A photo is stored
   * once and shared by every song made from it (dedupe by sha256), so the
   * check is a NOT EXISTS against the song table, never a per-song flag.
   */
  async unreferencedIds(): Promise<string[]> {
    const rows = await this.db.select<{ id: string }>(
      `SELECT p.id FROM photo_asset p WHERE NOT EXISTS (SELECT 1 FROM song s WHERE s.photo_asset_id = p.id)`,
    );
    return rows.map((r) => r.id);
  }

  /** Removes the asset's files and row (caller has checked nothing references it). */
  async delete(id: string): Promise<void> {
    const asset = await this.byId(id);
    if (!asset) return;
    await this.files.remove(asset.localPath).catch(() => {});
    if (asset.thumbPath) await this.files.remove(asset.thumbPath).catch(() => {});
    await this.db.execute(`DELETE FROM photo_asset WHERE id = ?`, [id]);
  }
}
