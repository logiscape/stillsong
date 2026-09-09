// Node-based ports for live tests (STILLSONG_LIVE=1): real HTTP against local
// ComfyUI, a real llama-server child process for the songwriter, node:sqlite
// in-memory DB, filesystem file store. The Ws transport defaults to a stub
// that never connects, which exercises the engine's history-polling fallback
// (nodeWs() gives a real socket when wanted).

import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import type { Clock, Db, FileStore, HttpTransport, Ports, Runtime, WsTransport } from '@engine/ports';

const require_ = createRequire(import.meta.url);

// Dev-machine component layout (mirrors the app's default components dir).
const COMPONENTS =
  process.env.STILLSONG_COMPONENTS ??
  path.join(process.env.LOCALAPPDATA ?? '', 'com.logiscape.stillsong', 'components');
const LLAMA_EXE = path.join(COMPONENTS, 'llama', 'llama-server.exe');
const LLM_MODEL = path.join(COMPONENTS, 'models', 'gemma-4-12B-it-Q4_0.gguf');
const LLM_MMPROJ = path.join(COMPONENTS, 'models', 'mmproj-gemma-4-12B-it-Q8_0.gguf');
const LLM_PORT = 17801;
const COMFY_URL = process.env.STILLSONG_COMFY_URL ?? 'http://127.0.0.1:8000';

export function llamaAvailable(): boolean {
  return fsSync.existsSync(LLAMA_EXE) && fsSync.existsSync(LLM_MODEL) && fsSync.existsSync(LLM_MMPROJ);
}

export function nodeDb(): Db {
  const { DatabaseSync } = require_('node:sqlite');
  const db = new DatabaseSync(':memory:');
  return {
    async execute(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      const r = stmt.run(...(params as never[]));
      return { rowsAffected: Number(r.changes) };
    },
    async select<T>(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      return stmt.all(...(params as never[])) as T[];
    },
  };
}

export function nodeHttp(): HttpTransport {
  return {
    async get(url) {
      const r = await fetch(url);
      return { status: r.status, body: await r.text() };
    },
    async postJson(url, body) {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: await r.text() };
    },
  };
}

export function stubWs(): WsTransport {
  return {
    async connect() {
      throw new Error('ws unavailable in live test — engine must fall back to history polling');
    },
    async close() {},
  };
}

/** Real WebSocket (Node 22 global) so live tests can assert progress events. */
export function nodeWs(): WsTransport {
  const sockets = new Map<string, WebSocket>();
  return {
    async connect(url, onEvent) {
      const id = crypto.randomUUID();
      const ws = new WebSocket(url);
      sockets.set(id, ws);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('ws connect failed'));
      });
      onEvent({ kind: 'open' });
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') onEvent({ kind: 'message', data: ev.data });
      };
      ws.onclose = () => onEvent({ kind: 'close' });
      return id;
    },
    async close(id) {
      sockets.get(id)?.close();
      sockets.delete(id);
    },
  };
}

/**
 * Real supervisor semantics for live tests: startLlm spawns llama-server.exe,
 * stopLlm kills it and resolves when the process has exited (the same
 * guarantee the app's supervisor gives the VRAM arbiter). stopLlm also
 * best-effort ejects Ollama-resident models so a dev machine's own Ollama
 * never skews render measurements.
 */
