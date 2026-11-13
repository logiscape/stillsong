// Remix: the one deliberately technical surface. Edit the package (caption,
// tagged lyrics, seed, melody plan, advanced knobs) and render a new linked
// version of the same photo's story. No length control: every song gets the
// same cap (MAX_DURATION_SEC) and ends where the composer ends it.

import React, { useMemo, useState } from 'react';
import type { Mp3Quality, PlanMode, SongSpec } from '@engine/domain/types';
import { renderCap } from '@engine/domain/duration';
import { lintSong } from '@engine/cowriter/linter';
import { estimateSeconds, wordCount } from '@engine/cowriter/lyrics';
import { validateSpec } from '@engine/domain/validate';
import { enqueueRemix, navigate, remixSpec, thumbSrc, useAppState } from '@state/store';
import { canKeepMelody, keepRestTake, keepsRestByDefault, offersKeepRest, offersMelodyChoice, remixNeedsNewSeed, remixTake, reshapesLyrics } from '@state/remix';
import { fmtDuration } from '@ui/ds/format';
import { Badge } from '@ui/ds/Badge';
import { Button } from '@ui/ds/Button';
import { Disclosure } from '@ui/ds/Disclosure';
import { IconButton } from '@ui/ds/IconButton';
import { LintList } from '@ui/ds/LintList';
import { Panel } from '@ui/ds/Panel';
import { SegmentedChoice } from '@ui/ds/SegmentedChoice';
import { TextField } from '@ui/ds/TextField';

function TagLyrics({ value, onChange }: { value: string; onChange: (v: string) => void }): React.ReactElement {
  const [foc, setFoc] = useState(false);
  const parts = useMemo(() => {
    const out: React.ReactNode[] = [];
    const re = /\[[^\]\n]+\]/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(value))) {
      if (m.index > last) out.push(value.slice(last, m.index));
      out.push(<span key={k++} style={{ color: 'var(--brass-200)' }}>{m[0]}</span>);
      last = m.index + m[0].length;
    }
    out.push(value.slice(last));
    out.push('\n');
    return out;
  }, [value]);
  return (
    <div>
      <span style={{ display: 'block', font: 'var(--ui-label)', color: 'var(--text-quiet)', marginBottom: 'var(--space-3)' }}>Lyrics</span>
      <div style={{
        position: 'relative', border: '1px solid ' + (foc ? 'var(--brass-line)' : 'var(--border-field)'),
        borderRadius: 'var(--radius-sm)', background: 'var(--surface-field)', boxShadow: 'var(--inset-field)',
      }}>
        <pre aria-hidden style={{ margin: 0, padding: '12px 14px', font: 'var(--mono-md)', color: 'var(--ink-1)', whiteSpace: 'pre-wrap', minHeight: 200 }}>{parts}</pre>
        <textarea
          value={value} onChange={(e) => onChange(e.target.value)} onFocus={() => setFoc(true)} onBlur={() => setFoc(false)}
          spellCheck={false}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%', padding: '12px 14px',
            font: 'var(--mono-md)', color: 'transparent', caretColor: 'var(--brass-100)', background: 'transparent',
            border: 'none', outline: 'none', resize: 'none', whiteSpace: 'pre-wrap',
          }}
        />
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }): React.ReactElement {
  return <TextField label={label} mono value={String(value)} onChange={(v) => onChange(Number(v) || 0)} />;
}

