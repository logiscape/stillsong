// Validates components.json — the pinned first-run manifest — without
// downloading anything large. Run in CI on every change (`npm run
// check:manifest`); the full offline bootstrap through the production Rust
// code is the separate `first_run_headless` cargo test (see
// .github/workflows/first-run.yml).
//
//   node scripts/check-manifest.mjs [--no-network] [--wheelhouse <dir>]
//
// Static: ids unique, hashes well-formed, every URL https on the allowlist,
// exact CPython patch, wheels only (no sdists), the lock section populated.
// Network: every URL answers, every redirect hop is https (mirroring the
// Rust downloader: the allowlist binds the pinned first hop only), and the
// server-stated size equals the pinned size. The hosts the hops land on are
// reported at the end so a CDN move is visible. A server that states no
// size (GitHub's codeload streams source tarballs) gets the artifact fully
// downloaded and hashed instead, up to a cap — nothing passes unmeasured.
// --wheelhouse: every manifest wheel is present in that directory with the
// pinned size and sha256, and stale files are reported (the lock generator's
// work dir keeps wheels from earlier resolutions).
//
// Deliberately NOT here: "re-resolve and diff". The lock is supposed to lag
// PyPI; a fresh resolution differing from it is the normal state, not a bug.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'components.json'), 'utf8'));
const args = process.argv.slice(2);
const network = !args.includes('--no-network');
let wheelhouseArg = null;
if (args.includes('--wheelhouse')) {
  wheelhouseArg = args[args.indexOf('--wheelhouse') + 1];
  if (!wheelhouseArg || wheelhouseArg.startsWith('--')) {
    console.error('--wheelhouse needs a directory argument');
    process.exit(2);
  }
}
for (const a of args) {
  if (a.startsWith('--') && !['--no-network', '--wheelhouse'].includes(a)) {
    console.error(`unknown option ${a}`);
    process.exit(2);
  }
}
/** Largest artifact we will fetch whole when the server states no size. */
const FULL_FETCH_CAP = 64 * 1024 * 1024;

const problems = [];
const fail = (msg) => problems.push(msg);

function hostAllowed(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  return manifest.allowedHosts.some((a) => (a.startsWith('*.') ? u.hostname.endsWith(a.slice(1)) && u.hostname.length > a.length - 1 : u.hostname === a));
}

// ---- static ---------------------------------------------------------------

const artifacts = [
  ...manifest.items.map((i) => ({ id: i.id, url: i.url, size: i.size, sha256: i.sha256, item: i })),
  ...manifest.python.wheels.map((w) => ({ id: w.filename, url: w.url, size: w.size, sha256: w.sha256, wheel: w })),
];

const ids = new Set();
for (const a of artifacts) {
  if (ids.has(a.id)) fail(`duplicate id ${a.id}`);
  ids.add(a.id);
  if (!/^[0-9a-f]{64}$/.test(a.sha256)) fail(`${a.id}: sha256 is not 64 hex chars`);
  if (!(Number.isInteger(a.size) && a.size > 0)) fail(`${a.id}: size must be a positive integer`);
  if (!hostAllowed(a.url)) fail(`${a.id}: ${a.url} is not https on an allowlisted host`);
}
for (const i of manifest.items) {
  if (!i.installPath || i.installPath.includes('..') || i.installPath.startsWith('/')) fail(`${i.id}: bad installPath`);
  if (i.extract && !['zip', 'tar.gz-strip1'].includes(i.extract)) fail(`${i.id}: unknown extract mode ${i.extract}`);
  if (!i.license) fail(`${i.id}: license missing`);
}
for (const id of ['uv', 'python-dist', 'comfyui', 'llama-cpp', 'llama-cudart']) {
  if (!manifest.items.some((i) => i.id === id)) fail(`required item ${id} missing`);
}

const py = manifest.python;
if (!/^\d+\.\d+\.\d+$/.test(py.version)) fail(`python.version must be an exact patch (got ${py.version})`);
const pyDist = manifest.items.find((i) => i.id === 'python-dist');
if (pyDist && !pyDist.url.includes(`cpython-${py.version}`)) fail(`python-dist url does not carry python.version ${py.version}`);
if (pyDist && pyDist.extract !== 'tar.gz-strip1') fail('python-dist must be a stripped tar.gz');
if (!py.wheelhouse || py.wheelhouse.includes('..')) fail('python.wheelhouse missing or unsafe');
if (!Array.isArray(py.wheels) || py.wheels.length === 0) fail('python.wheels is empty — run npm run lock:python');
if (!py.lockedAt || !py.lockedWith) fail('python.lockedAt / lockedWith missing — run npm run lock:python');
const pyTag = `cp${py.version.split('.').slice(0, 2).join('')}`;
const names = new Set();
for (const w of py.wheels ?? []) {
  if (names.has(w.name)) fail(`wheel for ${w.name} listed twice`);
  names.add(w.name);
  if (!w.filename.endsWith('.whl')) fail(`${w.filename}: not a wheel (sdists are refused)`);
  if (/[\\/]/.test(w.filename)) fail(`${w.filename}: filename contains a path separator`);
  const okPlat = w.filename.includes('win_amd64') || w.filename.endsWith('-none-any.whl');
  if (!okPlat) fail(`${w.filename}: not a Windows x64 or pure-python wheel`);
  if (w.filename.includes('win_amd64') && !w.filename.includes(pyTag) && !w.filename.includes('abi3') && !w.filename.includes('-py3-none-')) fail(`${w.filename}: built for another CPython than ${pyTag}`);
  if (!w.filename.startsWith(`${w.name.replace(/-/g, '_')}-${w.version}-`) && !w.filename.toLowerCase().startsWith(`${w.name.replace(/-/g, '_')}-${w.version}-`.toLowerCase())) {
    fail(`${w.filename}: does not match ${w.name}==${w.version}`);
  }
  if (!w.license) fail(`${w.filename}: license missing`);
}
for (const c of py.constraints ?? []) {
  const m = /^([A-Za-z0-9._-]+)==(\S+)$/.exec(c);
  if (!m) fail(`constraint "${c}" must be name==version`);
  else {
    const w = (py.wheels ?? []).find((x) => x.name === m[1].toLowerCase());
    if (w && w.version !== m[2]) fail(`constraint ${c} but the lock has ${w.name}==${w.version} — re-run npm run lock:python`);
  }
}

