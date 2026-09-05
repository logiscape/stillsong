/** Live validation list under the Remix caption / lyrics fields. Empty state is a single reassuring line. */
export interface LintItem { level: "error" | "warn"; message: string }
export interface LintListProps { items?: LintItem[]; style?: React.CSSProperties }
export function LintList(props: LintListProps): JSX.Element;
