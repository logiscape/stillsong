#!/usr/bin/env node
// Stages every first-run component into a directory laid out exactly as the
// app's components dir, so a copy of it lets the setup wizard finish with no
// network. Everything is held to components.json's size + sha256 — or, for
// the tree-bound ComfyUI source tarball, to its treeSha256 (the digest of
// the extracted files, scripts/tree-digest.mjs) and the app's size ceiling,
// since GitHub may regenerate that archive's bytes. A file that already
// verifies is left alone, so re-runs are cheap and the stage doubles as the
// download cache.
//
//   node physical-release/stage-components.mjs [--out DIR]
//        [--from-components DIR]   copy matching files (models, mostly) from an
//                                  existing Stillsong install before downloading
//        [--check-only]            report what is present/missing/wrong; fetch, delete
//                                  and change nothing
//        [--rehash]                ignore the verification cache and re-hash all
//
// Exit code 0 only when every artifact is present and verified.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, renameSync, rmSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { componentArtifacts, componentsBytes, hostAllowed, fitReport, gb } from './lib/layout.mjs';
import { treeBoundLimits, treeSha256FromTarGz } from '../scripts/tree-digest.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const args = parseArgs(process.argv.slice(2));
const outDir = resolve(args.out ?? join(here, 'out', 'stage', 'components'));
const fromComponents = args['from-components'] ? resolve(args['from-components']) : null;
const checkOnly = Boolean(args['check-only']);
const rehash = Boolean(args.rehash);

const manifest = JSON.parse(readFileSync(join(repoRoot, 'components.json'), 'utf8'));
const artifacts = componentArtifacts(manifest);
const cachePath = join(dirname(outDir), 'components.verified.json');
const verified = loadCache(cachePath);

console.log(`manifest ${manifest.manifestVersion}: ${artifacts.length} artifacts, ${gb(componentsBytes(manifest))}`);
console.log(`stage: ${outDir}`);
if (fromComponents) console.log(`seed from: ${fromComponents}`);

let missing = 0;
let fetched = 0;
for (const [i, art] of artifacts.entries()) {
  const dest = join(outDir, ...art.rel.split('/'));
  const tag = `[${String(i + 1).padStart(3)}/${artifacts.length}] ${art.id}`;
  const state = await checkExisting(art, dest);
  if (state === 'ok') {
    console.log(`${tag}  ok`);
    continue;
  }
  if (checkOnly) {
    // Report only: a wrong file is named, never touched, in this mode.
    console.log(`${tag}  ${state === 'missing' ? 'MISSING' : 'BAD ' + state.toUpperCase()} (${gb(art.size)})`);
    missing++;
    continue;
  }
  if (state !== 'missing') {
    console.warn(`${tag}  existing file has the wrong ${state}, replacing it`);
    rmSync(dest);
  }
  mkdirSync(dirname(dest), { recursive: true });
  if (fromComponents) {
    const src = join(fromComponents, ...art.rel.split('/'));
    if (existsSync(src) && sizeAcceptable(art, statSync(src).size)) {
      process.stdout.write(`${tag}  copying from existing install… `);
      copyFileSync(src, dest + '.part');
      if (await hashMatches(dest + '.part', art)) {
        renameSync(dest + '.part', dest);
        remember(art, dest);
        console.log('ok');
        continue;
      }
      rmSync(dest + '.part', { force: true });
      console.log('hash mismatch, downloading instead');
    }
  }
  try {
    await download(art, dest, tag);
    remember(art, dest);
    fetched++;
  } catch (e) {
    console.error(`${tag}  FAILED: ${e.message}`);
    missing++;
  }
}
// The verification cache is the one thing a check touches on disk; a
// read-only stage (a mounted image, a disc) must be checkable, so skip it.
if (!checkOnly) saveCache(cachePath, verified);

console.log('');
const stale = staleFiles();
if (stale.length) {
  console.warn(`${stale.length} file(s) in the stage are not in this manifest (an older one left them; they will not be packaged, delete them to reclaim space):`);
  for (const s of stale) console.warn(`  ${s}`);
}
console.log(`fetched ${fetched}, missing ${missing}, components total ${gb(componentsBytes(manifest))}`);
for (const m of fitReport(componentsBytes(manifest))) {
  console.log(`  ${m.fits ? 'fits ' : 'NO   '} ${m.label.padEnd(34)} headroom ${gb(m.headroom)} (components only — installer, licenses and source come on top)`);
}
process.exit(missing ? 1 : 0);

// ---------------------------------------------------------------------------

/** 'ok' | 'missing' | 'size' | 'hash' — never modifies anything. */
async function checkExisting(art, dest) {
  if (!existsSync(dest)) return 'missing';
  const st = statSync(dest);
  if (!sizeAcceptable(art, st.size)) return 'size';
  const c = verified[art.rel];
  if (!rehash && c && c.size === st.size && c.mtimeMs === st.mtimeMs && c.sha256 === pin(art)) return 'ok';
  if (await hashMatches(dest, art)) {
    remember(art, dest);
    return 'ok';
  }
  return 'hash';
}

