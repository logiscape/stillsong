// The Song view: the photo is the room, the lyrics drift over it, the player
// stays within reach. No word-level timing exists — the lyric sheet is a
// typeset column, with an optional gentle auto-scroll that is clearly an
// estimate.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseLyrics } from '@engine/cowriter/lyrics';
import { canEnhance, genreTag } from '@engine/domain/types';
import {
  canRerunLonger, deleteSong, enhancePending, enhanceSong, exportSong, navigate, openSong, photoSrc, playSong, renameSong, rerunLonger,
  revealSong, saveSettings, seek, setVolume, stopPlayback, togglePlay, useAppState,
} from '@state/store';
import { Badge } from '@ui/ds/Badge';
import { Button } from '@ui/ds/Button';
import { Dialog } from '@ui/ds/Dialog';
import { Icon } from '@ui/ds/Icon';
import { IconButton } from '@ui/ds/IconButton';
import { LyricSheet } from '@ui/ds/LyricSheet';
import { Notice } from '@ui/ds/Notice';
import { Panel } from '@ui/ds/Panel';
import { PhotoRoom } from '@ui/ds/PhotoRoom';
import { Player } from '@ui/ds/Player';
import { Switch } from '@ui/ds/Switch';
import { TextField } from '@ui/ds/TextField';

/** For instrumental songs: the first Global Metadata sentence as a mood line. */
function epigraphFrom(caption: string): string | null {
  const m = /global metadata\s*:?\s*([^.]+\.)/i.exec(caption);
  return m ? m[1].trim() : null;
}

