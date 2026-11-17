// The phrase under the playhead, close up: its notes bar by bar, the chords
// beneath, the words sung over it, and where else in the song its pattern
// is heard. Where the song allows it, the singer's notes can be picked here
// and moved up or down.

import React, { useState } from 'react';
import type { MapPhrase, MapTiming, SongMap } from '@engine/domain/songMap';
import { Button } from '@ui/ds/Button';
import { fmtDuration } from '@ui/ds/format';
import { Panel } from '@ui/ds/Panel';
import { BAND, SINGER, letterOf, pct, wallOf } from './palette';

const NOTE_H = 1.5; // semitones

/** Moving the singer's notes in the phrase on show. */
export interface PhraseEdit {
  /** The phrase as it was before any note moved, for showing where a moved note came from. */
  original: MapPhrase;
  /** The sung note that is picked (its place among the phrase's sung notes), or null. */
  picked: number | null;
  onPick: (note: number | null) => void;
  onStep: (steps: number) => void;
  canRaise: boolean;
  canLower: boolean;
  /** The studio is singing these notes: they show as moved, and stay where they are. */
  locked: boolean;
}

function Roll({ map, it, edit }: { map: SongMap; it: MapPhrase; edit?: PhraseEdit }): React.ReactElement {
  const units = map.ctx.barUnits;
  const top = map.hi + 1;
  const height = top - (map.lo - 1) + 1;
  const gap = units * 0.03;
  const y = (midi: number) => top - midi + 0.5 - NOTE_H / 2;
  const width = (dur: number) => Math.max(dur - gap, units * 0.05);
  const was = (i: number) => edit?.original.phrase.vocal[i];
  return (
    <svg viewBox={`0 0 ${it.phrase.bars * units} ${height}`} preserveAspectRatio="none" aria-hidden
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
      <g style={{ fill: BAND }}>
        {it.phrase.ins.map((n, i) => <rect key={i} x={n.pos} y={y(n.midi)} width={width(n.dur)} height={NOTE_H} />)}
      </g>
      {/* Where a moved note used to be. */}
      {it.phrase.vocal.map((n, i) => was(i) && was(i)!.midi !== n.midi && (
        <rect key={`was${i}`} x={n.pos} y={y(was(i)!.midi)} width={width(n.dur)} height={NOTE_H} vectorEffect="non-scaling-stroke"
          style={{ fill: 'none', stroke: SINGER, strokeWidth: 1, strokeDasharray: '3 3', opacity: 0.5 }} />
      ))}
      {it.phrase.vocal.map((n, i) => {
        const moved = !!was(i) && was(i)!.midi !== n.midi;
        const picked = edit?.picked === i;
        return (
          <rect key={i} x={n.pos} y={y(n.midi)} width={width(n.dur)} height={NOTE_H} vectorEffect="non-scaling-stroke"
            style={{ fill: picked ? 'var(--ink-1)' : moved ? 'var(--brass)' : SINGER, stroke: picked ? 'var(--brass)' : 'none', strokeWidth: 2 }} />
        );
      })}
      {/* A taller, unseen target over each sung note: the notes themselves are a few pixels high. */}
      {edit && !edit.locked && it.phrase.vocal.map((n, i) => (
        <rect key={`hit${i}`} x={n.pos} y={y(n.midi) - NOTE_H} width={width(n.dur)} height={NOTE_H * 3}
          onClick={() => edit.onPick(edit.picked === i ? null : i)} style={{ fill: 'transparent', cursor: 'pointer' }} />
      ))}
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
  /** Present when this song's sung notes can be moved. */
  edit?: PhraseEdit;
  /** Why they cannot, when that is worth saying. */
  editNote?: string;
}

export function PhrasePanel({ map, timing, now, cursorRef, onJump, edit, editNote }: PhrasePanelProps): React.ReactElement {
  const it = map.phrases[now];
  const p = it.phrase;
  const pickable = !!edit && !edit.locked && p.vocal.length > 0;
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
        <div
          tabIndex={pickable ? 0 : undefined}
          role={pickable ? 'group' : undefined}
          aria-label={pickable ? 'The notes of this phrase. Left and right pick one of the singer’s notes; up and down move it.' : undefined}
          onKeyDown={pickable && edit ? (e) => {
            const at = edit.picked;
            if (e.key === 'ArrowRight') edit.onPick(at === null ? 0 : Math.min(p.vocal.length - 1, at + 1));
            else if (e.key === 'ArrowLeft') edit.onPick(at === null ? p.vocal.length - 1 : Math.max(0, at - 1));
            else if (e.key === 'ArrowUp' && at !== null) edit.onStep(1);
            else if (e.key === 'ArrowDown' && at !== null) edit.onStep(-1);
            else if (e.key === 'Escape' && at !== null) edit.onPick(null);
            else return;
            e.preventDefault();
          } : undefined}
          style={{ position: 'relative', width, height: 150, background: 'var(--surface-inset)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}
        >
          <Roll map={map} it={it} edit={edit} />
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
        {edit && p.vocal.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 10px', marginTop: 4 }}>
            <Button variant="secondary" size="sm" icon="chevron-up" disabled={edit.locked || edit.picked === null || !edit.canRaise} onClick={() => edit.onStep(1)}>Higher</Button>
            <Button variant="secondary" size="sm" icon="chevron-down" disabled={edit.locked || edit.picked === null || !edit.canLower} onClick={() => edit.onStep(-1)}>Lower</Button>
            <span style={{ font: 'var(--ui-sm)', color: 'var(--ink-3)' }}>
              {edit.locked
                ? 'The studio is singing your notes. They can be moved again when it is done.'
                : edit.picked === null ? 'Pick one of the singer’s notes to move it.' : 'Each press moves it one step of the key. Notes tied together move together.'}
            </span>
          </div>
        )}
        {!edit && editNote && p.vocal.length > 0 && <span style={{ font: 'var(--ui-sm)', color: 'var(--ink-3)', marginTop: 4 }}>{editNote}</span>}
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
