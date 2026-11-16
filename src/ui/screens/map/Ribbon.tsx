// The whole song on one line, read left to right: its parts, one cell per
// phrase (coloured and lettered by pattern), and every note of the singer's
// and the instrument's lines. Click or drag to move through the song.

import React, { useRef } from 'react';
import type { MapTiming, SongMap } from '@engine/domain/songMap';
import { fmtDuration } from '@ui/ds/format';
import { BAND, SINGER, capitalize, letterOf, pct, wallOf } from './palette';

const NOTE_H = 2.2; // semitones

const Lane = React.memo(function Lane({ map, voice, label }: { map: SongMap; voice: 'vocal' | 'ins'; label: string }): React.ReactElement {
  const units = map.ctx.barUnits;
  const top = map.hi + 1;
  const height = top - (map.lo - 1) + 1;
  return (
    <div style={{ position: 'relative', height: 52, marginTop: 6, background: 'var(--surface-inset)', borderRadius: 'var(--radius-xs)' }}>
      <svg viewBox={`0 0 ${map.bars * units} ${height}`} preserveAspectRatio="none" aria-hidden
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}>
        {map.sections.map((sc) => sc.start > 0 && (
          <line key={sc.start} x1={sc.start * units} x2={sc.start * units} y1={0} y2={height}
            vectorEffect="non-scaling-stroke" style={{ stroke: 'var(--line-2)', strokeWidth: 1 }} />
        ))}
        <g style={{ fill: voice === 'vocal' ? SINGER : BAND }}>
          {map.phrases.flatMap((it, pi) => it.phrase[voice].map((n, ni) => (
            <rect key={`${pi}.${ni}`} x={it.start * units + n.pos} y={top - n.midi + 0.5 - NOTE_H / 2}
              width={Math.max(n.dur * 0.94, units * 0.06)} height={NOTE_H} />
          )))}
        </g>
      </svg>
      <span style={{
        position: 'absolute', left: 4, top: 4, padding: '3px 5px', borderRadius: 2, background: 'var(--surface-inset)',
        font: '500 11.5px/1 var(--font-ui)', color: 'var(--ink-3)',
      }}>{label}</span>
    </div>
  );
});

export interface RibbonProps {
  map: SongMap;
  timing: MapTiming;
  /** The phrase under the playhead. */
  now: number;
  /** The playhead: the screen moves it directly, many times a second. */
  headRef: React.RefObject<HTMLDivElement>;
  /** A press on the ribbon, a drag along it, and the release, as bar positions. */
  onScrub: (phase: 'start' | 'move' | 'end', bar: number) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function Ribbon({ map, timing, now, headRef, onScrub, onKeyDown }: RibbonProps): React.ReactElement {
  const dragging = useRef(false);
  const barOf = (e: React.PointerEvent<HTMLDivElement>): number => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(map.bars - 0.001, Math.max(0, ((e.clientX - r.left) / r.width) * map.bars));
  };
  const current = map.phrases[now];
  return (
    <div
      role="slider" tabIndex={0} aria-label="Position in the song"
      aria-valuemin={0} aria-valuemax={Math.round(timing.total)} aria-valuenow={Math.round(timing.secAt(current.start))}
      aria-valuetext={`${capitalize(map.sections[current.section].name)}, phrase ${current.index + 1} of ${current.count}`}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (e.button) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        onScrub('start', barOf(e));
      }}
      onPointerMove={(e) => { if (dragging.current) onScrub('move', barOf(e)); }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        onScrub('end', barOf(e));
      }}
      onPointerCancel={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        onScrub('end', barOf(e));
      }}
      style={{ position: 'relative', cursor: 'pointer', userSelect: 'none', touchAction: 'none' }}
    >
      <div style={{ display: 'flex' }}>
        {map.sections.map((sc) => (
          <div key={sc.start} title={capitalize(sc.name)}
            style={{ width: pct(sc.bars / map.bars), minWidth: 0, padding: '0 0 8px 7px', borderLeft: '1px solid var(--line-2)' }}>
            <b style={{ display: 'block', font: 'var(--ui-label)', color: 'var(--ink-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {capitalize(sc.name)}
            </b>
            <span style={{ display: 'block', font: 'var(--mono-sm)', color: 'var(--ink-4)', overflow: 'hidden' }}>
              {/* A part the recording never reached has no time in it. */}
              {sc.start < timing.lastBar ? fmtDuration(timing.secAt(sc.start)) : ' '}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex' }}>
        {map.phrases.map((it, i) => {
          const quiet = it.phrase.silent;
          const edge = i === now ? 'var(--brass-200)' : quiet ? 'var(--line-1)' : 'rgba(16,14,13,.9)';
          return (
            <div key={it.start} style={{
              width: pct(it.phrase.bars / map.bars), minWidth: 0, height: 24, overflow: 'hidden', textAlign: 'center',
              background: quiet ? 'transparent' : wallOf(it.pattern), boxShadow: `inset 0 0 0 1px ${edge}`,
              font: '500 10.5px/24px var(--font-mono)', color: 'var(--ink-1)',
            }}>{it.pattern >= 0 ? letterOf(it.pattern) : ''}</div>
          );
        })}
      </div>
      <Lane map={map} voice="vocal" label="Singer" />
      <Lane map={map} voice="ins" label="Instrument" />
      {timing.lastBar < map.bars && (
        // The stretch of the plan a cut-short recording never performed.
        <div data-unperformed style={{
          position: 'absolute', top: 0, bottom: 0, right: 0, left: pct(timing.lastBar / map.bars), pointerEvents: 'none',
          background: 'rgba(16,14,13,.66)', borderLeft: '1px dashed var(--line-3)',
        }} />
      )}
      <div ref={headRef} style={{
        position: 'absolute', top: 0, bottom: 0, left: 0, width: 2, marginLeft: -1, pointerEvents: 'none',
        background: 'var(--brass-200)', boxShadow: '0 0 10px rgba(192,151,95,.8)',
      }} />
    </div>
  );
}
