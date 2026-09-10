// Component bootstrap: archive extraction, the offline Python environment,
// and manifest verification. Every step is idempotent and re-runnable — a
// partially bootstrapped state always resumes cleanly. Downloads themselves
// live in downloads.rs; the first-run UI orchestrates the order:
//   download everything -> extract archives -> python env (offline) -> warm-up -> done.
//
// Nothing here takes a URL, a version, or a path from the web view: the
// compiled-in manifest (manifest.rs) says what exists and where it goes.
//
// Layout under the chosen components dir:
//   uv/uv.exe                      pinned uv release (zip) — used only as an offline installer
//   python-dist/python.exe         pinned python-build-standalone build (tar.gz, stripped);
//                                  the venv's `home`, so it stays for the life of the install
//   python-env/Scripts/python.exe  uv venv, synced from the wheelhouse with --require-hashes
//   ComfyUI/                       pinned source tree (tar.gz, stripped)
//   llama/llama-server.exe (+cuda) llama.cpp release zips
//   comfy-data/models/...          Music-3 weights (ComfyUI --base-directory)
//   models/*.gguf                  Gemma weights for llama-server
//   _downloads/                    archives + wheelhouse; deleted once setup completes

use crate::manifest::{self, Item, UnpackLimits};
use std::io::Read;
use std::os::windows::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use tauri::ipc::Channel;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn run_logged(
    mut cmd: std::process::Command,
    on_line: &(dyn Fn(String) + Sync),
) -> Result<(), String> {
    use std::io::BufRead;
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let tail = std::sync::Mutex::new(std::collections::VecDeque::<String>::new());
    let push = |line: String| {
        let mut t = tail.lock().unwrap();
        if t.len() >= 12 {
            t.pop_front();
        }
        t.push_back(line.clone());
        drop(t);
        on_line(line);
    };
    std::thread::scope(|s| {
        s.spawn(|| {
            for line in std::io::BufReader::new(stdout)
                .lines()
                .map_while(Result::ok)
            {
                push(line);
            }
        });
        s.spawn(|| {
            for line in std::io::BufReader::new(stderr)
                .lines()
                .map_while(Result::ok)
            {
                push(line);
            }
        });
    });
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        let t = tail.lock().unwrap();
        return Err(format!(
            "command exited with {status}\n{}",
            t.iter().cloned().collect::<Vec<_>>().join("\n")
        ));
    }
    Ok(())
}

fn run_capture(mut cmd: std::process::Command) -> Result<String, String> {
    cmd.stdin(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "command exited with {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Extracts one archive item from `_downloads/` into its install path.
/// `extract` is "zip" or "tar.gz-strip1" (GitHub source tarballs and
/// python-build-standalone wrap everything in one top-level folder that we
/// strip). Entries that would escape the destination are refused.
///
/// A tree-bound item (`tree_sha256` set; the downloader did not hash its
/// bytes) is unpacked beside its install path first, its files are digested
/// against the pin, and only a matching tree is swapped into place — so the
/// install path never holds anything the manifest has not bound.
pub fn extract_item(comp: &Path, item: &Item) -> Result<(), String> {
    let mode = item
        .extract
        .as_deref()
        .ok_or_else(|| format!("{} is not an archive", item.id))?;
    let archive = item.download_dest(comp);
    let dest = item.install_dest(comp);
    match (mode, &item.tree_sha256) {
        ("zip", None) => {
            std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            let file = std::fs::File::open(&archive).map_err(|e| e.to_string())?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            // ZipArchive::extract sanitises names (enclosed_name) itself.
            zip.extract(&dest).map_err(|e| e.to_string())
        }
        ("tar.gz-strip1", None) => {
            std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            unpack_tar_strip1(&archive, &dest, None)
        }
        ("tar.gz-strip1", Some(pin)) => {
            let staging = staging_dir(&dest)?;
            let _ = std::fs::remove_dir_all(&staging);
            std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
            let limits = item.unpack_limits();
            let result = unpack_tar_strip1(&archive, &staging, limits.as_ref())
                .and_then(|()| tree_sha256(&staging));
            // A rejected archive is deleted along with the staging tree: the
            // downloader accepts an existing file as complete, so leaving it
            // would make every retry fail on the same bytes.
            let reject = |why: String| {
                let _ = std::fs::remove_dir_all(&staging);
                let _ = std::fs::remove_file(&archive);
                Err(format!(
                    "{}: {why}; the archive was discarded and will be downloaded again",
                    item.id
                ))
            };
            let got = match result {
                Ok(got) => got,
                Err(e) => return reject(e),
            };
            if !got.eq_ignore_ascii_case(pin) {
                return reject(format!(
                    "the unpacked files do not match the pinned tree (digest {got}, expected {pin})"
                ));
            }
            if dest.exists() {
                std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
            }
            std::fs::rename(&staging, &dest).map_err(|e| e.to_string())
        }
        (other, None) => Err(format!("unknown extract mode {other}")),
        (other, Some(_)) => Err(format!(
            "{}: treeSha256 binds a tar.gz-strip1 tree, not {other}",
            item.id
        )),
    }
}

/// A reader that fails once more than `limit` bytes have passed through it
/// (by at most one buffer), so whatever parses the stream downstream can
/// never be fed an unbounded decompression.
struct LimitedReader<R> {
    inner: R,
    read: u64,
    limit: Option<u64>,
}

impl<R: Read> Read for LimitedReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.read += n as u64;
        match self.limit {
            Some(limit) if self.read > limit => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("decompressed archive exceeds the allowed {limit} bytes"),
            )),
            _ => Ok(n),
        }
    }
}

