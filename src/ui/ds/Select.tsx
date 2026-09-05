import React, { useState } from 'react';
import { Icon } from './Icon';

type Opt = string | { value: string; label: string };

export interface SelectProps {
  label?: string;
  value: string;
  onChange?: (v: string) => void;
  options: Opt[];
  id?: string;
  style?: React.CSSProperties;
}

export function Select({ label, value, onChange, options, id, style }: SelectProps): React.ReactElement {
  const [foc, setFoc] = useState(false);
  return (
    <label htmlFor={id} style={{ display: 'block', ...style }}>
      {label && <span style={{ display: 'block', font: 'var(--ui-label)', color: 'var(--text-quiet)', marginBottom: 'var(--space-3)' }}>{label}</span>}
      <span style={{ position: 'relative', display: 'block' }}>
        <select
          id={id} value={value} onChange={(e) => onChange && onChange(e.target.value)}
          onFocus={() => setFoc(true)} onBlur={() => setFoc(false)}
          style={{
            width: '100%', height: 'var(--control-h)', padding: '0 38px 0 14px', font: 'var(--ui-md)',
            color: 'var(--ink-1)', background: 'var(--surface-field)', appearance: 'none',
            border: '1px solid ' + (foc ? 'var(--brass-line)' : 'var(--border-field)'), borderRadius: 'var(--radius-sm)',
            boxShadow: foc ? 'var(--glow-brass)' : 'var(--inset-field)', outline: 'none', cursor: 'pointer',
          }}
        >
          {options.map((o) => {
            const v = typeof o === 'string' ? o : o.value;
            const l = typeof o === 'string' ? o : o.label;
            return <option key={v} value={v} style={{ background: 'var(--surface-2)' }}>{l}</option>;
          })}
        </select>
        <Icon name="chevron-down" size={16} style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)', pointerEvents: 'none' }} />
      </span>
    </label>
  );
}
