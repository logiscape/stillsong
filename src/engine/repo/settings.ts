// App settings, persisted as string key/values. Service URLs are NOT settings:
// the runtime supervisor owns them (the engine asks the Runtime port).

import type { Db } from '../ports';
import { MODEL_FILES, type Mp3Quality, type RenderMethod } from '../domain/types';

export interface AppSettings {
  ditFile: string;
  tiledDecode: boolean;
  quality: Mp3Quality;
  /** Sampler steps for newly created songs ('fast' = 40, 'enhanced' = 80). Remixes keep their source's. */
  renderMethod: RenderMethod;
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
  ditFile: MODEL_FILES.ditFp16,
  tiledDecode: true,
  quality: 'V0',
  renderMethod: 'fast',
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
    const renderMethod = map.renderMethod as RenderMethod | undefined;
    return {
      ditFile: map.ditFile ?? DEFAULT_SETTINGS.ditFile,
      tiledDecode: (map.tiledDecode ?? String(DEFAULT_SETTINGS.tiledDecode)) === 'true',
      quality: quality === 'V0' || quality === '128k' || quality === '320k' ? quality : DEFAULT_SETTINGS.quality,
      renderMethod: renderMethod === 'fast' || renderMethod === 'enhanced' ? renderMethod : DEFAULT_SETTINGS.renderMethod,
      lyricsAutoScroll: (map.lyricsAutoScroll ?? String(DEFAULT_SETTINGS.lyricsAutoScroll)) === 'true',
      solidPanelMode: (map.solidPanelMode ?? String(DEFAULT_SETTINGS.solidPanelMode)) === 'true',
      componentsDir: map.componentsDir || null,
      installComplete: map.installComplete === 'true',
      manifestVersion: map.manifestVersion || null,
    };
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
