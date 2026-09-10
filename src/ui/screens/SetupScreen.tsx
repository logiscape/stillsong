// First-run setup: consent-first, honest about sizes, resumable. Nothing is
// fetched before the explicit Download click; every step is idempotent, so a
// killed or offline setup resumes cleanly.

import React, { useEffect, useRef, useState } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { hardwareTier } from '@engine/domain/duration';
import { getEngine, navigate, saveSettings, useAppState } from '@state/store';
import { Button } from '@ui/ds/Button';
import { Icon } from '@ui/ds/Icon';
import { Notice } from '@ui/ds/Notice';
import { Panel } from '@ui/ds/Panel';
import { ProgressBar } from '@ui/ds/ProgressBar';
import { TextField } from '@ui/ds/TextField';
import manifest from '../../../components.json';

const STEP_COUNT = 6;
const REQUIRED_FREE_BYTES = 40 * 1024 ** 3;

interface ManifestItem {
  id: string;
  kind: string;
  url: string;
  size: number;
  /** Exactly one of these pins the item: the bytes, or (for the GitHub
   *  source tarball) the extracted files. Rust does the checking. */
  sha256?: string;
  treeSha256?: string;
  installPath: string;
  extract?: string;
}
interface ManifestWheel { filename: string; size: number }

// Display only. Every action (download, extract, install) is invoked by id;
// the Rust side reads the same manifest, compiled in, for URLs, hashes and
// destinations. A wheel's id is its filename.
const ITEMS = manifest.items as ManifestItem[];
const WHEELS = (manifest.python as { wheels: ManifestWheel[] }).wheels;
const ARTIFACTS: { id: string; size: number }[] = [
  ...ITEMS.map((i) => ({ id: i.id, size: i.size })),
  ...WHEELS.map((w) => ({ id: w.filename, size: w.size })),
];
const GB = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;

/** Plain-language grouping of the manifest for the consent screen. */
const PIECES = [
  { icon: 'pen-line', label: 'A songwriter', ids: ['gemma-model', 'gemma-mmproj'] },
  { icon: 'music', label: 'A composer and its instruments', ids: ['comfyui', 'music-dit', 'music-text-encoder', 'music-vae'] },
  { icon: 'audio-lines', label: 'A sound engine', ids: ['uv', 'python-dist', 'llama-cpp', 'llama-cudart', ...WHEELS.map((w) => w.filename)] },
];

const sizeOf = (id: string) => ARTIFACTS.find((a) => a.id === id)?.size ?? 0;
function pieceBytes(p: (typeof PIECES)[number]): number {
  return p.ids.reduce((sum, id) => sum + sizeOf(id), 0);
}

const TOTAL_BYTES = ARTIFACTS.reduce((s, a) => s + a.size, 0);

function Shell({ step, title, lede, children, footer }: {
  step: number; title: string; lede?: string; children?: React.ReactNode; footer?: React.ReactNode;
}): React.ReactElement {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', overflowY: 'auto', padding: 'var(--gutter-screen)', background: 'radial-gradient(80% 60% at 50% 0%,rgba(58,47,40,.5),transparent 70%)' }}>
      <div style={{ width: 600 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 'var(--space-8)' }}>
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <div key={i} style={{ flex: 1, height: 2, borderRadius: 2, background: i <= step ? 'var(--brass)' : 'var(--wash-2)' }} />
          ))}
        </div>
        <h1 style={{ font: 'var(--display-lg)', color: 'var(--ink-1)', margin: 0, letterSpacing: 'var(--tracking-display)', textWrap: 'pretty' }}>{title}</h1>
        {lede && <p style={{ font: 'var(--ui-lg)', color: 'var(--text-body)', margin: 'var(--space-5) 0 0', maxWidth: '52ch', textWrap: 'pretty' }}>{lede}</p>}
        <div style={{ marginTop: 'var(--space-8)' }}>{children}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)', marginTop: 'var(--space-8)' }}>{footer}</div>
      </div>
    </div>
  );
}

function Line({ icon, label, value, tone }: { icon: string; label: string; value: string; tone?: 'good' | 'warn' | 'bad' }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid var(--border-hairline)' }}>
      <Icon name={icon} size={16} color={tone === 'bad' ? '#E0A18B' : tone === 'warn' ? '#E6BC76' : 'var(--sage)'} />
      <span style={{ flex: 1, font: 'var(--ui-md)', color: 'var(--ink-1)' }}>{label}</span>
      <span style={{ font: 'var(--mono-sm)', color: 'var(--text-quiet)' }}>{value}</span>
    </div>
  );
}

