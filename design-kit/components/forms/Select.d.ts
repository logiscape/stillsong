/** Native select on the inset field surface, with a brass focus ring. */
export interface SelectProps {
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  /** Strings, or {value,label} pairs. */
  options?: Array<string | { value: string; label: string }>;
  id?: string;
  style?: React.CSSProperties;
}
export function Select(props: SelectProps): JSX.Element;
