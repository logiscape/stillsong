/**
 * The Song view's room: the photo full-bleed behind a luminance-aware scrim, with slow Ken Burns drift.
 * Implements layers 1–2 of the legibility spec; pass the photo's measured luminance and the scrim adapts.
 * @startingPoint section="Song view" subtitle="Full-bleed photo, luminance-aware scrim, Ken Burns" viewport="700x400"
 */
export interface PhotoRoomProps {
  photo: string;
  /** Average luminance measured at import, 0 (dark) .. 1 (light). Drives --scrim-alpha. */
  luminance?: number;
  /** radial for centred overlays, vertical for a left/edge lyric column. */
  scrim?: "radial" | "vertical" | "none";
  /** Disable to honour prefers-reduced-motion. */
  kenBurns?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export function PhotoRoom(props: PhotoRoomProps): JSX.Element;
