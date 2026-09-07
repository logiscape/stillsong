// In-process fakes shared by the unit suites: a scripted ComfyUI + llama-server
// over the HttpTransport port, node:sqlite, a fake clock, a fake runtime
// supervisor, and a WS that never connects (exercising the history-poll
// fallback).

import type { Clock, ComfyOutputRef, FileStore, HttpTransport, Ports, Runtime, ThumbnailInfo, WsTransport } from '@engine/ports';
import { nodeDb } from './livePorts';

export class FakeClock implements Clock {
  t = 1_000_000;
  timers: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.timers.push({ at: this.t + ms, fn, id });
    return () => {
      this.timers = this.timers.filter((x) => x.id !== id);
    };
  }
  async advance(ms: number) {
    this.t += ms;
    const due = this.timers.filter((x) => x.at <= this.t).sort((a, b) => a.at - b.at);
    this.timers = this.timers.filter((x) => x.at > this.t);
    for (const d of due) d.fn();
    await flush();
  }
}

export const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

export interface FakeWorld {
  http: HttpTransport;
  posts: { url: string; body: unknown }[];
  /** Ordered log of interesting things (runtime calls + submits) for ordering assertions. */
  events: string[];
  /** 'down' simulates a dead ComfyUI: the history transport throws. */
  historyStatus: 'running' | 'success' | 'error' | 'down';
  submittedGraph: Record<string, { class_type: string; inputs: Record<string, unknown> }> | null;
  /** Scripted /v1/chat/completions contents, shifted per call. */
  llmResponses: string[];
  /** Every chat request body, in order. */
  llmCalls: { messages: { role: string; content: unknown }[]; response_format?: unknown }[];
  llmHealthy: boolean;
  /** When true, the fake ComfyUI has the Stillsong overlay node and emits a codes file. */
  stillsongNode: boolean;
}

export function fakeHttp(): FakeWorld {
  const w: FakeWorld = {
    posts: [],
    events: [],
    historyStatus: 'running',
    submittedGraph: null,
    llmResponses: [],
    llmCalls: [],
    llmHealthy: true,
    stillsongNode: false,
    http: null!,
  };
  w.http = {
    async get(url) {
      if (url.endsWith('/queue')) return { status: 200, body: JSON.stringify({ queue_running: [], queue_pending: [] }) };
      if (url.endsWith('/health')) return w.llmHealthy ? { status: 200, body: '{"status":"ok"}' } : { status: 503, body: '{}' };
      if (url.includes('/history/')) {
        const id = url.split('/').pop()!;
        if (w.historyStatus === 'down') throw new Error('connect ECONNREFUSED 127.0.0.1:17800');
        if (w.historyStatus === 'running') return { status: 200, body: '{}' };
        if (w.historyStatus === 'error') {
          return {
            status: 200,
            body: JSON.stringify({
              [id]: { status: { status_str: 'error', completed: false, messages: [['execution_error', { node_type: 'KSampler', exception_type: 'OOM', exception_message: 'out of memory' }]] }, outputs: {} },
            }),
          };
        }
        const outputs: Record<string, unknown> = {
          save: { audio: [{ filename: 'x_00001_.mp3', subfolder: 'audio\\stillsong', type: 'output' }] },
        };
        if (w.stillsongNode) {
          outputs.encode = { stillsong_codes: [{ filename: 'x_00001_.codes.bin', subfolder: 'audio\\stillsong', type: 'output' }] };
        }
        return {
          status: 200,
          body: JSON.stringify({
            [id]: { status: { status_str: 'success', completed: true, messages: [] }, outputs },
          }),
        };
      }
      if (url.includes('/object_info/StillsongMusic3TextEncode')) {
        return w.stillsongNode
          ? { status: 200, body: JSON.stringify({ StillsongMusic3TextEncode: { input: {} } }) }
          : { status: 404, body: '' };
      }
      return { status: 404, body: '' };
    },
    async postJson(url, body) {
      w.posts.push({ url, body });
      if (url.endsWith('/prompt')) {
        w.events.push('submit');
        w.submittedGraph = (body as { prompt: FakeWorld['submittedGraph'] }).prompt;
        return { status: 200, body: JSON.stringify({ prompt_id: 'pid-1' }) };
      }
      if (url.endsWith('/v1/chat/completions')) {
        const req = body as { messages: { role: string; content: unknown }[]; response_format?: unknown };
        w.llmCalls.push(req);
        const content = w.llmResponses.shift();
        if (content === undefined) return { status: 500, body: 'no scripted llm response left' };
        return { status: 200, body: JSON.stringify({ choices: [{ message: { content } }] }) };
      }
      return { status: 200, body: '{}' };
    },
  };
  return w;
}

