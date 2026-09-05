// The in-progress drawing, held outside the reactive store: multi-megabyte
// data URLs have no render consumers (the Create screen reacts to
// `pendingPhoto`), and the session must survive screen switches so a submitted
// drawing stays editable until the song is created. Memory-only by design —
// an app restart loses it, matching `pendingPhoto`.

export type ToolId =
  | 'pencil' | 'brush' | 'eraser'
  | 'line' | 'rect' | 'ellipse' | 'rect-fill' | 'ellipse-fill'
  | 'fill' | 'picker';

export interface PaintSession {
  /** Committed bitmap as a PNG data URL (CSP allows data:, not blob:). */
  current: string;
  past: string[];
  future: string[];
  tool: ToolId;
  color: string;
  /** Remembered stroke width per tool (the eraser is wider than the pencil). */
  widths: Partial<Record<ToolId, number>>;
}

let session: PaintSession | null = null;

export function getPaintSession(): PaintSession | null {
  return session;
}

export function setPaintSession(s: PaintSession): void {
  session = s;
}

export function clearPaintSession(): void {
  session = null;
}