export function RemixScreen(): React.ReactElement | null {
  const s = useAppState();
  const original = s.songs.find((x) => x.id === s.selectedSongId);
  const [spec, setSpec] = useState<SongSpec | null>(original ? remixSpec(original) : null);
  const [seedMode, setSeedMode] = useState<'keep' | 'new'>('keep');
  const melodyAvailable = !!original && canKeepMelody(original);
  const [melody, setMelody] = useState<'keep' | 'new'>(melodyAvailable ? 'keep' : 'new');
  const [planText, setPlanText] = useState(original?.planAbc ?? '');
  // When only the words of existing lines changed: sing just those lines
  // again and keep the rest of the recording, or all of it. Null until the
  // person picks: the starting side then follows their other choices.
  const [recording, setRecording] = useState<'rest' | 'all' | null>(null);

  if (!original || !spec) {
    navigate('sanctuary');
    return null;
  }

  const patch = (p: Partial<SongSpec>) => setSpec({ ...spec, ...p });
  // The lint judges the lyrics against the co-writer's own length budget, as
  // it did when they were written; the render itself always gets the fixed cap.
  const issues = lintSong({ ...spec, durationSec: renderCap(spec.targetSec, spec.lyrics) });
  const errors = validateSpec(spec).filter((i) => i.severity === 'error');
  const est = estimateSeconds(spec.lyrics);
  const planOff = spec.planMode === 'off';
  const planEdited = !planOff && planText.trim() !== '' && planText !== (original.planAbc ?? '');
  const choice = { keepSeed: seedMode === 'keep', keepMelody: melody === 'keep', editedAbc: planEdited ? planText : undefined };
  const showMelody = offersMelodyChoice(original, spec, choice.editedAbc);
  // A new melody needs a new seed (the same seed writes the same plan), so
  // Feel shows "New seed" while it is chosen; picking "Keep original" then
  // goes back to the original melody, the only way to keep the original feel.
  const forcedNewSeed = remixNeedsNewSeed(original, spec, choice);
  const feel = forcedNewSeed ? 'new' : seedMode;
  const pickFeel = (v: 'keep' | 'new') => {
    if (v === 'keep' && forcedNewSeed) setMelody('keep');
    setSeedMode(v);
  };

  const showRecording = offersKeepRest(original, spec, choice.editedAbc);
  // Someone who already chose a new seed or a new melody asked for a different
  // performance: rewording a line then starts on "Sing it all again", with
  // their Feel and Melody choices still showing.
  const recordingChoice = recording ?? (keepsRestByDefault(choice) ? 'rest' : 'all');
  const keepingRest = showRecording && recordingChoice === 'rest';

  const create = () => {
    if (keepingRest) {
      void enqueueRemix(keepRestTake(original, spec), original.id);
      return;
    }
    const { seed, abc } = remixTake(original, spec, choice);
    void enqueueRemix({ ...spec, seed, abc }, original.id);
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 'var(--space-8) var(--gutter-screen) var(--space-9)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 'var(--space-7)' }}>
        <IconButton icon="chevron-left" label="Back" onClick={() => navigate('song')} />
        <div style={{ flex: 1 }}>
          <span style={{ font: 'var(--ui-eyebrow)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--brass-300)' }}>Remix</span>
          <h1 style={{ font: 'var(--display-md)', color: 'var(--ink-1)', margin: '6px 0 0', letterSpacing: 'var(--tracking-display)' }}>{original.spec.title}</h1>
        </div>
        <Badge mono>up to {fmtDuration(spec.durationSec)}</Badge>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) 320px', gap: 'var(--space-8)', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <TextField label="Title" value={spec.title} onChange={(v) => patch({ title: v })} />
          <div>
            <TextField
              label={`Caption — how the song should sound (${wordCount(spec.caption)} words, aim 250–450)`}
              multiline rows={8} value={spec.caption} onChange={(v) => patch({ caption: v })}
            />
            <div style={{ marginTop: 10 }}><LintList issues={issues} field="caption" /></div>
          </div>
          <div>
            <TagLyrics value={spec.lyrics} onChange={(v) => patch({ lyrics: v })} />
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <LintList issues={issues} field="lyrics" style={{ flex: 1 }} />
              <span style={{ font: 'var(--mono-sm)', color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>≈{fmtDuration(est)} of song</span>
            </div>
          </div>
          {showRecording && (
            <>
              <SegmentedChoice
                label="Recording" value={recordingChoice} onChange={(v) => setRecording(v as 'rest' | 'all')}
                options={[{ value: 'rest', label: 'Keep the rest', icon: 'lock' }, { value: 'all', label: 'Sing it all again', icon: 'dices' }]}
                style={{ maxWidth: 360 }}
              />
              <span style={{ font: 'var(--ui-sm)', color: 'var(--text-quiet)', marginTop: -8 }}>
                {keepingRest
                  ? 'Only the lines you changed are sung again. Everything else stays exactly as it was.'
                  : 'The whole song is sung again with your new words.'}
              </span>
            </>
          )}
          {!showRecording && reshapesLyrics(original, spec) && (
            <span style={{ font: 'var(--ui-sm)', color: 'var(--text-quiet)' }}>
              Adding or removing lines changes the shape of the song, so all of it is sung again.
            </span>
          )}
          {!keepingRest && (
            <SegmentedChoice
              label="Feel" value={feel} onChange={(v) => pickFeel(v as 'keep' | 'new')}
              options={[{ value: 'keep', label: 'Keep original', icon: 'lock' }, { value: 'new', label: 'New seed', icon: 'dices' }]}
              style={{ maxWidth: 320 }}
            />
          )}
          {!keepingRest && showMelody && (
            <>
              <SegmentedChoice
                label="Melody" value={melody} onChange={(v) => setMelody(v as 'keep' | 'new')}
                options={[{ value: 'keep', label: 'Keep melody', icon: 'lock' }, { value: 'new', label: 'New melody', icon: 'dices' }]}
                style={{ maxWidth: 320 }}
              />
              <span style={{ font: 'var(--ui-sm)', color: 'var(--text-quiet)', marginTop: -8 }}>
                {melody === 'keep'
                  ? seedMode === 'keep'
                    ? original.spec.edit
                      // A partly re-sung version is not a recipe for the whole recording.
                      ? 'Sings the original tune again. All of it is performed afresh, so voices and instruments can change.'
                      : 'Sings the original tune again. With nothing else changed it is the same take; your edits change how it is sung and played.'
                    : 'Sings the original tune again with a new feel: voices and instruments can change.'
                  : 'Writes a new melody for the song, with a new feel.'}
              </span>
            </>
          )}
          {planEdited && (
            <span style={{ font: 'var(--ui-sm)', color: 'var(--text-quiet)' }}>
              Your edited melody plan will be performed as written.
            </span>
          )}
          <Disclosure summary="Advanced">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)' }}>
              <NumField label="Steps" value={spec.steps} onChange={(v) => patch({ steps: v })} />
              <NumField label="Guidance" value={spec.cfg} onChange={(v) => patch({ cfg: v })} />
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <SegmentedChoice
                  label="Melody plan" value={spec.planMode}
                  onChange={(v) => patch({ planMode: v as PlanMode })}
                  options={[{ value: 'full', label: 'Melody + chords' }, { value: 'melody', label: 'Melody only' }, { value: 'off', label: 'None' }]}
                  style={{ maxWidth: 420 }}
                />
                {!planOff && (
                  <TextField
                    label={original.planAbc ? 'Melody plan (ABC notation) — edit to change the tune' : 'Melody plan (ABC notation) — leave empty to write a new one'}
                    multiline mono rows={10} value={planText} onChange={setPlanText}
                  />
                )}
                <SegmentedChoice
                  label="MP3 quality" value={spec.quality}
                  onChange={(v) => patch({ quality: v as Mp3Quality })}
                  options={['V0', '128k', '320k']}
                  style={{ maxWidth: 320 }}
                />
              </div>
            </div>
          </Disclosure>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', position: 'sticky', top: 0 }}>
          {spec.photo && (
            <img src={thumbSrc(spec.photo)} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 'var(--radius-photo)', boxShadow: 'var(--shadow-photo)' }} />
          )}
          <Panel variant="quiet" pad={16} style={{ font: 'var(--ui-sm)', color: 'var(--text-quiet)' }}>
            A remix keeps the same photo. It becomes a new version alongside this one.
          </Panel>
          <Button variant="primary" size="lg" fullWidth icon="shuffle" disabled={errors.length > 0} onClick={create}>
            Create Remix
          </Button>
          {errors.length > 0 && (
            <span style={{ font: 'var(--ui-sm)', color: 'var(--danger)' }}>{errors.map((e) => e.message).join(' ')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
