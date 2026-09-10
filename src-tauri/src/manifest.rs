// The pinned component manifest, compiled into the binary. This — not any
// argument from the web view — decides what first-run setup may download,
// from where, how big it is, what it must hash to, and where it lands. The
// frontend only ever names an artifact by id.
//
// `components.json` at the repo root is the single source: the frontend
// imports the same file for display (sizes, grouping), Rust owns every
// action on it.

use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const MANIFEST_JSON: &str = include_str!("../../components.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[allow(dead_code)] // part of the file format; the frontend records it in settings
    pub manifest_version: String,
    pub allowed_hosts: Vec<String>,
    pub python: PythonSpec,
    pub items: Vec<Item>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonSpec {
    /// Exact CPython patch version (e.g. "3.12.14"); checked against the
    /// extracted interpreter before anything is installed.
    pub version: String,
    /// Wheelhouse path relative to the components dir.
    pub wheelhouse: String,
    pub wheels: Vec<Wheel>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wheel {
    pub name: String,
    pub version: String,
    pub filename: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    /// "tool" | "runtime" | "model" — display grouping, and the E2E test's model filter.
    #[allow(dead_code)]
    pub kind: String,
    pub url: String,
    /// Exact byte count of the download — or, for a tree-bound archive, the
    /// nominal size at pin time (the downloader accepts up to
    /// `TREE_BOUND_SIZE_SLACK` times it).
    pub size: u64,
    /// sha256 of the downloaded bytes. Exactly one of `sha256` and
    /// `tree_sha256` is set.
    #[serde(default)]
    pub sha256: Option<String>,
    /// For a GitHub-generated source tarball (`.../archive/<commit>.tar.gz`):
    /// the digest of the *extracted* files (`components::tree_sha256`, the
    /// sha256 of a `sha256sum`-style listing of every regular file). GitHub
    /// guarantees the contents of a commit archive but not its compressed
    /// bytes — it regenerated every tarball in January 2023 and reserves the
    /// right to do so again — so binding the bytes would let an upstream
    /// recompression break fresh installs of a Stillsong release that never
    /// updates itself. Requires `extract: "tar.gz-strip1"`.
    #[serde(default)]
    pub tree_sha256: Option<String>,
    pub install_path: String,
    /// "zip" | "tar.gz-strip1" for archives that are extracted from
    /// `_downloads/`; absent for files that land directly at `install_path`.
    #[serde(default)]
    pub extract: Option<String>,
}

/// How much larger than its nominal `size` a tree-bound archive may come
/// back: a recompression moves the byte count by a few percent, so twice is
/// generous, while still cutting off a runaway stream. Mirrored by
/// `maxSize` in physical-release/lib/layout.mjs and scripts/check-manifest.mjs.
pub const TREE_BOUND_SIZE_SLACK: u64 = 2;

/// Unpack bounds for a tree-bound archive, whose bytes are unverified until
/// its files exist on disk: the entries' data may total at most this many
/// times the nominal `size` (a source tree expands about 4×), and there may
/// be at most `TREE_BOUND_MAX_ENTRIES` of them, so a decompression bomb is
/// cut off long before the digest gets to refuse it. Mirrored by
/// scripts/tree-digest.mjs.
pub const TREE_BOUND_UNPACK_SLACK: u64 = 64;
pub const TREE_BOUND_MAX_ENTRIES: u64 = 100_000;

/// What `components::unpack_tar_strip1` enforces on an archive it cannot
/// trust yet (see `Item::unpack_limits`).
pub struct UnpackLimits {
    pub max_bytes: u64,
    pub max_entries: u64,
}

impl UnpackLimits {
    /// The most decompressed bytes the tar parser may be fed at all:
    /// entry data plus 2 KiB of header, extended-header and padding
    /// overhead per entry. tar-rs buffers pax records and GNU long names in
    /// memory before it yields the entry they belong to, so a cap on yielded
    /// entries alone would not stop a bomb hidden in metadata. Mirrored by
    /// scripts/tree-digest.mjs (`maxOutputLength`).
    pub fn max_stream_bytes(&self) -> u64 {
        self.max_bytes
            .saturating_add(self.max_entries.saturating_mul(2048))
    }
}

/// One downloadable blob resolved against a components dir.
pub struct Artifact {
    pub id: String,
    pub url: String,
    pub size: u64,
    /// Pinned sha256 of the bytes. `None` for a tree-bound archive: its
    /// bytes are accepted up to `max_size()` and bound when it is unpacked
    /// (`components::extract_item`).
    pub sha256: Option<String>,
    /// Where the verified file lands.
    pub dest: PathBuf,
}

impl Artifact {
    /// The most bytes the downloader will write for this artifact.
    pub fn max_size(&self) -> u64 {
        if self.sha256.is_some() {
            self.size
        } else {
            self.size.saturating_mul(TREE_BOUND_SIZE_SLACK)
        }
    }
}

pub fn manifest() -> &'static Manifest {
    static M: OnceLock<Manifest> = OnceLock::new();
    M.get_or_init(|| serde_json::from_str(MANIFEST_JSON).expect("components.json is malformed"))
}

fn join_rel(comp: &Path, rel: &str) -> PathBuf {
    let mut p = comp.to_path_buf();
    for seg in rel.split('/') {
        p.push(seg);
    }
    p
}

/// Staging dir for archives and wheels; removed once setup completes.
pub fn downloads_dir(comp: &Path) -> PathBuf {
    comp.join("_downloads")
}

pub fn wheelhouse_dir(comp: &Path) -> PathBuf {
    join_rel(comp, &manifest().python.wheelhouse)
}

fn archive_basename(url: &str) -> String {
    let raw = url.rsplit('/').next().unwrap_or(url);
    // GitHub encodes '+' in release asset names; keep the on-disk name plain.
    raw.replace("%2B", "+")
}

impl Item {
    /// Where the download lands: archives are staged, everything else is
    /// written straight to its install path.
    pub fn download_dest(&self, comp: &Path) -> PathBuf {
        if self.extract.is_some() {
            downloads_dir(comp).join(archive_basename(&self.url))
        } else {
            join_rel(comp, &self.install_path)
        }
    }

    pub fn install_dest(&self, comp: &Path) -> PathBuf {
        join_rel(comp, &self.install_path)
    }

    /// `Some` for a tree-bound archive: it is unpacked before it is
    /// verified, so the unpacker must bound it. A byte-bound archive was
    /// authenticated by the downloader and needs no limits.
    pub fn unpack_limits(&self) -> Option<UnpackLimits> {
        self.tree_sha256.as_ref().map(|_| UnpackLimits {
            max_bytes: self.size.saturating_mul(TREE_BOUND_UNPACK_SLACK),
            max_entries: TREE_BOUND_MAX_ENTRIES,
        })
    }
}

/// Looks up an artifact by id: a manifest item id, or a wheel filename.
pub fn artifact(comp: &Path, id: &str) -> Option<Artifact> {
    let m = manifest();
    if let Some(it) = m.items.iter().find(|i| i.id == id) {
        return Some(Artifact {
            id: it.id.clone(),
            url: it.url.clone(),
            size: it.size,
            sha256: it.sha256.clone(),
            dest: it.download_dest(comp),
        });
    }
    let w = m.python.wheels.iter().find(|w| w.filename == id)?;
    Some(Artifact {
        id: w.filename.clone(),
        url: w.url.clone(),
        size: w.size,
        sha256: Some(w.sha256.clone()),
        dest: wheelhouse_dir(comp).join(&w.filename),
    })
}

pub fn item(id: &str) -> Option<&'static Item> {
    manifest().items.iter().find(|i| i.id == id)
}

