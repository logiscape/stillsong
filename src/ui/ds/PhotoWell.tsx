import React, { useState } from 'react';
import { Icon } from './Icon';
import { Button } from './Button';

export interface PhotoWellProps {
  src?: string | null;
  dragging?: boolean;
  onChoose?: () => void;
  onClear?: () => void;
  /** Shows an "Or draw something" entry under the empty well. */
  onDraw?: () => void;
  /** Shows an "Edit drawing" action on the filled well (the pending image is a drawing). */
  onEditDrawing?: () => void;
  height?: number;
  style?: React.CSSProperties;
}

export function PhotoWell({ src, dragging, onChoose, onClear, onDraw, onEditDrawing, height = 380, style }: PhotoWellProps): React.ReactElement {
  const [h, setH] = useState(false);
  const active = dragging || h;
  if (src) {
    return (
      <div style={{
        position: 'relative', height, borderRadius: 'var(--radius-photo)', overflow: 'hidden',
        boxShadow: 'var(--shadow-photo)', border: '1px solid var(--border-hairline)', ...style,
      }}>
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'var(--scrim-chrome-bottom)', opacity: 0.7, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: 14, right: 14, display: 'flex', gap: 'var(--space-3)' }}>
          {onEditDrawing && (
            <Button variant="secondary" size="sm" icon="pencil-line" onClick={onEditDrawing}>Edit drawing</Button>
          )}
          {onClear && (
            <Button variant="secondary" size="sm" icon="image-plus" onClick={onClear}>Choose another</Button>
          )}
        </div>
      </div>
    );
  }
  // The choose well and the draw entry are siblings — a button may not nest
  // another button, and the drop target stays the big dashed area.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', height, ...style }}>
      <button
        type="button" onClick={onChoose} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-4)',
          width: '100%', flex: 1, minHeight: 0, cursor: 'pointer', textAlign: 'center',
          background: active ? 'var(--brass-wash)' : 'var(--wash-1)',
          border: '1px dashed ' + (active ? 'var(--brass-line)' : 'var(--border-field)'),
          borderRadius: 'var(--radius-photo)', boxShadow: active ? 'var(--glow-brass)' : 'none',
          transition: 'background var(--dur-base) var(--ease-out),border-color var(--dur-base) var(--ease-out)',
        }}
      >
        <Icon name="image-plus" size={30} color={active ? 'var(--brass-200)' : 'var(--ink-3)'} />
        <span style={{ font: 'var(--display-sm)', color: 'var(--ink-1)', letterSpacing: 'var(--tracking-display)' }}>
          {dragging ? 'Let it go' : 'Choose a photo'}
        </span>
        <span style={{ font: 'var(--ui-sm)', color: 'var(--text-quiet)' }}>or drag one here — png, jpg, webp, bmp, gif</span>
      </button>
      {onDraw && (
        <Button variant="ghost" icon="pencil" onClick={onDraw} fullWidth>Or draw something</Button>
      )}
    </div>
  );
}
