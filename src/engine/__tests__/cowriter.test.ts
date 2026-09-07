// The deterministic instrumental tag skeleton: ~1 tag per 13 s of target,
// [intro]…[outro], [solo] at the peaks, [instrumental] everywhere else.

import { describe, expect, it } from 'vitest';
import { NO_GENRE_HINT, composeUserMessage, instrumentalSkeleton } from '@engine/cowriter/cowriter';
import { INSTRUMENTAL_EXAMPLES, VOCAL_EXAMPLES, analysisPrompt, captionGuide, fewShot } from '@engine/cowriter/guides';
import { estimateSeconds } from '@engine/cowriter/lyrics';
import { lintLyrics } from '@engine/cowriter/linter';

const tags = (s: string) => s.split('\n');

describe('instrumentalSkeleton', () => {
  it('scales tag count with the target (~9 s/tag), clamped to 3..15, bracketed by intro/outro', () => {
    expect(tags(instrumentalSkeleton(20))).toEqual(['[intro]', '[instrumental]', '[outro]']);
    const twoMin = tags(instrumentalSkeleton(120));
    expect(twoMin).toHaveLength(13);
    expect(twoMin[0]).toBe('[intro]');
    expect(twoMin[twoMin.length - 1]).toBe('[outro]');
    expect(twoMin.filter((t) => t === '[solo]')).toHaveLength(2);
    expect(tags(instrumentalSkeleton(60)).filter((t) => t === '[solo]')).toHaveLength(1);
    // Beyond ~15 tags the measured dose–response breaks down — clamp, never exceed.
    expect(tags(instrumentalSkeleton(300))).toHaveLength(15);
  });

  it('always passes its own instrumental lint at the target it was built for', () => {
    for (const target of [30, 60, 90, 120, 180, 240, 300]) {
      const skeleton = instrumentalSkeleton(target);
      const issues = lintLyrics(skeleton, '', { instrumental: true, targetSec: target, durationSec: target });
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
      // The estimate lands in the target's neighbourhood (15 s per tag).
      expect(estimateSeconds(skeleton)).toBeGreaterThanOrEqual(target * 0.75);
    }
  });
});

describe('compose controls', () => {
  const base = { idea: '', durationSec: 120, instrumental: false, vocalPref: 'any' as const };

  it('nudges toward a secondary influence only when the user gave no genre', () => {
    expect(composeUserMessage(base)).toContain(NO_GENRE_HINT);
    expect(composeUserMessage({ ...base, genreHint: '  ' })).toContain(NO_GENRE_HINT);
    const hinted = composeUserMessage({ ...base, genreHint: 'dark folk' });
    expect(hinted).toContain('Genre / mood hint: dark folk.');
    expect(hinted).not.toContain(NO_GENRE_HINT);
  });
});

describe('split prompt assembly', () => {
  const vocal = `${captionGuide(false)}\n${fewShot(false)}`;
  const instr = `${captionGuide(true)}\n${fewShot(true)}`;

  it('vocal prompt carries vocal rules and only vocal examples', () => {
    expect(vocal).toMatch(/A clearly repeated chorus/);
    expect(vocal).toMatch(/development to the material/);
    expect(vocal).toMatch(/## Example 1 \(vocal/);
    // Instrumental-only material must not bleed in.
    expect(vocal).not.toMatch(/gibberish/);
    expect(vocal).not.toMatch(/exact tag sequence/);
    expect(vocal).not.toMatch(/## Example \d+ \(instrumental/);
  });

  it('instrumental prompt carries instrumental rules and only instrumental examples', () => {
    expect(instr).toMatch(/exact tag sequence/);
    expect(instr).toMatch(/gibberish vocals/);
    expect(instr).toMatch(/never describe two sections the same way/);
    expect(instr).toMatch(/## Example 1 \(instrumental/);
    // Vocal-only material must not bleed in.
    expect(instr).not.toMatch(/A clearly repeated chorus/);
    expect(instr).not.toMatch(/4–8 words/);
    expect(instr).not.toMatch(/## Example \d+ \(vocal/);
  });

  it('shared rules appear in both, and appended examples get numbered', () => {
    for (const p of [vocal, instr]) {
      expect(p).toMatch(/Global Metadata: genre plus at most one secondary influence/);
      expect(p).toMatch(/Mismatch is the #1 cause of structure failures/);
      expect(p).toMatch(/do not pad or cut to hit the number exactly/);
    }
    // fewShot numbers examples in array order — appending example N+1 works.
    expect(fewShot(false)).toContain('## Example 1 ');
    expect(VOCAL_EXAMPLES.length + INSTRUMENTAL_EXAMPLES.length).toBeGreaterThanOrEqual(2);
  });
});

describe('split analysis prompt (photo vs drawing)', () => {
  const photo = analysisPrompt('photo');
  const drawing = analysisPrompt('drawing');

  it('photo card keeps the photographic categories and factual framing', () => {
    expect(photo).toMatch(/looking at a photo for inspiration/);
    expect(photo).toMatch(/Setting: place, environment/);
    expect(photo).toMatch(/Time of day & light/);
    expect(photo).toMatch(/Era & culture cues/);
    expect(photo).toMatch(/Be factual about what is visible/);
    expect(photo).toMatch(/song about this photo could take/);
    // Drawing-only material must not bleed in.
    expect(photo).not.toMatch(/drawing/);
    expect(photo).not.toMatch(/stick figure/);
  });

  it('drawing card reads intent and story, never skill, never photo categories', () => {
    expect(drawing).toMatch(/show you what their song should be about/);
    expect(drawing).toMatch(/every figure, creature, object, symbol and mark/);
    expect(drawing).toMatch(/Story they want to tell/);
    expect(drawing).toMatch(/nothing in a drawing is accidental/);
    expect(drawing).toMatch(/stick figure holding a sword carries the same weight/);
    expect(drawing).toMatch(/never HOW well it is drawn/);
    expect(drawing).toMatch(/song about this drawing could take/);
    // Photo-only material must not bleed in (the photographic categories push
    // the model toward describing the artifact instead of the intent).
    expect(drawing).not.toMatch(/Setting:/);
    expect(drawing).not.toMatch(/Time of day/);
    expect(drawing).not.toMatch(/Era & culture cues/);
    expect(drawing).not.toMatch(/Be factual/);
  });

  it('shared lines appear in both, exactly once', () => {
    for (const p of [photo, drawing]) {
      expect(p.match(/Visible text: any readable text VERBATIM/g)).toHaveLength(1);
      expect(p.match(/Mood words: 5-8 evocative words/g)).toHaveLength(1);
      expect(p.match(/Song angles: three different angles/g)).toHaveLength(1);
      // The card describes the picture; the genre is the songwriter's call in the compose pass (a genre in the card overrides the user's hint).
      expect(p.match(/Name no genre, style, tempo or instruments/g)).toHaveLength(1);
      expect(p).not.toMatch(/ballad/);
      expect(p.match(/No preamble\./g)).toHaveLength(1);
    }
  });
});
