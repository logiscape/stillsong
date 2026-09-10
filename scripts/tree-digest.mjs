// Tree digest of a source archive — the pin behind `treeSha256` in
// components.json. Mirrors `tree_sha256` in src-tauri/src/components.rs,
// which is what the app checks at first run; the two must agree bit for bit.
//
//   node scripts/tree-digest.mjs <file.tar.gz | directory>
//
// Definition: for every regular file, one `sha256sum`-style line
// `<sha256 hex>  <path>\n` (two spaces, LF), paths relative to the tree with
// forward slashes and the archive's single top-level folder stripped; lines
// sorted by the UTF-8 bytes of the path; the digest is the sha256 of the
// concatenated lines. Directories, symlinks, modes and timestamps are not
// part of it, so the digest is the same whichever archive — or whichever
// gzip — delivered the files. That is the point: GitHub keeps the contents
// of a commit archive stable but may regenerate the compressed bytes.
//
// Reproducible by hand:  cd <tree>; find . -type f | sort | xargs sha256sum
// (with `./` stripped from the paths) piped into sha256sum.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// The app's bounds on a tree-bound archive, mirrored from
// src-tauri/src/manifest.rs so the checker and the disc build refuse exactly
// what first-run setup refuses: the download may be at most SIZE_SLACK × the
// nominal size, its entries' data at most UNPACK_SLACK × that, and there may
// be at most MAX_ENTRIES entries.
export const TREE_BOUND_SIZE_SLACK = 2;
export const TREE_BOUND_UNPACK_SLACK = 64;
export const TREE_BOUND_MAX_ENTRIES = 100_000;

/** The unpack limits the app applies to a tree-bound item of this nominal size. */
export function treeBoundLimits(nominalSize) {
  return { maxBytes: nominalSize * TREE_BOUND_UNPACK_SLACK, maxEntries: TREE_BOUND_MAX_ENTRIES };
}

/** The digest of a Map (or iterable of [path, sha256 hex]) of regular files. */
export function treeSha256FromFiles(files) {
  const entries = [...files].sort((a, b) => Buffer.compare(Buffer.from(a[0], 'utf8'), Buffer.from(b[0], 'utf8')));
  const h = createHash('sha256');
  for (const [path, hex] of entries) h.update(`${hex}  ${path}\n`);
  return h.digest('hex');
}

/** Regular files of a gzipped tar with its first path segment stripped:
 *  Map of `path` → sha256 hex. A path listed twice keeps the last entry, as
 *  extraction would.
 *
 *  Throws on anything the app's unpacker would refuse (`unpack_tar_strip1`
 *  in src-tauri/src/components.rs): an entry that is neither a regular file
 *  nor a directory — links are not part of the digest, so an archive
 *  carrying one could verify while planting a link anywhere — and, when
 *  `limits` is given (`treeBoundLimits`), more entries or entry bytes than
 *  allowed. A damaged gzip throws too; callers verifying a file treat any
 *  throw as "not the pinned tree". */
export function tarGzFiles(gz, limits = null) {
  // The whole decompressed stream is bounded like the app's reader is
  // (`UnpackLimits::max_stream_bytes`): entry data plus 2 KiB of header,
  // extended-header and padding overhead per entry.
  const tar = gunzipSync(gz, limits ? { maxOutputLength: limits.maxBytes + 2048 * limits.maxEntries } : {});
  const files = new Map();
  let entries = 0;
  let bytes = 0;
  for (const e of tarEntries(tar)) {
    const rel = e.path.split('/').slice(1).filter((s) => s.length).join('/');
    if (!rel) continue;
    if (!e.regular && !e.directory) throw new Error(`archive entry ${e.path} is a ${e.kind}: only files and directories may be unpacked before the tree is verified`);
    if (limits) {
      entries += 1;
      bytes += e.data.length;
      if (entries > limits.maxEntries || bytes > limits.maxBytes) throw new Error(`archive exceeds the unpack limits (${entries} entries, ${bytes} bytes; at most ${limits.maxEntries} and ${limits.maxBytes})`);
    }
    if (e.regular) files.set(rel, sha256(e.data));
  }
  return files;
}

export function treeSha256FromTarGz(gz, limits = null) {
  return treeSha256FromFiles(tarGzFiles(gz, limits));
}

