/**
 * A song in the Sanctuary. The photo *is* the card; metadata rides on the bottom scrim.
 * @startingPoint section="Sanctuary" subtitle="Photo-dominant song card with audition player" viewport="700x300"
 */
export interface SongCardProps {
  /** Thumbnail URL generated at import. */
  photo: string;
  title: string;
  /** Genre tag from genreTag(caption). */
  genre?: string;
  /** Formatted length, e.g. "2:14" (actual_sec). Never show render time. */
  length?: string;
  /** Human date, e.g. "12 March". */
  date?: string;
  instrumental?: boolean;
  /** Version count; a marker appears when > 1. */
  versions?: number;
  playing?: boolean;
  onPlay?: () => void;
  onOpen?: () => void;
  style?: React.CSSProperties;
}
export function SongCard(props: SongCardProps): JSX.Element;
