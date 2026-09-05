/** Lucide icon rendered as a CSS mask so it takes currentColor. */
export interface IconProps {
  /** Lucide icon slug, e.g. "play", "pause", "image-plus", "wand-sparkles". */
  name: string;
  /** Pixel box. Stillsong uses 16 (inline), 18 (UI), 22 (player), 28 (well). */
  size?: number;
  /** Any CSS colour; defaults to currentColor. */
  color?: string;
  /** Accessible label. Omit for decorative icons. */
  title?: string;
  style?: React.CSSProperties;
}
export function Icon(props: IconProps): JSX.Element;
