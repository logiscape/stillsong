/**
 * Equal-weight exclusive choice — the voice picker on Create, seed choice in Remix.
 * @startingPoint section="Forms" subtitle="Equal-weight exclusive choice, brass selection" viewport="700x160"
 */
export interface SegmentedChoiceProps {
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  /** Strings, or {value,label,icon} where icon is a Lucide slug. */
  options?: Array<string | { value: string; label: string; icon?: string }>;
  style?: React.CSSProperties;
}
export function SegmentedChoice(props: SegmentedChoiceProps): JSX.Element;
