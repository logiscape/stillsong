// Remix: the one deliberately technical surface. Edit the package (caption,
// tagged lyrics, seed, melody plan, advanced knobs) and render a new linked
// version of the same photo's story. No length control: every song gets the
// same cap (MAX_DURATION_SEC) and ends where the composer ends it.

import React, { useMemo, useState } from 'react';
import type { Mp3Quality, PlanMode, SongSpec } from '@engine/domain/types';
import { randomSeed } from '@engine/domain/types';
import { renderCap } from '@engine/domain/duration';
import { lintSong } from '@engine/cowriter/linter';
import { estimateSeconds, wordCount } from '@engine/cowriter/lyrics';
import { validateSpec } from '@engine/domain/validate';
import { canKeepMelody, enqueueRemix, navigate, remixAbc, remixSpec, thumbSrc, useAppState } from '@state/store';
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
  // A different plan mode asks for a different kind of plan: write a new one.
  const modeChanged = spec.planMode !== original.spec.planMode;

  const create = () => {
    const seed = seedMode === 'keep' ? original.spec.seed : randomSeed();
    const abc = planOff ? undefined : remixAbc(original, melody === 'keep' && !modeChanged, planEdited ? planText : undefined);
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
          <SegmentedChoice
            label="Feel" value={seedMode} onChange={(v) => setSeedMode(v as 'keep' | 'new')}
            options={[{ value: 'keep', label: 'Keep original', icon: 'lock' }, { value: 'new', label: 'New seed', icon: 'dices' }]}
            style={{ maxWidth: 320 }}
          />
          {melodyAvailable && !planOff && !planEdited && !modeChanged && (
            <>
              <SegmentedChoice
                label="Melody" value={melody} onChange={(v) => setMelody(v as 'keep' | 'new')}
                options={[{ value: 'keep', label: 'Keep melody', icon: 'lock' }, { value: 'new', label: 'New melody', icon: 'dices' }]}
                style={{ maxWidth: 320 }}
              />
              <span style={{ font: 'var(--ui-sm)', color: 'var(--text-quiet)', marginTop: -8 }}>
                {melody === 'keep'
                  ? seedMode === 'keep'
                    ? 'Sings the original tune again. With nothing else changed it is the same take; your edits change how it is sung and played.'
                    : 'Sings the original tune again with a new feel: voices and instruments can change.'
                  : 'Writes a new melody for the song.'}
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
