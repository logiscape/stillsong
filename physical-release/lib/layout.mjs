// Pure helpers shared by the physical-release scripts. No side effects.
//
// The on-media layout mirrors what the app's Rust shell expects at first run
// (src-tauri/src/manifest.rs: `download_dest`, `wheelhouse_dir`,
// `archive_basename`). If those rules change, `layout.test.mjs` is where the
// mismatch should show up first.

/** Blu-ray capacities in bytes (2048-byte sectors). Single-layer BD-R is
 *  25,025,314,816 bytes, not 25 × 10^9. */
export const MEDIA = [
  { id: 'bd-r', label: 'BD-R, single layer (25 GB)', bytes: 25_025_314_816 },
  { id: 'bd-r-dl', label: 'BD-R DL, dual layer (50 GB)', bytes: 50_050_629_632 },
  { id: 'bdxl-100', label: 'BDXL, triple layer (100 GB)', bytes: 100_103_356_416 },
  { id: 'bdxl-128', label: 'BDXL, quad layer (128 GB)', bytes: 128_001_769_472 },
];

/** Room the setup wizard insists on before it unpacks anything
 *  (`REQUIRED_FREE_BYTES` in src/ui/screens/SetupScreen.tsx). The wizard does
 *  not know the seeded files are already on the drive, so a disc install
 *  needs this *in addition to* the components themselves. */
export const WIZARD_FREE_BYTES = 40 * 1024 ** 3;

/** Safety margin reserved for UDF metadata, directory records and padding
 *  when deciding whether a build fits on a given medium. */
export const FILESYSTEM_OVERHEAD_BYTES = 64 * 1024 * 1024;

/** Last URL path segment, with GitHub's `%2B` restored to `+`
 *  (`archive_basename` in manifest.rs). */
export function archiveBasename(url) {
  const raw = url.split('/').pop() ?? url;
  return raw.replace(/%2B/g, '+');
}

/**
 * Every blob first-run setup would fetch, with the path (forward slashes,
 * relative to the components dir) where the app expects to find it:
 *   - archives (`extract` set)  → `_downloads/<basename of url>`
 *   - everything else           → `<installPath>` (models land in place)
 *   - wheels                    → `<python.wheelhouse>/<filename>`
 */
export function componentArtifacts(manifest) {
  const out = [];
  for (const it of manifest.items) {
    out.push({
      id: it.id,
      kind: it.kind,
      url: it.url,
      size: it.size,
      sha256: it.sha256.toLowerCase(),
      rel: it.extract ? `_downloads/${archiveBasename(it.url)}` : it.installPath,
    });
  }
  const wheelhouse = manifest.python.wheelhouse.replace(/\/+$/, '');
  for (const w of manifest.python.wheels) {
    out.push({
      id: w.filename,
      kind: 'wheel',
      url: w.url,
      size: w.size,
      sha256: w.sha256.toLowerCase(),
      rel: `${wheelhouse}/${w.filename}`,
    });
  }
  return out;
}

export function componentsBytes(manifest) {
  return componentArtifacts(manifest).reduce((n, a) => n + a.size, 0);
}

/** Where a download may start (`host_allowed_by` in manifest.rs): https on an
 *  exact host, or `*.suffix` for any subdomain of `suffix`. */
export function hostAllowed(url, allowedHosts) {
  const u = new URL(url);
  if (u.protocol !== 'https:') return false;
  const host = u.hostname;
  return allowedHosts.some((a) => {
    if (a.startsWith('*.')) {
      const suffix = a.slice(2);
      return host.length > suffix.length + 1 && host.endsWith(suffix) && host[host.length - suffix.length - 1] === '.';
    }
    return host === a;
  });
}

/** `sha256sum`-style text: `<hex>  <path>` per line, LF, paths with forward
 *  slashes relative to the media root. */
export function formatSums(entries) {
  return entries.map((e) => `${e.sha256}  ${e.path}`).join('\n') + '\n';
}

export function parseSums(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const m = /^([0-9a-fA-F]{64})\s[\s*](.+)$/.exec(line);
    if (!m) throw new Error(`malformed SHA256SUMS line: ${line}`);
    out.push({ sha256: m[1].toLowerCase(), path: m[2] });
  }
  return out;
}

/** Which media a payload of `bytes` fits on, with the remaining headroom. */
export function fitReport(bytes) {
  return MEDIA.map((m) => ({
    ...m,
    fits: bytes + FILESYSTEM_OVERHEAD_BYTES <= m.bytes,
    headroom: m.bytes - bytes - FILESYSTEM_OVERHEAD_BYTES,
  }));
}

export function gb(bytes) {
  return (bytes / 1e9).toFixed(2) + ' GB';
}
