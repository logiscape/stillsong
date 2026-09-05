// Create: the photo well, one voice choice, quiet options, one button — and
// the full-status experience while the song is being made.

import React, { useEffect, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { AUDIO_FRAMES_PER_SECOND } from '@engine/domain/types';
import {
  choosePhoto, clearPhoto, createFromPhoto, navigate, photoSrc, useAppState, type CreationState,
} from '@state/store';
import { getPaintSession } from '@state/paintSession';
import { pickPhotoPath } from '@ui/ds/pickFiles';
import { fmtDuration } from '@ui/ds/format';
import { Button } from '@ui/ds/Button';
import { PhotoWell } from '@ui/ds/PhotoWell';
import { SegmentedChoice } from '@ui/ds/SegmentedChoice';
import { TextField } from '@ui/ds/TextField';
import { Select } from '@ui/ds/Select';
import { Disclosure } from '@ui/ds/Disclosure';
import { StageList, stageIndex } from '@ui/ds/StageList';
import { ProgressBar } from '@ui/ds/ProgressBar';
import { Notice } from '@ui/ds/Notice';
import { Panel } from '@ui/ds/Panel';

const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Japanese', 'Korean', 'Mandarin'];

type Voice = 'instrumental' | 'female' | 'male';

function StatusExperience({ creation }: { creation: CreationState }): React.ReactElement {
  const idx = stageIndex(creation.stage);
  const p = creation.progress;
  const composing = creation.stage === 'composing' && p?.stepNode === 'encode' && p.stepValue != null;
  const rendering = creation.stage === 'rendering' && p?.stepNode === 'sample' && p.stepValue != null && p.stepMax;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', height: '100%', alignItems: 'center', gap: 'var(--space-9)', padding: 'var(--gutter-screen)' }}>
      <div style={{ position: 'relative', borderRadius: 'var(--radius-photo)', overflow: 'hidden', boxShadow: 'var(--shadow-photo)', aspectRatio: '4/3', background: 'var(--surface-inset)' }}>
        {creation.photo && (
          <img src={photoSrc(creation.photo)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', animation: 'ss-kenburns 90s var(--ease-in-out) infinite alternate' }} />
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 100% at 50% 120%,var(--ambient-soft),transparent 70%)' }} />
      </div>
      <div style={{ maxWidth: 400 }}>
        <span style={{ font: 'var(--ui-eyebrow)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--brass-300)' }}>
          Your song is being made
        </span>
        <div style={{ height: 'var(--space-6)' }} />
        <StageList activeIndex={idx} />
        <div style={{ height: 'var(--space-7)' }} />
        {creation.title && idx >= 3 && (
          <div style={{ opacity: 0, animation: 'ss-rise var(--dur-reveal) var(--ease-serene) forwards' }}>
            <span style={{ font: 'var(--ui-sm)', color: 'var(--text-quiet)' }}>It will be called</span>
            <div style={{ font: 'var(--display-md)', color: 'var(--ink-1)', letterSpacing: 'var(--tracking-display)', marginTop: 6 }}>{creation.title}</div>
          </div>
        )}
        <div style={{ height: 'var(--space-7)' }} />
        {composing ? (
          <ProgressBar indeterminate label="Composing the melody…" detail={`${fmtDuration((p!.stepValue ?? 0) / AUDIO_FRAMES_PER_SECOND)} written`} />
        ) : rendering ? (
          <ProgressBar
            value={(p!.stepValue ?? 0) / (p!.stepMax ?? 1)}
            label="Bringing it to life…"
            detail={p!.etaSeconds != null ? `about ${Math.max(1, Math.round(p!.etaSeconds!))} seconds left` : undefined}
          />
        ) : (
          <ProgressBar indeterminate />
        )}
      </div>
    </div>
  );
}

export function CreateScreen(): React.ReactElement {
  const s = useAppState();
  const [voice, setVoice] = useState<Voice>('female');
  const [hint, setHint] = useState('');
  const [lang, setLang] = useState('English');
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  // Tauri intercepts native file drops (dragDropEnabled), so HTML5 drop events
  // never fire; listen to the webview's drag-drop event for real paths.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void getCurrentWebview()
      .onDragDropEvent((ev) => {
        if (ev.payload.type === 'enter' || ev.payload.type === 'over') setDragging(true);
        else if (ev.payload.type === 'leave') setDragging(false);
        else if (ev.payload.type === 'drop') {
          setDragging(false);
          const p = ev.payload.paths[0];
          if (p) void choosePhoto(p);
        }
      })
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, []);

  if (s.creation) return <StatusExperience creation={s.creation} />;

  const failed = s.creationError !== null && s.pendingPhoto !== null;
  const ambient = s.pendingPhoto?.dominantColor;

  return (
    <div style={{
      height: '100%', overflowY: 'auto', padding: 'var(--space-9) var(--gutter-screen)',
      background: ambient ? `radial-gradient(90% 70% at 50% 0%, ${hexWash(ambient)}, transparent 70%)` : 'none',
    }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        {failed && (
          <div style={{ marginBottom: 'var(--space-7)' }}>
            <Notice tone="error" title="Something went wrong while writing your song"
              action="Try again" onAction={() => void createFromPhoto(voice, hint.trim() || undefined, lang)}>
              Nothing was lost — your photo and your choices are still here.
            </Notice>
            <div style={{ marginTop: 'var(--space-4)' }}>
              <Button variant="quiet" onClick={() => setShowDetail(!showDetail)}>{showDetail ? 'hide details' : 'details'}</Button>
              {showDetail && (
                <Panel variant="inset" pad={14} style={{ marginTop: 10 }}>
                  <code style={{ font: 'var(--mono-sm)', color: 'var(--text-quiet)', whiteSpace: 'pre-wrap' }}>{s.creationError}</code>
                </Panel>
              )}
            </div>
          </div>
        )}
        {s.creationError && !s.pendingPhoto && (
          <div style={{ marginBottom: 'var(--space-7)' }}>
            <Notice tone="error" title="Something went wrong">{s.creationError}</Notice>
          </div>
        )}

        <PhotoWell
          src={photoSrc(s.pendingPhoto)} dragging={dragging} height={s.pendingPhoto ? 360 : 330}
          onChoose={() => void pickPhotoPath().then((p) => { if (p) void choosePhoto(p); }).catch(() => {})}
          onClear={() => clearPhoto()}
          onDraw={() => navigate('draw')}
          onEditDrawing={s.pendingPhoto?.source === 'drawing' && getPaintSession() ? () => navigate('draw') : undefined}
        />
        <div style={{ height: 'var(--space-8)' }} />
        <SegmentedChoice
          label="Voice" value={voice} onChange={(v) => setVoice(v as Voice)}
          options={[
            { value: 'instrumental', label: 'Instrumental', icon: 'audio-lines' },
            { value: 'female', label: 'Female vocals', icon: 'mic' },
            { value: 'male', label: 'Male vocals', icon: 'mic' },
          ]}
        />
        <div style={{ height: 'var(--space-7)' }} />
        <Disclosure summary="Add a touch of direction (optional)" open={open} onToggle={setOpen}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', maxWidth: 400 }}>
            <TextField label="Genre or mood" placeholder="cinematic folk ballad with medieval vibe" value={hint} onChange={setHint} />
            {voice !== 'instrumental' && <Select label="Lyrics language" value={lang} onChange={setLang} options={LANGUAGES} />}
          </div>
        </Disclosure>
        <div style={{ height: 'var(--space-8)', borderTop: '1px solid var(--border-hairline)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
          <Button variant="primary" size="lg" icon="wand-sparkles" disabled={!s.pendingPhoto}
            onClick={() => void createFromPhoto(voice, hint.trim() || undefined, lang)}>
            Create My Song
          </Button>
          <span style={{ font: 'var(--ui-sm)', color: 'var(--text-faint)' }}>
            {s.pendingPhoto ? 'A couple of minutes. Everything happens on your computer.' : 'Choose a photo or draw something to begin.'}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Very low-contrast wash of the photo's dominant colour for the ambient glow. */
function hexWash(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 'var(--ambient-soft)';
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},.35)`;
}
