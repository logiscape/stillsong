// Run with:  node --test physical-release/lib/
// Guards the one coupling this directory has with the app: the on-media
// layout must be byte-for-byte what src-tauri/src/manifest.rs resolves at
// first run, or the wizard would try to download instead of finding files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  archiveBasename, componentArtifacts, componentsBytes, hostAllowed,
  formatSums, parseSums, fitReport, MEDIA, TREE_BOUND_SIZE_SLACK,
} from './layout.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const real = JSON.parse(readFileSync(join(here, '..', '..', 'components.json'), 'utf8'));

// The same fixture `manifest.rs` uses in its `artifact_destinations` test.
const fixture = {
  allowedHosts: ['github.com', '*.pythonhosted.org'],
  python: {
    wheelhouse: '_downloads/wheelhouse',
    wheels: [{ filename: 'torch-2.13.0+cu130-cp312-cp312-win_amd64.whl', url: 'https://x/torch-2.13.0%2Bcu130-cp312-cp312-win_amd64.whl', size: 1, sha256: 'AB' }],
  },
  items: [
    { id: 'uv', kind: 'tool', url: 'https://github.com/astral-sh/uv/releases/download/0.12.6/uv-x86_64-pc-windows-msvc.zip', size: 2, sha256: 'cd', installPath: 'uv', extract: 'zip' },
    { id: 'python-dist', kind: 'runtime', url: 'https://github.com/x/cpython-3.12.14%2B20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz', size: 3, sha256: 'ef', installPath: 'python-dist', extract: 'tar.gz-strip1' },
    { id: 'music-dit', kind: 'model', url: 'https://huggingface.co/x/resolve/y/diffusion_models/minimax_music3_dit_fp16.safetensors', size: 4, sha256: '01', installPath: 'comfy-data/models/diffusion_models/minimax_music3_dit_fp16.safetensors' },
    { id: 'comfyui', kind: 'runtime', url: 'https://github.com/x/y/archive/abc123.tar.gz', size: 5, treeSha256: 'EF', installPath: 'ComfyUI', extract: 'tar.gz-strip1' },
  ],
};

test('archive basename keeps GitHub plus signs plain', () => {
  assert.equal(archiveBasename('https://a/b/cpython-3.12.14%2B20260901-x86_64.tar.gz'), 'cpython-3.12.14+20260901-x86_64.tar.gz');
  assert.equal(archiveBasename('https://a/b/uv.zip'), 'uv.zip');
});

test('artifact destinations match manifest.rs', () => {
  const by = Object.fromEntries(componentArtifacts(fixture).map((a) => [a.id, a]));
  assert.equal(by.uv.rel, '_downloads/uv-x86_64-pc-windows-msvc.zip');
  assert.equal(by['python-dist'].rel, '_downloads/cpython-3.12.14+20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz');
  assert.equal(by['music-dit'].rel, 'comfy-data/models/diffusion_models/minimax_music3_dit_fp16.safetensors');
  assert.equal(by['torch-2.13.0+cu130-cp312-cp312-win_amd64.whl'].rel, '_downloads/wheelhouse/torch-2.13.0+cu130-cp312-cp312-win_amd64.whl');
  assert.equal(by['torch-2.13.0+cu130-cp312-cp312-win_amd64.whl'].sha256, 'ab', 'hashes are lower-cased');
  assert.equal(by.uv.maxSize, 2, 'byte-bound: the size is exact');
  // Tree-bound: staged like any archive, no byte hash, a size ceiling.
  assert.equal(by.comfyui.rel, '_downloads/abc123.tar.gz');
  assert.equal(by.comfyui.sha256, null);
  assert.equal(by.comfyui.treeSha256, 'ef');
  assert.equal(by.comfyui.maxSize, 5 * TREE_BOUND_SIZE_SLACK);
});

test('the real manifest yields unique, rooted, forward-slash paths', () => {
  const arts = componentArtifacts(real);
  assert.ok(arts.length > 80);
  const rels = new Set();
  for (const a of arts) {
    assert.ok(!rels.has(a.rel), `duplicate ${a.rel}`);
    rels.add(a.rel);
    assert.ok(!a.rel.includes('\\') && !a.rel.startsWith('/') && !a.rel.split('/').includes('..'), a.rel);
    assert.ok((a.sha256 === null) !== (a.treeSha256 === null), `${a.id}: exactly one of sha256 / treeSha256`);
    assert.match(a.sha256 ?? a.treeSha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(a.size) && a.size > 0 && a.maxSize >= a.size);
    assert.ok(hostAllowed(a.url, real.allowedHosts), `not on allowedHosts: ${a.url}`);
  }
  assert.equal(componentsBytes(real), arts.reduce((n, a) => n + a.size, 0));
});

test('host allow-list mirrors host_allowed_by', () => {
  const hosts = ['github.com', '*.pythonhosted.org'];
  assert.ok(hostAllowed('https://github.com/x', hosts));
  assert.ok(hostAllowed('https://files.pythonhosted.org/x', hosts));
  assert.ok(!hostAllowed('https://pythonhosted.org/x', hosts), 'wildcard needs a subdomain');
  assert.ok(!hostAllowed('https://evilgithub.com/x', hosts));
  assert.ok(!hostAllowed('http://github.com/x', hosts), 'https only');
});

test('SHA256SUMS round-trips', () => {
  const entries = [{ sha256: 'a'.repeat(64), path: 'components/_downloads/x.zip' }, { sha256: 'b'.repeat(64), path: 'setup/Stillsong setup.exe' }];
  const text = formatSums(entries);
  assert.deepEqual(parseSums(text), entries);
  assert.deepEqual(parseSums(`# comment\n${'c'.repeat(64)} *bin/file\n`), [{ sha256: 'c'.repeat(64), path: 'bin/file' }]);
  assert.throws(() => parseSums('nonsense'));
});

test('fit report knows a single-layer disc is tight for the current manifest', () => {
  const report = fitReport(componentsBytes(real));
  const sl = report.find((m) => m.id === 'bd-r');
  const dl = report.find((m) => m.id === 'bd-r-dl');
  assert.ok(dl.fits, 'components alone must fit a dual-layer disc');
  assert.ok(sl.headroom < 1e9, 'if single-layer suddenly has >1 GB spare, the manifest shrank — re-check the README table');
  assert.equal(MEDIA[0].bytes, 25_025_314_816);
});
