// The Song map: how a song is put together, drawn from its melody plan. One
// ribbon for the whole song, the phrase under the playhead close up, and two
// ways to listen: the recording, or the plan on its own as a music box.
// Read-only. The position is kept in bars, so it stays at the same place in
// the music when the source changes.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Song } from '@engine/domain/types';
import { gridTiming, readBarGrid } from '@engine/domain/barGrid';
import { changedBars, melodyWindows } from '@engine/domain/melodyEdit';
import { stepNote, type NoteRef } from '@engine/domain/melodyPlan';
import { buildSongMap, evenTiming, musicBoxEvents, phraseAt, recordingTiming, type SongMap } from '@engine/domain/songMap';
import { mapEditStage, stopReady, STOP_GUARD_MS, type MorePhrase } from '@state/mapEdit';
import { canRepeatPhrase, roomForBars } from '@engine/domain/extension';
import { canKeepRest } from '@state/remix';
import {
  clearMapArrival, dropMapEdit, locateSongBars, navigate, pausePlayback, playSongFrom, playbackTime, playLonger, retryMapEdit, seek, singNewNotes,
  thumbSrc, useAppState,
} from '@state/store';
import { Button } from '@ui/ds/Button';
import { Icon } from '@ui/ds/Icon';
import { IconButton } from '@ui/ds/IconButton';
import { Notice } from '@ui/ds/Notice';
import { Panel } from '@ui/ds/Panel';
import { ProgressBar } from '@ui/ds/ProgressBar';
import { fmtDuration } from '@ui/ds/format';
import { PhrasePanel } from './PhrasePanel';
import { Ribbon } from './Ribbon';
import { boxElapsed, boxStart, boxStop } from './musicBox';
import { BAND, SINGER, STONE, pct, wallOf } from './palette';

type Source = 'recording' | 'box';
/** A version just sung from this map opens with its playhead this long before its new bars, so that Play leads into them. */
const ARRIVAL_LEAD_SEC = 4;

function SourceChoice({ value, onChange, recording }: { value: Source; onChange: (v: Source) => void; recording: boolean }): React.ReactElement {
  const options: { value: Source; label: string; icon: string; disabled?: boolean }[] = [
    { value: 'recording', label: 'The recording', icon: 'disc-3', disabled: !recording },
    { value: 'box', label: 'Music box', icon: 'music' },
  ];
  return (
    <div role="radiogroup" aria-label="Listen to" style={{
      display: 'inline-flex', padding: 3, gap: 2, background: 'var(--surface-inset)',
      border: '1px solid var(--line-2)', borderRadius: 'var(--radius-sm)',
    }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value} type="button" role="radio" aria-checked={on} disabled={o.disabled} onClick={() => onChange(o.value)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 34, padding: '0 14px',
              cursor: o.disabled ? 'default' : 'pointer', opacity: o.disabled ? 0.38 : 1,
              background: on ? 'var(--brass-wash)' : 'transparent',
              border: '1px solid ' + (on ? 'var(--brass-line)' : 'transparent'), borderRadius: 4,
              font: 'var(--ui-button)', color: on ? 'var(--brass-100)' : 'var(--ink-3)',
              transition: 'background var(--dur-tap) var(--ease-out),color var(--dur-tap) var(--ease-out)',
            }}
          >
            <Icon name={o.icon} size={16} />{o.label}
          </button>
        );
      })}
    </div>
  );
}

function Legend(): React.ReactElement {
  const bar = (color: string): React.CSSProperties => ({ width: 14, height: 5, borderRadius: 1, background: color });
  const block = (color: string, line?: boolean): React.CSSProperties => ({
    width: 12, height: 12, borderRadius: 2, background: color, boxShadow: line ? 'inset 0 0 0 1px var(--line-2)' : undefined,
  });
  const items: [React.CSSProperties, string][] = [
    [bar(SINGER), 'Singer'],
    [bar(BAND), 'Instrument'],
    [block(wallOf(0)), 'Same colour and letter, same pattern'],
    [block(STONE, true), 'Heard once'],
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', font: 'var(--ui-sm)', color: 'var(--ink-3)' }}>
      {items.map(([swatch, label]) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><i style={swatch} />{label}</span>
      ))}
    </div>
  );
}

