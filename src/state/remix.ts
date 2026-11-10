// What a remix performs: which seed and which melody plan. Pure (no Tauri),
// so the rules are unit-tested; the Remix screen only collects the choices.

import type { Song, SongSpec } from '@engine/domain/types';
import { randomSeed } from '@engine/domain/types';

/** Whether a remix of this song can keep its melody (it performed a saved plan). */
export function canKeepMelody(song: Song): boolean {
  return !!song.planAbc?.trim() && song.spec.planMode !== 'off';
}

export interface RemixChoice {
  /** "Feel: Keep original" — perform with the original seed. */
  keepSeed: boolean;
  /** "Melody: Keep melody" — re-perform the original's plan. */
  keepMelody: boolean;
  /** A hand-edited plan from the Advanced field; performed as written. */
  editedAbc?: string;
}

/**
 * Whether the editor offers Keep / New melody for this draft: the original
 * has a saved plan, and the draft neither turns the plan off, asks for a
 * different kind of plan, nor carries a hand-edited one.
 */
export function offersMelodyChoice(original: Song, spec: SongSpec, editedAbc?: string): boolean {
  return canKeepMelody(original)
    && spec.planMode !== 'off'
    && spec.planMode === original.spec.planMode
    && !editedAbc?.trim();
}

/**
 * Whether the choices force a new seed. The melody plan is written from the
 * caption, lyrics, plan mode and seed, and the same inputs write the same plan
 * (verified 2026-11-10: byte-identical takes). So "New melody" with the
 * original seed would sing the original tune again — and with nothing else
 * edited, the identical song. A new melody therefore always comes with a new
 * seed.
 */
export function remixNeedsNewSeed(original: Song, spec: SongSpec, choice: RemixChoice): boolean {
  return offersMelodyChoice(original, spec, choice.editedAbc) && !choice.keepMelody;
}

/**
 * The seed and plan a remix performs. "Keep melody" re-performs the
 * original's plan (the same plan with a new seed, or with an edited lyric
 * line, keeps a recognizable melody — voices and instruments can shift; with
 * the same seed and unchanged inputs it is the identical performance). A
 * hand-edited plan wins; a changed plan mode writes a new plan; plan mode
 * "off" performs none.
 */
export function remixTake(
  original: Song,
  spec: SongSpec,
  choice: RemixChoice,
  newSeed: () => string = randomSeed,
): { seed: string; abc: string | undefined } {
  const keepSeed = choice.keepSeed && !remixNeedsNewSeed(original, spec, choice);
  const seed = keepSeed ? original.spec.seed : newSeed();
  if (spec.planMode === 'off') return { seed, abc: undefined };
  if (choice.editedAbc?.trim()) return { seed, abc: choice.editedAbc };
  const keep = choice.keepMelody && spec.planMode === original.spec.planMode && canKeepMelody(original);
  return { seed, abc: keep ? original.planAbc : undefined };
}
