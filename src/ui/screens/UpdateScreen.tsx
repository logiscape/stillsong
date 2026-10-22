// Studio update: shown instead of the app when the installed components were
// built from another manifest than this build carries (a newer Stillsong was
// installed over an existing setup). Nothing is checked or fetched until the
// user says so; the update itself is the ordinary setup install re-run into
// the same folder after the old runtime has been cleared (models, comfy-data
// and the library stay). A quit or crash midway resumes here, past consent:
// the preparation is repeated unless the marker says it had completed (a
// half-deleted python-env must never be handed to the bootstrap).

import React, { useEffect, useState } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { exit } from '@tauri-apps/api/app';
import { getEngine } from '@state/store';
import { Button } from '@ui/ds/Button';
import { Disclosure } from '@ui/ds/Disclosure';
import { Notice } from '@ui/ds/Notice';
import { Panel } from '@ui/ds/Panel';
import { ProgressBar } from '@ui/ds/ProgressBar';
import { SetupScreen, Shell } from './SetupScreen';
import manifest from '../../../components.json';

// Peak during an update on the dev box: ~4.5 GB of runtime on disk, 2.6 GB
// of downloads, plus uv's unzip-then-hardlink staging. Checked before the old
// runtime is cleared, so it is conservative by what that clearing reclaims.
const UPDATE_FREE_BYTES = 10 * 1024 ** 3;
const GB = (b: number) => `${Math.round(b / 1024 ** 3)} GB`;

// What the update downloads: everything but the model files already in place.
const DOWNLOAD_BYTES =
  manifest.items.filter((i) => i.kind !== 'model').reduce((s, i) => s + i.size, 0) +
  manifest.python.wheels.reduce((s, w) => s + w.size, 0);

type Stage = 'consent' | 'preparing' | 'installing';

export function UpdateScreen(): React.ReactElement {
  const install = getEngine().installState;
  const resumePrepared = install.state === 'updating' && install.prepared;
  const resumeUnprepared = install.state === 'updating' && !install.prepared;
  const [stage, setStage] = useState<Stage>(resumePrepared ? 'installing' : resumeUnprepared ? 'preparing' : 'consent');
  const [componentsDir, setComponentsDir] = useState('');
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const [line, setLine] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void invoke<{ componentsDir: string }>('runtime_paths').then((p) => {
      setComponentsDir(p.componentsDir);
      void invoke<number | null>('components_free_space', { path: p.componentsDir }).then(setFreeBytes).catch(() => {});
    });
    if (resumeUnprepared) void prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prepare = async () => {
    setError(null);
    setLine('');
    setStage('preparing');
    const onLine = new Channel<string>();
    onLine.onmessage = (l) => setLine(l);
    try {
      await invoke('components_prepare_update', { onLine });
      setStage('installing');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (stage === 'installing') return <SetupScreen mode="update" />;

  const installed = install.state === 'needs-update' ? install.installedVersion : null;
  const enough = freeBytes === null || freeBytes >= UPDATE_FREE_BYTES;

  if (stage === 'preparing') {
    return (
      <Shell step={0} steps={2} title="Updating the studio."
        lede="Clearing out the old working parts first. This takes a moment."
        footer={error ? <Button variant="primary" size="lg" onClick={() => void prepare()}>Try again</Button> : undefined}>
        <Panel pad={20}>
          <ProgressBar indeterminate={!error} value={error ? 0 : undefined} label="Clearing out the old studio" detail={line} />
        </Panel>
        {error && <Notice tone="error" style={{ marginTop: 'var(--space-6)' }} title="The old studio could not be removed">{error}</Notice>}
      </Shell>
    );
  }

  return (
    <Shell step={0} steps={2} title="The studio needs an update."
      lede={`This version of Stillsong comes with a newer studio than the one on this computer. Updating downloads about ${GB(DOWNLOAD_BYTES)} and replaces the studio's working parts. Your songs, photos and the large pieces from setup stay where they are.`}
      footer={<>
        <Button variant="primary" size="lg" disabled={!enough} onClick={() => void prepare()}>Update now</Button>
        <Button variant="ghost" onClick={() => void exit(0)}>Quit</Button>
      </>}>
      <div style={{ font: 'var(--ui-eyebrow)', letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--brass-300)', marginBottom: 'var(--space-5)' }}>Studio update</div>
      <Notice tone="info" title="Nothing happens on its own">
        Stillsong never checks for updates by itself. This only appears after you install a newer version yourself.
      </Notice>
      {!enough && (
        <Notice tone="error" style={{ marginTop: 'var(--space-5)' }} title="Not enough room">
          Free up about {GB(UPDATE_FREE_BYTES)} on this drive, then try again.
        </Notice>
      )}
      <Disclosure summary="Details" style={{ marginTop: 'var(--space-6)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', font: 'var(--ui-sm)', color: 'var(--text-body)', padding: 'var(--space-4) 0' }}>
          <span style={{ color: 'var(--text-quiet)' }}>Installed</span><span style={{ font: 'var(--mono-sm)' }}>{installed ?? 'an earlier version'}</span>
          <span style={{ color: 'var(--text-quiet)' }}>This version needs</span><span style={{ font: 'var(--mono-sm)' }}>{install.currentVersion}</span>
          <span style={{ color: 'var(--text-quiet)' }}>Folder</span><span style={{ font: 'var(--mono-sm)', wordBreak: 'break-all' }}>{componentsDir || '…'}</span>
          {freeBytes !== null && <><span style={{ color: 'var(--text-quiet)' }}>Free on that drive</span><span style={{ font: 'var(--mono-sm)' }}>{GB(freeBytes)}</span></>}
        </div>
      </Disclosure>
    </Shell>
  );
}