/** What binds the artifact: its byte hash, or the tree digest. */
function pin(art) {
  return art.sha256 ?? art.treeSha256;
}

/** Byte-bound: exactly the pinned size. Tree-bound: anything up to the
 *  app's ceiling (`maxSize`), the digest decides. */
function sizeAcceptable(art, size) {
  return art.sha256 ? size === art.size : size > 0 && size <= art.maxSize;
}

/** Files in the stage that the current manifest does not name (left by an
 *  earlier manifest). Reported, never deleted: the build packages only the
 *  manifest's files, so they cost disk space, not correctness. */
function staleFiles() {
  if (!existsSync(outDir)) return [];
  const wanted = new Set(artifacts.map((a) => a.rel));
  return readdirSync(outDir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(outDir, join(d.parentPath ?? d.path, d.name)).replace(/\\/g, '/'))
    .filter((rel) => !wanted.has(rel) && !rel.endsWith('.part'));
}

async function hashMatches(path, art) {
  if (art.treeSha256) {
    // Same digest and limits as the app. A damaged gzip, a link entry or a
    // bomb throws: not the pinned tree, so the file is replaced like any
    // other mismatch rather than aborting the stage.
    try {
      return treeSha256FromTarGz(readFileSync(path), treeBoundLimits(art.size)) === art.treeSha256;
    } catch {
      return false;
    }
  }
  const h = createHash('sha256');
  await pipeline(createReadStream(path, { highWaterMark: 4 * 1024 * 1024 }), async function* (src) {
    for await (const chunk of src) h.update(chunk);
  });
  return h.digest('hex') === art.sha256;
}

function remember(art, dest) {
  const st = statSync(dest);
  verified[art.rel] = { size: st.size, mtimeMs: st.mtimeMs, sha256: pin(art) };
}

/** Manual redirect walk (https-only hops, first hop on allowedHosts), Range
 *  resume on a `.part` file, size cap, full-file hash (or tree digest)
 *  before the rename. */
async function download(art, dest, tag) {
  if (!hostAllowed(art.url, manifest.allowedHosts)) throw new Error(`host not allowed: ${art.url}`);
  const part = dest + '.part';
  for (let attempt = 1; attempt <= 5; attempt++) {
    const have = existsSync(part) ? statSync(part).size : 0;
    if (have > art.maxSize) rmSync(part);
    try {
      const res = await follow(art.url, have > 0 && have < art.maxSize ? { Range: `bytes=${have}-` } : {});
      let offset = have;
      if (res.status === 200) {
        offset = 0;
        rmSync(part, { force: true });
      } else if (res.status !== 206) {
        throw new Error(`HTTP ${res.status}`);
      }
      const len = Number(res.headers.get('content-length') ?? 0);
      if (len && offset + len > art.maxSize) throw new Error(`server offers ${offset + len} bytes, manifest pins ${art.size}`);
      let done = offset;
      let lastPrint = 0;
      const started = Date.now();
      const meter = async function* (src) {
        for await (const chunk of src) {
          done += chunk.length;
          if (done > art.maxSize) throw new Error('response exceeds pinned size');
          const now = Date.now();
          if (now - lastPrint > 1000) {
            lastPrint = now;
            const mbps = ((done - offset) / 1e6) / ((now - started) / 1000);
            process.stdout.write(`\r${tag}  ${(100 * done / art.size).toFixed(1).padStart(5)}%  ${mbps.toFixed(1)} MB/s   `);
          }
          yield chunk;
        }
      };
      await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(part, { flags: offset ? 'a' : 'w' }));
      process.stdout.write('\r');
      const got = statSync(part).size;
      if (!sizeAcceptable(art, got)) throw new Error(`short file (${got} of ${art.size} bytes)`);
      if (!(await hashMatches(part, art))) {
        rmSync(part);
        throw new Error(art.treeSha256 ? 'tree digest mismatch' : 'sha256 mismatch');
      }
      if (art.treeSha256 && got !== art.size) console.warn(`\n${tag}  archive is ${got} bytes, the manifest's nominal size is ${art.size} (upstream recompressed it; the tree verifies)`);
      renameSync(part, dest);
      console.log(`${tag}  downloaded ${gb(art.size)}`);
      return;
    } catch (e) {
      if (attempt === 5 || /host not allowed|manifest pins|exceeds pinned|sha256 mismatch|tree digest mismatch/.test(e.message)) throw e;
      console.warn(`\n${tag}  attempt ${attempt} failed (${e.message}); retrying`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function follow(url, headers) {
  let current = url;
  for (let hop = 0; hop < 10; hop++) {
    const res = await fetch(current, { headers, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`redirect without Location from ${current}`);
      const next = new URL(loc, current);
      if (next.protocol !== 'https:') throw new Error(`refusing non-https redirect to ${next}`);
      await res.body?.cancel();
      current = next.toString();
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

function loadCache(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 1));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument: ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}
