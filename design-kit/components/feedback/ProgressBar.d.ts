/** A 3px brass rule. Determinate when the engine reports real progress, drifting otherwise. */
export interface ProgressBarProps {
  /** 0..1. Ignored when indeterminate. */
  value?: number;
  label?: string;
  /** Right-aligned mono detail — "0:42 written", "about a minute left", "1.4 / 7.4 GB". */
  detail?: string;
  indeterminate?: boolean;
  style?: React.CSSProperties;
}
export function ProgressBar(props: ProgressBarProps): JSX.Element;
