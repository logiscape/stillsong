// Release-time Python lock generator. Resolves ComfyUI's requirements ONCE,
// here, and writes the result into components.json (`python.wheels`) so that
// first-run setup on a user's machine never runs a resolver: the Rust
// downloader fetches exactly these wheels (URL + size + sha256), and uv
// installs them offline from the local wheelhouse with --require-hashes.
//
//   node scripts/lock-python.mjs [--uv <uv.exe>] [--work <dir>] [--freeze]
//
// Needs the network (PyPI, download.pytorch.org, GitHub). Uses the SAME uv
// release the manifest ships (downloaded + hash-checked into the work dir
// unless --uv points at one) and the SAME python-build-standalone tarball, so
// the resolution the user gets is the one this script produced. Run it after
// every ComfyUI bump; commit components.json and docs/THIRD-PARTY-PYTHON.md.
//
// --freeze feeds every wheel already in components.json back in as a
// `name==version` constraint, so a re-lock that only changes the manifest
// (a new python.exclude entry, say) reproduces the current resolution
// instead of picking up whatever PyPI published since. Never use it for a
// ComfyUI bump: the new requirements must be free to move.
//
// python.exclude (hand-maintained in the manifest) names packages that the
// resolution contains but the wheelhouse must not: they are dropped AFTER
// `uv pip compile`, so the resolver still sees them (their own dependencies,
// if any, stay), and a name the resolution does not contain is an error —
// a stale entry after a ComfyUI bump fails loudly instead of doing nothing.
//
// Rules enforced here (the interim design would only have hashed an index
// resolution; this pins the actual blobs):
//   - wheels only (--only-binary :all:) — setup never runs a package's
//     build script;
//   - one file per package, chosen for cp312 / win_amd64 (or pure-python);
//   - every wheel is downloaded, hashed locally and its METADATA read for the
//     license, so the manifest records what we verified, not what an index
//     advertised.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'components.json');
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith('--')) throw new Error(`${name} needs a value`);
  return v;
};
for (const a of args) {
  if (a.startsWith('--') && !['--uv', '--work', '--freeze'].includes(a)) throw new Error(`unknown option ${a}`);
}
const work = resolve(flag('--work') ?? join(root, '.lock-work'));
const freeze = args.includes('--freeze');

const PYPI_SIMPLE = 'https://pypi.org/simple';
const TORCH_INDEX = 'https://download.pytorch.org/whl/cu130';
const PLATFORM = 'x86_64-pc-windows-msvc';
// Windows' own bsdtar reads zip and tar.gz alike (Git Bash puts GNU tar first on PATH, which cannot open zips).
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const item = (id) => {
  const it = manifest.items.find((i) => i.id === id);
  if (!it) throw new Error(`components.json has no item "${id}"`);
  return it;
};
const pyVersion = manifest.python.version;
if (!/^\d+\.\d+\.\d+$/.test(pyVersion)) throw new Error(`python.version must be an exact patch, got "${pyVersion}"`);
const pyTag = `cp${pyVersion.split('.').slice(0, 2).join('')}`; // cp312
const pyMinor = Number(pyVersion.split('.')[1]);

/** PEP 503 name normalisation — the key space of the lock below. */
const normalize = (name) => name.toLowerCase().replace(/[-_.]+/g, '-');

// Packages the resolution may contain but the wheelhouse must not (python.exclude).
const excludeRaw = manifest.python.exclude ?? [];
if (!Array.isArray(excludeRaw) || excludeRaw.some((e) => typeof e !== 'string' || !e.trim())) {
  throw new Error('python.exclude must be an array of package names');
}
const exclude = excludeRaw.map(normalize);
if (new Set(exclude).size !== exclude.length) throw new Error('python.exclude lists a package twice');

mkdirSync(work, { recursive: true });

// ---- helpers ---------------------------------------------------------------

function sha256File(path) {
  const h = createHash('sha256');
  h.update(readFileSync(path));
  return h.digest('hex');
}

