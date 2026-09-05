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

use crate::manifest::{self, Item};
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
pub fn extract_item(comp: &Path, item: &Item) -> Result<(), String> {
    let mode = item
        .extract
        .as_deref()
        .ok_or_else(|| format!("{} is not an archive", item.id))?;
    let archive = item.download_dest(comp);
    let dest = item.install_dest(comp);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    match mode {
        "zip" => {
            let file = std::fs::File::open(&archive).map_err(|e| e.to_string())?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
            // ZipArchive::extract sanitises names (enclosed_name) itself.
            zip.extract(&dest).map_err(|e| e.to_string())
        }
        "tar.gz-strip1" => {
            let file = std::fs::File::open(&archive).map_err(|e| e.to_string())?;
            let tar = flate2::read::GzDecoder::new(file);
            let mut archive = tar::Archive::new(tar);
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
                let out = dest.join(stripped);
                if let Some(parent) = out.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                entry.unpack(&out).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        other => Err(format!("unknown extract mode {other}")),
    }
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
    use sha2::{Digest, Sha256};
    let Ok(meta) = path.metadata() else {
        return Ok(false);
    };
    if meta.len() != size {
        return Ok(false);
    }
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
    Ok(format!("{:x}", hasher.finalize()).eq_ignore_ascii_case(sha256))
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
    if item.extract.is_some() {
        return Err(format!(
            "{id} is an archive and cannot be re-verified after extraction"
        ));
    }
    tokio::task::spawn_blocking(move || {
        sha256_matches(&item.install_dest(&comp), &item.sha256, item.size)
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
