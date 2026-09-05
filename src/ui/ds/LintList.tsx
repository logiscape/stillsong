import React from 'react';
import { Icon } from './Icon';
import type { LintIssue } from '@engine/cowriter/linter';

export function LintList({ issues, field, style }: { issues: LintIssue[]; field?: LintIssue['field']; style?: React.CSSProperties }): React.ReactElement | null {
  const shown = field ? issues.filter((i) => i.field === field || i.field === 'both') : issues;
  if (!shown.length) return null;
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', ...style }}>
      {shown.map((it, i) => {
        const err = it.severity === 'error';
        return (
          <li key={i} style={{ display: 'flex', gap: 8, font: 'var(--ui-sm)', color: err ? '#E0A18B' : '#E6BC76' }}>
            <Icon name={err ? 'triangle-alert' : 'info'} size={14} style={{ marginTop: 2, flex: '0 0 auto' }} />
            <span style={{ color: 'var(--text-body)' }}>{it.message}</span>
          </li>
        );
      })}
    </ul>
  );
}
