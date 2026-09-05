import React, { useState } from 'react';

export interface TextFieldProps {
  label?: string;
  hint?: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
  invalid?: boolean;
  readOnly?: boolean;
  id?: string;
  style?: React.CSSProperties;
}

export function TextField({ label, hint, value, onChange, placeholder, multiline, rows = 4, mono, invalid, readOnly, id, style }: TextFieldProps): React.ReactElement {
  const [foc, setFoc] = useState(false);
  const inner: React.CSSProperties = {
    width: '100%', display: 'block', resize: multiline ? 'vertical' : undefined,
    minHeight: multiline ? undefined : 'var(--control-h)', padding: multiline ? '12px 14px' : '0 14px',
    font: mono ? 'var(--mono-md)' : 'var(--ui-md)', color: 'var(--ink-1)', background: 'var(--surface-field)',
    border: '1px solid ' + (invalid ? 'var(--clay)' : foc ? 'var(--brass-line)' : 'var(--border-field)'),
    borderRadius: 'var(--radius-sm)', boxShadow: foc ? 'var(--glow-brass)' : 'var(--inset-field)', outline: 'none',
    transition: 'border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-base) var(--ease-out)',
  };
  const shared = {
    id, value, placeholder, readOnly,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange && onChange(e.target.value),
    onFocus: () => setFoc(true),
    onBlur: () => setFoc(false),
    style: inner,
  };
  return (
    <label htmlFor={id} style={{ display: 'block', ...style }}>
      {label && <span style={{ display: 'block', font: 'var(--ui-label)', color: 'var(--text-quiet)', marginBottom: 'var(--space-3)' }}>{label}</span>}
      {multiline ? <textarea rows={rows} {...shared} /> : <input {...shared} />}
      {hint && <span style={{ display: 'block', font: 'var(--ui-xs)', color: 'var(--text-faint)', marginTop: 'var(--space-2)' }}>{hint}</span>}
    </label>
  );
}
