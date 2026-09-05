/** Circular icon-only control. Never smaller than 40px on the desktop app; 44px inside photo overlays. */
export interface IconButtonProps {
  /** Lucide slug. */
  icon: string;
  /** Required accessible label / tooltip. */
  label: string;
  size?: number;
  iconSize?: number;
  /** glass = over a photo, surface = on a card, brass = the play affordance. */
  variant?: "ghost" | "surface" | "glass" | "brass";
  active?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}
export function IconButton(props: IconButtonProps): JSX.Element;
