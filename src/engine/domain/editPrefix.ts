// Where to cut a saved composition when its lyrics are edited (same-seed
// remix). Everything before the cut is teacher-forced — bit-exact by
// construction; everything after is re-composed with the new words (measured:
// generation diverges immediately after the forced prefix once the prompt
// changed, so nothing after the cut survives — the cut IS the boundary of
// what's kept).
//
// There is no word-level timing, so the cut is estimated: sections before the
// first edited one, scaled by the same per-line model estimateSeconds uses,
// mapped onto the composition's real length. The safety factor errs early —
// cutting early loses a little pre-edit material (re-composed in the same
// style); cutting late would force frames where the OLD words are being sung.

import { AUDIO_FRAMES_PER_SECOND } from './types';
import { parseLyrics, type LyricSection } from '../cowriter/lyrics';

const SAFETY = 0.9;

function sectionSeconds(s: LyricSection): number {
  return s.lines.length === 0 ? 15 : s.lines.length * 4.5;
}

function sameSection(a: LyricSection, b: LyricSection): boolean {
  return a.tag === b.tag && a.lines.length === b.lines.length && a.lines.every((l, i) => l === b.lines[i]);
}

/**
 * Frames of the original composition to keep when re-rendering with edited
 * lyrics: 0 = nothing forcible (edit at the very start, or preamble changed),
 * Infinity = lyrics are unchanged (force everything).
 */
export function editPrefixFrames(originalLyrics: string, editedLyrics: string, totalFrames: number): number {
  const orig = parseLyrics(originalLyrics);
  const edited = parseLyrics(editedLyrics);
  if (orig.preamble.join('\n') !== edited.preamble.join('\n')) return 0;

  let firstEdited = orig.sections.length;
  for (let i = 0; i < Math.max(orig.sections.length, edited.sections.length); i++) {
    if (!orig.sections[i] || !edited.sections[i] || !sameSection(orig.sections[i], edited.sections[i])) {
      firstEdited = i;
      break;
    }
  }
  if (firstEdited >= orig.sections.length) {
    // Nothing original was edited: unchanged lyrics force everything; purely
    // appended sections keep the whole original (no safety shave — the cut
    // isn't near edited material) and compose the new ending after it.
    return orig.sections.length === edited.sections.length ? Infinity : totalFrames;
  }
  if (firstEdited === 0) return 0;

  const before = orig.sections.slice(0, firstEdited).reduce((sec, s) => sec + sectionSeconds(s), 0);
  const total = orig.sections.reduce((sec, s) => sec + sectionSeconds(s), 0) + orig.preamble.length * 4.5;
  if (total <= 0) return 0;
  return Math.max(0, Math.floor((before / total) * totalFrames * SAFETY));
}

/** A song's composition length in frames, from what the encoder reported. */
export function compositionFrames(actualSec: number | undefined, durationSec: number): number {
  return Math.round((actualSec ?? durationSec) * AUDIO_FRAMES_PER_SECOND);
}
