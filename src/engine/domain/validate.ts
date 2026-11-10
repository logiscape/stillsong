import { DURATION, type SongSpec } from './types';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

const SEED_MAX = 18446744073709551615n;
/** YuE2GenerateMusic max_duration range (nodes_yue2.py). */
const MAX_DURATION_LIMIT = 900;
const PLAN_MODES = new Set(['full', 'melody', 'off']);

export function validateSpec(spec: SongSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!spec.caption.trim()) issues.push({ severity: 'error', message: 'Caption is empty.' });
  if (!spec.instrumental && !spec.lyrics.trim()) {
    issues.push({ severity: 'warning', message: 'Lyrics are empty — the model will improvise or stay instrumental.' });
  }
  if (!Number.isFinite(spec.durationSec) || spec.durationSec < DURATION.min || spec.durationSec > MAX_DURATION_LIMIT) {
    issues.push({ severity: 'error', message: `Duration cap must be between ${DURATION.min} and ${MAX_DURATION_LIMIT} seconds.` });
  }
  if (!Number.isFinite(spec.targetSec) || spec.targetSec < DURATION.min || spec.targetSec > DURATION.max) {
    issues.push({ severity: 'error', message: `Target length must be between ${DURATION.min} and ${DURATION.max} seconds.` });
  } else if (spec.durationSec < spec.targetSec) {
    issues.push({ severity: 'warning', message: 'The render cap is below the target length — the song will probably be cut off.' });
  }
  if (!/^\d+$/.test(spec.seed) || BigInt(spec.seed) > SEED_MAX) {
    issues.push({ severity: 'error', message: 'Seed must be a non-negative integer.' });
  }
  if (!Number.isInteger(spec.steps) || spec.steps < 1 || spec.steps > 200) {
    issues.push({ severity: 'error', message: 'Steps must be between 1 and 200.' });
  }
  if (!(spec.cfg >= 0 && spec.cfg <= 100)) issues.push({ severity: 'error', message: 'CFG must be between 0 and 100.' });
  if (!spec.checkpoint) issues.push({ severity: 'error', message: 'No music model file selected.' });
  if (!PLAN_MODES.has(spec.planMode)) issues.push({ severity: 'error', message: 'Unknown melody plan mode.' });
  if (spec.abc?.trim() && spec.planMode === 'off') {
    issues.push({ severity: 'warning', message: 'A melody plan is set but planning is off — the plan will be ignored.' });
  }
  return issues;
}

/** Snap to the 0.04 s grid (one music token at 25 per second). */
export function snapDuration(sec: number): number {
  return Math.round(sec * 25) / 25;
}
