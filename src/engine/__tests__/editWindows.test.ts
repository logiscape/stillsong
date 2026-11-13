import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { editWindows, mergeWindows, padWindows, parseAlignSeries, sungSpans, windowSeconds } from '@engine/domain/editWindows';
import { editedLineCount } from '@engine/cowriter/lyrics';

// Measured series (see the file's `about`), in hundredths of a nat.
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/alignment.json', import.meta.url)), 'utf8')) as Record<string, number[]>;
const series = (name: string) => fixture[name].map((v) => v / 100);

/** A quiet series (deterministic noise of about +-0.05) with -2 dips over the given spans. */
function synthetic(frames: number, dips: [number, number][]): number[] {
  return Array.from({ length: frames }, (_, i) => {
    const noise = (((i * 7919) % 101) - 50) / 1000;
    return dips.some(([a, b]) => i >= a && i < b) ? -2 + noise : noise;
  });
}

describe('editWindows on measured series', () => {
  it('finds the four edited lines of The Last Ember as one window', () => {
    // Line 1 is sung at 81.5-83.5 s, lines 2-4 at 87.6-97.0 s; four seconds
    // of kept music between them is not worth two more seams.
    expect(sungSpans(series('emberFourLines'))).toEqual([[2037, 2424]]);
    expect(editWindows(series('emberFourLines'))).toEqual([[2025, 2436]]);
  });

  it('finds a chorus line in the one chorus where it was changed', () => {
    // Iron Ghost sings that line in three choruses (about 105 s, 160 s and
    // 235 s); only the second was edited.
    const windows = editWindows(series('ghostChorusTwo'));
    expect(windows).toEqual([[3978, 4037]]);
    expect(windowSeconds(windows)).toBeCloseTo(2.36, 2);
  });

  it('sees the tail of an old word left just past a re-sung window', () => {
    // The check on the take re-sung over [3978, 4037): the old last word's
    // tail sits at 161.3-161.8 s.
    const leftover = editWindows(series('ghostChorusLeftover'));
    expect(leftover).toEqual([[4020, 4057]]);
    // Widening: the next attempt re-sings both, as one window.
    expect(mergeWindows([[3978, 4037]], leftover)).toEqual([[3978, 4057]]);
  });
});

describe('editWindows', () => {
  // The half-second smoothing widens a hard-edged synthetic dip by 5 frames
  // either side before the 12-frame pad; real dips are onsets, not blocks.
  it('keeps lines far apart as separate windows', () => {
    expect(editWindows(synthetic(5000, [[600, 650], [2300, 2330]]))).toEqual([
      [583, 667],
      [2283, 2347],
    ]);
  });

  it('joins spans closer than five seconds', () => {
    expect(editWindows(synthetic(5000, [[600, 650], [770, 800]]))).toEqual([[583, 817]]);
    expect(editWindows(synthetic(5000, [[600, 650], [800, 830]]))).toEqual([
      [583, 667],
      [783, 847],
    ]);
  });

  it('finds nothing in a quiet series', () => {
    expect(editWindows(synthetic(5000, []))).toEqual([]);
    expect(editWindows(new Array(5000).fill(0))).toEqual([]);
  });

  it('ignores a wobble well above the dips', () => {
    const wobble = synthetic(5000, []).map((v, i) => (i >= 1000 && i < 1040 ? v - 0.15 : v));
    expect(editWindows(wobble)).toEqual([]);
  });

  it('clamps windows to the take', () => {
    expect(editWindows(synthetic(1000, [[0, 30], [980, 1000]]))).toEqual([
      [0, 47],
      [963, 1000],
    ]);
    expect(padWindows([[5, 20]], 25)).toEqual([[0, 25]]);
  });

  it('merges overlapping and touching windows', () => {
    expect(mergeWindows([[10, 20], [40, 50]], [[18, 30], [50, 60]])).toEqual([
      [10, 30],
      [40, 60],
    ]);
  });
});

describe('parseAlignSeries', () => {
  it('reads the node output', () => {
    expect(parseAlignSeries('{"frames":3,"drop":[0,-1.5,0.2]}')).toEqual({ frames: 3, drop: [0, -1.5, 0.2] });
  });

  it('rejects anything else', () => {
    expect(parseAlignSeries(undefined)).toBeNull();
    expect(parseAlignSeries('')).toBeNull();
    expect(parseAlignSeries('not json')).toBeNull();
    expect(parseAlignSeries('{"frames":0,"drop":[]}')).toBeNull();
    expect(parseAlignSeries('{"drop":[1,"x"]}')).toBeNull();
  });
});

describe('editedLineCount', () => {
  const sheet = '[verse]\nOne small spark\nA face I knew\n\n[chorus]\nOne spark in the black\n\n[outro]';

  it('counts lines whose words changed', () => {
    expect(editedLineCount(sheet, sheet)).toBe(0);
    expect(editedLineCount(sheet, sheet.replace('A face I knew', 'A song I hummed'))).toBe(1);
    expect(editedLineCount(sheet, sheet.replace('One small spark', 'One last light').replace('in the black', 'in the dark'))).toBe(2);
  });

  it('ignores blank lines and spacing around a line', () => {
    expect(editedLineCount(sheet, sheet.replace('\n\n[chorus]', '\n[chorus]').replace('A face I knew', '  A face I knew  '))).toBe(0);
  });

  it('is null when the shape of the song changed', () => {
    expect(editedLineCount(sheet, sheet + '\nStill I see you')).toBeNull(); // a line added
    expect(editedLineCount(sheet, sheet.replace('A face I knew\n', ''))).toBeNull(); // a line removed
    expect(editedLineCount(sheet, sheet.replace('[chorus]', '[bridge]'))).toBeNull(); // retagged
    expect(editedLineCount(sheet, sheet.replace('\n\n[outro]', ''))).toBeNull(); // a section removed
    expect(editedLineCount(sheet, 'A new first line\n' + sheet)).toBeNull(); // a line before the first tag
  });
});
