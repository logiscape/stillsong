// VRAM arbiter: the songwriter (llama-server) and the Music 3 weights
// (ComfyUI) must not be resident simultaneously on a 16 GB card (Gemma 12B
// ≈ 8 GB + the 8.8 GB text encoder; measured contention made a 20 s render
// take ~6× longer). Probe-before-transition — cached state is never trusted
// for a handoff. Stopping the LLM is deterministic: the supervisor's stopLlm
// resolves only when the process has exited.

import type { Clock, Runtime } from '../ports';
import type { ComfyClient } from '../comfy/client';
import type { LlmClient } from '../cowriter/llmClient';

export type VramOwner = 'idle' | 'llm' | 'comfy';

/** How long to wait for llama-server to come up (model load from disk included). */
const LLM_HEALTH_TIMEOUT_MS = 180_000;
const LLM_HEALTH_POLL_MS = 1_000;

export class VramArbiter {
  private epoch = 0;
  /** Best-effort belief; transitions always re-probe. */
  owner: VramOwner = 'idle';

  constructor(
    private readonly runtime: Runtime,
    private readonly comfy: ComfyClient,
    private readonly llm: LlmClient,
    private readonly clock: Clock,
  ) {}

  /**
   * Ensure the GPU is clear of the LLM and ComfyUI is actually up before a
   * render. startComfy is what reaches the supervisor's crash-restart-once
   * when ComfyUI died mid-session (found live: without it, every render after
   * a ComfyUI crash failed on a dead port until the app restarted).
   */
  async acquireForComfy(): Promise<void> {
    const myEpoch = ++this.epoch;
    await this.runtime.stopLlm(); // resolves when the process is gone
    if (this.epoch !== myEpoch) return; // superseded by a newer transition
    await this.runtime.startComfy();
    if (this.epoch !== myEpoch) return;
    this.owner = 'comfy';
  }

  /**
   * Ensure ComfyUI's models are out of VRAM, then bring the LLM up and wait
   * until it answers health checks. Refuses while a render is running —
   * callers should queue behind it.
   */
  async acquireForLlm(): Promise<void> {
    const myEpoch = ++this.epoch;
    const queue = await this.comfy.queue().catch(() => null);
    if (queue && queue.runningPromptIds.length > 0) {
      throw new VramBusyError('A song is rendering; the writer will run when it finishes.');
    }
    if (this.epoch !== myEpoch) return;
    await this.comfy.free().catch(() => {
      /* ComfyUI down = nothing loaded */
    });
    await this.runtime.startLlm();
    await this.waitForLlmHealthy();
    this.owner = 'llm';
  }

  /** After a co-writer batch, stop the LLM so renders start clean. */
  async releaseLlm(): Promise<void> {
    await this.runtime.stopLlm().catch(() => {});
    if (this.owner === 'llm') this.owner = 'idle';
  }

  private async waitForLlmHealthy(): Promise<void> {
    const deadline = this.clock.now() + LLM_HEALTH_TIMEOUT_MS;
    for (;;) {
      if (await this.llm.isHealthy()) return;
      if (this.clock.now() > deadline) {
        throw new Error('The songwriter did not come up in time.');
      }
      await new Promise<void>((resolve) => this.clock.setTimeout(resolve, LLM_HEALTH_POLL_MS));
    }
  }
}

export class VramBusyError extends Error {}
