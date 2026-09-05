/** Small pill for genre tags, song length, version counts and instrumental marks. */
export interface BadgeProps {
  tone?: "neutral" | "brass" | "glass" | "sage" | "amber" | "clay";
  /** Lucide slug shown before the label. */
  icon?: string;
  /** Use the mono face — for durations and counts. */
  mono?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export function Badge(props: BadgeProps): JSX.Element;
