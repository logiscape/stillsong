/**
 * The hero drop target on Create. Empty it is a dashed matte well; filled, the photo takes over.
 * @startingPoint section="Create" subtitle="Photo drop target — empty, dragging, filled" viewport="700x300"
 */
export interface PhotoWellProps {
  /** Object URL of the chosen photo. Absent = empty state. */
  src?: string;
  /** True while a native drag hovers the window (Tauri onDragDropEvent, not HTML5 onDrop). */
  dragging?: boolean;
  onChoose?: () => void;
  /** Shown as "Choose another" on the filled state. */
  onClear?: () => void;
  height?: number | string;
  style?: React.CSSProperties;
}
export function PhotoWell(props: PhotoWellProps): JSX.Element;
