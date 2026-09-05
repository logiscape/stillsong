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
    pub size: u64,
    pub sha256: String,
    pub install_path: String,
    /// "zip" | "tar.gz-strip1" for archives that are extracted from
    /// `_downloads/`; absent for files that land directly at `install_path`.
    #[serde(default)]
    pub extract: Option<String>,
}

/// One downloadable blob resolved against a components dir.
pub struct Artifact {
    pub id: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
    /// Where the verified file lands.
    pub dest: PathBuf,
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
        sha256: w.sha256.clone(),
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
            assert!(hex(&i.sha256), "{}: bad sha256", i.id);
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
