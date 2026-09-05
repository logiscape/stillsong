/** Collapses subordinate options so the main path stays quiet — "Add a touch of direction", Remix > Advanced. */
export interface DisclosureProps {
  /** The trigger copy. Invitational, lowercase-ish sentence case. */
  summary: React.ReactNode;
  /** Controlled open state; omit to let the component manage it. */
  open?: boolean;
  onToggle?: (next: boolean) => void;
  defaultOpen?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export function Disclosure(props: DisclosureProps): JSX.Element;
