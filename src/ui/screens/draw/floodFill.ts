// Scanline flood fill over raw RGBA pixels — pure and unit-tested. Uses a
// Uint32Array view for fast compare/write and an explicit span stack (never
// recursion; a 1400² canvas would blow the call stack). The per-channel
// tolerance absorbs anti-aliased stroke edges; a faint halo can remain along
// very soft edges — the same cosmetic limit classic Paint has.

export function floodFill(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  rgba: [number, number, number, number],
  tolerance = 24,
): boolean {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const px = new Uint32Array(data.buffer, data.byteOffset, w * h);
  // Little-endian: bytes r,g,b,a read back as a|b|g|r.
  const fill = ((rgba[3] << 24) | (rgba[2] << 16) | (rgba[1] << 8) | rgba[0]) >>> 0;
  const target = px[y * w + x];
  if (target === fill) return false;

  const tr = target & 0xff;
  const tg = (target >>> 8) & 0xff;
  const tb = (target >>> 16) & 0xff;
  const ta = (target >>> 24) & 0xff;
  const matches =
    tolerance === 0
      ? (p: number) => p === target
      : (p: number) =>
          p !== fill &&
          Math.abs((p & 0xff) - tr) <= tolerance &&
          Math.abs(((p >>> 8) & 0xff) - tg) <= tolerance &&
          Math.abs(((p >>> 16) & 0xff) - tb) <= tolerance &&
          Math.abs(((p >>> 24) & 0xff) - ta) <= tolerance;

  let changed = false;
  const stack: number[] = [x, y];
  while (stack.length) {
    const sy = stack.pop()!;
    let sx = stack.pop()!;
    const row = sy * w;
    // Walk to the left edge of the matching span.
    while (sx > 0 && matches(px[row + sx - 1])) sx--;
    let above = false;
    let below = false;
    while (sx < w && matches(px[row + sx])) {
      px[row + sx] = fill;
      changed = true;
      if (sy > 0) {
        const m = matches(px[row - w + sx]);
        if (m && !above) {
          stack.push(sx, sy - 1);
          above = true;
        } else if (!m) above = false;
      }
      if (sy < h - 1) {
        const m = matches(px[row + w + sx]);
        if (m && !below) {
          stack.push(sx, sy + 1);
          below = true;
        } else if (!m) below = false;
      }
      sx++;
    }
  }
  return changed;
}
