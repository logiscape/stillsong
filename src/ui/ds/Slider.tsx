// A draggable value slider styled on the Player's track language (3px ink
// track, brass fill, halo knob). The Player bars are click-to-set only; this
// one holds a real drag via pointer capture, for continuous controls like
// brush width.

import React, { useRef, useState } from 'react';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange?: (value: number) => void;
  label?: string;
  width?: number | string;
  style?: React.CSSProperties;
}

export function Slider({ value, min, max, step = 1, onChange, label, width = 160, style }: SliderProps): React.ReactElement {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min || 1)) * 100));

  const setFromClientX = (clientX: number) => {
    const track = trackRef.current;
    if (!track || !onChange) return;
    const r = track.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / (r.width || 1)));
    const raw = min + frac * (max - min);
    const stepped = Math.round(raw / step) * step;
    onChange(Math.min(max, Math.max(min, stepped)));
  };

  const nudge = (dir: -1 | 1) => onChange?.(Math.min(max, Math.max(min, value + dir * step)));

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging) setFromClientX(e.clientX);
      }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          nudge(-1);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          nudge(1);
        }
      }}
      style={{
        position: 'relative', width, height: 22, display: 'flex', alignItems: 'center',
        cursor: 'pointer', touchAction: 'none', ...style,
      }}
    >
      <div style={{ width: '100%', height: 3, borderRadius: 2, background: 'var(--wash-2)' }} />
      <div style={{ position: 'absolute', left: 0, width: pct + '%', height: 3, borderRadius: 2, background: 'var(--brass-200)' }} />
      <div style={{
        position: 'absolute', left: `calc(${pct}% - 5px)`, width: 10, height: 10, borderRadius: '50%',
        background: 'var(--brass-100)', boxShadow: dragging ? 'var(--glow-brass)' : '0 0 0 4px var(--brass-wash)',
      }} />
    </div>
  );
}
