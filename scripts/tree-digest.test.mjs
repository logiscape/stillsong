// Run with:  node --test scripts/
// Pins the Node tree digest to the same reference value the Rust
// implementation (`tree_sha256` in src-tauri/src/components.rs) is tested
// against, on the same fixture — the two must agree bit for bit, because
// check-manifest.mjs and the physical release verify with this one and the
// app verifies with the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { tarEntries, tarGzFiles, treeBoundLimits, treeSha256FromDir, treeSha256FromFiles, treeSha256FromTarGz } from './tree-digest.mjs';

/** A ustar archive from `{ name, type, data?, link? }` entries (type is the
 *  typeflag character), for the refusal tests. */
function makeTar(entries) {
  const blocks = [];
  for (const e of entries) {
    const data = e.data ?? Buffer.alloc(0);
    const h = Buffer.alloc(512);
    h.write(e.name, 0, 100, 'utf8');
    h.write('0000644\0', 100, 8);
    h.write('0000000\0', 108, 8);
    h.write('0000000\0', 116, 8);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12);
    h.write('00000000000\0', 136, 12);
    h.write('        ', 148, 8);
    h.write(e.type, 156, 1);
    if (e.link) h.write(e.link, 157, 100, 'utf8');
    h.write('ustar\0', 257, 6);
    h.write('00', 263, 2);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'tree-digest.tar.gz'));
// Computed independently (Python tarfile + hashlib) when the fixture was made.
const FIXTURE_TREE_SHA256 = '11a39931c8ab65935ffbd1327f7c4ae1e6d24d13b01d50e8dee71e99786a26b0';

test('fixture digest matches the reference (and the Rust test)', () => {
  assert.equal(treeSha256FromTarGz(fixture), FIXTURE_TREE_SHA256);
});

test('the tar reader sees pax long names, empty files and skips directories', () => {
  const files = tarGzFiles(fixture);
  assert.equal(files.size, 6);
  const longName = [...files.keys()].find((p) => p.length > 100);
  assert.ok(longName?.endsWith('that_needs_a_pax_header.py'), 'pax path record applied');
  assert.equal(files.get('pkg/__init__.py'), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'empty file hashes as empty');
  assert.equal(files.get('README.md'), '5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03');
  const entries = [...tarEntries(gunzipSync(fixture))];
  assert.ok(entries.some((e) => !e.regular && e.path.endsWith('/empty-dir/')), 'directory entries are yielded but not files');
});

test('recompressing the archive changes the bytes, not the digest', () => {
  const tar = gunzipSync(fixture);
  const fast = gzipSync(tar, { level: 1 });
  const stored = gzipSync(tar, { level: 0 });
  assert.notDeepEqual(fast, fixture);
  assert.notDeepEqual(stored, fixture);
  assert.equal(treeSha256FromTarGz(fast), FIXTURE_TREE_SHA256);
  assert.equal(treeSha256FromTarGz(stored), FIXTURE_TREE_SHA256);
});