/** Regular files under `dir` (symlinks are neither followed nor counted). */
export function dirFiles(dir) {
  const files = new Map();
  for (const d of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!d.isFile()) continue;
    const full = join(d.parentPath ?? d.path, d.name);
    files.set(relative(dir, full).split('\\').join('/'), sha256(readFileSync(full)));
  }
  return files;
}

export function treeSha256FromDir(dir) {
  return treeSha256FromFiles(dirFiles(dir));
}

const ENTRY_KINDS = {
  0: 'file', 0x30: 'file', 0x37: 'file', 0x31: 'hard link', 0x32: 'symlink', 0x33: 'character device',
  0x34: 'block device', 0x35: 'directory', 0x36: 'fifo', 0x53: 'GNU sparse file',
};

/**
 * Minimal ustar/pax/GNU tar reader over an in-memory buffer: yields
 * `{ path, regular, directory, kind, data }` per entry. Handles the pax
 * `path` record and the GNU `././@LongLink` entry that long names arrive in
 * (git archive, which GitHub uses, writes pax), the ustar prefix field, and
 * base-256 sizes. Structure is validated the way tar-rs validates it for
 * the app — every header checksum, and no entry or block cut short — so
 * this never approves an archive setup would refuse.
 */
export function* tarEntries(tar) {
  const cstr = (buf, off, len) => {
    const end = buf.indexOf(0, off);
    return buf.toString('utf8', off, end === -1 || end > off + len ? off + len : end);
  };
  const num = (buf, off, len) => {
    if (buf[off] & 0x80) {
      let n = 0;
      for (let i = 1; i < len; i++) n = n * 256 + buf[off + i];
      return n;
    }
    const s = cstr(buf, off, len).trim();
    return s ? parseInt(s, 8) : 0;
  };
  let pending = null;
  let off = 0;
  let ended = false;
  for (; off + 512 <= tar.length; ) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) {
      ended = true;
      break;
    }
    // tar-rs: the byte sum of the header with the checksum field taken as
    // spaces must equal the recorded checksum.
    let sum = 8 * 32;
    for (let i = 0; i < 512; i++) if (i < 148 || i >= 156) sum += h[i];
    if (sum !== num(h, 148, 8)) throw new Error(`archive header checksum mismatch at offset ${off}`);
    const size = num(h, 124, 12);
    const type = h[156];
    let name = cstr(h, 0, 100);
    if (cstr(h, 257, 6).startsWith('ustar')) {
      const prefix = cstr(h, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }
    const next = off + 512 + Math.ceil(size / 512) * 512;
    if (next > tar.length) throw new Error(`archive is truncated inside ${name}`);
    const data = tar.subarray(off + 512, off + 512 + size);
    off = next;
    if (type === 0x78 /* x: pax extended header for the next entry */) {
      for (const rec of parsePax(data)) if (rec.key === 'path') pending = rec.value;
      continue;
    }
    if (type === 0x4c /* L: GNU long name for the next entry */) {
      pending = cstr(data, 0, data.length);
      continue;
    }
    if (type === 0x67 /* g: pax global header */ || type === 0x4b /* K: GNU long link */) continue;
    const path = pending ?? name;
    pending = null;
    yield {
      path,
      regular: type === 0 || type === 0x30 || type === 0x37,
      directory: type === 0x35,
      kind: ENTRY_KINDS[type] ?? `type '${String.fromCharCode(type)}' entry`,
      data,
    };
  }
  // A partial header block at the end is a cut-short archive, not an end marker.
  if (!ended && off < tar.length) throw new Error('archive is truncated (partial header block)');
}

function parsePax(buf) {
  const out = [];
  let i = 0;
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i);
    if (sp === -1) break;
    const len = parseInt(buf.toString('ascii', i, sp), 10);
    if (!(len > 0)) break;
    const rec = buf.toString('utf8', sp + 1, i + len - 1);
    const eq = rec.indexOf('=');
    if (eq !== -1) out.push({ key: rec.slice(0, eq), value: rec.slice(eq + 1) });
    i += len;
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2];
  if (!target || process.argv.length > 3) {
    console.error('usage: node scripts/tree-digest.mjs <file.tar.gz | directory>');
    process.exit(2);
  }
  if (statSync(target).isDirectory()) {
    console.log(treeSha256FromDir(target));
  } else {
    const gz = readFileSync(target);
    const files = tarGzFiles(gz);
    console.log(treeSha256FromFiles(files));
    console.error(`${files.size} regular files; archive ${gz.length} bytes (the manifest's nominal size)`);
  }
}
