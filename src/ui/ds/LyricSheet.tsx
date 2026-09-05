import React from 'react';

export interface LyricSheetProps {
  title: string;
  stanzas?: string[];
  epigraph?: string | null;
  instrumental?: boolean;
  mode?: 'blur' | 'solid';
  style?: React.CSSProperties;
}

/** The lyric sheet: a typeset column, never karaoke — no word timing exists. */
export function LyricSheet({ title, stanzas = [], epigraph, instrumental, mode = 'blur', style }: LyricSheetProps): React.ReactElement {
  const backing: React.CSSProperties = mode === 'solid'
    ? { background: 'var(--panel-solid-bg)', border: '1px solid var(--line-2)' }
    : { background: 'var(--panel-blur-bg)', backdropFilter: 'var(--panel-blur)', border: '1px solid var(--line-1)' };
  return (
    <div style={{
      maxWidth: 'calc(var(--measure-lyric) + 96px)', borderRadius: 'var(--radius-lg)',
      padding: 'var(--space-8) var(--space-7)', boxShadow: 'var(--shadow-3)', color: 'var(--lyric-text)', ...backing, ...style,
    }}>
      <h1 style={{ font: 'var(--display-lg)', letterSpacing: 'var(--tracking-display)', margin: 0, color: 'var(--lyric-text)', textWrap: 'pretty' }}>{title}</h1>
      {epigraph && <p style={{ font: 'var(--epigraph)', color: 'var(--lyric-text-quiet)', margin: 'var(--space-5) 0 0', maxWidth: '30ch', textWrap: 'pretty' }}>{epigraph}</p>}
      {instrumental
        ? <p style={{ font: 'var(--ui-sm)', color: 'var(--lyric-text-quiet)', margin: 'var(--space-7) 0 0', letterSpacing: '.06em' }}>Instrumental</p>
        : (
          <div style={{ marginTop: 'var(--space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--space-7)' }}>
            {stanzas.map((st, i) => (
              <p key={i} style={{ font: 'var(--lyric)', color: 'var(--lyric-text)', margin: 0, whiteSpace: 'pre-line', textWrap: 'pretty' }}>{st}</p>
            ))}
          </div>
        )}
    </div>
  );
}