export function fakeFiles(): FileStore & {
  downloaded: string[];
  removed: string[];
  written: { relPath: string; b64: string }[];
  base64Content: string | null;
  base64ByPath: Record<string, string>;
  existing: boolean;
} {
  const f = {
    downloaded: [] as string[],
    removed: [] as string[],
    written: [] as { relPath: string; b64: string }[],
    /** Returned by readBase64 when set (e.g. an SSC1 blob for prefix tests). */
    base64Content: null as string | null,
    /** Per-path overrides, ahead of base64Content. */
    base64ByPath: {} as Record<string, string>,
    existing: true,
    async libraryDir() {
      return 'C:\\lib';
    },
    async download(url: string, relPath: string) {
      f.downloaded.push(url);
      return `C:\\lib\\${relPath}`;
    },
    async importFile(_s: string, relPath: string) {
      return `C:\\lib\\${relPath}`;
    },
    async writeBase64(relPath: string, b64: string) {
      f.written.push({ relPath, b64 });
      return `C:\\lib\\${relPath}`;
    },
    async makeThumbnail(_s: string, relPath: string, _maxDim: number): Promise<ThumbnailInfo> {
      return { path: `C:\\lib\\${relPath}`, luminance: 0.42, dominantColor: '#aabbcc' };
    },
    /** The file stem, so distinct paths are distinct assets and the same path dedupes. */
    async sha256(path: string) {
      return (path.replace(/\\/g, '/').split('/').pop() ?? 'abc').replace(/\.[^.]*$/, '');
    },
    async readBase64(p: string) {
      return f.base64ByPath[p] ?? f.base64Content ?? 'ZmFrZQ==';
    },
    async exists() {
      return f.existing;
    },
    async remove(p: string) {
      f.removed.push(p);
    },
    async reveal() {},
  };
  return f;
}

export function fakeRuntime(events: string[] = []): Runtime & {
  calls: string[];
  /** What the fake ComfyUI's output dir currently holds (seed before Engine.create for sweep tests). */
  outputs: ComfyOutputRef[];
  removedOutputs: ComfyOutputRef[];
} {
  const r = {
    calls: events,
    outputs: [] as ComfyOutputRef[],
    removedOutputs: [] as ComfyOutputRef[],
    async status() {
      return { comfy: 'running' as const, llm: 'stopped' as const };
    },
    async startLlm() {
      r.calls.push('startLlm');
    },
    async stopLlm() {
      r.calls.push('stopLlm');
    },
    async startComfy() {
      r.calls.push('startComfy');
    },
    async urls() {
      return { comfy: 'http://comfy.test', llm: 'http://llm.test' };
    },
    async hardware() {
      return { vendor: 'nvidia', vramMb: 16_303, ramMb: 65_536 };
    },
    async comfyOutputs() {
      return [...r.outputs];
    },
    async removeComfyOutput(file: ComfyOutputRef) {
      r.removedOutputs.push(file);
      r.outputs = r.outputs.filter((o) => !(o.filename === file.filename && o.subfolder === file.subfolder));
    },
  };
  return r;
}

export const deadWs: WsTransport = {
  async connect() {
    throw new Error('no ws');
  },
  async close() {},
};

export function makePorts(): {
  ports: Ports;
  world: FakeWorld;
  clock: FakeClock;
  files: ReturnType<typeof fakeFiles>;
  runtime: ReturnType<typeof fakeRuntime>;
} {
  const world = fakeHttp();
  const clock = new FakeClock();
  const files = fakeFiles();
  const runtime = fakeRuntime(world.events);
  return { ports: { db: nodeDb(), http: world.http, ws: deadWs, files, clock, runtime }, world, clock, files, runtime };
}