/// `<install path>.unpacking`, beside the install path so the final rename
/// stays on one volume.
fn staging_dir(dest: &Path) -> Result<PathBuf, String> {
    let name = dest
        .file_name()
        .ok_or_else(|| format!("bad install path {}", dest.display()))?
        .to_string_lossy();
    Ok(dest.with_file_name(format!("{name}.unpacking")))
}

/// Unpacks a `.tar.gz` into `dest`, dropping each entry's first path
/// component. `dest` must be a fresh, empty directory when `limits` is given.
///
/// With `limits` (a tree-bound archive: nothing has authenticated these
/// bytes yet) only regular files and directories are unpacked. Links are
/// refused outright: the tree digest covers regular files, so a symlink —
/// or a hard link to a file outside the tree — would pass it unseen, and
/// tar-rs's plain `unpack` resolves link targets against the working
/// directory, not `dest`. With no links ever created inside a fresh `dest`,
/// the component check below is also what keeps every entry inside it. The
/// entry and byte caps stop a decompression bomb before it fills the disk,
/// and `LimitedReader` bounds the decompressed stream itself, so a bomb in
/// an extended header — which tar-rs buffers before yielding anything —
/// cannot exhaust memory first.
fn unpack_tar_strip1(
    archive: &Path,
    dest: &Path,
    limits: Option<&UnpackLimits>,
) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let tar = LimitedReader {
        inner: flate2::read::GzDecoder::new(file),
        read: 0,
        limit: limits.map(UnpackLimits::max_stream_bytes),
    };
    let mut archive = tar::Archive::new(tar);
    let mut entries = 0u64;
    let mut bytes = 0u64;
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let stripped: PathBuf = path.components().skip(1).collect();
        if stripped.as_os_str().is_empty() {
            continue;
        }
        if stripped
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        {
            return Err(format!("refusing archive entry {}", path.display()));
        }
        if let Some(l) = limits {
            let kind = entry.header().entry_type();
            if !matches!(kind, tar::EntryType::Regular | tar::EntryType::Directory) {
                return Err(format!(
                    "refusing archive entry {} ({kind:?}): only files and directories may be unpacked before the tree is verified",
                    path.display()
                ));
            }
            entries += 1;
            bytes = bytes.saturating_add(entry.size());
            if entries > l.max_entries || bytes > l.max_bytes {
                return Err(format!(
                    "archive exceeds the unpack limits ({entries} entries, {bytes} bytes; at most {} and {})",
                    l.max_entries, l.max_bytes
                ));
            }
        }
        let out = dest.join(stripped);
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        entry.unpack(&out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Digest of the regular files under `root`: the sha256 of a `sha256sum`-
/// style listing — one `<sha256 hex>  <path>\n` line per file, paths
/// relative to `root` with `/` separators, sorted by their UTF-8 bytes.
/// Directories, symlinks, modes and timestamps are not part of it, so the
/// digest is the same whichever archive (or gzip) delivered the files; that
/// is what lets a GitHub source tarball be pinned by content rather than by
/// compressed bytes GitHub may regenerate. Mirrored by
/// scripts/tree-digest.mjs; the two must agree bit for bit.
pub fn tree_sha256(root: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut files = std::collections::BTreeMap::<String, String>::new();
    collect_files(root, root, &mut files)?;
    let mut hasher = Sha256::new();
    for (path, sha) in &files {
        hasher.update(format!("{sha}  {path}\n").as_bytes());
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn collect_files(
    root: &Path,
    dir: &Path,
    out: &mut std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        // DirEntry::metadata does not follow symlinks: a link is neither
        // descended into nor counted.
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if meta.is_dir() {
            collect_files(root, &path, out)?;
        } else if meta.is_file() {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .components()
                .map(|c| {
                    c.as_os_str()
                        .to_str()
                        .map(str::to_string)
                        .ok_or_else(|| format!("non-UTF-8 file name under {}", root.display()))
                })
                .collect::<Result<Vec<_>, _>>()?
                .join("/");
            out.insert(rel, file_sha256(&path)?);
        }
    }
    Ok(())
}

fn file_sha256(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub async fn components_extract(
    sup: tauri::State<'_, crate::supervisor::Supervisor>,
    id: String,
) -> Result<(), String> {
    let comp = sup.components_dir();
    let item = manifest::item(&id).ok_or_else(|| format!("unknown component: {id}"))?;
    tokio::task::spawn_blocking(move || extract_item(&comp, item))
        .await
        .map_err(|e| e.to_string())?
}

/// Drops every inherited variable that could steer Python, pip or uv away
/// from our private environment: a user's PYTHONPATH (ComfyUI would import
/// their torch), an active conda/venv, a global index URL or cache. Applied
/// to the uv install and to every python child the supervisor spawns.
pub fn scrub_inherited_env(cmd: &mut std::process::Command) {
    for (k, _) in std::env::vars_os() {
        let key = k.to_string_lossy().to_ascii_uppercase();
        if key.starts_with("UV_")
            || key.starts_with("PIP_")
            || matches!(
                key.as_str(),
                "PYTHONPATH"
                    | "PYTHONHOME"
                    | "PYTHONSTARTUP"
                    | "PYTHONUSERBASE"
                    | "VIRTUAL_ENV"
                    | "CONDA_PREFIX"
            )
        {
            cmd.env_remove(&k);
        }
    }
}

/// A uv invocation that cannot reach the network or read anyone's config:
/// the inherited environment is scrubbed, then the offline knobs are set
/// explicitly as well as passed as flags.
fn uv_command(comp: &Path) -> std::process::Command {
    let mut cmd = std::process::Command::new(comp.join("uv").join("uv.exe"));
    scrub_inherited_env(&mut cmd);
    cmd.env("UV_OFFLINE", "1")
        .env("UV_NO_CONFIG", "1")
        .env("UV_PYTHON_DOWNLOADS", "never")
        .env("UV_CACHE_DIR", comp.join("uv-cache"))
        .current_dir(comp);
    cmd
}

/// Creates the venv from the pinned interpreter and installs exactly the
/// manifest's wheels from the local wheelhouse — no index, no network, no
/// resolver, every file hash-checked again by uv (`--require-hashes`).
/// Long-running; output lines stream to `on_line`.
pub fn bootstrap_python(comp: &Path, on_line: &(dyn Fn(String) + Sync)) -> Result<(), String> {
    let m = manifest::manifest();
    let uv = comp.join("uv").join("uv.exe");
    let python = comp.join("python-dist").join("python.exe");
    if !uv.exists() {
        return Err("uv is not installed yet".into());
    }
    if !python.exists() {
        return Err("the Python runtime is not installed yet".into());
    }
    let wheelhouse = manifest::wheelhouse_dir(comp);
    for w in &m.python.wheels {
        if !wheelhouse.join(&w.filename).exists() {
            return Err(format!("wheel missing from the wheelhouse: {}", w.filename));
        }
    }

    // The interpreter must be the one the lock was resolved for. `-I`
    // isolates it from PYTHON* variables and user site-packages.
    let mut ver = std::process::Command::new(&python);
    ver.args([
        "-I",
        "-c",
        "import sys;print('%d.%d.%d'%sys.version_info[:3])",
    ]);
    let got = run_capture(ver)?;
    if got != m.python.version {
        return Err(format!(
            "python-dist is {got}, expected {}",
            m.python.version
        ));
    }

    let venv = comp.join("python-env");
    let venv_python = venv.join("Scripts").join("python.exe");
    if !venv_python.exists() {
        on_line("Creating the Python environment…".into());
        let mut cmd = uv_command(comp);
        cmd.arg("venv")
            .arg(&venv)
            .arg("--python")
            .arg(&python)
            .args(["--no-python-downloads", "--offline", "--no-config"]);
        run_logged(cmd, on_line)?;
    }

    let lock = wheelhouse.join("requirements.lock");
    std::fs::write(&lock, manifest::wheel_lock_text()).map_err(|e| e.to_string())?;

    on_line("Installing the sound engine (offline)…".into());
    let mut cmd = uv_command(comp);
    cmd.args(["pip", "sync"])
        .arg(&lock)
        .arg("--python")
        .arg(&venv_python)
        .args([
            "--offline",
            "--no-index",
            "--no-config",
            "--require-hashes",
            "--only-binary",
            ":all:",
        ])
        .arg("--find-links")
        .arg(&wheelhouse);
    run_logged(cmd, on_line)?;
    Ok(())
}

#[tauri::command]
pub async fn components_bootstrap_python(
    sup: tauri::State<'_, crate::supervisor::Supervisor>,
    on_line: Channel<String>,
) -> Result<(), String> {
    let comp = sup.components_dir();
    tokio::task::spawn_blocking(move || {
        let emit = |line: String| {
            let _ = on_line.send(line);
        };
        bootstrap_python(&comp, &emit)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn sha256_matches(path: &Path, sha256: &str, size: u64) -> Result<bool, String> {
    let Ok(meta) = path.metadata() else {
        return Ok(false);
    };
    if meta.len() != size {
        return Ok(false);
    }
    Ok(file_sha256(path)?.eq_ignore_ascii_case(sha256))
}

/// Re-hashes an installed manifest item against its pinned sha256 ("Verify
/// installation"). Only items that are installed as-is (models) can be
/// checked this way; archives are extracted and their staging copies gone.
/// Local only — no network.
#[tauri::command]
pub async fn components_verify(
    sup: tauri::State<'_, crate::supervisor::Supervisor>,
    id: String,
) -> Result<bool, String> {
    let comp = sup.components_dir();
    let item = manifest::item(&id).ok_or_else(|| format!("unknown component: {id}"))?;
    let (Some(sha256), None) = (&item.sha256, &item.extract) else {
        return Err(format!(
            "{id} is an archive and cannot be re-verified after extraction"
        ));
    };
    tokio::task::spawn_blocking(move || {
        sha256_matches(&item.install_dest(&comp), sha256, item.size)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Free space (bytes) on the volume that holds (or will hold) `path` — the
/// first-run location step's preflight.
#[tauri::command]
pub fn components_free_space(path: String) -> Option<u64> {
    crate::downloads::free_space_at(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicBool;

    /// scripts/fixtures/tree-digest.tar.gz: a GitHub-style pax tarball (one
    /// top-level folder, a path long enough to need a pax header, an empty
    /// file, a binary file, an empty directory, entries out of order). Its
    /// digest was computed independently in Python; scripts/tree-digest
    /// .test.mjs pins the Node mirror to the same value.
    const FIXTURE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../scripts/fixtures/tree-digest.tar.gz"
    );
    const FIXTURE_TREE_SHA256: &str =
        "11a39931c8ab65935ffbd1327f7c4ae1e6d24d13b01d50e8dee71e99786a26b0";

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("stillsong-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The fixture, re-gzipped at another level: different bytes, same tree.
    fn recompressed_fixture() -> Vec<u8> {
        use std::io::Write;
        let mut tar = Vec::new();
        flate2::read::GzDecoder::new(std::fs::File::open(FIXTURE).unwrap())
            .read_to_end(&mut tar)
            .unwrap();
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        enc.write_all(&tar).unwrap();
        enc.finish().unwrap()
    }

    fn tree_bound_item(comp: &Path, gz: &[u8], pin: &str) -> Item {
        let item = Item {
            id: "tree".into(),
            kind: "runtime".into(),
            url: "https://github.com/x/y/archive/abc.tar.gz".into(),
            size: gz.len() as u64,
            sha256: None,
            tree_sha256: Some(pin.into()),
            install_path: "tree".into(),
            extract: Some("tar.gz-strip1".into()),
        };
        let archive = item.download_dest(comp);
        std::fs::create_dir_all(archive.parent().unwrap()).unwrap();
        std::fs::write(&archive, gz).unwrap();
        item
    }

    /// A small tar.gz built in memory by `build`, for the refusal tests.
    fn tar_gz(build: impl FnOnce(&mut tar::Builder<flate2::write::GzEncoder<Vec<u8>>>)) -> Vec<u8> {
        let enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        let mut b = tar::Builder::new(enc);
        build(&mut b);
        b.into_inner().unwrap().finish().unwrap()
    }

    fn append_file(b: &mut tar::Builder<impl std::io::Write>, path: &str, data: &[u8]) {
        let mut h = tar::Header::new_gnu();
        h.set_mode(0o644);
        h.set_size(data.len() as u64);
        b.append_data(&mut h, path, data).unwrap();
    }

    #[test]
    fn tree_digest_matches_the_reference_fixture() {
        let dir = scratch("tree-ref");
        unpack_tar_strip1(Path::new(FIXTURE), &dir, None).unwrap();
        assert!(dir.join("pkg").join("__init__.py").exists());
        assert_eq!(tree_sha256(&dir).unwrap(), FIXTURE_TREE_SHA256);
        // An extra file changes it; an empty directory does not.
        std::fs::create_dir_all(dir.join("another-empty")).unwrap();
        assert_eq!(tree_sha256(&dir).unwrap(), FIXTURE_TREE_SHA256);
        std::fs::write(dir.join("extra.txt"), b"x").unwrap();
        assert_ne!(tree_sha256(&dir).unwrap(), FIXTURE_TREE_SHA256);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The scenario the pin exists for: GitHub regenerates the tarball with
    /// other compression settings. The bytes differ, extraction still
    /// verifies and lands the tree; a re-run replaces it cleanly.
    #[test]
    fn tree_bound_extract_accepts_recompressed_bytes() {
        let comp = scratch("tree-ok");
        let original = std::fs::read(FIXTURE).unwrap();
        let gz = recompressed_fixture();
        assert_ne!(gz, original, "recompression must change the bytes");
        let item = tree_bound_item(&comp, &gz, FIXTURE_TREE_SHA256);
        extract_item(&comp, &item).unwrap();
        let dest = item.install_dest(&comp);
        assert_eq!(tree_sha256(&dest).unwrap(), FIXTURE_TREE_SHA256);
        assert!(!staging_dir(&dest).unwrap().exists());
        // Idempotent: a second extraction over the existing tree succeeds.
        std::fs::write(dest.join("stale.pyc"), b"old").unwrap();
        extract_item(&comp, &item).unwrap();
        assert!(!dest.join("stale.pyc").exists());
        assert_eq!(tree_sha256(&dest).unwrap(), FIXTURE_TREE_SHA256);
        let _ = std::fs::remove_dir_all(&comp);
    }

    #[test]
    fn tree_bound_extract_refuses_a_different_tree() {
        let comp = scratch("tree-bad");
        let gz = std::fs::read(FIXTURE).unwrap();
        let item = tree_bound_item(&comp, &gz, &"0".repeat(64));
        let err = extract_item(&comp, &item).unwrap_err();
        assert!(err.contains("do not match the pinned tree"), "{err}");
        assert_rejected(&comp, &item);
        let _ = std::fs::remove_dir_all(&comp);
    }

    /// Nothing at the install path, no staging left behind, and the archive
    /// itself gone so the next download attempt fetches it afresh (the
    /// downloader accepts an existing file as complete).
    fn assert_rejected(comp: &Path, item: &Item) {
        let dest = item.install_dest(comp);
        assert!(!dest.exists(), "nothing may land at the install path");
        assert!(
            !staging_dir(&dest).unwrap().exists(),
            "staging is cleaned up"
        );
        assert!(
            !item.download_dest(comp).exists(),
            "a rejected archive must not stay cached"
        );
    }

    /// Links are not part of the digest, so an archive carrying one could
    /// verify while planting a symlink anywhere; it is refused before any
    /// link is created, and the archive is discarded.
    #[test]
    fn tree_bound_extract_refuses_links() {
        let comp = scratch("tree-link");
        let gz = tar_gz(|b| {
            append_file(b, "top/ok.txt", b"hello\n");
            let mut h = tar::Header::new_gnu();
            h.set_entry_type(tar::EntryType::Symlink);
            h.set_mode(0o777);
            h.set_size(0);
            b.append_link(&mut h, "top/escape", "C:/Windows/win.ini")
                .unwrap();
        });
        let item = tree_bound_item(&comp, &gz, &"0".repeat(64));
        let err = extract_item(&comp, &item).unwrap_err();
        assert!(err.contains("only files and directories"), "{err}");
        assert_rejected(&comp, &item);

        let comp2 = scratch("tree-hardlink");
        let gz = tar_gz(|b| {
            append_file(b, "top/ok.txt", b"hello\n");
            let mut h = tar::Header::new_gnu();
            h.set_entry_type(tar::EntryType::Link);
            h.set_mode(0o644);
            h.set_size(0);
            b.append_link(&mut h, "top/alias.txt", "../../outside.txt")
                .unwrap();
        });
        let item = tree_bound_item(&comp2, &gz, &"0".repeat(64));
        let err = extract_item(&comp2, &item).unwrap_err();
        assert!(err.contains("only files and directories"), "{err}");
        assert_rejected(&comp2, &item);
        let _ = std::fs::remove_dir_all(&comp);
        let _ = std::fs::remove_dir_all(&comp2);
    }

    /// A bomb hidden in metadata: tar-rs reads a GNU long-name (or pax)
    /// entry fully into memory before yielding the entry it names, so the
    /// per-entry caps never see it. The stream bound does.
    #[test]
    fn tree_bound_unpack_bounds_the_decompressed_stream() {
        let dir = scratch("tree-stream");
        let n = 4u64 << 20;
        let gz = tar_gz(|b| {
            let mut h = tar::Header::new_gnu();
            h.set_entry_type(tar::EntryType::GNULongName);
            h.set_path("././@LongLink").unwrap();
            h.set_size(n);
            h.set_cksum();
            b.append(&h, std::io::repeat(0).take(n)).unwrap();
            append_file(b, "top/ok.txt", b"hello\n");
        });
        let archive = dir.join("bomb.tar.gz");
        std::fs::write(&archive, &gz).unwrap();
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let limits = UnpackLimits {
            max_bytes: 1 << 20,
            max_entries: 8,
        };
        assert!(limits.max_stream_bytes() < n);
        let err = unpack_tar_strip1(&archive, &out, Some(&limits)).unwrap_err();
        assert!(err.contains("decompressed archive exceeds"), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The same one-byte corruption scripts/tree-digest.test.mjs applies to
    /// the fixture: tar-rs rejects the header checksum, and so must the Node
    /// mirror, or the disc build could package what setup refuses.
    #[test]
    fn tree_bound_extract_rejects_a_bad_header_checksum() {
        use std::io::Write;
        let comp = scratch("tree-cksum");
        let mut tar = Vec::new();
        flate2::read::GzDecoder::new(std::fs::File::open(FIXTURE).unwrap())
            .read_to_end(&mut tar)
            .unwrap();
        tar[0] ^= 0xff;
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        enc.write_all(&tar).unwrap();
        let gz = enc.finish().unwrap();
        let item = tree_bound_item(&comp, &gz, FIXTURE_TREE_SHA256);
        let err = extract_item(&comp, &item).unwrap_err();
        assert!(err.contains("checksum mismatch"), "{err}");
        assert_rejected(&comp, &item);
        let _ = std::fs::remove_dir_all(&comp);
    }

    /// A decompression bomb is cut off by the byte cap (nominal size ×
    /// TREE_BOUND_UNPACK_SLACK) before the oversized entry is written.
    #[test]
    fn tree_bound_extract_refuses_a_bomb() {
        let comp = scratch("tree-bomb");
        let zeros = vec![0u8; 4 << 20];
        let gz = tar_gz(|b| {
            append_file(b, "top/ok.txt", b"hello\n");
            append_file(b, "top/zeros.bin", &zeros);
        });
        assert!(
            (gz.len() as u64) * manifest::TREE_BOUND_UNPACK_SLACK < zeros.len() as u64,
            "the test needs the zeros to compress past the cap"
        );
        let item = tree_bound_item(&comp, &gz, &"0".repeat(64));
        let err = extract_item(&comp, &item).unwrap_err();
        assert!(err.contains("exceeds the unpack limits"), "{err}");
        assert_rejected(&comp, &item);
        let _ = std::fs::remove_dir_all(&comp);
    }

    #[test]
    fn scrub_removes_python_steering_vars() {
        // Only vars present in this process are removable; plant a few.
        std::env::set_var("PYTHONPATH", r"C:\theirs\site-packages");
        std::env::set_var("UV_INDEX_URL", "https://evil.example/simple");
        std::env::set_var("PIP_INDEX_URL", "https://evil.example/simple");
        std::env::set_var("CONDA_PREFIX", r"C:\conda");
        let mut cmd = std::process::Command::new("x");
        scrub_inherited_env(&mut cmd);
        let removed: Vec<String> = cmd
            .get_envs()
            .filter(|(_, v)| v.is_none())
            .map(|(k, _)| k.to_string_lossy().to_ascii_uppercase())
            .collect();
        for k in [
            "PYTHONPATH",
            "UV_INDEX_URL",
            "PIP_INDEX_URL",
            "CONDA_PREFIX",
        ] {
            assert!(
                removed.contains(&k.to_string()),
                "{k} not removed: {removed:?}"
            );
        }
        assert!(!removed.contains(&"PATH".to_string()));
        for k in [
            "PYTHONPATH",
            "UV_INDEX_URL",
            "PIP_INDEX_URL",
            "CONDA_PREFIX",
        ] {
            std::env::remove_var(k);
        }
    }

    /// The complete first run, headless, through the production code paths:
    /// every manifest artifact is fetched (resume + hash), archives are
    /// extracted, the Python environment is synced offline, and the result
    /// imports torch with CUDA. Needs the network and ~40 GB; runs only when
    /// STILLSONG_E2E_COMPONENTS names the target dir. With
    /// STILLSONG_E2E_SKIP_MODELS=1 the model files are skipped (the runtime
    /// legs alone, ~4.6 GB).
    #[tokio::test]
    async fn first_run_headless() {
        let Ok(dir) = std::env::var("STILLSONG_E2E_COMPONENTS") else {
            return;
        };
        let comp = PathBuf::from(dir);
        let skip_models = std::env::var("STILLSONG_E2E_SKIP_MODELS").is_ok();
        let m = manifest::manifest();
        let best = std::sync::Mutex::new(std::collections::HashMap::new());
        let cancel = AtomicBool::new(false);
        let mut ids: Vec<String> = m
            .items
            .iter()
            .filter(|i| !(skip_models && i.kind == "model"))
            .map(|i| i.id.clone())
            .collect();
        ids.extend(m.python.wheels.iter().map(|w| w.filename.clone()));
        for id in &ids {
            let art = manifest::artifact(&comp, id).unwrap();
            eprintln!("fetch {id} ({} MB)", art.size / 1_000_000);
            crate::downloads::fetch(&art, &cancel, &|_, _| {}, &best)
                .await
                .unwrap_or_else(|e| panic!("{id}: {e}"));
        }
        for item in m.items.iter().filter(|i| i.extract.is_some()) {
            eprintln!("extract {}", item.id);
            extract_item(&comp, item).unwrap();
        }
        bootstrap_python(&comp, &|l| eprintln!("  {l}")).unwrap();

        let mut probe =
            std::process::Command::new(comp.join("python-env").join("Scripts").join("python.exe"));
        probe.args(["-I", "-c", "import torch, torchaudio; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"]);
        let out = run_capture(probe).unwrap();
        eprintln!("torch: {out}");
        assert!(out.contains("+cu130"), "{out}");

        // Idempotent: a second bootstrap is a no-op that still succeeds.
        bootstrap_python(&comp, &|_| {}).unwrap();
    }
}
