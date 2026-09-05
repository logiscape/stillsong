// The Sanctuary: browse photos while listening to their stories. The photo is
// the card; songs sharing a parent chain collapse into one card with versions.

import React, { useState } from 'react';
import { genreTag } from '@engine/domain/types';
import type { Song } from '@engine/domain/types';
import {
  groupVersions, navigate, openSong, playSong, thumbSrc, useAppState, type SongGroup,
} from '@state/store';
import { fmtDuration } from '@ui/ds/format';
import { Icon } from '@ui/ds/Icon';
import { IconButton } from '@ui/ds/IconButton';
import { Panel } from '@ui/ds/Panel';
import { SongCard } from '@ui/ds/SongCard';

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }): React.ReactElement {
  const [foc, setFoc] = useState(false);
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 9, width: foc || value ? 260 : 210, height: 34, padding: '0 12px',
      background: 'var(--wash-1)', border: '1px solid ' + (foc ? 'var(--brass-line)' : 'var(--border-hairline)'),
      borderRadius: 'var(--radius-pill)', transition: 'width var(--dur-base) var(--ease-out)',
    }}>
      <Icon name="search" size={15} color="var(--ink-4)" />
      <input
        value={value} onChange={(e) => onChange(e.target.value)} onFocus={() => setFoc(true)} onBlur={() => setFoc(false)}
        placeholder="Search your songs"
        style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none', font: 'var(--ui-sm)', color: 'var(--ink-1)' }}
      />
    </label>
  );
}

function versionLabel(i: number, total: number): string {
  if (i === total - 1) return 'Original';
  return `Version ${total - i}`;
}

export function SanctuaryScreen(): React.ReactElement {
  const s = useAppState();
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const matches = (song: Song) => (song.spec.title + ' ' + song.spec.caption).toLowerCase().includes(q.toLowerCase());
  const groups: SongGroup[] = groupVersions(s.songs).filter((g) => g.versions.some(matches));

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 'var(--space-8) var(--gutter-screen) var(--space-9)' }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-6)', marginBottom: 'var(--space-8)' }}>
        <div style={{ flex: 1 }}>
          <span style={{ font: 'var(--ui-eyebrow)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--brass-300)' }}>The Sanctuary</span>
          <h1 style={{ font: 'var(--display-md)', color: 'var(--ink-1)', margin: '8px 0 0', letterSpacing: 'var(--tracking-display)' }}>
            {groups.length === 0 && !q ? 'Nothing here yet' : `${groups.length} ${groups.length === 1 ? 'song' : 'songs'}`}
          </h1>
        </div>
        <SearchField value={q} onChange={setQ} />
      </header>

      {groups.length === 0 && !q ? (
        <button
          onClick={() => navigate('create')}
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
            width: 340, aspectRatio: '4/3', cursor: 'pointer', background: 'var(--wash-1)',
            border: '1px dashed var(--border-field)', borderRadius: 'var(--radius-photo)',
          }}
        >
          <Icon name="image-plus" size={26} color="var(--brass-300)" />
          <span style={{ font: 'var(--display-sm)', color: 'var(--ink-1)' }}>Start with one photo</span>
          <span style={{ font: 'var(--ui-sm)', color: 'var(--text-quiet)' }}>Its song will live here.</span>
        </button>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 'var(--grid-gap)', alignItems: 'start' }}>
          {groups.map((g) => {
            const song = g.newest;
            const playingThis = s.playback?.songId === song.id && s.playback.isPlaying;
            return (
              <div key={g.rootId}>
                <SongCard
                  photo={thumbSrc(song.spec.photo)}
                  title={song.spec.title || 'Untitled'}
                  genre={genreTag(song.spec.caption)}
                  length={song.actualSec != null ? fmtDuration(song.actualSec) : undefined}
                  date={fmtDate(song.createdAt)}
                  instrumental={song.spec.instrumental}
                  versions={g.versions.length}
                  playing={playingThis}
                  onPlay={() => playSong(song)}
                  onOpen={() => openSong(song.id)}
                />
                {g.versions.length > 1 && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={() => setExpanded(expanded === g.rootId ? null : g.rootId)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', padding: 0,
                        cursor: 'pointer', font: 'var(--ui-sm)', color: 'var(--brass-200)',
                      }}
                    >
                      <Icon name={expanded === g.rootId ? 'chevron-down' : 'chevron-right'} size={14} />
                      {g.versions.length} versions
                    </button>
                    {expanded === g.rootId && (
                      <Panel variant="quiet" pad={0} style={{ marginTop: 8, overflow: 'hidden' }}>
                        {g.versions.map((v, i) => {
                          const current = v.id === song.id;
                          const playingV = s.playback?.songId === v.id && s.playback.isPlaying;
                          return (
                            <div key={v.id} style={{
                              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer',
                              borderTop: i ? '1px solid var(--border-hairline)' : 'none',
                              background: current ? 'var(--wash-1)' : 'transparent',
                            }} onClick={() => openSong(v.id)}>
                              <Icon name={current ? 'disc-3' : 'disc'} size={15} color={current ? 'var(--brass-200)' : 'var(--ink-4)'} />
                              <span style={{ flex: 1, font: 'var(--ui-sm)', color: 'var(--ink-1)' }}>{versionLabel(i, g.versions.length)}</span>
                              <span style={{ font: 'var(--ui-xs)', color: 'var(--text-faint)' }}>{fmtDate(v.createdAt)}</span>
                              <IconButton icon={playingV ? 'pause' : 'play'} label="Play version" size={30}
                                onClick={(e) => { e.stopPropagation(); playSong(v); }} />
                            </div>
                          );
                        })}
                      </Panel>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
