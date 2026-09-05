// The advanced color popover: a saturation/value square, a hue bar, and a hex
// field, updating the tool color live while dragging. The curated swatch row
// stays the fast path — this is the "exact color" escape hatch. Colors are
// expressed as rgba()/hsl() strings here (the design-kit lint reserves hex
// literals for tokens; hex only passes through as data).

import React, { useEffect, useRef, useState } from 'react';
import { Panel } from '@ui/ds/Panel';
import { TextField } from '@ui/ds/TextField';

export interface ColorPickerProps {
  /** Current color as #rrggbb. */
  color: string;
  onChange: (hex: string) => void;
  style?: React.CSSProperties;
}

interface Hsv {
  h: number; // 0..360
  s: number; // 0..100
  v: number; // 0..100
}

function hsvToHex({ h, s, v }: Hsv): string {
  const sf = s / 100;
  const vf = v / 100;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return vf - vf * sf * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return (
    '#' +
    [f(5), f(3), f(1)]
      .map((x) =>
        Math.round(x * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

function hexToHsv(hex: string): Hsv | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Shared press-and-drag handler: calls back with 0..1 fractions inside the target. */
function dragProps(onFrac: (fx: number, fy: number) => void): React.HTMLAttributes<HTMLDivElement> {
  const apply = (el: HTMLElement, clientX: number, clientY: number) => {
    const r = el.getBoundingClientRect();
    onFrac(clamp01((clientX - r.left) / (r.width || 1)), clamp01((clientY - r.top) / (r.height || 1)));
  };
  return {
    onPointerDown: (e) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      apply(e.currentTarget, e.clientX, e.clientY);
    },
    onPointerMove: (e) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) apply(e.currentTarget, e.clientX, e.clientY);
    },
  };
}

export function ColorPicker({ color, onChange, style }: ColorPickerProps): React.ReactElement {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color) ?? { h: 30, s: 60, v: 70 });
  const [hexText, setHexText] = useState(color.toLowerCase());
  const lastEmitted = useRef(color.toLowerCase());

  // A swatch click while the popover is open changes `color` from outside —
  // follow it (but never fight our own onChange echoes).
  useEffect(() => {
    if (color.toLowerCase() !== lastEmitted.current) {
      const next = hexToHsv(color);
      if (next) {
        setHsv(next);
        setHexText(color.toLowerCase());
        lastEmitted.current = color.toLowerCase();
      }
    }
  }, [color]);

  const emit = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setHexText(hex);
    lastEmitted.current = hex;
    onChange(hex);
  };

  const knob: React.CSSProperties = {
    position: 'absolute', width: 12, height: 12, borderRadius: '50%', pointerEvents: 'none',
    border: '2px solid rgba(255,255,255,.95)', boxShadow: '0 0 0 1px rgba(0,0,0,.9)',
    transform: 'translate(-50%, -50%)',
  };

  return (
    <Panel
      variant="glass" pad={14}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', width: 232, ...style }}
    >
        <div
          {...dragProps((fx, fy) => emit({ ...hsv, s: fx * 100, v: (1 - fy) * 100 }))}
          style={{
            position: 'relative', height: 140, borderRadius: 'var(--radius-sm)', cursor: 'crosshair', touchAction: 'none',
            background: [
              'linear-gradient(to top, rgba(0,0,0,1), rgba(0,0,0,0))',
              `linear-gradient(to right, rgba(255,255,255,1), hsl(${Math.round(hsv.h)} 100% 50%))`,
            ].join(','),
          }}
        >
          <span style={{ ...knob, left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
        </div>
        <div
          {...dragProps((fx) => emit({ ...hsv, h: fx * 360 }))}
          style={{
            position: 'relative', height: 14, borderRadius: 'var(--radius-pill)', cursor: 'pointer', touchAction: 'none',
            background: `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((h) => `hsl(${h} 100% 50%)`).join(',')})`,
          }}
        >
          <span style={{ ...knob, left: `${(hsv.h / 360) * 100}%`, top: '50%' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)' }}>
          <TextField
            label="Hex" mono value={hexText} invalid={hexToHsv(hexText) === null}
            onChange={(t) => {
              setHexText(t);
              const next = hexToHsv(t);
              if (next) {
                setHsv(next);
                // Emit the typed hex verbatim — an HSV round-trip can shift it.
                const hex = '#' + t.trim().replace('#', '').toLowerCase();
                lastEmitted.current = hex;
                onChange(hex);
              }
            }}
            style={{ flex: 1 }}
          />
          <span
            title="Current color"
            style={{
              width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: hsvToHex(hsv),
              border: '1px solid var(--border-strong)', flex: '0 0 auto', marginBottom: 2,
            }}
          />
        </div>
    </Panel>
  );
}
