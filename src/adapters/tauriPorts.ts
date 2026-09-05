// Wires the engine's ports to the Tauri shell. The ONLY file (besides UI
// bootstrapping and file pickers) that imports @tauri-apps/*.

import { invoke, Channel } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import type {
  Clock, ComfyOutputRef, Db, FileStore, HardwareInfo, HttpTransport, Ports, Runtime, ServiceState, ThumbnailInfo, WsEventHandler, WsTransport,
} from '@engine/ports';
import { newId } from '@engine/ports';

// -- Db: tauri-plugin-sql (SQLite). Engine uses `?` placeholders; the sqlx
// sqlite driver accepts `?` natively, so no translation is needed here.
class TauriDb implements Db {
  constructor(private readonly db: Database) {}

  async execute(sql: string, params: unknown[] = []): Promise<{ rowsAffected: number }> {
    const r = await this.db.execute(sql, params);
    return { rowsAffected: r.rowsAffected };
  }

  async select<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.select<T[]>(sql, params);
  }
}

class TauriHttp implements HttpTransport {
  async get(url: string) {
    return invoke<{ status: number; body: string }>('http_get', { url });
  }

  async postJson(url: string, body: unknown, timeoutMs?: number) {
    return invoke<{ status: number; body: string }>('http_post_json', { url, body, timeoutMs });
  }
}

class TauriWs implements WsTransport {
  async connect(url: string, onEvent: WsEventHandler): Promise<string> {
    const id = newId();
    const channel = new Channel<{ kind: 'open' } | { kind: 'message'; data: string } | { kind: 'close' }>();
    channel.onmessage = (msg) => onEvent(msg);
    await invoke('ws_connect', { id, url, onEvent: channel });
    return id;
  }

  async close(id: string): Promise<void> {
    await invoke('ws_close', { id });
  }
}

class TauriFiles implements FileStore {
  private libDir: string | null = null;

  async libraryDir(): Promise<string> {
    if (!this.libDir) this.libDir = await invoke<string>('files_library_dir');
    return this.libDir;
  }

  async download(url: string, relPath: string): Promise<string> {
    // Rust resolves relPath inside the library and refuses anything else.
    return invoke<string>('http_download', { url, relPath });
  }

  async importFile(srcPath: string, relPath: string): Promise<string> {
    return invoke<string>('files_import', { srcPath, relPath });
  }

  async makeThumbnail(srcPath: string, relPath: string, maxDim: number): Promise<ThumbnailInfo> {
    return invoke<ThumbnailInfo>('files_make_thumbnail', { srcPath, relPath, maxDim });
  }

  async writeBase64(relPath: string, b64: string): Promise<string> {
    return invoke<string>('files_write_base64', { relPath, b64 });
  }

  async sha256(path: string): Promise<string> {
    return invoke<string>('files_sha256', { path });
  }

  async readBase64(path: string): Promise<string> {
    return invoke<string>('files_read_base64', { path });
  }

  async exists(path: string): Promise<boolean> {
    return invoke<boolean>('files_exists', { path });
  }

  async remove(path: string): Promise<void> {
    await invoke('files_delete', { path });
  }

  async reveal(path: string): Promise<void> {
    await invoke('files_reveal', { path });
  }
}

class RealClock implements Clock {
  now(): number {
    return Date.now();
  }

  setTimeout(fn: () => void, ms: number): () => void {
    const id = window.setTimeout(fn, ms);
    return () => window.clearTimeout(id);
  }
}

/** Supervisor-backed runtime (the shipped path once the supervisor lands). */
class TauriRuntime implements Runtime {
  async status(): Promise<{ comfy: ServiceState; llm: ServiceState }> {
    return invoke('runtime_status');
  }

  async startLlm(): Promise<void> {
    await invoke('runtime_start_llm');
  }

  async stopLlm(): Promise<void> {
    await invoke('runtime_stop_llm');
  }

  async startComfy(): Promise<void> {
    await invoke('runtime_start_comfy');
  }

  async urls(): Promise<{ comfy: string; llm: string }> {
    return invoke('runtime_urls');
  }

  async hardware(): Promise<HardwareInfo> {
    return invoke('gpu_info');
  }

  async comfyOutputs(): Promise<ComfyOutputRef[]> {
    return invoke('runtime_comfy_outputs');
  }

  async removeComfyOutput(file: ComfyOutputRef): Promise<void> {
    await invoke('runtime_remove_comfy_output', { subfolder: file.subfolder, filename: file.filename });
  }
}

export async function createTauriPorts(): Promise<Ports> {
  const db = await Database.load('sqlite:stillsong.db');
  return {
    db: new TauriDb(db),
    http: new TauriHttp(),
    ws: new TauriWs(),
    files: new TauriFiles(),
    clock: new RealClock(),
    // The Rust supervisor owns child processes and URLs. In dev it honours
    // STILLSONG_COMFY_URL / STILLSONG_LLM_URL / STILLSONG_COMPONENTS to point
    // at externally managed services instead of spawning.
    runtime: new TauriRuntime(),
  };
}
