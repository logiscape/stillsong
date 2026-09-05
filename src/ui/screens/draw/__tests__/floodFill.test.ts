// The scanline fill is the only pixel algorithm we wrote ourselves — pin its
// boundary behavior, tolerance, and no-op cases on small grids.

import { describe, expect, it } from 'vitest';
import { floodFill } from '../floodFill';

const W = 8;
const H = 8;

/** Build an RGBA grid from single-letter cell codes. */
const COLORS: Record<string, [number, number, number, number]> = {
  '.': [255, 255, 255, 255], // white paper
  '#': [38, 32, 27, 255], // ink wall
  '~': [245, 245, 245, 255], // near-white (soft anti-aliased edge)
  r: [201, 71, 61, 255], // red
};

function grid(rows: string[]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      data.set(COLORS[ch], (y * W + x) * 4);
    });
  });
  return data;
}

function at(data: Uint8ClampedArray, x: number, y: number): [number, number, number, number] {
  const i = (y * W + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

const RED = COLORS.r;

describe('floodFill', () => {
  it('fills an enclosed region and stops at the walls', () => {
    const data = grid([
      '........',
      '.######.',
      '.#....#.',
      '.#....#.',
      '.#....#.',
      '.######.',
      '........',
      '........',
    ]);
    expect(floodFill(data, W, H, 3, 3, RED)).toBe(true);
    expect(at(data, 2, 2)).toEqual(RED); // inside filled
    expect(at(data, 5, 4)).toEqual(RED);
    expect(at(data, 0, 0)).toEqual(COLORS['.']); // outside untouched
    expect(at(data, 0, 7)).toEqual(COLORS['.']);
    expect(at(data, 1, 5)).toEqual(COLORS['#']); // walls untouched
  });

  it('tolerance absorbs a near-target soft edge; zero tolerance does not', () => {
    const soft = ['~.......', '........', '........', '........', '........', '........', '........', '........'];
    const a = grid(soft);
    expect(floodFill(a, W, H, 4, 4, RED, 24)).toBe(true);
    expect(at(a, 0, 0)).toEqual(RED); // near-white swallowed by tolerance

    const b = grid(soft);
    expect(floodFill(b, W, H, 4, 4, RED, 0)).toBe(true);
    expect(at(b, 0, 0)).toEqual(COLORS['~']); // exact match leaves it as a halo
  });

  it('no-ops when the seed already has the fill color, or is out of bounds', () => {
    const data = grid(['rrrr....', 'rrrr....', '........', '........', '........', '........', '........', '........']);
    expect(floodFill(data, W, H, 1, 1, RED)).toBe(false);
    expect(floodFill(data, W, H, -1, 0, RED)).toBe(false);
    expect(floodFill(data, W, H, 0, H, RED)).toBe(false);
    expect(at(data, 5, 5)).toEqual(COLORS['.']);
  });

  it('a wall within tolerance of the fill color still bounds the fill', () => {
    // Fill white with white-ish? No — fill the paper with a color whose
    // tolerance band includes already-filled pixels: the p !== fill guard
    // must keep the scan from re-matching what it just wrote.
    const data = grid(['........', '........', '........', '........', '........', '........', '........', '........']);
    const nearWhite: [number, number, number, number] = [250, 250, 250, 255];
    expect(floodFill(data, W, H, 4, 4, nearWhite, 24)).toBe(true);
    expect(at(data, 0, 0)).toEqual(nearWhite);
    expect(at(data, 7, 7)).toEqual(nearWhite);
  });
});
