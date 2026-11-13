// What a remix performs: which seed and which melody plan. Pure (no Tauri),
// so the rules are unit-tested; the Remix screen only collects the choices.

import type { Song, SongSpec } from '@engine/domain/types';
import { randomSeed } from '@engine/domain/types';
import { editedLineCount } from '@engine/cowriter/lyrics';

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
 * Whether part of this song's recording can be sung again while the rest is
 * kept: it saved its take (songs made by a studio with its own nodes do) and
 * the plan it performed, and it has words to change.
 */
export function canKeepRest(song: Song): boolean {
  return !!song.takePath?.trim() && canKeepMelody(song) && !song.spec.instrumental;
}

/**
 * Whether the editor offers "Keep the rest" for this draft: the only change
 * to the song itself is the words of existing lines. A changed caption, plan,
 * plan mode, steps or guidance asks for a different performance; added or
 * removed lines change the song's shape and length. The title and the MP3
 * quality may change freely.
 */
export function offersKeepRest(original: Song, spec: SongSpec, editedAbc?: string): boolean {
  return canKeepRest(original)
    && !spec.instrumental
    && !editedAbc?.trim()
    && spec.planMode === original.spec.planMode
    && spec.caption === original.spec.caption
    && spec.steps === original.spec.steps
    && spec.cfg === original.spec.cfg
    && (editedLineCount(original.spec.lyrics, spec.lyrics) ?? 0) > 0;
}

/**
 * Which way the "Recording" choice starts when it is offered and the person
 * has not touched it: keep the rest, unless they already asked for a
 * different performance (a new seed or a new melody). Rewording a line after
 * choosing "New seed" must not quietly swap that choice for the original take.
 */
export function keepsRestByDefault(choice: RemixChoice): boolean {
  return choice.keepSeed && choice.keepMelody;
}

/**
 * Whether the draft's lyrics add, remove or retag lines of a song whose
 * recording could otherwise be kept (the editor says why the choice is gone).
 */
export function reshapesLyrics(original: Song, spec: SongSpec): boolean {
  return canKeepRest(original) && editedLineCount(original.spec.lyrics, spec.lyrics) === null;
}

/**
 * The spec a "keep the rest" edit performs: the original's take is performed
 * again (its seed, its plan) with the new words, and only the changed lines
 * are sung anew. The engine finds where they are.
 */
export function keepRestTake(original: Song, spec: SongSpec): SongSpec {
  return { ...spec, seed: original.spec.seed, abc: original.planAbc, edit: { sourceId: original.id } };
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
