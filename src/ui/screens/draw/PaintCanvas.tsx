// The drawing surface: two stacked canvases (committed bitmap under a
// transparent preview overlay), 4:3 aspect-fit into the available space by a
// ResizeObserver, with all pointer wiring. Pointer capture + touch-action:none
// is the reliable path here — Tauri's drag-drop interception makes HTML5
// dragging flaky, and capture keeps strokes alive outside the canvas edge.

import React, { useEffect, useRef } from 'react';
import { CANVAS_H, CANVAS_W, PaintEngine, type PaintPoint } from './paintEngine';

export interface PaintCanvasProps {
  /** Called once with the engine after the canvases mount. */
  onReady: (engine: PaintEngine) => void;
  cursor?: string;
  style?: React.CSSProperties;
}

export function PaintCanvas({ onReady, cursor = 'crosshair', style }: PaintCanvasProps): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const bitmapRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PaintEngine | null>(null);
  const activePointer = useRef<number | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const engine = new PaintEngine(bitmapRef.current!, overlayRef.current!);
    engineRef.current = engine;
    onReadyRef.current(engine);

    const wrap = wrapRef.current!;
    const fit = () => {
      const r = wrap.getBoundingClientRect();
      const w = Math.max(160, Math.floor(Math.min(r.width, (r.height * CANVAS_W) / CANVAS_H)));
      frameRef.current!.style.width = w + 'px';
      frameRef.current!.style.height = Math.floor((w * CANVAS_H) / CANVAS_W) + 'px';
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const toPoint = (e: { clientX: number; clientY: number; pressure: number; pointerType: string }): PaintPoint => {
    const r = overlayRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * CANVAS_W) / (r.width || 1),
      y: ((e.clientY - r.top) * CANVAS_H) / (r.height || 1),
      pressure: e.pressure,
      pointerType: e.pointerType,
    };
  };

  return (
    <div
      ref={wrapRef}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', ...style }}
    >
      <div
        ref={frameRef}
        style={{
          position: 'relative', borderRadius: 'var(--radius-photo)', overflow: 'hidden',
          boxShadow: 'var(--shadow-photo)', border: '1px solid var(--border-hairline)',
        }}
      >
        <canvas ref={bitmapRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
        <canvas
          ref={overlayRef}
          onPointerDown={(e) => {
            const engine = engineRef.current;
            // One gesture at a time: a second finger/pen during a stroke is ignored.
            if (!engine || activePointer.current !== null) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            activePointer.current = e.pointerId;
            engine.hoverAt(null);
            engine.down(toPoint(e));
          }}
          onPointerMove={(e) => {
            const engine = engineRef.current;
            if (!engine) return;
            if (e.pointerId === activePointer.current) {
              const native = e.nativeEvent;
              const events = native.getCoalescedEvents?.() ?? [native];
              engine.move((events.length ? events : [native]).map(toPoint));
            } else if (activePointer.current === null) {
              engine.hoverAt(toPoint(e));
            }
          }}
          onPointerUp={(e) => {
            const engine = engineRef.current;
            if (!engine || e.pointerId !== activePointer.current) return;
            activePointer.current = null;
            engine.up(toPoint(e));
          }}
          onPointerCancel={(e) => {
            const engine = engineRef.current;
            if (!engine || e.pointerId !== activePointer.current) return;
            activePointer.current = null;
            engine.cancelGesture();
          }}
          onPointerLeave={() => engineRef.current?.hoverAt(null)}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block',
            touchAction: 'none', cursor,
          }}
        />
      </div>
    </div>
  );
}