type Phase = 'idle' | 'downloading' | 'paused' | 'installing' | 'error' | 'done';

export function SetupScreen(): React.ReactElement {
  const s = useAppState();
  const [step, setStep] = useState(0);
  const [componentsDir, setComponentsDir] = useState<string>('');
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [bytesById, setBytesById] = useState<Record<string, number>>({});
  const [installLine, setInstallLine] = useState('');
  const [netNote, setNetNote] = useState<'reconnecting' | 'rate-limited' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warm, setWarm] = useState<{ writer: boolean; studio: boolean; instruments: boolean } | null>(null);
  const cancelRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  // One install run at a time: Pause returns immediately but the cancelled
  // Rust command can take up to its read timeout to settle, and a second run
  // started meanwhile would download the same .part concurrently and have
  // its phase clobbered by the first run's catch.
  const busyRef = useRef(false);
  const [settling, setSettling] = useState(false);

  const engine = getEngine();
  const hw = engine.hardware;
  const tier = hardwareTier(hw);

  useEffect(() => {
    void invoke<{ componentsDir: string }>('runtime_paths').then((p) => {
      setComponentsDir(p.componentsDir);
      void invoke<number | null>('components_free_space', { path: p.componentsDir }).then(setFreeBytes).catch(() => {});
    });
  }, []);

  const chooseDir = async () => {
    const sel = await open({ directory: true, multiple: false }).catch(() => null);
    if (typeof sel !== 'string') return;
    const dir = `${sel}\\Stillsong components`;
    await invoke('runtime_set_components_dir', { dir });
    setComponentsDir(dir);
    const free = await invoke<number | null>('components_free_space', { path: sel }).catch(() => null);
    setFreeBytes(free);
  };

  const runInstall = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase('downloading');
    setError(null);
    setNetNote(null);
    pausedRef.current = false;
    try {
      for (const art of ARTIFACTS) {
        if (pausedRef.current) return;
        const onProgress = new Channel<{ id: string; bytes: number; total: number; note?: 'reconnecting' | 'rate-limited' }>();
        onProgress.onmessage = (m) => {
          setBytesById((prev) => ({ ...prev, [m.id]: m.bytes }));
          // Rust is swapping a collapsed connection or waiting out a 429;
          // cleared by the next ordinary progress message.
          setNetNote(m.note ?? null);
        };
        cancelRef.current = art.id;
        await invoke('download_component', { id: art.id, onProgress });
        setBytesById((prev) => ({ ...prev, [art.id]: art.size }));
      }
      cancelRef.current = null;

      setPhase('installing');
      setInstallLine('Unpacking…');
      for (const item of ITEMS) {
        if (!item.extract) continue;
        await invoke('components_extract', { id: item.id });
      }
      setInstallLine('Setting up the sound engine…');
      const onLine = new Channel<string>();
      onLine.onmessage = (line) => setInstallLine(line.slice(0, 120));
      // Offline from here: the wheelhouse was fetched and hash-checked above.
      await invoke('components_bootstrap_python', { onLine });
      setPhase('done');
      setStep(5);
      void runWarmup();
    } catch (err) {
      // A terminal failure or a Pause arrives with no closing progress
      // event, so the last network note would otherwise outlive the download.
      setNetNote(null);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'cancelled') {
        setPhase('paused');
        return;
      }
      setError(msg);
      setPhase('error');
    } finally {
      busyRef.current = false;
      setSettling(false);
    }
  };

  const pause = () => {
    pausedRef.current = true;
    if (cancelRef.current) void invoke('download_cancel', { id: cancelRef.current });
    setSettling(true); // Resume stays disabled until the cancelled run returns
    setPhase('paused');
  };

  const runWarmup = async () => {
    setWarm({ writer: false, studio: false, instruments: false });
    try {
      await invoke('runtime_start_comfy');
      setWarm((w) => ({ ...w!, studio: true }));
      const info = await engine.comfy.objectInfo('MiniMaxMusic3TextEncode').catch(() => ({}));
      const dits = await engine.comfy.availableModels('UNETLoader', 'unet_name').catch(() => [] as string[]);
      const ok = Object.keys(info).length > 0 && dits.some((d) => d.includes('minimax_music3_dit'));
      setWarm((w) => ({ ...w!, instruments: ok }));
      await engine.vram.acquireForLlm();
      setWarm((w) => ({ ...w!, writer: true }));
      await engine.vram.releaseLlm();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const finish = async () => {
    await invoke('runtime_mark_install_complete');
    // The extracted archives in _downloads are never read again (and the
    // supervisor also sweeps them at boot for installs that predate this).
    await invoke('components_remove_downloads').catch(() => {});
    if (s.settings) await saveSettings({ ...s.settings, installComplete: true, componentsDir, manifestVersion: manifest.manifestVersion });
    navigate('create');
  };

  // ---- steps ----------------------------------------------------------------

  if (step === 0) {
    return (
      <Shell step={0} title="Turn your photos into songs."
        lede="Choose a photo and Stillsong writes and performs a song about it. Everything happens on your computer — nothing you make ever leaves it."
        footer={<Button variant="primary" size="lg" onClick={() => setStep(1)}>Begin</Button>} />
    );
  }

  if (step === 1) {
    const vramGb = Math.round(hw.vramMb / 1024);
    const ramGb = Math.round(hw.ramMb / 1024);
    return (
      <Shell step={1} title="Let's check this computer." lede="Stillsong does all its work here, so it needs a little room to work in."
        footer={tier !== 'unsupported' ? <Button variant="primary" size="lg" onClick={() => setStep(2)}>Continue</Button> : undefined}>
        <Panel pad={18}>
          <Line icon="check" label="Windows, 64-bit" value="ok" />
          <Line
            icon={tier === 'unsupported' ? 'x' : 'check'}
            label={`Graphics card — ${hw.vendor === 'nvidia' ? 'NVIDIA' : hw.vendor}`}
            value={`${vramGb} GB`}
            tone={tier === 'unsupported' ? 'bad' : tier === 'patient' ? 'warn' : 'good'}
          />
          <Line icon="check" label="Memory" value={`${ramGb} GB`} tone={hw.ramMb < 32_000 ? 'warn' : 'good'} />
          <Line
            icon={freeBytes !== null && freeBytes < REQUIRED_FREE_BYTES ? 'x' : 'check'}
            label="Free space"
            value={freeBytes !== null ? GB(freeBytes) : '…'}
            tone={freeBytes !== null && freeBytes < REQUIRED_FREE_BYTES ? 'bad' : 'good'}
          />
        </Panel>
        {tier === 'patient' && (
          <Notice tone="warn" style={{ marginTop: 'var(--space-6)' }} title="This will take a little longer">
            Your graphics card has {vramGb} GB of memory — songs will sound exactly as good and run just as long, but they'll take several times longer to create.
            {hw.ramMb < 32_000 && ' With less than 32 GB of memory things may slow down further — 32 GB is recommended, and Windows virtual memory (the default) should stay enabled.'}
          </Notice>
        )}
        {tier === 'unsupported' && (
          <Notice tone="error" style={{ marginTop: 'var(--space-6)' }} title="This computer can't run Stillsong">
            {hw.vendor === 'nvidia'
              ? `Stillsong needs an NVIDIA graphics card with at least 8 GB of memory. This one has ${vramGb} GB.`
              : 'Stillsong needs an NVIDIA graphics card with at least 8 GB of memory.'}
          </Notice>
        )}
      </Shell>
    );
  }

  if (step === 2) {
    return (
      <Shell step={2} title="What Stillsong needs." lede="Three pieces, downloaded once from Hugging Face, GitHub, PyPI and PyTorch. After this, Stillsong works completely offline."
        footer={<><Button variant="primary" size="lg" onClick={() => setStep(3)}>Choose where they go</Button><span style={{ font: 'var(--ui-sm)', color: 'var(--text-faint)' }}>Nothing is downloaded yet.</span></>}>
        <Panel pad={18}>
          {PIECES.map((p) => <Line key={p.label} icon={p.icon} label={p.label} value={GB(pieceBytes(p))} />)}
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 14, marginTop: 2, borderTop: '1px solid var(--border-field)' }}>
            <span style={{ font: 'var(--ui-md)', color: 'var(--ink-1)' }}>About {Math.round(TOTAL_BYTES / 1024 ** 3)} GB in total</span>
            <span style={{ font: 'var(--mono-sm)', color: 'var(--text-quiet)' }}>huggingface.co · github.com · pypi.org · pytorch.org</span>
          </div>
        </Panel>
        <p style={{ font: 'var(--ui-xs)', color: 'var(--text-faint)', marginTop: 'var(--space-5)', maxWidth: '58ch' }}>
          The songwriter is Gemma, under the Apache 2.0 license. The composer is MiniMax-Music3, under the MiniMax-Music3 Community License.
        </p>
      </Shell>
    );
  }

  if (step === 3) {
    const enough = freeBytes === null || freeBytes >= REQUIRED_FREE_BYTES;
    return (
      <Shell step={3} title="Where should they live?" lede="They're large, so you can keep them on another drive if you'd rather."
        footer={<>
          <Button variant="primary" size="lg" disabled={!enough} onClick={() => { setStep(4); void runInstall(); }}>Download</Button>
          <Button variant="secondary" onClick={() => void chooseDir()}>Change…</Button>
        </>}>
        <TextField label="Folder" mono value={componentsDir} readOnly
          hint={freeBytes !== null ? `${GB(freeBytes)} free on this drive — 40 GB is needed.` : undefined} />
        {!enough && <Notice tone="error" style={{ marginTop: 'var(--space-5)' }} title="Not enough room here">Pick a drive with at least 40 GB free.</Notice>}
      </Shell>
    );
  }

  if (step === 4) {
    const paused = phase === 'paused';
    const downloaded = ARTIFACTS.reduce((sum, a) => sum + Math.min(bytesById[a.id] ?? 0, a.size), 0);
    return (
      <Shell step={4}
        title={paused ? 'Paused.' : phase === 'error' ? 'The connection hiccuped.' : 'Setting things up.'}
        lede={paused
          ? 'Pick it up whenever you like — Stillsong remembers where it got to, even if you close it.'
          : 'You can leave this running. It picks up where it left off if the connection drops.'}
        footer={<>
          {phase === 'downloading' && <Button variant="secondary" size="lg" onClick={pause}>Pause</Button>}
          {(paused || phase === 'error') && <Button variant="primary" size="lg" disabled={settling} onClick={() => void runInstall()}>{!paused ? 'Try again' : settling ? 'Pausing…' : 'Resume'}</Button>}
        </>}>
        <Panel pad={20} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {PIECES.map((p) => {
            const total = pieceBytes(p);
            const got = p.ids.reduce((sum, id) => sum + Math.min(bytesById[id] ?? 0, sizeOf(id)), 0);
            return (
              <ProgressBar key={p.label} value={total ? got / total : 0}
                indeterminate={false}
                label={p.label}
                detail={`${GB(got)} / ${GB(total)}`} />
            );
          })}
          {phase === 'installing' && <ProgressBar indeterminate label="Putting the pieces together" detail={installLine} />}
          <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--ui-sm)', color: 'var(--text-quiet)', paddingTop: 14, borderTop: '1px solid var(--border-hairline)' }}>
            <span>{GB(downloaded)} of {GB(TOTAL_BYTES)} downloaded</span>
            <span>{paused ? '—' : phase === 'installing' ? 'installing' : phase !== 'downloading' ? '' : netNote === 'reconnecting' ? 'Reconnecting…' : netNote === 'rate-limited' ? 'Waiting for the server…' : ''}</span>
          </div>
        </Panel>
        {error && <Notice tone="error" style={{ marginTop: 'var(--space-6)' }} title="Something went wrong">{error}</Notice>}
      </Shell>
    );
  }

  // A distinct final page once every check passes — "Almost ready." left on
  // screen reads as still-working to someone glancing back at the machine.
  const ready = Boolean(warm?.writer && warm?.studio && warm?.instruments);
  if (ready) {
    return (
      <Shell step={5} title="Ready to write your first song."
        lede="Setup is finished and everything answers. From here on, Stillsong works completely offline."
        footer={<Button variant="primary" size="lg" onClick={() => void finish()}>Start with a photo</Button>}>
        <Panel variant="quiet" pad={18}>
          <Line icon="check" label="The studio answers" value="ok" />
          <Line icon="check" label="Instruments found" value="ok" />
          <Line icon="check" label="The songwriter answers" value="ok" />
        </Panel>
      </Shell>
    );
  }
  return (
    <Shell step={5} title="Almost ready." lede="Warming up the studio and checking everything answers.">
      <Panel pad={18}>
        <Line icon={warm?.studio ? 'check' : 'clock'} label="The studio answers" value={warm?.studio ? 'ok' : '…'} />
        <Line icon={warm?.instruments ? 'check' : 'clock'} label="Instruments found" value={warm?.instruments ? 'ok' : '…'} />
        <Line icon={warm?.writer ? 'check' : 'clock'} label="The songwriter answers" value={warm?.writer ? 'ok' : '…'} />
      </Panel>
      {error && <Notice tone="error" style={{ marginTop: 'var(--space-6)' }} title="Warm-up hit a snag">{error}</Notice>}
    </Shell>
  );
}
