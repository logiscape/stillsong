/**
 * A quiet inline message with at most one action. Carries the cut-off note, the failure apology
 * and the hardware interstitial.
 * @startingPoint section="Feedback" subtitle="Info, calm, warn and error notices" viewport="700x300"
 */
export interface NoticeProps {
  tone?: "info" | "calm" | "warn" | "error";
  title?: string;
  /** One or two plain sentences. What happened, then what to do. */
  children?: React.ReactNode;
  /** Single action label, e.g. "Let it finish", "Try again". */
  action?: string;
  onAction?: () => void;
  /** Set when the notice sits over a photo. */
  glass?: boolean;
  style?: React.CSSProperties;
}
export function Notice(props: NoticeProps): JSX.Element;
