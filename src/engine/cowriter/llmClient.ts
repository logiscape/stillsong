// Minimal client for llama-server's OpenAI-compatible API (the songwriter
// runtime). One model per server instance, so no model field is sent. The
// context size is fixed at launch (-c), not per request. Vision goes through
// the standard content-array shape with a data: URL; constrained JSON uses
// llama.cpp's `response_format: {type:"json_schema", schema}` (grammar
// sampling — the schema is enforced, not suggested).

import type { HttpTransport } from '../ports';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** base64-encoded images (no data: prefix); sent before the text part. */
  images?: string[];
}

export interface ChatOptions {
  temperature?: number;
  /** JSON schema for constrained decoding. */
  format?: Record<string, unknown>;
}

type OpenAiContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

interface OpenAiMessage {
  role: string;
  content: string | OpenAiContentPart[];
}

function toOpenAi(m: ChatMessage): OpenAiMessage {
  if (!m.images?.length) return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: [
      ...m.images.map((b64): OpenAiContentPart => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } })),
      { type: 'text', text: m.content },
    ],
  };
}

export class LlmClient {
  constructor(
    private readonly http: HttpTransport,
    public baseUrl: string,
  ) {}

  /** True once the server is up and the model is loaded (503 while loading). */
  async isHealthy(): Promise<boolean> {
    try {
      const r = await this.http.get(`${this.baseUrl}/health`);
      return r.status === 200;
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    // Non-streaming: the server sends nothing until generation completes, so
    // the request must outlive the whole generation (grammar-constrained
    // passes on the 12B have been observed over 3 minutes) — far beyond the
    // transport's 120 s default.
    const r = await this.http.postJson(
      `${this.baseUrl}/v1/chat/completions`,
      {
        messages: messages.map(toOpenAi),
        temperature: opts.temperature ?? 0.7,
        stream: false,
        response_format: opts.format ? { type: 'json_schema', schema: opts.format } : undefined,
      },
      600_000,
    );
    if (r.status !== 200) throw new Error(`Songwriter request failed (${r.status}): ${r.body.slice(0, 300)}`);
    const j = JSON.parse(r.body) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? '';
  }
}
