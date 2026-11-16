// The phrase under the playhead, close up: its notes bar by bar, the chords
// beneath, the words sung over it, and where else in the song its pattern
// is heard.

import React, { useState } from 'react';
import type { MapPhrase, MapTiming, SongMap } from '@engine/domain/songMap';
import { fmtDuration } from '@ui/ds/format';
import { Panel } from '@ui/ds/Panel';
import { BAND, SINGER, letterOf, pct, wallOf } from './palette';

const NOTE_H = 1.5; // semitones

function Roll({ map, it }: { map: SongMap; it: MapPhrase }): React.ReactElement {
  const units = map.ctx.barUnits;
  const top = map.hi + 1;
  const height = top - (map.lo - 1) + 1;
  const gap = units * 0.03;
  const notes = (voice: 'vocal' | 'ins') => it.phrase[voice].map((n, i) => (
    <rect key={i} x={n.pos} y={top - n.midi + 0.5 - NOTE_H / 2} width={Math.max(n.dur - gap, units * 0.05)} height={NOTE_H} />
  ));
  return (
    <svg viewBox={`0 0 ${it.phrase.bars * units} ${height}`} preserveAspectRatio="none" aria-hidden
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <g style={{ fill: BAND }}>{notes('ins')}</g>
      <g style={{ fill: SINGER }}>{notes('vocal')}</g>
    </svg>
  );
}

function TimeChip({ label, current, disabled, onClick }: { label: string; current: boolean; disabled: boolean; onClick: () => void }): React.ReactElement {
  const [hover, setH] = useState(false);
  const h = hover && !disabled;
  return (
    <button
      type="button" aria-current={current || undefined} disabled={disabled} onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', minHeight: 28, padding: '0 10px',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.38 : 1,
        borderRadius: 'var(--radius-pill)', font: 'var(--mono-sm)',
        background: current ? 'var(--brass-wash)' : h ? 'var(--wash-2)' : 'transparent',
        border: '1px solid ' + (current ? 'var(--brass-line)' : h ? 'var(--line-3)' : 'var(--line-2)'),
        color: current ? 'var(--brass-100)' : 'var(--ink-2)',
        transition: 'background var(--dur-tap) var(--ease-out),border-color var(--dur-tap) var(--ease-out)',
      }}
    >{label}</button>
  );
}

export interface PhrasePanelProps {
  map: SongMap;
  timing: MapTiming;
  /** Index of the phrase to show. */
  now: number;
  /** The line that runs across the phrase as it plays; the screen moves it. */
  cursorRef: React.RefObject<HTMLDivElement>;
  onJump: (bar: number) => void;
}

export function PhrasePanel({ map, timing, now, cursorRef, onJump }: PhrasePanelProps): React.ReactElement {
  const it = map.phrases[now];
  const p = it.phrase;
  const section = map.sections[it.section];
  // Four bars fill the width (most phrases are four); a longer phrase sets the scale for the song.
  const widest = map.phrases.reduce((n, x) => Math.max(n, x.phrase.bars), 4);
  const width = pct(p.bars / widest);
  const bars = Array.from({ length: p.bars }, (_, b) => b);
  const same = it.pattern >= 0 ? map.phrases.filter((x) => x.pattern === it.pattern) : [];
  const tag: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, flex: 'none',
    borderRadius: 4, background: wallOf(it.pattern), font: '500 12px/1 var(--font-mono)', color: 'var(--ink-1)',
  };
  return (
    <Panel pad="22px 24px 24px" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: 28 }}>
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ font: 'var(--ui-eyebrow)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--brass-300)' }}>
          {section.name} · phrase {it.index + 1} of {it.count}
        </span>
        <div style={{ position: 'relative', width, height: 150, background: 'var(--surface-inset)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          <Roll map={map} it={it} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', pointerEvents: 'none' }}>
            {bars.map((b) => <i key={b} style={{ flex: 1, borderLeft: b ? '1px solid var(--line-1)' : 'none' }} />)}
          </div>
          <div ref={cursorRef} style={{
            position: 'absolute', top: 0, bottom: 0, left: 0, width: 2, marginLeft: -1,
            background: 'var(--brass-200)', boxShadow: '0 0 10px rgba(192,151,95,.8)',
          }} />
        </div>
        <div style={{ display: 'flex', width }}>
          {bars.map((b) => (
            <span key={b} style={{ flex: 1, minWidth: 0, paddingLeft: 2, font: 'var(--mono-sm)', color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {p.chords.filter((c) => c.bar === b).map((c) => c.name).join('  ')}
            </span>
          ))}
        </div>
      </div>

      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {it.words.length > 0 ? (
          <p style={{ margin: 0, font: '300 24px/1.5 var(--font-display)', color: 'var(--ink-1)', maxWidth: '34ch' }}>
            {it.words.map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{line}</React.Fragment>)}
          </p>
        ) : (
          <p style={{ margin: 0, font: 'italic 300 19px/1.5 var(--font-display)', color: 'var(--ink-3)', maxWidth: '34ch' }}>
            {p.vocal.length ? 'Sung, with no words placed here.' : p.silent ? 'No melody here. The band holds the chords.' : 'The instrument plays alone.'}
          </p>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 10px', font: 'var(--ui-sm)', color: 'var(--ink-3)' }}>
          {it.pattern >= 0 ? (
            <>
              <span style={tag}>{letterOf(it.pattern)}</span>
              <span>Pattern {letterOf(it.pattern)} · heard {same.length} times</span>
              {same.map((x) => {
                // The pattern comes round again in a part the recording never reached.
                const unperformed = x.start >= timing.lastBar;
                return (
                  <TimeChip key={x.start} label={unperformed ? '–' : fmtDuration(timing.secAt(x.start))} current={x === it}
                    disabled={unperformed} onClick={() => onJump(x.start)} />
                );
              })}
            </>
          ) : (
            <>
              <span style={{ ...tag, boxShadow: 'inset 0 0 0 1px var(--line-2)' }} />
              <span>{p.silent ? 'A quiet phrase.' : 'Heard once in this song.'}</span>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