function MapView({ song, map: original }: { song: Song; map: SongMap }): React.ReactElement {
  const s = useAppState();
  // Notes the person has moved and not yet had sung: each move is a new draft
  // of the plan, the last one is on show, and undo drops it. The map below is
  // the draft's; `original` is the song as recorded.
  // Someone who asked for their notes to be sung and left the map finds them here on the way back.
  const [drafts, setDrafts] = useState<string[]>(() => (s.mapEdit?.sourceId === song.id && !s.mapEdit.longer && s.mapEdit.abc !== song.planAbc ? [s.mapEdit.abc] : []));
  const draft = drafts.length ? drafts[drafts.length - 1] : null;
  const map = useMemo(() => (draft ? buildSongMap(draft, song.spec.lyrics) ?? original : original), [draft, original, song.spec.lyrics]);
  const [picked, setPicked] = useState<NoteRef | null>(null);
  // New bars asked for after a phrase (the song made longer), not yet written
  // or performed. Not a draft of the plan: the studio writes them, and the map
  // stays the song as recorded until the longer version exists. One kind of
  // change at a time, notes or length.
  const [more, setMore] = useState<MorePhrase | null>(() => (s.mapEdit?.sourceId === song.id ? s.mapEdit.longer ?? null : null));
  const loaded = s.playback?.songId === song.id;
  const recordingPlaying = loaded && s.playback!.isPlaying;
  const volume = s.playback?.volume ?? 0.8;
  const hasRecording = !!song.outputPath;

  const [source, setSource] = useState<Source>(hasRecording ? 'recording' : 'box');
  const [boxPlaying, setBoxPlaying] = useState(false);
  const playing = source === 'recording' ? recordingPlaying : boxPlaying;

  // The music box plays the plan at its written tempo. Where the bars fall in
  // the recording is measured from its audio (the song's bar grid); until that
  // is known, and for a recording it cannot place, it is an estimate from the
  // plan's tempo.
  const grid = useMemo(() => readBarGrid(song.barGrid, map.phrases.length), [song.barGrid, map]);
  const boxTotal = map.bars * map.ctx.secPerBar;
  const recordingTotal = song.actualSec || (loaded && s.playback!.durationSec) || boxTotal;
  const timings = useMemo(
    () => ({
      recording: grid ? gridTiming(map, grid, recordingTotal) : recordingTiming(map, recordingTotal, !!song.hitCeiling),
      box: evenTiming(map.bars, boxTotal),
    }),
    [map, grid, recordingTotal, song.hitCeiling, boxTotal],
  );
  const timing = timings[source];
  // A recording that stops partway through the plan: its playhead goes no
  // further than that. The music box plays the whole plan.
  const cutShort = timings.recording.lastBar < map.bars;

  // The first time a song's map is opened, its bars are looked for in the
  // recording (about half a second of work, once per song; the grid is stored).
  // Held back a moment so the map is on screen first.
  const [locating, setLocating] = useState(false);
  const looked = useRef(false);
  useEffect(() => {
    if (grid || !hasRecording || looked.current) return;
    looked.current = true;
    let gone = false;
    const timer = window.setTimeout(() => {
      setLocating(true);
      void locateSongBars(song, map).finally(() => { if (!gone) setLocating(false); });
    }, 400);
    return () => {
      gone = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, hasRecording]);

  // The transport position, in bars. A ref: it moves every frame while playing.
  const pos = useRef<number | null>(null);
  if (pos.current === null) pos.current = loaded && hasRecording ? Math.min(timings.recording.lastBar, timings.recording.barAt(playbackTime())) : 0;
  const boxFrom = useRef(0);
  const [now, setNow] = useState(() => phraseAt(map, pos.current!));
  const headRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  const paint = useCallback(() => {
    const bar = Math.min(timing.lastBar, Math.max(0, pos.current ?? 0));
    const i = phraseAt(map, bar);
    const it = map.phrases[i];
    setNow(i);
    if (headRef.current) headRef.current.style.left = pct(bar / map.bars);
    if (cursorRef.current) cursorRef.current.style.left = pct(Math.min(1, Math.max(0, (bar - it.start) / it.phrase.bars)));
    if (timeRef.current) timeRef.current.textContent = `${fmtDuration(timing.secAt(bar))} / ${fmtDuration(timing.total)}`;
  }, [map, timing]);

  useLayoutEffect(paint, [paint]);

  // While something plays, follow it frame by frame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      if (source === 'recording') {
        pos.current = timing.barAt(playbackTime());
      } else {
        pos.current = boxFrom.current + boxElapsed() / map.ctx.secPerBar;
        if (pos.current >= map.bars) {
          boxStop();
          setBoxPlaying(false);
          pos.current = 0;
          paint();
          return;
        }
      }
      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, source, timing, map, paint]);

  // The recording reached its end: the player rewinds, and so does the map.
  const wasPlaying = useRef(recordingPlaying);
  useEffect(() => {
    if (wasPlaying.current && !recordingPlaying && source === 'recording' && s.playback?.positionSec === 0) {
      pos.current = 0;
      paint();
    }
    wasPlaying.current = recordingPlaying;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingPlaying]);

  // The music box belongs to this screen; the recording keeps playing on the way back to the song.
  useEffect(() => boxStop, []);

  const play = (from: Source, bar: number) => {
    // At the end of what there is to hear, Play starts over.
    const at = bar >= timings[from].lastBar - 0.01 ? 0 : bar;
    pos.current = at;
    if (from === 'recording') {
      // A phrase being played back after a note was moved would sound over the recording.
      boxStop();
      playSongFrom(song, timings.recording.secAt(at));
    } else {
      // The shared player may be playing another song (an audition started
      // from its card): the box takes over from whatever is sounding.
      pausePlayback();
      boxFrom.current = at;
      setBoxPlaying(boxStart(musicBoxEvents(map, at, map.bars), volume));
    }
  };
  const pause = () => {
    if (source === 'recording') {
      pausePlayback();
    } else {
      boxStop();
      setBoxPlaying(false);
    }
  };
  /** Move to a bar: playback carries on from there; a paused map just moves its playhead. */
  const jump = (bar: number) => {
    if (bar >= timing.lastBar) return;
    pos.current = bar;
    if (playing && source === 'box') play('box', bar);
    else if (source === 'recording' && loaded) seek(timing.secAt(bar));
    paint();
  };
  const pickSource = (next: Source) => {
    if (next === source) return;
    const was = playing;
    if (was) pause();
    setSource(next);
    // Past the end of a recording that was cut short there is nothing to
    // switch to: the playhead waits at the recording's end.
    if ((pos.current ?? 0) >= timings[next].lastBar) pos.current = timings[next].lastBar;
    else if (was) play(next, pos.current ?? 0);
  };

  const resume = useRef(false);
  const scrub = (phase: 'start' | 'move' | 'end', to: number) => {
    if (phase === 'start') {
      resume.current = playing;
      if (playing) pause();
    }
    const bar = Math.min(to, Math.max(0, timing.lastBar - 0.001));
    pos.current = bar;
    paint();
    if (phase !== 'end') return;
    if (resume.current) play(source, bar);
    else if (source === 'recording' && loaded) seek(timing.secAt(bar));
    resume.current = false;
  };

  // ---- moving notes
  const changed = useMemo(() => (draft ? changedBars(original, map) ?? [] : []), [draft, original, map]);
  const frames = Math.round(recordingTotal * 25);
  const windows = useMemo(() => (grid && changed.length ? melodyWindows(original, grid, changed, frames) : []), [grid, changed, original, frames]);
  const editedPhrases = useMemo(() => new Set(more ? [more.phrase] : changed.map((bar) => phraseAt(original, bar))), [changed, original, more]);
  // A song's notes can be moved once the rest of its recording can be kept (it
  // has a take) and its bars have been found in the recording.
  const editable = canKeepRest(song) && !!grid;
  const editNote = !canKeepRest(song)
    ? 'This recording cannot be kept in part, so its notes cannot be changed here.'
    : !grid && !locating ? 'The map could not be lined up with this recording, so its notes cannot be changed here.' : undefined;
  const plan = draft ?? song.planAbc ?? '';
  const pickedHere = picked && picked.phrase === now ? picked.note : null;
  const pick = (note: number | null) => {
    if (note === null) return setPicked(null);
    if (playing) pause();
    setPicked({ phrase: now, voice: 'vocal', note });
    // Hear the note that was picked.
    const n = map.phrases[now].phrase.vocal[note];
    if (n) {
      pausePlayback();
      boxStart([{ kind: 'singer', t: 0, d: 0.45, midi: n.midi }], volume);
    }
  };
  const step = (steps: number) => {
    if (!picked) return;
    const next = stepNote(plan, picked, steps);
    if (!next) return;
    // A request that failed was for the notes as they were then. "Try again"
    // would sing those: with the notes moved on, it is "Sing the new notes" again.
    if (asked?.error) void dropMapEdit();
    setDrafts(next === song.planAbc ? [] : [...drafts, next]);
    // Hear the phrase with the note where it is now.
    const moved = buildSongMap(next, song.spec.lyrics);
    const it = moved?.phrases[picked.phrase];
    if (moved && it) {
      if (playing) pause();
      pausePlayback();
      boxStart(musicBoxEvents(moved, it.start, it.start + it.phrase.bars), volume);
    }
  };
  // Singing happens here, on the map: the studio's progress shows in the bar
  // below, and when the new version is done the map turns to it.
  const asked = s.mapEdit?.sourceId === song.id ? s.mapEdit : null;
  const singing = !!asked && !asked.error;
  const busy = !!s.mapEdit && !s.mapEdit.error; // one edit at a time, whichever song it is for
  const stage = mapEditStage(asked?.progress, !!asked?.longer);
  // Stop sits where "Sing the new notes" was: it waits out a double-click, and for the studio to have taken the
  // request. Once the new version is being copied into the library there is nothing left to stop.
  const [stopArmed, setStopArmed] = useState(false);
  useEffect(() => {
    if (!singing || !asked) return setStopArmed(false);
    const arm = () => setStopArmed(stopReady(asked, Date.now()));
    arm();
    const timer = window.setTimeout(arm, Math.max(0, STOP_GUARD_MS - (Date.now() - asked.since)) + 20);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singing, asked?.since, asked?.taken, asked?.progress?.phase]);
  const sing = () => {
    if (!draft || !windows.length || busy) return;
    void singNewNotes(song, draft);
  };

  // ---- new bars after a phrase
  const planPhrases = useMemo(() => original.phrases.map((p) => p.phrase), [original]);
  /**
   * The most seconds of new bars that can follow a phrase (0: none). They come
   * in phrases as long as that one, as many as fit in what the studio adds in
   * one go, the recording holds and the length limit leaves.
   */
  const roomFor = useCallback((phrase: number): number => {
    const p = original.phrases[phrase];
    if (!editable || !grid || !p || !canRepeatPhrase(planPhrases, phrase)) return 0;
    const bars = Math.floor(roomForBars(original, grid, phrase, frames) / p.phrase.bars) * p.phrase.bars;
    return bars * original.ctx.secPerBar;
  }, [editable, original, planPhrases, grid, frames]);
  const moreRoom = more ? roomFor(more.phrase) : 0;
  const askMore = () => {
    if (asked?.error) void dropMapEdit(); // as with notes: what failed was asked for as it was then
    setPicked(null);
    setMore({ phrase: now });
  };
  const perform = () => {
    if (!more || !moreRoom || busy) return;
    void playLonger(song, more);
  };
  const longerAsk = !!(asked?.longer ?? more);

  // Arriving at a version this map just had sung: the playhead waits a few
  // seconds before the bars that are new. Nothing plays until the person
  // presses Play (they asked for that, having tried it playing by itself).
  const resung = useMemo(
    () => (song.editWindows ?? []).map(([a, b]) => [timings.recording.barAt(a / 25), timings.recording.barAt(b / 25)] as const),
    [song.editWindows, timings],
  );
  useEffect(() => {
    if (s.mapArrival !== song.id) return;
    clearMapArrival();
    const first = song.editWindows?.[0];
    if (!first) return;
    // The player may still be on the version this one was made from: a recording playing on under a map of another would be heard as this one.
    pausePlayback();
    pos.current = Math.max(0, timings.recording.barAt(Math.max(0, first[0] / 25 - ARRIVAL_LEAD_SEC)));
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const span = (list: readonly (readonly [number, number])[]) =>
    list.map(([a, b]) => `${fmtDuration(a / 25)} to ${fmtDuration(b / 25)}`).join(' and ');

  const onKeyDown = (e: React.KeyboardEvent) => {
    const bar = pos.current ?? 0;
    const i = phraseAt(map, bar);
    if (e.key === 'ArrowRight') {
      if (i < map.phrases.length - 1) jump(map.phrases[i + 1].start);
    } else if (e.key === 'ArrowLeft') {
      // Back to the start of this phrase, or to the one before when already near it.
      jump(map.phrases[bar - map.phrases[i].start > 0.5 || i === 0 ? i : i - 1].start);
    } else if (e.key === 'Home') {
      jump(0);
    } else if (e.key === ' ' || e.key === 'Enter') {
      if (playing) pause();
      else play(source, bar);
    } else {
      return;
    }
    e.preventDefault();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 20px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-4)' }}>
          <Button variant="secondary" icon={playing ? 'pause' : 'play'} onClick={() => (playing ? pause() : play(source, pos.current ?? 0))}
            style={{ minWidth: 108, borderRadius: 'var(--radius-pill)' }}>
            {playing ? 'Pause' : 'Play'}
          </Button>
          <span ref={timeRef} style={{ font: 'var(--mono-md)', fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)', minWidth: 98 }} />
          <SourceChoice value={source} onChange={pickSource} recording={hasRecording} />
        </div>
        <Legend />
      </div>

      <Panel pad="18px 18px 16px">
        <Ribbon map={map} timing={timing} now={now} edited={editedPhrases} resung={resung} headRef={headRef} onScrub={scrub} onKeyDown={onKeyDown} />
      </Panel>

      <PhrasePanel
        map={map} timing={timing} now={now} cursorRef={cursorRef} onJump={jump} editNote={editNote}
        edit={editable ? {
          original: original.phrases[now],
          locked: singing,
          picked: singing ? null : pickedHere,
          onPick: pick,
          onStep: step,
          canRaise: !!picked && stepNote(plan, picked, 1) !== null,
          canLower: !!picked && stepNote(plan, picked, -1) !== null,
          ...(more && !singing ? { locked: true, picked: null, lockedNote: 'New bars are set to be added. Have them performed, or undo that, before moving notes: one change at a time.' } : {}),
        } : undefined}
        more={editable && canRepeatPhrase(planPhrases, now) ? {
          asked: more?.phrase === now,
          seconds: roomFor(now),
          onAsk: askMore,
          locked: singing || drafts.length > 0 || (!!more && more.phrase !== now) || roomFor(now) === 0,
          note: singing
            ? asked?.longer ? 'The studio is at work on the new bars.' : 'The studio is singing your notes.'
            : drafts.length > 0
              ? 'Notes have been moved. Have them sung, or undo them, before making the song longer: one change at a time.'
              : more && more.phrase !== now
                ? 'New bars are set to follow another phrase. One place at a time.'
                : roomFor(now) === 0 ? 'There is no room for new bars here: the song is as long as the studio can make it, or the recording stops before here.' : undefined,
        } : undefined}
      />

      {(changed.length > 0 || more || asked) && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 20px',
          padding: '14px 18px', borderRadius: 'var(--radius-md)', background: 'var(--brass-wash)', border: '1px solid var(--brass-line)',
        }}>
          {singing ? (
            <>
              <div style={{ flex: '1 1 320px', minWidth: 0, maxWidth: '62ch' }}>
                <ProgressBar label={stage.label} value={stage.fraction} indeterminate={stage.fraction === undefined} />
                <div style={{ font: 'var(--ui-sm)', color: 'var(--text-body)', marginTop: 10 }}>
                  {longerAsk
                    ? 'The map will turn to the longer version when it is ready, at the new bars.'
                    : 'The map will turn to the new version when it is ready, at the bars that were sung again.'}
                </div>
              </div>
              <Button variant="ghost" disabled={!stopArmed} onClick={() => void dropMapEdit()}>Stop</Button>
            </>
          ) : longerAsk ? (
            <>
              <div style={{ minWidth: 0, maxWidth: '62ch' }}>
                <div style={{ font: '500 14.5px/1.4 var(--font-ui)', color: 'var(--ink-1)' }}>
                  {asked?.error ? 'The new bars were not added' : `New bars for the ${original.sections[original.phrases[more?.phrase ?? 0].section]?.name.toLowerCase() || 'song'}`}
                </div>
                <div style={{ font: 'var(--ui-sm)', color: 'var(--text-body)', marginTop: 4 }}>
                  {asked?.error
                    ? asked.error
                    : moreRoom
                      ? `The studio writes new bars in the manner of this part, to follow the phrase you chose, and performs them: up to ${Math.round(moreRoom)} seconds more, as a new version. The bar before them is performed again so that they join; everything else stays exactly as it is.`
                      : 'There is no room for new bars in this recording.'}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <Button variant="ghost" icon="undo-2" onClick={() => { if (asked) void dropMapEdit(); setMore(null); }}>Undo</Button>
                {asked?.error && asked.songId
                  ? <Button variant="primary" onClick={() => void retryMapEdit()}>Try again</Button>
                  : <Button variant="primary" disabled={!more || !moreRoom || busy} onClick={perform}>Write and perform them</Button>}
              </div>
            </>
          ) : (
            <>
              <div style={{ minWidth: 0, maxWidth: '62ch' }}>
                <div style={{ font: '500 14.5px/1.4 var(--font-ui)', color: 'var(--ink-1)' }}>
                  {asked?.error ? 'The new notes were not sung' : changed.length === 1 ? 'One bar has new notes' : `${changed.length} bars have new notes`}
                </div>
                <div style={{ font: 'var(--ui-sm)', color: 'var(--text-body)', marginTop: 4 }}>
                  {asked?.error
                    ? `${asked.error} Your notes are still here.`
                    : windows.length
                      ? `Only ${span(windows)} of the recording is sung again, as a new version. Everything else stays exactly as it is. The studio tries a few takes and keeps the one that follows your notes best.`
                      : 'Those bars are not in the recording, so there is nothing to sing again.'}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <Button variant="ghost" icon="undo-2" onClick={() => { if (asked) void dropMapEdit(); setDrafts(drafts.slice(0, -1)); }}>Undo</Button>
                <Button variant="ghost" onClick={() => { if (asked) void dropMapEdit(); setDrafts([]); setPicked(null); }}>Start over</Button>
                {asked?.error && asked.songId
                  ? <Button variant="primary" icon="mic" onClick={() => void retryMapEdit()}>Try again</Button>
                  : <Button variant="primary" icon="mic" disabled={!windows.length || busy} onClick={sing}>Sing the new notes</Button>}
              </div>
            </>
          )}
        </div>
      )}

      <p style={{ margin: 0, font: 'var(--ui-sm)', color: 'var(--ink-3)', maxWidth: '72ch' }}>
        {source === 'recording' && cutShort && `This recording stops at ${fmtDuration(timing.total)}, before the end of its melody plan. The dimmed part was never performed; the music box still plays it. `}
        {source === 'recording'
          ? grid
            ? 'The map is lined up with the recording by matching the notes and chords of the melody plan to what is heard. Words are placed by syllable count, which is an estimate.'
            : `${locating ? 'Lining the map up with the recording. Until then, the' : 'The'} map places each bar by the tempo written in the melody plan, so the playhead can sit a little off what you hear. Words are placed by syllable count, which is also an estimate.`
          : 'The music box plays the melody plan on its own: the tune and the chords, without the performance. Words are placed by syllable count, which is an estimate.'}
      </p>
    </div>
  );
}

