// Remix: the one deliberately technical surface. Edit the package (caption,
// tagged lyrics, seed, advanced knobs) and render a new linked version of the
// same photo's story. No length control — the cap derives from the lyrics.

import React, { useMemo, useState } from 'react';
import type { Mp3Quality, SongSpec } from '@engine/domain/types';
import { randomSeed } from '@engine/domain/types';
import { renderCap } from '@engine/domain/duration';
import { lintSong } from '@engine/cowriter/linter';
import { estimateSeconds, wordCount } from '@engine/cowriter/lyrics';
import { validateSpec } from '@engine/domain/validate';
import { enqueueRemix, getEngine, navigate, remixPrefix, remixSpec, thumbSrc, useAppState } from '@state/store';
import { fmtDuration } from '@ui/ds/format';
import { Badge } from '@ui/ds/Badge';
import { Button } from '@ui/ds/Button';
import { Disclosure } from '@ui/ds/Disclosure';
import { IconButton } from '@ui/ds/IconButton';
import { LintList } from '@ui/ds/LintList';
import { Panel } from '@ui/ds/Panel';
import { SegmentedChoice } from '@ui/ds/SegmentedChoice';
import { Switch } from '@ui/ds/Switch';
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

  if (!original || !spec) {
    navigate('sanctuary');
    return null;
  }

  const patch = (p: Partial<SongSpec>) => setSpec({ ...spec, ...p });
  const ceiling = getEngine().capCeilingSec;
  const cap = renderCap(spec.targetSec, spec.lyrics, ceiling);
  const issues = lintSong({ ...spec, durationSec: cap });
  const errors = validateSpec({ ...spec, durationSec: cap }).filter((i) => i.severity === 'error');
  const est = estimateSeconds(spec.lyrics);

  const create = () => {
    const keepSeed = seedMode === 'keep';
    const seed = keepSeed ? original.spec.seed : randomSeed();
    const finalSpec = { ...spec, seed, durationSec: cap };
    void enqueueRemix(finalSpec, original.id, remixPrefix(original, finalSpec, keepSeed));
  };
  const keepsPerformance = seedMode === 'keep' && remixPrefix(original, spec, true) != null;

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 'var(--space-8) var(--gutter-screen) var(--space-9)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 'var(--space-7)' }}>
        <IconButton icon="chevron-left" label="Back" onClick={() => navigate('song')} />
        <div style={{ flex: 1 }}>
          <span style={{ font: 'var(--ui-eyebrow)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--brass-300)' }}>Remix</span>
          <h1 style={{ font: 'var(--display-md)', color: 'var(--ink-1)', margin: '6px 0 0', letterSpacing: 'var(--tracking-display)' }}>{original.spec.title}</h1>
        </div>
        <Badge mono>renders up to {fmtDuration(cap)}</Badge>
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
          {seedMode === 'keep' && (
            <span style={{ font: 'var(--ui-sm)', color: 'var(--text-quiet)', marginTop: -8 }}>
              {keepsPerformance
                ? 'Keeps the original performance up to your first lyric change, then re-composes from there.'
                : 'A changed caption or opening (or a song without a saved composition) means the whole song is performed again — same seed, so it may still come out close.'}
            </span>
          )}
          <Disclosure summary="Advanced">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)', maxWidth: 460 }}>
              <NumField label="Steps" value={spec.steps} onChange={(v) => patch({ steps: v })} />
              <NumField label="Guidance" value={spec.cfg} onChange={(v) => patch({ cfg: v })} />
              <NumField label="Encode guidance" value={spec.encodeCfg} onChange={(v) => patch({ encodeCfg: v })} />
              <NumField label="Top K" value={spec.topK} onChange={(v) => patch({ topK: v })} />
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                <SegmentedChoice
                  label="MP3 quality" value={spec.quality}
                  onChange={(v) => patch({ quality: v as Mp3Quality })}
                  options={['V0', '128k', '320k']}
                  style={{ maxWidth: 320 }}
                />
                <Switch checked={spec.tiledDecode} onChange={(v) => patch({ tiledDecode: v })}
                  label="Tiled decode" hint="The safe default. Turning it off is unmeasured on long songs." />
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
