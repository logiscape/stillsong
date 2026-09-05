import React, { useState } from 'react';
import { Icon } from './Icon';

export interface DisclosureProps {
  summary: React.ReactNode;
  open?: boolean;
  onToggle?: (v: boolean) => void;
  defaultOpen?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Disclosure({ summary, open, onToggle, defaultOpen = false, children, style }: DisclosureProps): React.ReactElement {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open !== undefined ? open : inner;
  const toggle = () => (onToggle ? onToggle(!isOpen) : setInner(!isOpen));
  return (
    <div style={{ borderTop: '1px solid var(--border-hairline)', ...style }}>
      <button
        type="button" onClick={toggle} aria-expanded={isOpen}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%', padding: '14px 0',
          background: 'none', border: 'none', cursor: 'pointer', font: 'var(--ui-md)',
          color: isOpen ? 'var(--ink-1)' : 'var(--text-quiet)', textAlign: 'left',
        }}
      >
        <Icon name="chevron-down" size={15} style={{ color: 'var(--brass-300)', transform: isOpen ? 'none' : 'rotate(-90deg)', transition: 'transform var(--dur-base) var(--ease-out)' }} />
        {summary}
      </button>
      {isOpen && <div style={{ padding: '0 0 var(--space-6) 26px' }}>{children}</div>}
    </div>
  );
}
