// The app frame: a quiet icon rail beside the active surface. Chrome
// disappears on the Song view and during first-run, where the photo owns the
// window (the OS title bar stays native).

import React from 'react';
import { navigate, useAppState, type Screen } from '@state/store';
import { Icon } from '@ui/ds/Icon';
import { CreateScreen } from './screens/CreateScreen';
import { SanctuaryScreen } from './screens/SanctuaryScreen';
import { SongScreen } from './screens/SongScreen';
import { RemixScreen } from './screens/RemixScreen';
import { AboutScreen } from './screens/AboutScreen';
import { SetupScreen } from './screens/SetupScreen';
import { DrawScreen } from './screens/draw/DrawScreen';

const NAV: { id: Screen; icon: string; label: string }[] = [
  { id: 'create', icon: 'image-plus', label: 'Create' },
  { id: 'sanctuary', icon: 'layout-grid', label: 'Sanctuary' },
  { id: 'about', icon: 'settings', label: 'About' },
];

function NavRail({ view }: { view: Screen }): React.ReactElement {
  return (
    <nav style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 72, padding: '18px 0',
      flex: '0 0 auto', borderRight: '1px solid var(--border-hairline)', background: 'var(--ground-deep)',
    }}>
      <span style={{ font: '300 15px/1 var(--font-display)', letterSpacing: '.01em', color: 'var(--ink-3)', marginBottom: 14 }}>S</span>
      {NAV.map((it) => {
        const on = view === it.id;
        return (
          <button
            key={it.id} onClick={() => navigate(it.id)} title={it.label}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 56, padding: '10px 0',
              cursor: 'pointer', background: on ? 'var(--brass-wash)' : 'transparent',
              border: '1px solid ' + (on ? 'var(--brass-line)' : 'transparent'),
              borderRadius: 'var(--radius-md)', color: on ? 'var(--brass-200)' : 'var(--ink-3)',
              transition: 'all var(--dur-fast) var(--ease-out)',
            }}
          >
            <Icon name={it.icon} size={19} />
            <span style={{ font: 'var(--ui-xs)', letterSpacing: '.01em' }}>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function App(): React.ReactElement {
  const s = useAppState();
  if (!s.ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        {s.lastError
          ? <div style={{ maxWidth: 480, font: 'var(--ui-md)', color: 'var(--text-body)' }}>{s.lastError}</div>
          : <span style={{ font: 'var(--epigraph)', color: 'var(--text-quiet)' }}>Stillsong</span>}
      </div>
    );
  }
  const chrome = s.screen !== 'song' && s.screen !== 'setup' && s.screen !== 'draw';
  return (
    <div style={{ position: 'relative', display: 'flex', width: '100%', height: '100%', overflow: 'hidden', background: 'var(--ground)' }}>
      {chrome && <NavRail view={s.screen} />}
      <main style={{ position: 'relative', flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {s.screen === 'setup' && <SetupScreen />}
        {s.screen === 'create' && <CreateScreen />}
        {s.screen === 'sanctuary' && <SanctuaryScreen />}
        {s.screen === 'song' && <SongScreen />}
        {s.screen === 'remix' && <RemixScreen />}
        {s.screen === 'about' && <AboutScreen />}
        {s.screen === 'draw' && <DrawScreen />}
      </main>
    </div>
  );
}
