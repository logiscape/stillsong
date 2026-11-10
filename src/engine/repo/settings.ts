// App settings, persisted as string key/values. Service URLs are NOT settings:
// the runtime supervisor owns them (the engine asks the Runtime port).

import type { Db } from '../ports';
import { YUE2_CHECKPOINT, type Mp3Quality } from '../domain/types';

export interface AppSettings {
  /** The YuE2 checkpoint new songs are performed with. */
  checkpoint: string;
  quality: Mp3Quality;
  /** Song view: gently auto-scroll the lyric sheet with playback (an estimate, off by default). */
  lyricsAutoScroll: boolean;
  /** Song view: opaque panel behind lyrics (accessibility fallback). */
  solidPanelMode: boolean;
  /** Where the downloaded components (runtimes + models) live; null until first-run chooses. */
  componentsDir: string | null;
  /** True once first-run setup finished and warm-up passed. */
  installComplete: boolean;
  /** Manifest version the current install was bootstrapped from. */
  manifestVersion: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  checkpoint: YUE2_CHECKPOINT,
  quality: 'V0',
  lyricsAutoScroll: false,
  solidPanelMode: false,
  componentsDir: null,
  installComplete: false,
  manifestVersion: null,
};

export class SettingsRepo {
  constructor(private readonly db: Db) {}

  async load(): Promise<AppSettings> {
    const rows = await this.db.select<{ key: string; value: string }>(`SELECT key, value FROM setting`);
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const quality = map.quality as Mp3Quality | undefined;
    return {
      checkpoint: map.checkpoint || DEFAULT_SETTINGS.checkpoint,
      quality: quality === 'V0' || quality === '128k' || quality === '320k' ? quality : DEFAULT_SETTINGS.quality,
      lyricsAutoScroll: (map.lyricsAutoScroll ?? String(DEFAULT_SETTINGS.lyricsAutoScroll)) === 'true',
      solidPanelMode: (map.solidPanelMode ?? String(DEFAULT_SETTINGS.solidPanelMode)) === 'true',
      componentsDir: map.componentsDir || null,
      installComplete: map.installComplete === 'true',
      manifestVersion: map.manifestVersion || null,
    };
  }

  /** One-off markers outside AppSettings (e.g. the example-library seed); `save` never touches them. */
  async getFlag(key: string): Promise<string | null> {
    const rows = await this.db.select<{ value: string }>(`SELECT value FROM setting WHERE key = ?`, [key]);
    return rows.length ? rows[0].value : null;
  }

  async setFlag(key: string, value: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value],
    );
  }

  async save(settings: AppSettings): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await this.db.execute(
        `INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value == null ? '' : String(value)],
      );
    }
  }
}
