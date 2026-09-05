/**
 * The typeset lyric column over the photo. A sheet, not karaoke — no word-level timing exists.
 * @startingPoint section="Song view" subtitle="Typeset lyric column, blur or solid backing" viewport="700x400"
 */
export interface LyricSheetProps {
  /** The song title Gemma chose. Serif display — it is the title of a work. */
  title: string;
  /** Stanzas from parseLyrics(); structural [tags] already stripped for display. */
  stanzas?: string[];
  /** Instrumental only: one-line mood line from the caption's first sentence. */
  epigraph?: string;
  instrumental?: boolean;
  /** blur = backdrop-filter panel (default); solid = accessibility fallback, auto under prefers-contrast: more. */
  mode?: "blur" | "solid";
  style?: React.CSSProperties;
}
export function LyricSheet(props: LyricSheetProps): JSX.Element;
