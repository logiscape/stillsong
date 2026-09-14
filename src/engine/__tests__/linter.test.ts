import { describe, expect, it } from 'vitest';
import { arrangementSections, estimateSeconds, isTagsOnly, parseLyrics, stripStageDirections, tagFamily } from '@engine/cowriter/lyrics';
import { lintCaption, lintLyrics, stripMarkdown } from '@engine/cowriter/linter';
import { genreTag } from '@engine/domain/types';

const GOOD_CAPTION = `Global Metadata: Indie folk with a light Americana lean. Around 80 bpm, key is G, scale is major. ${'Warm and hopeful, builds gently. '.repeat(12)}

Vocal Details: Female lead, warm alto, intimate delivery in the verses, opening up in the chorus. Soft double-tracked harmonies on the chorus. ${'Light plate reverb. '.repeat(10)}

Arrangement: Intro: fingerpicked acoustic guitar alone. Verse: guitar and a soft upright bass. Chorus: brushed drums enter, harmonies lift. Bridge: drums drop out, piano enters. Outro: guitar alone again. ${'Subtle textures throughout. '.repeat(12)}`;

describe('lyrics helpers', () => {
  it('parses tags case-insensitively, including tags sharing a line', () => {
    const { sections, preamble } = parseLyrics('stray\n[Intro]\n\n[Verse 1]\nline one\nline two\n[chorus] la la\n[Outro]');
    expect(preamble).toEqual(['stray']);
    expect(sections.map((s) => s.tag)).toEqual(['intro', 'verse 1', 'chorus', 'outro']);
    expect(sections[1].lines).toEqual(['line one', 'line two']);
    expect(sections[2].lines).toEqual(['la la']);
    expect(tagFamily('Verse 2')).toBe('verse');
    expect(tagFamily('Pre Chorus')).toBe('pre-chorus');
  });

  it('detects tag-only lyrics and estimates length', () => {
    expect(isTagsOnly('[intro]\n[instrumental]\n[outro]')).toBe(true);
    expect(isTagsOnly('')).toBe(true);
    expect(isTagsOnly('[verse]\nwords')).toBe(false);
    // 2 wordless sections (30s) + 4 lines (18s)
    expect(estimateSeconds('[intro]\n[verse]\na\nb\nc\nd\n[outro]')).toBe(48);
  });

  it('finds sections named in the arrangement', () => {
    const s = arrangementSections(GOOD_CAPTION);
    expect([...s].sort()).toEqual(['bridge', 'chorus', 'intro', 'outro', 'verse']);
  });

  it('derives a genre tag from Global Metadata', () => {
    expect(genreTag(GOOD_CAPTION)).toBe('Indie folk with a light Americana lean');
  });
});

describe('stripStageDirections', () => {
  it('removes directions, dropping a line that held nothing else', () => {
    const lyrics = '[verse]\n(foghorn sound)\nSailing home (whispers) alone\nThe harbour lights (softly, almost spoken)\n\n[chorus]\nHold on';
    expect(stripStageDirections(lyrics)).toBe('[verse]\nSailing home alone\nThe harbour lights\n\n[chorus]\nHold on');
  });

  it('keeps vocable ad-libs, whatever the case or punctuation', () => {
    expect(stripStageDirections('Lead me home (ooh)')).toBe('Lead me home (ooh)');
    expect(stripStageDirections('Lead me home (Ooh, ooh...)')).toBe('Lead me home (Ooh, ooh...)');
    expect(stripStageDirections('(Yeah!)\nLead me home')).toBe('(Yeah!)\nLead me home');
    // A vocable mixed with a direction is still a direction.
    expect(stripStageDirections('Lead me home (ooh, whispered)')).toBe('Lead me home');
  });

  it('keeps a backing-vocal echo of a line sung elsewhere', () => {
    const lyrics = '[chorus]\nLight of the moon, lead me through\n(lead me through)\nInto the night (into the dark)';
    expect(stripStageDirections(lyrics)).toBe('[chorus]\nLight of the moon, lead me through\n(lead me through)\nInto the night');
  });

  it('handles non-Latin lyrics: echoes survive, directions in fullwidth parentheses go', () => {
    const ja = '[chorus]\n君の声\n(君の声)\n夜の海へ（ささやき）\n（フォグホーンの音）\n[outro]';
    expect(stripStageDirections(ja)).toBe('[chorus]\n君の声\n(君の声)\n夜の海へ\n[outro]');
    const ko = '[verse]\n그대의 목소리가 들려\n(그대의 목소리가 들려)\n(속삭이듯)';
    expect(stripStageDirections(ko)).toBe('[verse]\n그대의 목소리가 들려\n(그대의 목소리가 들려)');
    expect(stripStageDirections('[verse]\n月光照我心\n(照我心)\n(低语)')).toBe('[verse]\n月光照我心\n(照我心)');
  });

  it('does not mistake a direction for an echo because its word is sung mid-line', () => {
    const lyrics = '[verse]\nThe whispers of the sea\n(whispers)\nCall me softly home\n(softly)\n(the sea)';
    expect(stripStageDirections(lyrics)).toBe('[verse]\nThe whispers of the sea\nCall me softly home\n(the sea)');
  });

  it('tidies punctuation left behind and leaves everything else alone', () => {
    expect(stripStageDirections('Sailing home (foghorn), alone')).toBe('Sailing home, alone');
    expect(stripStageDirections('A smile (half a smile')).toBe('A smile (half a smile');
    expect(stripStageDirections('[intro]\n\n[verse]\nNo directions here\n\n[outro]')).toBe('[intro]\n\n[verse]\nNo directions here\n\n[outro]');
    expect(stripStageDirections('')).toBe('');
  });
});

