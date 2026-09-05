import type { HttpTransport, FileStore } from '../ports';
import type { ApiGraph } from './nodes';

export interface ComfyOutputFile {
  filename: string;
  subfolder: string;
  type: string; // 'output' | 'temp' | 'input'
}

export interface HistoryEntry {
  status: 'running' | 'success' | 'error' | 'interrupted' | 'unknown';
  /** Human-readable error, when status === 'error'. */
  error?: string;
  /** Every file-shaped output (audio appears under the `audio` key). */
  files: ComfyOutputFile[];
}

export interface QueueInfo {
  runningPromptIds: string[];
  pendingPromptIds: string[];
}

export class ComfyError extends Error {
  constructor(
    message: string,
    public readonly nodeErrors?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Parse ComfyUI's /prompt 400 payload into a readable message. */
export function parseNodeErrors(body: string): ComfyError {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; details?: string };
      node_errors?: Record<string, { errors?: { message?: string; details?: string }[]; class_type?: string }>;
    };
    const parts: string[] = [];
    if (parsed.error?.message) {
      parts.push(parsed.error.details ? `${parsed.error.message}: ${parsed.error.details}` : parsed.error.message);
    }
    for (const [nodeId, ne] of Object.entries(parsed.node_errors ?? {})) {
      for (const e of ne.errors ?? []) {
        parts.push(`${ne.class_type ?? nodeId}: ${e.message ?? 'invalid input'}${e.details ? ` (${e.details})` : ''}`);
      }
    }
    return new ComfyError(parts.join('; ') || 'ComfyUI rejected the workflow', parsed.node_errors);
  } catch {
    return new ComfyError(`ComfyUI rejected the workflow: ${body.slice(0, 500)}`);
  }
}

export class ComfyClient {
  constructor(
    private readonly http: HttpTransport,
    private readonly files: FileStore,
    public baseUrl: string, // e.g. http://127.0.0.1:8000
  ) {}

  async systemStats(): Promise<{ comfyuiVersion: string; ramFree: number } | null> {
    try {
      const r = await this.http.get(`${this.baseUrl}/system_stats`);
      if (r.status !== 200) return null;
      const j = JSON.parse(r.body);
      return { comfyuiVersion: j.system?.comfyui_version ?? 'unknown', ramFree: j.system?.ram_free ?? 0 };
    } catch {
      return null;
    }
  }

  async objectInfo(nodeClass?: string): Promise<Record<string, unknown>> {
    const url = nodeClass ? `${this.baseUrl}/object_info/${nodeClass}` : `${this.baseUrl}/object_info`;
    const r = await this.http.get(url);
    if (r.status !== 200) throw new ComfyError(`object_info failed (${r.status})`);
    return JSON.parse(r.body);
  }

  /** Whether a node class is registered (e.g. the Stillsong overlay's encoder). */
  async hasNode(nodeClass: string): Promise<boolean> {
    try {
      const info = await this.objectInfo(nodeClass);
      return nodeClass in info;
    } catch {
      return false;
    }
  }

  /** Model files visible to a loader node's combo input (e.g. UNETLoader/unet_name). */
  async availableModels(nodeClass: string, inputName: string): Promise<string[]> {
    const info = await this.objectInfo(nodeClass);
    const node = (info as Record<string, { input?: { required?: Record<string, unknown[]> } }>)[nodeClass];
    const spec = node?.input?.required?.[inputName];
    return Array.isArray(spec) && Array.isArray(spec[0]) ? (spec[0] as string[]) : [];
  }

  async submit(graph: ApiGraph, clientId: string): Promise<string> {
    const r = await this.http.postJson(`${this.baseUrl}/prompt`, { prompt: graph, client_id: clientId });
    if (r.status !== 200) throw parseNodeErrors(r.body);
    const j = JSON.parse(r.body) as { prompt_id: string };
    return j.prompt_id;
  }

  async history(promptId: string): Promise<HistoryEntry | null> {
    const r = await this.http.get(`${this.baseUrl}/history/${promptId}`);
    if (r.status !== 200) return null;
    const j = JSON.parse(r.body) as Record<string, HistoryRaw>;
    const entry = j[promptId];
    if (!entry) return null;
    return parseHistoryEntry(entry);
  }

  async queue(): Promise<QueueInfo> {
    const r = await this.http.get(`${this.baseUrl}/queue`);
    const j = JSON.parse(r.body) as { queue_running: unknown[][]; queue_pending: unknown[][] };
    // Each queue item is [number, prompt_id, prompt, extra_data, outputs_to_execute]
    return {
      runningPromptIds: j.queue_running.map((it) => String(it[1])),
      pendingPromptIds: j.queue_pending.map((it) => String(it[1])),
    };
  }

  async deleteQueued(promptId: string): Promise<void> {
    await this.http.postJson(`${this.baseUrl}/queue`, { delete: [promptId] });
  }

  async interrupt(): Promise<void> {
    await this.http.postJson(`${this.baseUrl}/interrupt`, {});
  }

  /** Unload all models from VRAM (used before handing the GPU to the LLM). */
  async free(): Promise<void> {
    await this.http.postJson(`${this.baseUrl}/free`, { unload_models: true, free_memory: true });
  }

  viewUrl(f: ComfyOutputFile): string {
    const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder, type: f.type });
    return `${this.baseUrl}/view?${q.toString()}`;
  }

  async downloadOutput(f: ComfyOutputFile, relPath: string): Promise<string> {
    return this.files.download(this.viewUrl(f), relPath);
  }
}

interface HistoryRaw {
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
  outputs?: Record<string, Record<string, unknown>>;
}

export function parseHistoryEntry(entry: HistoryRaw): HistoryEntry {
  const statusStr = entry.status?.status_str ?? 'unknown';
  const files: ComfyOutputFile[] = [];
  for (const nodeOut of Object.values(entry.outputs ?? {})) {
    for (const val of Object.values(nodeOut)) {
      if (!Array.isArray(val)) continue;
      for (const item of val) {
        if (item && typeof item === 'object' && 'filename' in item) {
          const f = item as { filename: string; subfolder?: string; type?: string };
          files.push({ filename: f.filename, subfolder: f.subfolder ?? '', type: f.type ?? 'output' });
        }
      }
    }
  }
  let error: string | undefined;
  if (statusStr === 'error') {
    const msg = entry.status?.messages?.find((m) => m[0] === 'execution_error')?.[1] as
      | { node_id?: string; node_type?: string; exception_type?: string; exception_message?: string }
      | undefined;
    error = msg
      ? `${msg.node_type ?? msg.node_id}: ${msg.exception_type ?? 'Error'}: ${(msg.exception_message ?? '').trim()}`
      : 'Execution failed';
  }
  const status =
    statusStr === 'success' && entry.status?.completed
      ? 'success'
      : statusStr === 'error'
        ? 'error'
        : statusStr === 'interrupted'
          ? 'interrupted'
          : 'running';
  return { status, error, files };
}