/// Where a download may *start*: the pinned URL must be https on an
/// allowlisted host. Entries are exact hosts, or `*.suffix` for any subdomain
/// of `suffix`. Redirects from there are governed by `hop_allowed`.
pub fn host_allowed(url: &reqwest::Url) -> bool {
    host_allowed_by(url, &manifest().allowed_hosts)
}

fn host_allowed_by(url: &reqwest::Url, allowed: &[String]) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    allowed.iter().any(|a| match a.strip_prefix("*.") {
        Some(suffix) => {
            host.len() > suffix.len() + 1
                && host.ends_with(suffix)
                && host.as_bytes()[host.len() - suffix.len() - 1] == b'.'
        }
        None => host == a,
    })
}

/// Where a download may be *redirected*: any https URL with a DNS name. The
/// allowlisted origin chose the target, and the bytes are still held to the
/// pinned size and sha256, so the hostname adds no integrity — while pinning
/// it would turn every CDN rename into a setup that fails until the user
/// installs a new release (the app never updates itself). Plain http is
/// refused so the transfer is never downgraded; a bare IP literal is refused
/// because no CDN redirects to one and it is the obvious way to aim a
/// redirect at a loopback or private address. (A DNS name resolving to a
/// private address cannot complete either: TLS requires the target to hold
/// the certificate's key. Deliberately no resolver-level filtering — it
/// would reject the private-address proxies that managed Windows machines
/// use.)
pub fn hop_allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https" && url.domain().is_some()
}