export function SongScreen(): React.ReactElement | null {
  const s = useAppState();
  const song = s.songs.find((x) => x.id === s.selectedSongId);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmEnhance, setConfirmEnhance] = useState(false);
  const prefersContrast = useMemo(() => window.matchMedia('(prefers-contrast: more)').matches, []);
  const lyricsRef = useRef<HTMLDivElement | null>(null);

  const isCurrent = song && s.playback?.songId === song.id;
  const playing = !!isCurrent && s.playback!.isPlaying;

  // Autoplay on entry from a finished creation, never when browsing.
  useEffect(() => {
    if (song && s.autoplayOnOpen && song.outputPath && s.playback?.songId !== song.id) {
      playSong(song);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id]);

  // Optional gentle auto-scroll: linearly maps playback position to scroll
  // extent. An estimate — the words aren't timed to the music.
  useEffect(() => {
    if (!s.settings?.lyricsAutoScroll || !isCurrent || !playing) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = lyricsRef.current;
    if (!el) return;
    const dur = s.playback!.durationSec || 1;
    const frac = Math.min(1, s.playback!.positionSec / dur);
    el.scrollTo({ top: (el.scrollHeight - el.clientHeight) * frac, behavior: 'smooth' });
  }, [s.playback?.positionSec, s.settings?.lyricsAutoScroll, isCurrent, playing, s.playback]);

  if (!song) {
    navigate('sanctuary');
    return null;
  }

  const stanzas = parseLyrics(song.spec.lyrics).sections
    .filter((sec) => sec.lines.length > 0)
    .map((sec) => sec.lines.join('\n'));
  const solid = !!s.settings?.solidPanelMode || prefersContrast;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const photo = photoSrc(song.spec.photo);
  const pending = enhancePending(song, s.songs);
  const enhanceable = canEnhance(song) && !pending;

  const menuItems: [string, string, () => void][] = [
    ['shuffle', 'Remix this song', () => navigate('remix')],
    ...(enhanceable ? ([['wand-sparkles', 'Enhance quality…', () => setConfirmEnhance(true)]] as [string, string, () => void][]) : []),
    ['download', 'Save a copy…', () => void exportSong(song)],
    ['folder-open', 'Reveal in folder', () => void revealSong(song)],
    ['pencil-line', 'Rename', () => setRenaming(song.spec.title)],
    ...(song.parentId ? ([['disc', 'View original version', () => openSong(song.parentId!)]] as [string, string, () => void][]) : []),
    ['trash-2', 'Delete', () => setConfirmDelete(true)],
  ];

  const body = (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 22px' }}>
        <IconButton icon="chevron-left" label="Close" variant="glass" onClick={() => { stopPlayback(); navigate('sanctuary'); }} />
        <div style={{ flex: 1 }} />
        {canEnhance(song) && (
          <Button variant="glass" size="sm" icon="wand-sparkles" disabled={pending} onClick={() => setConfirmEnhance(true)}>
            {pending ? 'Enhancing…' : 'Enhance quality'}
          </Button>
        )}
        <IconButton icon="shuffle" label="Remix" variant="glass" onClick={() => navigate('remix')} />
        <IconButton icon="ellipsis" label="More" variant="glass" onClick={() => setMenu(!menu)} />
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', padding: '0 var(--gutter-screen)' }}>
        <div ref={lyricsRef} style={{ maxWidth: 520, maxHeight: '100%', overflowY: 'auto', paddingRight: 8 }}>
          {song.hitCeiling && canRerunLonger(song) && (
            <Notice tone="calm" glass action="Let it finish" onAction={() => void rerunLonger(song)}
              title="This song wanted to run longer than expected"
              style={{ marginBottom: 'var(--space-6)', maxWidth: 420 }}>
              {song.codesPath
                ? 'We can replay this exact performance with more room, so it gets to write its own ending.'
                : 'We can give it another half minute with the same seed — the song usually, but not always, comes out close.'}
            </Notice>
          )}
          <LyricSheet
            title={song.spec.title || 'Untitled'}
            stanzas={stanzas}
            instrumental={song.spec.instrumental}
            epigraph={song.spec.instrumental ? epigraphFrom(song.spec.caption) : null}
            mode={solid ? 'solid' : 'blur'}
          />
        </div>
      </div>

      <div style={{ padding: '0 var(--gutter-screen) 26px', display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
        <Player
          playing={playing}
          position={isCurrent ? s.playback!.positionSec : 0}
          duration={isCurrent ? s.playback!.durationSec || song.actualSec || 0 : song.actualSec || 0}
          volume={s.playback?.volume ?? 0.8}
          onToggle={() => (isCurrent ? togglePlay() : playSong(song))}
          onSeek={(sec) => (isCurrent ? seek(sec) : undefined)}
          onVolume={setVolume}
          style={{ flex: 1, maxWidth: 640 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Badge tone="glass">{genreTag(song.spec.caption)}</Badge>
          <Switch
            checked={solid}
            onChange={(v) => s.settings && void saveSettings({ ...s.settings, solidPanelMode: v })}
            label="Solid panel"
          />
        </div>
      </div>

      {menu && (
        <Panel variant="glass" pad={6} style={{ position: 'absolute', top: 64, right: 22, width: 230, zIndex: 40 }}>
          {menuItems.map(([ic, l, fn]) => (
            <button
              key={l}
              onClick={() => { setMenu(false); fn(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '9px 10px', background: 'none',
                border: 'none', cursor: 'pointer', font: 'var(--ui-sm)',
                color: l === 'Delete' ? '#E0A18B' : 'var(--ink-1)', textAlign: 'left', borderRadius: 'var(--radius-sm)',
              }}
            >
              <Icon name={ic} size={15} />{l}
            </button>
          ))}
        </Panel>
      )}

      <Dialog open={confirmDelete} title="Delete this song?" onClose={() => setConfirmDelete(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
            <Button variant="danger" onClick={() => void deleteSong(song)}>Delete</Button>
          </>
        }>
        Anything you saved with Save a copy stays where you saved it. The song will be removed from Stillsong.
      </Dialog>

      <Dialog open={confirmEnhance} title="Enhance the sound?" onClose={() => setConfirmEnhance(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmEnhance(false)}>Not now</Button>
            <Button variant="primary" icon="wand-sparkles" onClick={() => { setConfirmEnhance(false); void enhanceSong(song); }}>Enhance quality</Button>
          </>
        }>
        The studio will play this very same performance again and take more time over the sound, so some
        voices and instruments come out sharper. It usually takes 5–10 minutes, depending on the song.
        The enhanced take arrives as a new version, and this one stays just as it is.
      </Dialog>

      {renaming !== null && (
        <Dialog title="Rename" onClose={() => setRenaming(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => { void renameSong(song, renaming.trim() || 'Untitled'); setRenaming(null); }}>Rename</Button>
            </>
          }>
          <TextField value={renaming} onChange={setRenaming} label="Title" />
        </Dialog>
      )}
    </div>
  );

  if (!photo) {
    return <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--ground-deep)' }}>{body}</div>;
  }
  return (
    <PhotoRoom photo={photo} luminance={song.spec.photo?.luminance ?? 0.5} scrim="vertical" kenBurns={!reducedMotion}>
      {body}
    </PhotoRoom>
  );
}
