/**
 * The app's one loud element. `primary` is brass and appears at most once per screen
 * ("Create My Song", "Create Remix", "Download").
 * @startingPoint section="Core" subtitle="Brass primary, matte secondary, ghost, quiet link, danger" viewport="700x150"
 */
export interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost" | "quiet" | "danger";
  size?: "sm" | "md" | "lg";
  /** Lucide slug rendered before the label. */
  icon?: string;
  /** Lucide slug rendered after the label. */
  iconRight?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export function Button(props: ButtonProps): JSX.Element;
