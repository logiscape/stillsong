/**
 * The matte museum-wall surface everything sits on.
 * @startingPoint section="Core" subtitle="Matte, inset, glass and solid-panel surfaces" viewport="700x180"
 */
export interface PanelProps {
  /** glass = blurred over a photo (lyrics layer 2); solid = accessibility fallback. */
  variant?: "matte" | "inset" | "glass" | "solid" | "quiet";
  /** Any CSS length; defaults to --gutter-panel (24px). */
  pad?: string | number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export function Panel(props: PanelProps): JSX.Element;