// ---- wheelhouse -----------------------------------------------------------

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

if (wheelhouseArg) {
  const dir = resolve(wheelhouseArg);
  if (!existsSync(dir)) fail(`wheelhouse ${dir} does not exist`);
  else {
    const expected = new Set();
    for (const w of py.wheels ?? []) {
      expected.add(w.filename);
      const p = join(dir, w.filename);
      if (!existsSync(p)) {
        fail(`wheelhouse: ${w.filename} missing`);
        continue;
      }
      const size = statSync(p).size;
      if (size !== w.size) fail(`wheelhouse: ${w.filename} is ${size} bytes, manifest pins ${w.size}`);
      else if (sha256File(p) !== w.sha256) fail(`wheelhouse: ${w.filename} sha256 mismatch`);
    }
    const stale = readdirSync(dir).filter((f) => f.endsWith('.whl') && !expected.has(f));
    for (const f of stale) console.warn(`wheelhouse: stale file not in the manifest: ${f}`);
    console.log(`wheelhouse: ${expected.size} wheels verified${stale.length ? `, ${stale.length} stale` : ''}`);
  }
}

// ---- network --------------------------------------------------------------

/** Hosts that redirects landed on, for the drift report. */
const hopHosts = new Map();

/** Follows redirects by hand so every hop is checked the way the app checks
 *  it: the first on the allowlist, the rest https. Returns { status, size,
 *  url } where size is what the server states (or null) and url is the final
 *  hop. */
async function probe(url) {
  let current = url;
  let linkedSize = null;
  for (let hop = 0; hop < 10; hop += 1) {
    if (hop === 0) {
      if (!hostAllowed(current)) throw new Error(`pinned URL is not on the allowlist: ${current}`);
    } else {
      if (!current.startsWith('https://')) throw new Error(`hop ${hop} is not https: ${current}`);
      const h = new URL(current).hostname;
      if (h.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(h)) throw new Error(`hop ${hop} is a bare IP address: ${current}`);
      hopHosts.set(h, (hopHosts.get(h) ?? 0) + 1);
    }
    let res = await fetch(current, { method: 'HEAD', redirect: 'manual' });
    if (res.status === 405 || res.status === 403) {
      res = await fetch(current, { method: 'GET', redirect: 'manual', headers: { range: 'bytes=0-0' } });
    }
    // Hugging Face states the real object size on the resolve hop.
    linkedSize = linkedSize ?? (res.headers.get('x-linked-size') ? Number(res.headers.get('x-linked-size')) : null);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`${current}: redirect without Location`);
      current = new URL(loc, current).toString();
      continue;
    }
    if (!(res.ok || res.status === 206)) throw new Error(`${current}: HTTP ${res.status}`);
    const cr = res.headers.get('content-range');
    const total = cr ? Number(cr.split('/')[1]) : res.headers.get('content-length') ? Number(res.headers.get('content-length')) : null;
    return { status: res.status, size: linkedSize ?? total, url: current };
  }
  throw new Error(`${url}: too many redirects`);
}

/** For a server that states no size: fetch the whole artifact (already
 *  redirect-checked by probe) and measure it. */
async function fetchAndMeasure(url, pinnedSize) {
  if (pinnedSize > FULL_FETCH_CAP) throw new Error(`server states no size and the artifact is too large (${pinnedSize} bytes) to fetch whole`);
  const res = await fetch(url, { redirect: 'manual' });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    size += chunk.length;
    if (size > FULL_FETCH_CAP) throw new Error('artifact exceeds the full-fetch cap');
  }
  return { size, sha256: hash.digest('hex') };
}

if (network) {
  let checked = 0;
  let fetchedWhole = 0;
  const queue = [...artifacts];
  const workers = Array.from({ length: 8 }, async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      try {
        const { size, url } = await probe(a.url);
        if (size === null) {
          const got = await fetchAndMeasure(url, a.size);
          if (got.size !== a.size) fail(`${a.id}: fetched ${got.size} bytes, manifest pins ${a.size}`);
          else if (got.sha256 !== a.sha256) fail(`${a.id}: fetched sha256 ${got.sha256} does not match the manifest`);
          else fetchedWhole += 1;
        } else if (size !== a.size) {
          fail(`${a.id}: server states ${size} bytes, manifest pins ${a.size}`);
        }
        checked += 1;
      } catch (e) {
        fail(`${a.id}: ${e.message}`);
      }
    }
  });
  await Promise.all(workers);
  console.log(`probed ${checked}/${artifacts.length} URLs${fetchedWhole ? ` (${fetchedWhole} fetched whole and hashed: no server-stated size)` : ''}`);
  if (hopHosts.size) {
    console.log('redirects landed on (https, followed by the app as-is):');
    for (const [h, n] of [...hopHosts].sort((a, b) => b[1] - a[1])) console.log(`  ${h}  (${n})`);
  }
}

const total = artifacts.reduce((s, a) => s + a.size, 0);
console.log(`${manifest.items.length} items + ${py.wheels?.length ?? 0} wheels, ${(total / 1024 ** 3).toFixed(2)} GB pinned`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('components.json checks out');
