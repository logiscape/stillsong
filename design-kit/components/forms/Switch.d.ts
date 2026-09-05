/** On/off for remembered preferences — auto-scroll lyrics, solid panel mode, tiled decode. */
export interface SwitchProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
  /** One quiet sentence explaining the consequence, not the mechanism. */
  hint?: string;
  style?: React.CSSProperties;
}
export function Switch(props: SwitchProps): JSX.Element;
