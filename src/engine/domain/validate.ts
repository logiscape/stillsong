import { DURATION, type SongSpec } from './types';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
}

const SEED_MAX = 18446744073709551615n;

export function validateSpec(spec: SongSpec): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!spec.caption.trim()) issues.push({ severity: 'error', message: 'Caption is empty.' });
  if (!spec.instrumental && !spec.lyrics.trim()) {
    issues.push({ severity: 'warning', message: 'Lyrics are empty — the model will improvise or stay instrumental.' });
  }
  if (!Number.isFinite(spec.durationSec) || spec.durationSec < DURATION.min || spec.durationSec > DURATION.max) {
    issues.push({ severity: 'error', message: `Duration must be between ${DURATION.min} and ${DURATION.max} seconds.` });
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
  if (!(spec.encodeCfg >= 0 && spec.encodeCfg <= 100)) {
    issues.push({ severity: 'error', message: 'Encode CFG must be between 0 and 100.' });
  }
  if (!Number.isInteger(spec.topK) || spec.topK < 1 || spec.topK > 16384) {
    issues.push({ severity: 'error', message: 'top_k must be between 1 and 16384.' });
  }
  if (!spec.ditFile) issues.push({ severity: 'error', message: 'No DiT model file selected.' });
  if (/<\|[^|]*\|>/.test(spec.caption) || /<\|[^|]*\|>/.test(spec.lyrics)) {
    issues.push({ severity: 'error', message: 'Caption/lyrics must not contain <|…|> special tokens.' });
  }
  return issues;
}

/** Snap to the encoder's 0.04 s grid (one audio frame). */
export function snapDuration(sec: number): number {
  return Math.round(sec * 25) / 25;
}