/// The hash-complete requirements file `uv pip sync --require-hashes`
/// consumes: one exact pin per wheel, so the only thing uv can install is the
/// file the downloader already verified.
pub fn wheel_lock_text() -> String {
    let mut s = String::from(
        "# generated from components.json — every pin matches a verified file in the wheelhouse\n",
    );
    for w in &manifest().python.wheels {
        s.push_str(&format!(
            "{}=={} --hash=sha256:{}\n",
            w.name, w.version, w.sha256
        ));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> reqwest::Url {
        reqwest::Url::parse(s).unwrap()
    }

    #[test]
    fn manifest_parses_and_is_well_formed() {
        let m = manifest();
        assert!(!m.items.is_empty());
        let mut ids: Vec<&str> = m.items.iter().map(|i| i.id.as_str()).collect();
        ids.extend(m.python.wheels.iter().map(|w| w.filename.as_str()));
        let n = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), n, "artifact ids must be unique");
        let hex = |s: &str| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit());
        for i in &m.items {
            match (&i.sha256, &i.tree_sha256) {
                (Some(s), None) => assert!(hex(s), "{}: bad sha256", i.id),
                (None, Some(t)) => {
                    assert!(hex(t), "{}: bad treeSha256", i.id);
                    assert_eq!(
                        i.extract.as_deref(),
                        Some("tar.gz-strip1"),
                        "{}: treeSha256 binds an extracted tar.gz tree only",
                        i.id
                    );
                }
                _ => panic!("{}: exactly one of sha256 / treeSha256", i.id),
            }
            assert!(i.size > 0, "{}: size", i.id);
            assert!(
                host_allowed(&url(&i.url)),
                "{}: host not allowed: {}",
                i.id,
                i.url
            );
            assert!(!i.install_path.contains(".."), "{}: install path", i.id);
        }
        for w in &m.python.wheels {
            assert!(hex(&w.sha256), "{}: bad sha256", w.filename);
            assert!(w.size > 0);
            assert!(w.filename.ends_with(".whl"), "{}: not a wheel", w.filename);
            assert!(
                host_allowed(&url(&w.url)),
                "{}: host not allowed: {}",
                w.filename,
                w.url
            );
            assert!(!w.filename.contains('/') && !w.filename.contains('\\'));
        }
        assert!(
            m.python.version.split('.').count() == 3,
            "python.version must be an exact patch"
        );
        assert!(item("uv").is_some() && item("python-dist").is_some() && item("comfyui").is_some());
    }

    #[test]
    fn comfyui_is_tree_bound_and_the_rest_byte_bound() {
        // The one GitHub-generated source archive is pinned by its extracted
        // files; every release asset, model and wheel by its exact bytes.
        let comp = Path::new(r"C:\c");
        for i in &manifest().items {
            let art = artifact(comp, &i.id).unwrap();
            if i.id == "comfyui" {
                assert!(i.url.contains("/archive/"), "{}", i.url);
                assert!(art.sha256.is_none());
                assert_eq!(art.max_size(), i.size * TREE_BOUND_SIZE_SLACK);
            } else {
                assert!(!i.url.contains("/archive/"), "{}: {}", i.id, i.url);
                assert!(art.sha256.is_some(), "{}", i.id);
                assert_eq!(art.max_size(), i.size);
            }
        }
        let w = artifact(comp, &manifest().python.wheels[0].filename).unwrap();
        assert!(w.sha256.is_some());
    }

    #[test]
    fn allowlist_is_the_pinned_origins_only() {
        assert!(host_allowed(&url("https://huggingface.co/x")));
        assert!(host_allowed(&url("https://github.com/x")));
        assert!(host_allowed(&url("https://download-r2.pytorch.org/x")));
        assert!(host_allowed(&url(
            "https://files.pythonhosted.org/packages/a.whl"
        )));
        assert!(
            !host_allowed(&url("https://us.aws.cdn.hf.co/x")),
            "CDNs are reached only by redirect, never pinned"
        );
        assert!(!host_allowed(&url("https://huggingface.co.evil.example/x")));
        assert!(
            !host_allowed(&url("http://huggingface.co/x")),
            "plain http is refused"
        );
        assert!(
            !host_allowed(&url("https://pypi.org/simple")),
            "the app never talks to an index"
        );
    }

    #[test]
    fn allowlist_suffix_entries() {
        let list = vec!["*.hf.co".to_string()];
        assert!(host_allowed_by(&url("https://us.aws.cdn.hf.co/x"), &list));
        assert!(
            !host_allowed_by(&url("https://hf.co/x"), &list),
            "bare suffix is not a subdomain"
        );
        assert!(!host_allowed_by(&url("https://evilhf.co/x"), &list));
    }

    #[test]
    fn hops_need_https_and_a_dns_name() {
        assert!(hop_allowed(&url("https://cas-bridge.xethub.hf.co/x")));
        assert!(hop_allowed(&url("https://anything.example/x")));
        assert!(!hop_allowed(&url("http://cas-bridge.xethub.hf.co/x")));
        assert!(!hop_allowed(&url("ftp://cas-bridge.xethub.hf.co/x")));
        assert!(!hop_allowed(&url("https://127.0.0.1:17800/x")));
        assert!(!hop_allowed(&url("https://192.168.1.1/x")));
        assert!(!hop_allowed(&url("https://[::1]/x")));
        assert!(!hop_allowed(&url("https://[fe80::1]/x")));
    }

    #[test]
    fn artifact_destinations() {
        let comp = Path::new(r"C:\c");
        let uv = artifact(comp, "uv").unwrap();
        assert_eq!(
            uv.dest,
            Path::new(r"C:\c\_downloads\uv-x86_64-pc-windows-msvc.zip")
        );
        let py = artifact(comp, "python-dist").unwrap();
        assert_eq!(
            py.dest.file_name().unwrap().to_string_lossy(),
            "cpython-3.12.14+20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz"
        );
        let dit = artifact(comp, "music-dit").unwrap();
        assert_eq!(
            dit.dest,
            Path::new(
                r"C:\c\comfy-data\models\diffusion_models\minimax_music3_dit_fp16.safetensors"
            )
        );
        assert!(artifact(comp, "nope").is_none());
        if let Some(w) = manifest().python.wheels.first() {
            let a = artifact(comp, &w.filename).unwrap();
            assert_eq!(
                a.dest,
                Path::new(r"C:\c\_downloads\wheelhouse").join(&w.filename)
            );
        }
    }

    #[test]
    fn lock_text_shape() {
        let t = wheel_lock_text();
        for w in &manifest().python.wheels {
            assert!(t.contains(&format!(
                "{}=={} --hash=sha256:{}\n",
                w.name, w.version, w.sha256
            )));
        }
    }
}