test('a directory written from the archive digests identically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stillsong-tree-'));
  try {
    for (const e of tarEntries(gunzipSync(fixture))) {
      const rel = e.path.split('/').slice(1).filter(Boolean).join('/');
      if (!rel) continue;
      if (e.regular) {
        mkdirSync(join(dir, dirname(rel)), { recursive: true });
        writeFileSync(join(dir, rel), e.data);
      } else {
        mkdirSync(join(dir, rel), { recursive: true });
      }
    }
    assert.equal(treeSha256FromDir(dir), FIXTURE_TREE_SHA256);
    writeFileSync(join(dir, 'extra.txt'), 'x');
    assert.notEqual(treeSha256FromDir(dir), FIXTURE_TREE_SHA256);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('links and other non-file entries are refused, as the app refuses them', () => {
  const ok = makeTar([{ name: 'top/', type: '5' }, { name: 'top/a.txt', type: '0', data: Buffer.from('a') }]);
  assert.equal(tarGzFiles(ok).size, 1, 'directories and files pass');
  const symlink = makeTar([{ name: 'top/a.txt', type: '0', data: Buffer.from('a') }, { name: 'top/escape', type: '2', link: 'C:/Windows/win.ini' }]);
  assert.throws(() => tarGzFiles(symlink), /symlink.*only files and directories/);
  const hardlink = makeTar([{ name: 'top/alias', type: '1', link: '../../outside' }]);
  assert.throws(() => tarGzFiles(hardlink), /hard link/);
  const fifo = makeTar([{ name: 'top/pipe', type: '6' }]);
  assert.throws(() => tarGzFiles(fifo), /fifo/);
  // The top-level folder entry itself is stripped away before the check.
  assert.equal(tarGzFiles(makeTar([{ name: 'top/', type: '5' }])).size, 0);
});

test('unpack limits mirror the app: entry bytes and entry count', () => {
  const zeros = Buffer.alloc(1 << 20);
  const bomb = makeTar([{ name: 'top/zeros.bin', type: '0', data: zeros }]);
  assert.ok(bomb.length * 64 < zeros.length, 'the zeros compress past the cap');
  assert.throws(() => treeSha256FromTarGz(bomb, treeBoundLimits(bomb.length)), /exceeds the unpack limits/);
  assert.equal(typeof treeSha256FromTarGz(bomb), 'string', 'no limits for the bump-ritual CLI');
  const many = makeTar([{ name: 'top/a', type: '0' }, { name: 'top/b', type: '0' }, { name: 'top/c', type: '0' }]);
  assert.throws(() => tarGzFiles(many, { maxBytes: 1e9, maxEntries: 2 }), /exceeds the unpack limits \(3 entries/);
  assert.equal(tarGzFiles(many, { maxBytes: 1e9, maxEntries: 3 }).size, 3);
  assert.equal(treeSha256FromTarGz(fixture, treeBoundLimits(fixture.length)), FIXTURE_TREE_SHA256, 'the fixture is within its own limits');
});

test('tar structure is validated like tar-rs: header checksums and truncation', () => {
  const ok = makeTar([{ name: 'top/', type: '5' }, { name: 'top/a.txt', type: '0', data: Buffer.from('a') }]);
  const tar = gunzipSync(ok);
  const badSum = Buffer.from(tar);
  badSum[0] ^= 0xff;
  assert.throws(() => tarGzFiles(gzipSync(badSum)), /checksum mismatch at offset 0/);
  // Cut inside the second entry's block: tar-rs fails to read the entry.
  assert.throws(() => tarGzFiles(gzipSync(tar.subarray(0, 1500))), /truncated inside top\/a.txt/);
  // A partial trailing header block is not an end-of-archive marker.
  assert.throws(() => tarGzFiles(gzipSync(tar.subarray(0, 1536 + 100))), /partial header block/);
  // Ending exactly on a block boundary without zero blocks is accepted, as tar-rs accepts it.
  assert.equal(tarGzFiles(gzipSync(tar.subarray(0, 1536))).size, 1);
});

test('the checksum-corrupted fixture is rejected, as the Rust test asserts for the same bytes', () => {
  // Mirrors components::tests::tree_bound_extract_rejects_a_bad_header_checksum.
  const tar = gunzipSync(fixture);
  tar[0] ^= 0xff;
  assert.throws(() => treeSha256FromTarGz(gzipSync(tar)), /checksum mismatch/);
});

test('a damaged gzip throws, so a verifier must catch and treat it as a mismatch', () => {
  const damaged = Buffer.from(fixture);
  damaged[damaged.length - 20] ^= 0xff;
  assert.throws(() => treeSha256FromTarGz(damaged));
  assert.throws(() => treeSha256FromTarGz(Buffer.from('not gzip at all')));
});

test('lines are sorted by path bytes, sha256sum style', () => {
  const a = treeSha256FromFiles(new Map([['b', '1'.repeat(64)], ['a', '0'.repeat(64)]]));
  const b = treeSha256FromFiles(new Map([['a', '0'.repeat(64)], ['b', '1'.repeat(64)]]));
  assert.equal(a, b);
  assert.notEqual(a, treeSha256FromFiles(new Map([['a', '1'.repeat(64)], ['b', '0'.repeat(64)]])));
});
