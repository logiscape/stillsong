/** Single-line or multiline text input on an inset field surface. */
export interface TextFieldProps {
  label?: string;
  /** Quiet helper line under the field. */
  hint?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  /** Use the mono face — lyrics, seeds, paths. */
  mono?: boolean;
  invalid?: boolean;
  id?: string;
  style?: React.CSSProperties;
}
export function TextField(props: TextFieldProps): JSX.Element;
