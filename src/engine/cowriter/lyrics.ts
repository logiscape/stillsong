// Lyrics helpers shared by the linter and the UI: tag parsing (mirrors
// comfy/ldm/minimax_music/prompt.py normalize_lyrics — tags are case-insensitive
// and split on `[...]`), and a rough length estimate.

export const KNOWN_TAGS = [
  'intro',
  'verse',
  'pre-chorus',
  'chorus',
  'post-chorus',
  'bridge',
  'instrumental',
  'solo',
  'outro',
  'hook',
  'interlude',
  'break',
  'drop',
  'refrain',
  'verse 1',
  'verse 2',
  'verse 3',
  'chorus 1',
  'chorus 2',
] as const;

const TAG_RE = /\[([^\]]+)\]/g;

export interface LyricSection {
  tag: string; // lowercased, trimmed
  lines: string[]; // non-empty lyric lines inside the section
}

/** Normalize a tag to its family: "Verse 2" -> "verse", "Pre Chorus" -> "pre-chorus". */
export function tagFamily(tag: string): string {
  const t = tag.toLowerCase().trim().replace(/[_\s]+/g, '-').replace(/-?\d+$/, '').replace(/-$/, '');
  return t;
}

export function parseLyrics(lyrics: string): { sections: LyricSection[]; preamble: string[] } {
  const sections: LyricSection[] = [];
  const preamble: string[] = [];
  let current: LyricSection | null = null;
  for (const rawLine of lyrics.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // A line may hold a tag plus text ("[chorus] la la"); split like the tokenizer does.
    let last = 0;
    let m: RegExpExecArray | null;
    TAG_RE.lastIndex = 0;
    const parts: { tag?: string; text?: string }[] = [];
    while ((m = TAG_RE.exec(line))) {
      const before = line.slice(last, m.index).trim();
      if (before) parts.push({ text: before });
      parts.push({ tag: m[1] });
      last = m.index + m[0].length;
    }
    const tail = line.slice(last).trim();
    if (tail) parts.push({ text: tail });
    for (const p of parts) {
      if (p.tag !== undefined) {
        current = { tag: p.tag.toLowerCase().trim(), lines: [] };
        sections.push(current);
      } else if (p.text) {
        if (current) current.lines.push(p.text);
        else preamble.push(p.text);
      }
    }
  }
  return { sections, preamble };
}

export function allTags(lyrics: string): string[] {
  return parseLyrics(lyrics).sections.map((s) => s.tag);
}

export function isKnownTag(tag: string): boolean {
  const fam = tagFamily(tag);
  return (KNOWN_TAGS as readonly string[]).includes(fam) || (KNOWN_TAGS as readonly string[]).includes(tag.toLowerCase().trim());
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** True when the lyrics carry no sung words (empty or tags only). */
export function isTagsOnly(lyrics: string): boolean {
  const { sections, preamble } = parseLyrics(lyrics);
  return preamble.length === 0 && sections.every((s) => s.lines.length === 0);
}

/**
 * ~4.5 s per sung line + 15 s per wordless structural section (intro/outro/
 * instrumental/solo/interlude or any tag with no lines). Deliberately generous:
 * measured renders ran well past the old 3.5 s / 8 s estimate (a 2-line song
 * with intro+outro came out at 65–81 s).
 */
export function estimateSeconds(lyrics: string): number {
  const { sections, preamble } = parseLyrics(lyrics);
  let sec = preamble.length * 4.5;
  for (const s of sections) {
    if (s.lines.length === 0) sec += 15;
    else sec += s.lines.length * 4.5;
  }
  return Math.round(sec);
}

/** Sections mentioned in the caption's Arrangement (by family name). */
export function arrangementSections(caption: string): Set<string> {
  const m = /arrangement\s*:?\s*([\s\S]*)$/i.exec(caption);
  const text = (m?.[1] ?? caption).toLowerCase();
  const found = new Set<string>();
  // Only unambiguous section words: "drop"/"break" also appear as ordinary verbs in arrangements.
  for (const fam of ['intro', 'verse', 'pre-chorus', 'chorus', 'post-chorus', 'bridge', 'instrumental', 'solo', 'outro', 'hook', 'interlude']) {
    const re = new RegExp(`\\b${fam.replace('-', '[- ]?')}s?\\b`);
    if (re.test(text)) found.add(fam);
  }
  return found;
}