export function nodeRuntime(): Runtime & { dispose(): Promise<void> } {
  let child: ChildProcess | null = null;
  let exited: Promise<void> | null = null;

  const startLlm = async (): Promise<void> => {
    if (child) return;
    if (!llamaAvailable()) throw new Error(`llama-server not provisioned under ${COMPONENTS}`);
    const proc = spawn(
      LLAMA_EXE,
      ['-m', LLM_MODEL, '--mmproj', LLM_MMPROJ, '-c', '16384', '--host', '127.0.0.1', '--port', String(LLM_PORT), '-ngl', '99', '--no-webui'],
      { stdio: 'ignore' },
    );
    child = proc;
    exited = new Promise<void>((resolve) => {
      proc.once('exit', () => {
        if (child === proc) child = null;
        resolve();
      });
    });
  };

  const stopLlm = async (): Promise<void> => {
    if (child) {
      child.kill();
      await exited;
    }
    try {
      const ps = await fetch('http://127.0.0.1:11434/api/ps');
      if (ps.ok) {
        const loaded = ((await ps.json()) as { models?: { name: string }[] }).models ?? [];
        for (const m of loaded) {
          await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: m.name, prompt: '', keep_alive: 0 }),
          });
        }
        for (let i = 0; i < 15 && loaded.length; i++) {
          const again = ((await (await fetch('http://127.0.0.1:11434/api/ps')).json()) as { models?: unknown[] }).models ?? [];
          if (!again.length) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } catch {
      /* no Ollama on this machine */
    }
  };

  return {
    status: async () => ({ comfy: 'running', llm: child ? 'running' : 'stopped' }),
    startLlm,
    stopLlm,
    // Live tests run against an externally managed ComfyUI (:8000) whose
    // output tree is not ours to sweep.
    startComfy: async () => {},
    comfyOutputs: async () => [],
    removeComfyOutput: async () => {},
    urls: async () => ({ comfy: COMFY_URL, llm: `http://127.0.0.1:${LLM_PORT}` }),
    // STILLSONG_VRAM_MB / STILLSONG_RAM_MB mirror the gpu.rs dev overrides so
    // live runs can exercise the Patient-tier engine paths under emulation.
    hardware: async () => ({
      vendor: 'nvidia',
      vramMb: Number(process.env.STILLSONG_VRAM_MB) || 16_303,
      ramMb: Number(process.env.STILLSONG_RAM_MB) || 65_536,
    }),
    dispose: stopLlm,
  };
}

export function nodeFiles(rootDir: string): FileStore {
  return {
    async libraryDir() {
      await fs.mkdir(rootDir, { recursive: true });
      return rootDir;
    },
    async download(url, relPath) {
      const dest = path.join(rootDir, relPath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const r = await fetch(url);
      if (!r.ok) throw new Error(`download failed: ${r.status}`);
      await fs.writeFile(dest, Buffer.from(await r.arrayBuffer()));
      return dest;
    },
    async importFile(srcPath, relPath) {
      const dest = path.join(rootDir, relPath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(srcPath, dest);
      return dest;
    },
    async writeBase64(relPath, b64) {
      const dest = path.join(rootDir, relPath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, Buffer.from(b64, 'base64'));
      return dest;
    },
    // Live tests don't exercise image math (the Rust shell owns that); a copy
    // with nominal ambiance values keeps the pipeline honest.
    async makeThumbnail(srcPath, relPath) {
      const dest = path.join(rootDir, relPath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(srcPath, dest);
      return { path: dest, luminance: 0.5, dominantColor: '#808080' };
    },
    async sha256(p) {
      const bytes = await fs.readFile(p);
      return crypto.createHash('sha256').update(bytes).digest('hex');
    },
    async readBase64(p) {
      return (await fs.readFile(p)).toString('base64');
    },
    async exists(p) {
      return fs
        .access(p)
        .then(() => true)
        .catch(() => false);
    },
    async remove(p) {
      await fs.rm(p, { force: true });
    },
    async reveal() {},
    async examplesDir() {
      return null;
    },
  };
}

export function realClock(): Clock {
  return {
    now: () => Date.now(),
    setTimeout(fn, ms) {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
  };
}

export function livePorts(opts: { ws?: boolean; runtime?: Runtime } = {}): Ports {
  const root = path.join(os.tmpdir(), `stillsong-live-${Date.now()}`);
  return {
    db: nodeDb(),
    http: nodeHttp(),
    ws: opts.ws ? nodeWs() : stubWs(),
    files: nodeFiles(root),
    clock: realClock(),
    runtime: opts.runtime ?? nodeRuntime(),
  };
}
