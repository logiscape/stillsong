// About / Settings: the few real settings, the dignified credits, and the
// local-only "Verify installation" re-hash.

import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Mp3Quality, RenderMethod } from '@engine/domain/types';
import { saveSettings, useAppState } from '@state/store';
import manifest from '../../../components.json';
import { Badge } from '@ui/ds/Badge';
import { Button } from '@ui/ds/Button';
import { Panel } from '@ui/ds/Panel';
import { Select } from '@ui/ds/Select';
import { Switch } from '@ui/ds/Switch';

interface AppPaths {
  componentsDir: string;
  logsDir: string;
  installComplete: boolean;
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section style={{ marginBottom: 'var(--space-8)' }}>
      <h2 style={{ font: 'var(--ui-eyebrow)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--brass-300)', margin: '0 0 var(--space-5)' }}>{title}</h2>
      {children}
    </section>
  );
}

export function AboutScreen(): React.ReactElement {
  const s = useAppState();
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [verify, setVerify] = useState<string | null>(null);
  const [legal, setLegal] = useState<{ title: string; text: string } | null>(null);

  // Both texts ship inside the app bundle (lazy chunks) — the GPL's
  // "Appropriate Legal Notices" and the bundled components' MIT/ISC/Apache
  // notice conditions are met by the app itself, offline.
  const showLegal = async (title: string, load: () => Promise<{ default: string }>) => {
    if (legal?.title === title) { setLegal(null); return; }
    setLegal({ title, text: (await load()).default });
  };

  useEffect(() => {
    void invoke<AppPaths>('runtime_paths').then(setPaths).catch(() => {});
  }, []);

  const settings = s.settings;

  const runVerify = async () => {
    if (!paths) return;
    setVerify('Checking…');
    let ok = 0;
    const bad: string[] = [];
    for (const item of manifest.items) {
      // Archives are extracted then kept only as installed trees; verify the
      // model files (the archives may have been cleaned up).
      if (item.kind !== 'model') continue;
      const good = await invoke<boolean>('components_verify', { id: item.id }).catch(() => false);
      if (good) ok += 1;
      else bad.push(item.id);
    }
    setVerify(bad.length === 0 ? `All ${ok} model files check out.` : `Problems with: ${bad.join(', ')}. Reinstalling repairs this.`);
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 'var(--space-8) var(--gutter-screen) var(--space-9)' }}>
      <div style={{ maxWidth: 640 }}>
        <h1 style={{ font: 'var(--display-md)', color: 'var(--ink-1)', margin: '0 0 var(--space-8)', letterSpacing: 'var(--tracking-display)' }}>Stillsong</h1>

        {settings && (
          <Section title="Settings">
            <Panel pad={20} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
              <div>
                <Select
                  label="How new songs are made"
                  value={settings.renderMethod}
                  onChange={(v) => void saveSettings({ ...settings, renderMethod: v as RenderMethod })}
                  options={[{ value: 'fast', label: 'Fast' }, { value: 'enhanced', label: 'Enhanced quality' }]}
                />
                <span style={{ display: 'block', font: 'var(--ui-sm)', color: 'var(--text-quiet)', marginTop: 8, maxWidth: '52ch' }}>
                  Enhanced quality gives the studio more time with each song, so voices and instruments come out
                  clearer — and a song takes a while longer to make. Any song made the fast way can be enhanced later.
                </span>
              </div>
              <div>
                <Select
                  label="Quality of saved songs"
                  value={settings.quality}
                  onChange={(v) => void saveSettings({ ...settings, quality: v as Mp3Quality })}
                  options={[{ value: 'V0', label: 'Best (V0)' }, { value: '320k', label: 'Largest (320k)' }, { value: '128k', label: 'Smaller files (128k)' }]}
                />
                <span style={{ display: 'block', font: 'var(--ui-sm)', color: 'var(--text-quiet)', marginTop: 8, maxWidth: '52ch' }}>
                  Only changes how the finished song is packed into an MP3 — its file size, and how much fine detail
                  the file keeps. It doesn't change how the song is made.
                </span>
              </div>
              <Switch
                checked={settings.lyricsAutoScroll}
                onChange={(v) => void saveSettings({ ...settings, lyricsAutoScroll: v })}
                label="Gently scroll the lyrics while a song plays"
                hint="An estimate — the words aren't timed to the music."
              />
              <Switch
                checked={settings.solidPanelMode}
                onChange={(v) => void saveSettings({ ...settings, solidPanelMode: v })}
                label="Always use a solid panel behind lyrics"
                hint="Turns on by itself when your system asks for more contrast."
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 'var(--space-5)', borderTop: '1px solid var(--border-hairline)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: 'var(--ui-md)', color: 'var(--ink-1)' }}>Where the pieces are kept</div>
                  <div style={{ font: 'var(--mono-sm)', color: 'var(--text-quiet)', marginTop: 3, overflowWrap: 'anywhere' }}>{paths?.componentsDir ?? '…'}</div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => void runVerify()}>Verify installation</Button>
              </div>
              {verify && <span style={{ font: 'var(--ui-sm)', color: 'var(--text-quiet)' }}>{verify}</span>}
            </Panel>
          </Section>
        )}

        <Section title="About">
          <Panel variant="quiet" pad={20}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span style={{ font: '300 30px/1 var(--font-display)', color: 'var(--ink-1)' }}>Stillsong</span>
              <Badge mono>0.1.0</Badge>
            </div>
            <p style={{ font: 'var(--ui-md)', color: 'var(--text-body)', margin: 'var(--space-5) 0 0', maxWidth: '54ch' }}>
              Stillsong never connects to the internet after setup. Your photos and songs stay on this computer.
            </p>
            <div style={{ marginTop: 'var(--space-7)', display: 'flex', flexDirection: 'column', gap: 6, font: 'var(--ui-sm)', color: 'var(--text-quiet)' }}>
              <span>A <span style={{ color: 'var(--ink-1)' }}>Logiscape</span> project</span>
              <span style={{ font: 'var(--ui-label)', color: 'var(--text-faint)', letterSpacing: '.04em' }}>With acknowledgement to</span>
              <span>Music composed locally by <span style={{ color: 'var(--ink-1)' }}>MiniMax-Music3</span></span>
              <span>Lyrics by <span style={{ color: 'var(--ink-1)' }}>Gemma 4</span></span>
              <span>Engines: <span style={{ color: 'var(--ink-1)' }}>ComfyUI</span>, <span style={{ color: 'var(--ink-1)' }}>llama.cpp</span></span>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-5)', marginTop: 'var(--space-7)' }}>
              <Button variant="ghost" size="sm" icon="folder-open"
                onClick={() => paths && void invoke('files_reveal', { path: `${paths.logsDir}\\comfyui.log` })}>
                Open logs folder
              </Button>
            </div>
          </Panel>
        </Section>

        <Section title="What's in a saved song">
          <Panel variant="quiet" pad={20}>
          <p style={{ font: 'var(--ui-md)', color: 'var(--text-body)', margin: 0, maxWidth: '58ch' }}>
              A founding principle of Stillsong is to protect your creations and your privacy. Everything
              runs on your own PC, and the songs only leave if you choose to share them. If you do decide to share,
              Stillsong adds a small text tag to the song for open transparency.
            </p>
            <p style={{ font: 'var(--ui-md)', color: 'var(--text-body)', margin: 'var(--space-5) 0 0', maxWidth: '58ch' }}>
              Every song Stillsong makes carries a small text tag inside the MP3, written by
              the renderer: the complete recipe for the song. That is the caption and lyrics
              Gemma wrote, the seed, the length cap and sampler settings, the model file
              names — and, for a song that continues an earlier take (Let it finish, or a
              Remix that keeps a section), the composition codes of the part being continued.
              With the same models, that recipe re-creates the audio exactly.
            </p>
            <p style={{ font: 'var(--ui-md)', color: 'var(--text-body)', margin: 'var(--space-5) 0 0', maxWidth: '58ch' }}>
              It never contains your photo or drawing, or anything made from its pixels — the
              picture is only shown to the songwriter, on this computer, and the renderer has
              no image input. It carries no title, no name, and nothing about this PC. The
              caption and lyrics do describe the picture in words, though.
            </p>
            <p style={{ font: 'var(--ui-md)', color: 'var(--text-body)', margin: 'var(--space-5) 0 0', maxWidth: '58ch' }}>
              Save a copy adds one more tag: a comment noting the music was generated with
              MiniMax-Music3 in Stillsong.
            </p>
          </Panel>
        </Section>

        <Section title="License">
          <Panel variant="quiet" pad={20}>
            <p style={{ font: 'var(--ui-md)', color: 'var(--text-body)', margin: 0, maxWidth: '58ch' }}>
              © 2026 Logiscape LLC. Stillsong is free software under the GNU General Public
              License v3 — you may run, study, share, and change it. It comes with
              absolutely no warranty.
            </p>
            <div style={{ font: 'var(--mono-sm)', color: 'var(--text-quiet)', marginTop: 'var(--space-5)', userSelect: 'text' }}>
              Source code: https://github.com/logiscape/stillsong
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-5)', marginTop: 'var(--space-6)' }}>
              <Button variant="ghost" size="sm" icon="scroll-text"
                onClick={() => void showLegal('GNU General Public License v3', () => import('../../../LICENSE?raw'))}>
                View license
              </Button>
              <Button variant="ghost" size="sm" icon="layers"
                onClick={() => void showLegal('Third-party licenses', () => import('../../../THIRD-PARTY-LICENSES.txt?raw'))}>
                Third-party licenses
              </Button>
            </div>
            {legal && (
              <div style={{ marginTop: 'var(--space-6)' }}>
                <div style={{ font: 'var(--ui-label)', color: 'var(--text-faint)', letterSpacing: '.04em', marginBottom: 'var(--space-4)' }}>{legal.title}</div>
                <pre style={{
                  font: 'var(--mono-sm)', color: 'var(--text-quiet)', whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere', maxHeight: 360, overflowY: 'auto', margin: 0,
                  padding: 'var(--space-5)', border: '1px solid var(--border-hairline)',
                  borderRadius: 'var(--radius-md, 8px)', userSelect: 'text',
                }}>{legal.text}</pre>
              </div>
            )}
          </Panel>
        </Section>
      </div>
    </div>
  );
}