export function SongMapScreen(): React.ReactElement | null {
  const s = useAppState();
  const song = s.songs.find((x) => x.id === s.selectedSongId);
  const map = useMemo(
    () => (song?.planAbc?.trim() ? buildSongMap(song.planAbc, song.spec.lyrics) : null),
    [song?.planAbc, song?.spec.lyrics],
  );

  if (!song) {
    navigate('sanctuary');
    return null;
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 'var(--space-8) var(--gutter-screen) var(--space-9)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 'var(--space-7)' }}>
        <IconButton icon="chevron-left" label="Back" onClick={() => navigate('song')} />
        {song.spec.photo && (
          <img src={thumbSrc(song.spec.photo)} alt="" style={{
            width: 92, height: 69, objectFit: 'cover', flex: 'none', borderRadius: 'var(--radius-photo)', boxShadow: 'var(--shadow-photo)',
          }} />
        )}
        <div style={{ flex: 1, minWidth: 0, marginLeft: 4 }}>
          <span style={{ font: 'var(--ui-eyebrow)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--brass-300)' }}>Song map</span>
          <h1 style={{ font: 'var(--display-md)', color: 'var(--ink-1)', margin: '6px 0 0', letterSpacing: 'var(--tracking-display)' }}>{song.spec.title || 'Untitled'}</h1>
          {map && (
            <span style={{ display: 'block', marginTop: 5, font: 'var(--ui-sm)', color: 'var(--ink-3)' }}>
              {map.ctx.keyLabel} · {map.ctx.tempo} beats a minute{song.actualSec ? ` · ${fmtDuration(song.actualSec)}` : ''}
            </span>
          )}
        </div>
      </div>

      {map
        ? <MapView key={song.id} song={song} map={map} />
        : (
          <Notice tone="calm" title="This song has no map" style={{ maxWidth: 520 }}>
            {song.planAbc?.trim()
              ? "The map is drawn from a song's melody plan, and this song's plan could not be read."
              : "The map is drawn from a song's melody plan, and this song was performed without one."}
          </Notice>
        )}
    </div>
  );
}
