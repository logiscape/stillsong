/** Centred modal for two-step confirmations (Delete) and Rename. Rare by design. */
export interface DialogProps {
  open?: boolean;
  title?: string;
  children?: React.ReactNode;
  /** Buttons, right-aligned. Destructive action last. */
  footer?: React.ReactNode;
  onClose?: () => void;
  width?: number;
  style?: React.CSSProperties;
}
export function Dialog(props: DialogProps): JSX.Element;
