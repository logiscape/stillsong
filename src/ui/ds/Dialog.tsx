import React from 'react';
import { IconButton } from './IconButton';

export interface DialogProps {
  open?: boolean;
  title: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
  width?: number;
  style?: React.CSSProperties;
}

export function Dialog({ open = true, title, children, footer, onClose, width = 460, style }: DialogProps): React.ReactElement | null {
  if (!open) return null;
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--surface-overlay)', backdropFilter: 'var(--blur-chrome)', zIndex: 60,
    }}>
      <div role="dialog" aria-modal="true" style={{
        width, maxWidth: 'calc(100% - 48px)', background: 'var(--surface-2)',
        border: '1px solid var(--border-field)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-4)',
        padding: 'var(--space-7)', ...style,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-5)' }}>
          <h2 style={{ font: 'var(--display-sm)', color: 'var(--ink-1)', margin: 0, flex: 1, letterSpacing: 'var(--tracking-display)' }}>{title}</h2>
          {onClose && <IconButton icon="x" label="Close" size={32} onClick={onClose} />}
        </div>
        <div style={{ font: 'var(--ui-md)', color: 'var(--text-body)', marginTop: 'var(--space-5)', maxWidth: '52ch' }}>{children}</div>
        {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-4)', marginTop: 'var(--space-7)' }}>{footer}</div>}
      </div>
    </div>
  );
}
