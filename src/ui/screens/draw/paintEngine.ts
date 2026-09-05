// The paint editor's whole drawing brain, framework-free: tools, pressure
// strokes, shape previews on the overlay, flood fill, and a PNG-data-URL
// undo stack. React (DrawScreen/PaintCanvas) only feeds it pointer points and
// mirrors canUndo/canRedo via onChange. Hex literals here are artwork data,
// not styling — exempted from the design-kit hex lint.

import type { ToolId } from '@state/paintSession';
import { floodFill } from './floodFill';

export const CANVAS_W = 1600;
export const CANVAS_H = 1200;
/** Bounded snapshot stack: 20 PNG data URLs (~50 KB–1.5 MB each), not raw ImageData (7.7 MB each). */
const UNDO_CAP = 20;
const WHITE = '#ffffff';

export interface PaintPoint {
  x: number;
  y: number;
  /** PointerEvent.pressure — 0.5 constant for mouse, real values for a pen. */
  pressure: number;
  pointerType: string;
}

export interface PaintSnapshot {
  current: string;
  past: string[];
  future: string[];
}

function hexToRgba(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class PaintEngine {
  tool: ToolId = 'pencil';
  color = '#26201b';
  width = 4;
  /** Fires after any commit/undo/redo/restore so the UI can sync button state and the session. */
  onChange?: () => void;
  /** Eyedropper result; the screen sets the color and switches back to the previous tool. */
  onPick?: (hex: string) => void;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly octx: CanvasRenderingContext2D;
  private past: string[] = [];
  private future: string[] = [];
  private current: string;
  private drawing = false;
  private restoring = false;
  private last: PaintPoint | null = null;
  private lastMid: { x: number; y: number } | null = null;
  private anchor: { x: number; y: number } | null = null;

  constructor(
    private readonly bitmap: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
  ) {
    bitmap.width = CANVAS_W;
    bitmap.height = CANVAS_H;
    overlay.width = CANVAS_W;
    overlay.height = CANVAS_H;
    // The bitmap context is read often (fill, eyedropper, snapshots).
    this.ctx = bitmap.getContext('2d', { willReadFrequently: true })!;
    this.octx = overlay.getContext('2d')!;
    for (const c of [this.ctx, this.octx]) {
      c.lineCap = 'round';
      c.lineJoin = 'round';
    }
    this.ctx.fillStyle = WHITE;
    this.ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    this.current = bitmap.toDataURL('image/png');
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  /** The committed bitmap — always current (commits re-encode at gesture end). */
  toDataURL(): string {
    return this.current;
  }

  snapshot(): PaintSnapshot {
    return { current: this.current, past: [...this.past], future: [...this.future] };
  }

  async restoreSnapshot(s: PaintSnapshot): Promise<void> {
    this.past = [...s.past];
    this.future = [...s.future];
    this.current = s.current;
    await this.loadCurrent();
    this.onChange?.();
  }

  down(p: PaintPoint): void {
    if (this.restoring || this.drawing) return;
    switch (this.tool) {
      case 'picker':
        return this.pick(p);
      case 'fill':
        return this.applyFill(p);
      case 'line':
      case 'rect':
      case 'ellipse':
      case 'rect-fill':
      case 'ellipse-fill':
        this.drawing = true;
        this.anchor = { x: p.x, y: p.y };
        return;
      default: {
        this.drawing = true;
        this.last = p;
        this.lastMid = { x: p.x, y: p.y };
        // A starting dot so taps mark the canvas.
        this.ctx.fillStyle = this.strokeColor();
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, this.strokeWidth(p) / 2, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  /** Coalesced batch of move points (one PointerEvent can carry several). */
  move(pts: PaintPoint[]): void {
    if (!this.drawing || pts.length === 0) return;
    if (this.anchor) {
      const p = pts[pts.length - 1];
      this.octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      this.drawShape(this.octx, p);
      return;
    }
    // Midpoint quadratic smoothing; one stroke per segment so each can carry
    // its own pressure-scaled width.
    this.ctx.strokeStyle = this.strokeColor();
    for (const p of pts) {
      const mid = { x: (this.last!.x + p.x) / 2, y: (this.last!.y + p.y) / 2 };
      this.ctx.lineWidth = this.strokeWidth(p);
      this.ctx.beginPath();
      this.ctx.moveTo(this.lastMid!.x, this.lastMid!.y);
      this.ctx.quadraticCurveTo(this.last!.x, this.last!.y, mid.x, mid.y);
      this.ctx.stroke();
      this.last = p;
      this.lastMid = mid;
    }
    // Keep the cursor ring alive mid-stroke — the CSS cursor is hidden for
    // freehand tools, and an eraser painting white over white would otherwise
    // leave the pointer position completely invisible.
    this.drawRing(pts[pts.length - 1]);
  }

  up(p: PaintPoint): void {
    if (!this.drawing) return;
    if (this.anchor) {
      this.octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      this.drawShape(this.ctx, { x: p.x, y: p.y });
      this.anchor = null;
    } else {
      this.move([p]); // the gesture's final segment
    }
    this.drawing = false;
    this.last = this.lastMid = null;
    this.commit();
    this.drawRing(p);
  }

  cancelGesture(): void {
    if (!this.drawing) return;
    this.octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.drawing = false;
    this.anchor = null;
    this.last = this.lastMid = null;
    // Freehand marks already touched the bitmap — commit them rather than
    // leaving an unrecorded change.
    this.commit();
  }

  async undo(): Promise<void> {
    if (!this.canUndo || this.restoring || this.drawing) return;
    this.future.push(this.current);
    this.current = this.past.pop()!;
    await this.loadCurrent();
    this.onChange?.();
  }

  async redo(): Promise<void> {
    if (!this.canRedo || this.restoring || this.drawing) return;
    this.past.push(this.current);
    this.current = this.future.pop()!;
    await this.loadCurrent();
    this.onChange?.();
  }

  /** White-fill the canvas; undoable, so no confirmation needed. */
  clear(): void {
    if (this.restoring || this.drawing) return;
    this.ctx.fillStyle = WHITE;
    this.ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    this.commit();
  }

  /** Brush-size ring following the pointer while not drawing; null clears it. */
  hoverAt(p: { x: number; y: number } | null): void {
    if (this.drawing) return;
    this.octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (!p || !['pencil', 'brush', 'eraser'].includes(this.tool)) return;
    this.drawRing(p);
  }

  // ---- internals -------------------------------------------------------------

  private strokeColor(): string {
    return this.tool === 'eraser' ? WHITE : this.color;
  }

  private strokeWidth(p: PaintPoint): number {
    if (p.pointerType === 'pen' && p.pressure > 0) return this.width * (0.25 + 1.5 * p.pressure);
    return this.width;
  }

  private drawShape(c: CanvasRenderingContext2D, p: { x: number; y: number }): void {
    const a = this.anchor!;
    c.strokeStyle = this.color;
    c.fillStyle = this.color;
    c.lineWidth = this.width;
    c.beginPath();
    if (this.tool === 'line') {
      c.moveTo(a.x, a.y);
      c.lineTo(p.x, p.y);
    } else if (this.tool === 'rect' || this.tool === 'rect-fill') {
      c.rect(Math.min(a.x, p.x), Math.min(a.y, p.y), Math.abs(p.x - a.x), Math.abs(p.y - a.y));
    } else {
      c.ellipse((a.x + p.x) / 2, (a.y + p.y) / 2, Math.abs(p.x - a.x) / 2, Math.abs(p.y - a.y) / 2, 0, 0, Math.PI * 2);
    }
    if (this.tool === 'rect-fill' || this.tool === 'ellipse-fill') c.fill();
    else c.stroke();
  }

  /**
   * The cursor ring: two concentric strokes, white outside black, so it reads
   * against any artwork color — classic Paint keeps its pointer visible the
   * same way. Cleared and redrawn on the overlay every update.
   */
  private drawRing(p: { x: number; y: number }): void {
    this.octx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    const r = Math.max(2, this.width / 2);
    this.octx.beginPath();
    this.octx.arc(p.x, p.y, r + 1, 0, Math.PI * 2);
    this.octx.lineWidth = 2;
    this.octx.strokeStyle = 'rgba(255,255,255,.95)';
    this.octx.stroke();
    this.octx.beginPath();
    this.octx.arc(p.x, p.y, r, 0, Math.PI * 2);
    this.octx.lineWidth = 1.5;
    this.octx.strokeStyle = 'rgba(0,0,0,.9)';
    this.octx.stroke();
  }

  private applyFill(p: PaintPoint): void {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x < 0 || y < 0 || x >= CANVAS_W || y >= CANVAS_H) return;
    const img = this.ctx.getImageData(0, 0, CANVAS_W, CANVAS_H);
    if (!floodFill(img.data, CANVAS_W, CANVAS_H, x, y, hexToRgba(this.color))) return;
    this.ctx.putImageData(img, 0, 0);
    this.commit();
  }

  private pick(p: PaintPoint): void {
    const x = clamp(Math.round(p.x), 0, CANVAS_W - 1);
    const y = clamp(Math.round(p.y), 0, CANVAS_H - 1);
    const d = this.ctx.getImageData(x, y, 1, 1).data;
    this.onPick?.('#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join(''));
  }

  private commit(): void {
    this.past.push(this.current);
    if (this.past.length > UNDO_CAP) this.past.shift();
    this.future = [];
    this.current = this.bitmap.toDataURL('image/png');
    this.onChange?.();
  }

  private loadCurrent(): Promise<void> {
    this.restoring = true;
    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        // The PNG is opaque and canvas-sized; drawing it covers everything.
        this.ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
        this.restoring = false;
        resolve();
      };
      img.onerror = () => {
        this.restoring = false;
        reject(new Error('could not restore canvas snapshot'));
      };
      img.src = this.current;
    });
  }
}
