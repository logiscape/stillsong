/**
 * The creation status stages, in canonical order and canonical copy.
 * Exported constant CREATION_STAGES holds the seven stages; pass a subset for Remix (no LLM stages).
 * @startingPoint section="Create" subtitle="Seven warm creation stages, breathing marker" viewport="700x340"
 */
export interface Stage { id: string; label: string }
export interface StageListProps {
  /** Defaults to CREATION_STAGES. Remix passes the list without "Looking"/"Writing". */
  stages?: Stage[];
  /** Index of the stage in flight. Earlier stages read as done. */
  activeIndex?: number;
  style?: React.CSSProperties;
}
export const CREATION_STAGES: Stage[];
export function StageList(props: StageListProps): JSX.Element;
