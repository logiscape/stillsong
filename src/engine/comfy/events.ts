// Parses ComfyUI WebSocket messages into typed progress events with
// human-readable phases and a rolling per-step ETA.
//
// Music 3 specifics (verified live on 0.33.3): the AR encoder emits
// `progress` events with max = max_duration × 25 (audio frames), and
// `progress.data.node` identifies the emitting node, so a step event carries
// the phase of the node it belongs to (encode = composing, sample = rendering).

import { NODE_PHASES } from './graphBuilder';

export type ProgressEvent =
  | { kind: 'queue_status'; queueRemaining: number }
  | { kind: 'started'; promptId: string }
  | { kind: 'phase'; promptId: string; nodeId: string; phase: string }
  | { kind: 'step'; promptId: string; nodeId: string; phase: string; value: number; max: number; etaSeconds: number | null }
  | { kind: 'completed'; promptId: string }
  | { kind: 'error'; promptId: string; message: string }
  | { kind: 'interrupted'; promptId: string };

export class ProgressTracker {
  private stepTimes: number[] = [];
  private lastStepAt: number | null = null;
  private lastStepNode: string | null = null;
  private lastStepValue = 0;

  /** Returns null for messages that don't concern job progress. */
  parse(raw: string, now: number): ProgressEvent | null {
    let msg: { type: string; data: Record<string, unknown> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return null; // binary preview frames arrive as non-JSON; ignore
    }
    const d = msg.data ?? {};
    const promptId = String(d.prompt_id ?? '');
    switch (msg.type) {
      case 'status': {
        const remaining = (d.status as { exec_info?: { queue_remaining?: number } })?.exec_info?.queue_remaining ?? 0;
        return { kind: 'queue_status', queueRemaining: remaining };
      }
      case 'execution_start':
        this.reset();
        return { kind: 'started', promptId };
      case 'executing': {
        if (d.node === null) return { kind: 'completed', promptId };
        const nodeId = String(d.node);
        return { kind: 'phase', promptId, nodeId, phase: NODE_PHASES[nodeId] ?? 'Processing' };
      }
      case 'progress': {
        const value = Number(d.value ?? 0);
        const max = Number(d.max ?? 0);
        const nodeId = d.node == null ? 'sample' : String(d.node);
        if (nodeId !== this.lastStepNode) {
          // New progress bar (encode -> sample): restart the ETA window.
          this.reset();
          this.lastStepNode = nodeId;
        }
        if (this.lastStepAt !== null && value > this.lastStepValue) {
          // Per-unit time, so bursts of several units per message still average correctly.
          this.stepTimes.push((now - this.lastStepAt) / (value - this.lastStepValue));
          if (this.stepTimes.length > 12) this.stepTimes.shift();
        }
        this.lastStepAt = now;
        this.lastStepValue = value;
        let eta: number | null = null;
        if (this.stepTimes.length >= 2 && max > value) {
          const avg = this.stepTimes.reduce((a, b) => a + b, 0) / this.stepTimes.length;
          eta = ((max - value) * avg) / 1000;
        }
        return { kind: 'step', promptId, nodeId, phase: NODE_PHASES[nodeId] ?? 'Processing', value, max, etaSeconds: eta };
      }
      case 'execution_success':
        return { kind: 'completed', promptId };
      case 'execution_error': {
        const m = d as { node_type?: string; exception_type?: string; exception_message?: string };
        return {
          kind: 'error',
          promptId,
          message: `${m.node_type ?? 'node'}: ${m.exception_type ?? 'Error'}: ${(m.exception_message ?? '').trim()}`,
        };
      }
      case 'execution_interrupted':
        return { kind: 'interrupted', promptId };
      default:
        return null;
    }
  }

  private reset(): void {
    this.stepTimes = [];
    this.lastStepAt = null;
    this.lastStepNode = null;
    this.lastStepValue = 0;
  }
}