describe('lintCaption', () => {
  it('accepts a well-formed caption', () => {
    expect(lintCaption(GOOD_CAPTION, { instrumental: false, vocalPref: 'female' }).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('flags missing/misordered headings, markdown, and instrumental contradictions', () => {
    const issues = lintCaption('Arrangement: **x**\nGlobal Metadata: y', { instrumental: true, vocalPref: 'any' });
    const msgs = issues.map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/Vocal Details/);
    expect(msgs).toMatch(/out of order/);
    expect(msgs).toMatch(/Markdown/);
    expect(msgs).toMatch(/instrumental/i);
  });

  it('does not mistake prose mentions of section words for headings', () => {
    // "arrangement" in Global Metadata prose sits before the Vocal Details
    // heading — the old substring check called that "out of order".
    const caption = `Global Metadata: Instrumental, no vocals. A sparse arrangement of felt piano, warm and quiet. ${'Calm, patient, glowing. '.repeat(10)}

Vocal Details: Instrumental, no vocals, no humming. A felt piano carries the lead melody. ${'Soft hall reverb. '.repeat(8)}

Arrangement: Intro: lone piano. Instrumental sections: arpeggios build, strings enter and swell. Solo: cello lead. Outro: piano alone rings out. ${'Gentle textures. '.repeat(10)}`;
    expect(lintCaption(caption, { instrumental: true, vocalPref: 'instrumental' }).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('stripMarkdown removes headings, bullets and emphasis', () => {
    expect(stripMarkdown('## Global Metadata\n- **Genre**: *pop*\n\n\n---\ntext')).toBe('Global Metadata\nGenre: pop\n\ntext');
  });
});

describe('lintLyrics', () => {
  it('accepts tagged lyrics consistent with the arrangement', () => {
    const lyrics = '[intro]\n[verse]\n' + 'short line here\n'.repeat(6) + '[chorus]\n' + 'sing it loud\n'.repeat(4) + '[bridge]\nquiet now\n[outro]';
    const issues = lintLyrics(lyrics, GOOD_CAPTION, { instrumental: false, targetSec: 90, durationSec: 90 });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(issues.map((i) => i.message).join(' ')).not.toMatch(/never describes/);
  });

  it('flags [start], missing tags, words in instrumentals, unknown tags, and duration mismatch', () => {
    expect(lintLyrics('[start]\n[verse]\nx', '', { instrumental: false, targetSec: 60, durationSec: 60 }).map((i) => i.message).join()).toMatch(/\[start\]/);
    expect(lintLyrics('just words', '', { instrumental: false, targetSec: 60, durationSec: 60 }).some((i) => i.severity === 'error')).toBe(true);
    expect(lintLyrics('[verse]\nwords', '', { instrumental: true, targetSec: 60, durationSec: 60 }).some((i) => i.severity === 'error')).toBe(true);
    expect(lintLyrics('[banana]\nwords', '', { instrumental: false, targetSec: 30, durationSec: 30 }).map((i) => i.message).join()).toMatch(/Unknown tag/);
    const long = '[verse]\n' + 'la la la\n'.repeat(40);
    expect(lintLyrics(long, '', { instrumental: false, targetSec: 30, durationSec: 30 }).map((i) => i.message).join()).toMatch(/cut off/);
    expect(lintLyrics('[verse]\none line\n[chorus]\ntwo', '', { instrumental: false, targetSec: 300, durationSec: 300 }).map((i) => i.message).join()).toMatch(/end early/);
  });

  it('flags sung-section tags in instrumentals, accepts the instrumental tag set', () => {
    const bad = lintLyrics('[intro]\n[verse]\n[chorus]\n[outro]', '', { instrumental: true, targetSec: 60, durationSec: 60 });
    expect(bad.filter((i) => i.severity === 'error').map((i) => i.message).join()).toMatch(/\[verse\], \[chorus\]/);
    const good = lintLyrics('[intro]\n[instrumental]\n[solo]\n[instrumental]\n[outro]', '', { instrumental: true, targetSec: 60, durationSec: 60 });
    expect(good.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('flags instrumentals with too few tags to fill the target', () => {
    // 5 wordless tags ≈ 75 s: fine for 60 s (above), an error at 180 s.
    const short = lintLyrics('[intro]\n[instrumental]\n[solo]\n[instrumental]\n[outro]', '', { instrumental: true, targetSec: 180, durationSec: 180 });
    expect(short.filter((i) => i.severity === 'error').map((i) => i.message).join()).toMatch(/add more \[instrumental\]/);
  });

  it('warns when lyric sections are absent from the arrangement', () => {
    const issues = lintLyrics('[verse]\nx\n[solo]\n[chorus]\ny', GOOD_CAPTION, { instrumental: false, targetSec: 60, durationSec: 60 });
    expect(issues.map((i) => i.message).join()).toMatch(/\[solo\]/);
  });
});