async function download(url, dest, expectedSha) {
  if (existsSync(dest) && (!expectedSha || sha256File(dest) === expectedSha)) return;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  const got = sha256File(tmp);
  if (expectedSha && got !== expectedSha) {
    rmSync(tmp);
    throw new Error(`sha256 mismatch for ${url}: expected ${expectedSha}, got ${got}`);
  }
  rmSync(dest, { force: true });
  renameSync(tmp, dest);
}

function run(exe, argv, opts = {}) {
  const r = spawnSync(exe, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${exe} ${argv.join(' ')} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

/** Parse a wheel filename into its tag sets. */
function wheelTags(filename) {
  const stem = filename.replace(/\.whl$/, '');
  const parts = stem.split('-');
  if (parts.length < 5) return null;
  const [plat, abi, py] = [parts.pop(), parts.pop(), parts.pop()];
  return { py: py.split('.'), abi: abi.split('.'), plat: plat.split('.') };
}

/** Score a wheel for our target; null when incompatible. Higher wins. */
function wheelScore(filename) {
  const t = wheelTags(filename);
  if (!t) return null;
  const platOk = t.plat.includes('win_amd64') ? 100 : t.plat.includes('any') ? 0 : null;
  if (platOk === null) return null;
  const pyOk = t.py.some((p) => p === pyTag || p === 'py3' || p === `py3${pyMinor}` || (/^cp3\d+$/.test(p) && Number(p.slice(3)) <= pyMinor && t.abi.includes('abi3')));
  if (!pyOk) return null;
  let abiScore;
  if (t.abi.includes(pyTag)) abiScore = 20;
  else if (t.abi.includes('abi3')) abiScore = 10;
  else if (t.abi.includes('none')) abiScore = 0;
  else return null;
  return platOk + abiScore + (t.py.includes(pyTag) ? 2 : 0);
}

/** Files advertised by a PEP 503 simple index page: [{filename, url, sha256}]. */
async function simpleIndexFiles(base, name) {
  const res = await fetch(`${base}/${name}/`, { headers: { accept: 'text/html' } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GET ${base}/${name}/ -> HTTP ${res.status}`);
  const html = await res.text();
  const out = [];
  for (const m of html.matchAll(/<a\s+[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)) {
    const href = m[1];
    const filename = m[2].trim();
    // download.pytorch.org publishes no #sha256= fragment for some files; the
    // hash is then established by downloading (uv did the same to resolve).
    const sha = /#sha256=([0-9a-f]{64})/i.exec(href)?.[1]?.toLowerCase() ?? null;
    const url = new URL(href.replace(/#.*$/, ''), `${base}/${name}/`).toString();
    out.push({ filename, url, sha256: sha });
  }
  return out;
}

/** License from a wheel's METADATA, read by the pinned interpreter. */
function wheelLicense(python, wheelPath) {
  const code = `
import sys, zipfile, email
z = zipfile.ZipFile(sys.argv[1])
meta = next(n for n in z.namelist() if n.endswith('.dist-info/METADATA'))
m = email.message_from_bytes(z.read(meta))
expr = m.get('License-Expression')
lic = m.get('License')
cls = [c.split('::')[-1].strip() for c in m.get_all('Classifier') or [] if c.startswith('License ::')]
if expr: print(expr)
elif cls: print(' / '.join(dict.fromkeys(cls)))
elif lic and len(lic) <= 80 and '\\n' not in lic: print(lic)
else: print('see wheel METADATA')
`;
  return run(python, ['-c', code, wheelPath]).trim();
}

// ---- 1. tools: the shipped uv + the shipped interpreter --------------------

const uvItem = item('uv');
const uvVersion = /\/download\/([^/]+)\//.exec(uvItem.url)?.[1];
let uv = flag('--uv');
if (!uv) {
  const zip = join(work, 'uv.zip');
  console.log(`fetching uv ${uvVersion}`);
  await download(uvItem.url, zip, uvItem.sha256);
  run(TAR, ['-xf', 'uv.zip'], { cwd: work }); // bsdtar reads 'C:' in a path as a remote host: relative names only
  uv = join(work, 'uv.exe');
}
const uvVer = run(uv, ['--version']).trim();
if (!uvVer.includes(` ${uvVersion} `)) {
  throw new Error(`uv at ${uv} is "${uvVer}" but the manifest ships ${uvVersion}; pass the matching uv (or none, to fetch it)`);
}

const pyItem = item('python-dist');
const pyDist = join(work, 'python-dist');
if (!existsSync(join(pyDist, 'python.exe'))) {
  const tgz = join(work, 'python-dist.tar.gz');
  console.log(`fetching CPython ${pyVersion}`);
  await download(pyItem.url, tgz, pyItem.sha256);
  mkdirSync(pyDist, { recursive: true });
  run(TAR, ['-xzf', 'python-dist.tar.gz', '-C', 'python-dist', '--strip-components=1'], { cwd: work });
}
const python = join(pyDist, 'python.exe');
const gotPy = run(python, ['-c', 'import sys;print(sys.version.split()[0])']).trim();
if (gotPy !== pyVersion) throw new Error(`python-dist is ${gotPy}, manifest says ${pyVersion}`);

// ---- 2. resolve once, with hashes ------------------------------------------

const comfy = item('comfyui');
const reqUrl = `https://raw.githubusercontent.com/comfyanonymous/ComfyUI/${comfy.commit}/requirements.txt`;
const reqPath = join(work, 'requirements.txt');
console.log(`fetching ${reqUrl}`);
await download(reqUrl, reqPath);
const reqSha = sha256File(reqPath);

// Hand-maintained pins for what ComfyUI leaves open (python.constraints).
// With --freeze, every wheel of the current lock is added as a pin too, so
// the resolution cannot drift (the hand constraints come first and win any
// disagreement by failing the resolve, which is the right outcome).
const constraints = manifest.python.constraints ?? [];
const handPinned = new Set(constraints.map((c) => normalize(c.split('==')[0])));
const frozen = freeze
  ? (manifest.python.wheels ?? []).filter((w) => !handPinned.has(normalize(w.name))).map((w) => `${w.name}==${w.version}`)
  : [];
if (freeze) console.log(`freezing ${frozen.length} pins from the current lock (--freeze)`);
const constraintsPath = join(work, 'constraints.txt');
writeFileSync(constraintsPath, `${[...constraints, ...frozen].join('\n')}\n`);

const lockPath = join(work, 'requirements.lock');
console.log(`resolving with uv pip compile (constraints: ${constraints.join(', ') || 'none'})`);
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(UV_|PIP_)/i.test(k)));
run(uv, [
  'pip', 'compile', reqPath,
  '-c', constraintsPath,
  '--python', python,
  '--python-version', pyVersion,
  '--python-platform', PLATFORM,
  '--only-binary', ':all:',
  '--generate-hashes',
  '--index-url', PYPI_SIMPLE,
  '--extra-index-url', TORCH_INDEX,
  '--index-strategy', 'unsafe-best-match', // release-time only; users never resolve
  '--no-config',
  '--no-annotate',
  '--no-header',
  '--no-cache',
  '-o', lockPath,
], { env: cleanEnv, stdio: ['ignore', 'pipe', 'inherit'] });

/** name -> { version, hashes:Set } from the compile output. */
const locked = new Map();
{
  let current = null;
  for (const raw of readFileSync(lockPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim().replace(/\s*\\$/, '');
    if (!line || line.startsWith('#')) continue;
    const pin = /^([A-Za-z0-9._-]+)==(\S+)$/.exec(line);
    if (pin) {
      current = { version: pin[2], hashes: new Set() };
      locked.set(normalize(pin[1]), current);
      continue;
    }
    const h = /^--hash=sha256:([0-9a-f]{64})$/i.exec(line);
    if (h && current) current.hashes.add(h[1].toLowerCase());
    else throw new Error(`unexpected line in lock: ${raw}`);
  }
}
console.log(`${locked.size} packages resolved`);

// Drop python.exclude from the resolution before anything is fetched. Each
// entry must have been resolved: an excluded name the resolver no longer
// produces is a stale entry, not a no-op.
for (const name of exclude) {
  const hit = locked.get(name);
  if (!hit) throw new Error(`python.exclude lists "${name}" but the resolution does not contain it — stale entry?`);
  console.log(`excluding ${name}==${hit.version} (python.exclude)`);
  locked.delete(name);
}

// ---- 3. pick the exact file per package, download, hash, read license ------

const wheelhouse = join(work, 'wheelhouse');
mkdirSync(wheelhouse, { recursive: true });
const wheels = [];
for (const [name, { version, hashes }] of [...locked.entries()].sort()) {
  // PyPI first; the torch index only for what PyPI does not carry with a
  // matching hash (the +cu130 builds). Hash membership is the filter, so a
  // same-named file with different bytes on either index can never be chosen.
  const hashOk = (f) => f.sha256 === null || hashes.has(f.sha256);
  let files = (await simpleIndexFiles(PYPI_SIMPLE, name)).filter(hashOk);
  let source = 'pypi.org';
  if (files.length === 0) {
    files = (await simpleIndexFiles(TORCH_INDEX, name)).filter(hashOk);
    source = 'download.pytorch.org';
  }
  const scored = files
    .filter((f) => f.filename.endsWith('.whl'))
    .map((f) => ({ ...f, score: wheelScore(f.filename) }))
    .filter((f) => f.score !== null)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) throw new Error(`${name}==${version}: no compatible wheel among ${files.map((f) => f.filename).join(', ') || '(none)'}`);
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    throw new Error(`${name}==${version}: ambiguous wheels ${scored[0].filename} vs ${scored[1].filename}`);
  }
  const pick = scored[0];
  const dest = join(wheelhouse, pick.filename);
  process.stdout.write(`  ${pick.filename} … `);
  await download(pick.url, dest, pick.sha256 ?? undefined);
  const got = sha256File(dest);
  if (!hashes.has(got)) throw new Error(`${pick.filename}: downloaded sha256 ${got} is not among the lock's hashes`);
  pick.sha256 = got;
  const size = statSync(dest).size;
  const license = wheelLicense(python, dest);
  console.log(`${(size / 1024 / 1024).toFixed(1)} MB  ${license}`);
  wheels.push({ name, version, filename: pick.filename, url: pick.url, size, sha256: pick.sha256, license, source });
}

// ---- 4. write the manifest section + the notices table ---------------------

const today = new Date().toISOString().slice(0, 10);
manifest.python = {
  version: pyVersion,
  notes: manifest.python.notes,
  constraints,
  exclude: excludeRaw,
  lockedAt: today,
  lockedWith: `uv ${uvVersion}`,
  requirementsSha256: reqSha,
  wheelhouse: '_downloads/wheelhouse',
  wheels,
};
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const totalBytes = wheels.reduce((s, w) => s + w.size, 0);
const rows = wheels.map((w) => `| ${w.name} | ${w.version} | ${w.license} | ${w.source} |`).join('\n');
const excludedNote = exclude.length === 0 ? '' : `
ComfyUI's requirements also resolve ${exclude.length} package${exclude.length === 1 ? '' : 's'} that Stillsong
deliberately does not ship (\`python.exclude\` in \`components.json\`, which
says why): ${exclude.map((e) => `\`${e}\``).join(', ')}.
`;
writeFileSync(join(root, 'docs', 'THIRD-PARTY-PYTHON.md'), `# Python packages installed at first run

Generated by \`node scripts/lock-python.mjs\` on ${today} — do not edit by hand.
These are the ${wheels.length} wheels (${(totalBytes / 1024 ** 3).toFixed(2)} GB) that first-run setup
downloads and installs into the app's private Python environment, resolved
once at release time from ComfyUI's pinned \`requirements.txt\` and recorded
per file (URL, size, SHA-256) in \`components.json\`. Licenses are read from
each wheel's own METADATA. The CUDA runtime libraries inside the PyTorch
wheels are governed by the NVIDIA CUDA Toolkit EULA (see
THIRD-PARTY-NOTICES.md).
${excludedNote}
| Package | Version | License | Source |
|---|---|---|---|
${rows}
`);

console.log(`\nwrote ${wheels.length} wheels (${(totalBytes / 1024 ** 3).toFixed(2)} GB) to components.json and docs/THIRD-PARTY-PYTHON.md`);
console.log(`wheelhouse kept at ${wheelhouse} (the work dir is gitignored)`);
console.log(`verify it with: node scripts/check-manifest.mjs --wheelhouse "${wheelhouse}"`);
