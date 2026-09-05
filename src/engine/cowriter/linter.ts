// Structural linter for caption + lyrics: cheap invariant checks that catch
// the common failure modes before the text reaches the music model. Errors
// trigger a repair round-trip in the co-writer; warnings are shown inline.

import type { SongSpec } from '../domain/types';
import { arrangementSections, estimateSeconds, isKnownTag, isTagsOnly, parseLyrics, tagFamily, wordCount } from './lyrics';

export interface LintIssue {
  severity: 'error' | 'warning';
  field: 'caption' | 'lyrics' | 'both';
  message: string;
}

const HEADINGS = ['Global Metadata', 'Vocal Details', 'Arrangement'] as const;

export function stripMarkdown(text: string): string {
  return text
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*[*+-]\s+/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
        .replace(/^\s*[-*_]{3,}\s*$/, '')
        .trimEnd(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function lintCaption(caption: string, spec: Pick<SongSpec, 'instrumental' | 'vocalPref'>): LintIssue[] {
  const issues: LintIssue[] = [];
  const lower = caption.toLowerCase();
  let lastIdx = -1;
  let missing = false;
  for (const h of HEADINGS) {
    // Anchored "Heading:" at a line start — a bare substring search false-positives
    // on prose ("a sparse arrangement of felt piano" reads as the Arrangement
    // heading appearing early and fires a spurious out-of-order error).
    const idx = new RegExp(`^\\s*${h}\\s*:`, 'im').exec(caption)?.index ?? -1;
    if (idx < 0) {
      issues.push({ severity: 'error', field: 'caption', message: `Caption is missing the "${h}" section.` });
      missing = true;
    } else if (idx < lastIdx) {
      issues.push({ severity: 'error', field: 'caption', message: `Caption sections are out of order ("${h}" should come later).` });
    }
    lastIdx = Math.max(lastIdx, idx);
  }
  void missing;
  const words = wordCount(caption);
  if (words < 150) issues.push({ severity: 'warning', field: 'caption', message: `Caption is short (${words} words; aim for 250–450).` });
  if (words > 500) issues.push({ severity: 'warning', field: 'caption', message: `Caption is long (${words} words; aim for 250–450).` });
  if (/^\s*#|\*\*|^\s*[-*]\s/m.test(caption)) {
    issues.push({ severity: 'warning', field: 'caption', message: 'Caption contains Markdown; it will be stripped.' });
  }
  if (/<\|[^|]*\|>/.test(caption)) issues.push({ severity: 'error', field: 'caption', message: 'Caption contains <|…|> tokens.' });
  if (/\[(intro|verse|chorus|bridge|outro)[^\]]*\]/i.test(caption)) {
    issues.push({ severity: 'warning', field: 'caption', message: 'Caption contains [section] tags — those belong in the lyrics.' });
  }
  if (spec.instrumental && !/instrumental|no vocals/.test(lower)) {
    issues.push({ severity: 'error', field: 'caption', message: 'Instrumental song, but the caption never says "instrumental" / "no vocals".' });
  }
  if (!spec.instrumental && spec.vocalPref === 'female' && !/female|woman|girl|soprano|alto|mezzo|she\b|her\b/.test(lower)) {
    issues.push({ severity: 'warning', field: 'caption', message: 'Female vocal requested, but Vocal Details never mentions it.' });
  }
  if (!spec.instrumental && spec.vocalPref === 'male' && !/\bmale|\bman\b|\bboy\b|tenor|baritone|bass\b|\bhe\b|\bhis\b/.test(lower)) {
    issues.push({ severity: 'warning', field: 'caption', message: 'Male vocal requested, but Vocal Details never mentions it.' });
  }
  return issues;
}

export function lintLyrics(lyrics: string, caption: string, spec: Pick<SongSpec, 'instrumental' | 'durationSec' | 'targetSec'>): LintIssue[] {
  const issues: LintIssue[] = [];
  const { sections, preamble } = parseLyrics(lyrics);
  if (/<\|[^|]*\|>/.test(lyrics)) issues.push({ severity: 'error', field: 'lyrics', message: 'Lyrics contain <|…|> tokens.' });
  if (sections.some((s) => s.tag === 'start')) {
    issues.push({ severity: 'error', field: 'lyrics', message: 'Remove the [start] tag — the model adds it automatically.' });
  }
  if (spec.instrumental) {
    if (!isTagsOnly(lyrics)) {
      issues.push({ severity: 'error', field: 'lyrics', message: 'Instrumental song, but the lyrics contain words. Use structural tags only (or leave empty).' });
    }
    // Sung-section tags prime the model to invent vocals (gibberish syllables) even with no words.
    const sung = [...new Set(sections.map((s) => tagFamily(s.tag)))].filter((f) => ['verse', 'pre-chorus', 'chorus', 'post-chorus', 'bridge', 'hook', 'refrain'].includes(f));
    if (sung.length) {
      issues.push({ severity: 'error', field: 'lyrics', message: `Instrumental song, but the lyrics use sung-section tags ([${sung.join('], [')}]) — the model invents vocals for them. Use only [intro], [instrumental], [solo], [outro].` });
    }
    // The model stops when the tags run out (~10–15 s each): too few tags = a short piece, no matter the target.
    const instEst = estimateSeconds(lyrics);
    if (sections.length > 0 && spec.targetSec > instEst * 1.5) {
      issues.push({ severity: 'error', field: 'lyrics', message: `Only ${sections.length} tag(s) ≈ ${instEst}s of music, but the target is ${Math.round(spec.targetSec)}s — add more [instrumental]/[solo] sections (about one tag per 12–15 seconds of target).` });
    }
  } else {
    if (!lyrics.trim()) {
      issues.push({ severity: 'warning', field: 'lyrics', message: 'Lyrics are empty.' });
    } else if (sections.length === 0) {
      issues.push({ severity: 'error', field: 'lyrics', message: 'Lyrics have no [section] tags (e.g. [verse], [chorus]).' });
    }
    if (preamble.length) {
      issues.push({ severity: 'warning', field: 'lyrics', message: `${preamble.length} line(s) appear before the first [tag].` });
    }
    if (spec.targetSec >= 60 && sections.length > 0 && !sections.some((s) => tagFamily(s.tag) === 'chorus')) {
      issues.push({ severity: 'warning', field: 'lyrics', message: 'No [chorus] — songs over a minute usually want a repeated chorus.' });
    }
  }
  for (const s of sections) {
    if (!isKnownTag(s.tag)) {
      issues.push({ severity: 'warning', field: 'lyrics', message: `Unknown tag [${s.tag}] — the model may ignore it.` });
    }
  }
  // Tags sharing a line with lyric text.
  for (const line of lyrics.split(/\r?\n/)) {
    const t = line.trim();
    if (/\[[^\]]+\]/.test(t) && t.replace(/\[[^\]]+\]/g, '').trim()) {
      issues.push({ severity: 'warning', field: 'lyrics', message: `Put the tag on its own line: "${t.slice(0, 40)}"` });
      break;
    }
  }
  const longLines = sections.flatMap((s) => s.lines).filter((l) => wordCount(l) > 12);
  if (longLines.length) {
    issues.push({ severity: 'warning', field: 'lyrics', message: `${longLines.length} line(s) exceed 12 words — keep lines to 4–8 words.` });
  }
  // Consistency with the Arrangement.
  if (caption.trim() && sections.length) {
    const arr = arrangementSections(caption);
    if (arr.size) {
      const lyricFamilies = new Set(sections.map((s) => tagFamily(s.tag)));
      const missing = [...lyricFamilies].filter((f) => !arr.has(f) && ['intro', 'verse', 'pre-chorus', 'chorus', 'post-chorus', 'bridge', 'instrumental', 'solo', 'outro'].includes(f));
      if (missing.length) {
        issues.push({ severity: 'warning', field: 'both', message: `Lyrics use [${missing.join('], [')}] but the Arrangement never describes that section.` });
      }
    }
  }
  // Length fit.
  const est = estimateSeconds(lyrics);
  if (est > 0 && lyrics.trim()) {
    if (spec.durationSec < est * 0.7) {
      issues.push({ severity: 'warning', field: 'both', message: `Lyrics need ~${est}s but the render cap is ${Math.round(spec.durationSec)}s — the song will likely cut off. Raise the length or trim lyrics.` });
    } else if (spec.targetSec > est * 2 && !spec.instrumental) {
      issues.push({ severity: 'warning', field: 'both', message: `Target ${Math.round(spec.targetSec)}s is far above the ~${est}s the lyrics need — the composer will end early or pad with long instrumental sections.` });
    }
  }
  return issues;
}

export function lintSong(spec: SongSpec): LintIssue[] {
  return [...lintCaption(spec.caption, spec), ...lintLyrics(spec.lyrics, spec.caption, spec)];
}
