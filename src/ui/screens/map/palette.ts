// The song map's own colours: who is playing, and which phrases share a tune.

/** The singer's notes. */
export const SINGER = 'var(--brass-100)';
/** The instrument's notes. */
export const BAND = '#9DB894';

// Phrases that play the same pattern share a wall. Eight muted pigments; a
// song with more patterns than that reuses them, and the letter tells them apart.
const WALLS = ['#55302A', '#54421F', '#34432C', '#4E2937', '#23403A', '#5F5546', '#63401F', '#43334A'];
/** A phrase whose tune is heard once. */
export const STONE = '#252120';

export function wallOf(pattern: number): string {
  return pattern < 0 ? STONE : WALLS[pattern % WALLS.length];
}

export function letterOf(pattern: number): string {
  return String.fromCharCode(65 + (pattern % 26));
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function pct(fraction: number): string {
  return `${(fraction * 100).toFixed(4)}%`;
}
