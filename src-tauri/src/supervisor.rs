// Runtime supervisor: owns the ComfyUI and llama-server child processes, their
// dynamic ports, their logs, and the kernel-level guarantee that they die with
// the app (a Job Object with KILL_ON_JOB_CLOSE — Tauri does not clean up child
// process trees itself, and `child.kill()` misses grandchildren like the
// python launcher -> worker tree).
//
// Dev mode: STILLSONG_COMFY_URL / STILLSONG_LLM_URL point a service at an
// externally managed instance instead of spawning one (the reference dev
// workflow); STILLSONG_COMPONENTS overrides the components dir.

use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const PORT_RANGE: std::ops::Range<u16> = 17800..17900;
const LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;
const LOG_KEEP: u32 = 5;

/// Process liveness only: not spawned / child alive / child exited
/// unexpectedly. Readiness (ComfyUI answering, llama-server past its 503
/// model-load window) is the engine's own health probe, not reported here.
#[derive(serde::Serialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ServiceState {
    Stopped,
    Running,
    Error,
}

/// What the components dir holds, relative to the manifest compiled into
/// this binary. `.install-complete` carries the manifest version the install
/// was built from (older builds wrote "ok"); `.update-pending` marks an
/// update that has started replacing the runtime and not yet finished. The
/// app never compares against anything remote — a new manifest only ever
/// arrives inside a new build the user installed.
#[derive(serde::Serialize, Clone, PartialEq, Debug)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum InstallState {
    NotInstalled,
    #[serde(rename_all = "camelCase")]
    NeedsUpdate {
        installed_version: Option<String>,
    },
    /// `prepared` once the old runtime has been fully cleared; before that a
    /// resumed update must run the preparation again (a half-deleted
    /// `python-env` would otherwise be reused by the bootstrap).
    Updating {
        prepared: bool,
    },
    Ready {
        version: String,
    },
}

const INSTALL_MARKER: &str = ".install-complete";
const UPDATE_PENDING_MARKER: &str = ".update-pending";
const PENDING_PREPARING: &str = "preparing";
const PENDING_PREPARED: &str = "prepared";
const UPDATE_NEEDED: &str = "The studio needs an update before it can start.";
const UPDATE_IN_PROGRESS: &str = "The studio is being updated.";

/// Pure classification of a components dir against the manifest version
/// `current`. A legacy "ok" marker (or anything unreadable) is an install of
/// unknown vintage and therefore needs the update; SQLite's copy of the
/// version is deliberately not consulted — a build that forgot to bump the
/// manifest version would have recorded "current" there and been wrong.
pub fn install_state_in(dir: &Path, current: &str) -> InstallState {
    if let Ok(pending) = std::fs::read_to_string(dir.join(UPDATE_PENDING_MARKER)) {
        // Prepared only for *this* manifest: an update interrupted after its
        // preparation and then overtaken by another build has already
        // extracted that build's runtime, which must be cleared again.
        let mut lines = pending.lines().map(str::trim);
        let phase = lines.next();
        let for_version = lines.next();
        return InstallState::Updating {
            prepared: phase == Some(PENDING_PREPARED) && for_version == Some(current),
        };
    }
    let Ok(bytes) = std::fs::read(dir.join(INSTALL_MARKER)) else {
        return InstallState::NotInstalled;
    };
    let text = String::from_utf8_lossy(&bytes);
    let text = text.trim_start_matches('\u{feff}').trim();
    if text == current {
        return InstallState::Ready {
            version: current.to_string(),
        };
    }
    let looks_like_version =
        !text.is_empty() && text != "ok" && text.chars().all(|c| c.is_ascii_graphic());
    InstallState::NeedsUpdate {
        installed_version: looks_like_version.then(|| text.to_string()),
    }
}

/// Writes the versioned install marker and clears any pending-update marker.
pub fn write_marker(dir: &Path, version: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(INSTALL_MARKER), format!("{version}\n")).map_err(|e| e.to_string())?;
    remove_file_ok(&dir.join(UPDATE_PENDING_MARKER))
}

fn remove_file_ok(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// `remove_dir_all` that rides out the deferred handle closes and antivirus
/// scans that make a just-stopped process's tree briefly undeletable on
/// Windows. Missing is success.
fn remove_dir_all_retry(path: &Path) -> Result<(), String> {
    let mut last: Option<std::io::Error> = None;
    for attempt in 0..8 {
        match std::fs::remove_dir_all(path) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => {
                // 5 access denied, 32 sharing violation, 145 dir not empty
                let transient = e.kind() == std::io::ErrorKind::PermissionDenied
                    || matches!(e.raw_os_error(), Some(5 | 32 | 145));
                last = Some(e);
                if !transient {
                    break;
                }
                if attempt < 7 {
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
        }
    }
    let detail = last.map(|e| e.to_string()).unwrap_or_default();
    Err(format!(
        "A file in the studio folder is still in use. Close other programs and try again. ({}: {detail})",
        path.display()
    ))
}

/// Runtime directories an update replaces. Everything else under the
/// components dir — the models, `comfy-data/` (user output, the overlay
/// mirror) — is kept.
const RUNTIME_DIRS: [&str; 7] = [
    "python-env",
    "uv-cache",
    "ComfyUI",
    "ComfyUI.unpacking",
    "llama",
    "python-dist",
    "uv",
];

/// The filesystem half of an update, with the manifest tables injected:
/// `keep` maps each current-manifest download destination to the sizes
/// `fetch` would accept it at — exact for a byte-pinned file, up to the
/// tree-bound slack for ComfyUI's archive, whose manifest size is nominal
/// (anything else under `_downloads` is a leftover of another version and
/// must not be mistaken for a complete download by `fetch`'s existing-file
/// fast path — uv's zip name carries no version); `models` lists each model
/// file with its pinned size, a mismatch meaning the pin moved.
pub fn prepare_update_in_with(
    dir: &Path,
    version: &str,
    keep: &std::collections::HashMap<PathBuf, std::ops::RangeInclusive<u64>>,
    models: &[(PathBuf, u64)],
    on_line: &dyn Fn(String),
) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // Pending ("preparing") first, then the install marker: a crash anywhere
    // after this line boots into the update screen, never into a
    // half-replaced studio, and a resume repeats the preparation until the
    // marker says "prepared".
    std::fs::write(
        dir.join(UPDATE_PENDING_MARKER),
        format!("{PENDING_PREPARING}\n{version}\n"),
    )
    .map_err(|e| e.to_string())?;
    remove_file_ok(&dir.join(INSTALL_MARKER))?;
    for name in RUNTIME_DIRS {
        let path = dir.join(name);
        if path.exists() {
            on_line(format!("Removing {name}"));
            remove_dir_all_retry(&path)?;
        }
    }
    let downloads = crate::manifest::downloads_dir(dir);
    if downloads.is_dir() {
        let mut stack = vec![downloads];
        while let Some(d) = stack.pop() {
            let entries = std::fs::read_dir(&d).map_err(|e| e.to_string())?;
            for entry in entries {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                let size = entry.metadata().map(|m| m.len()).unwrap_or(u64::MAX);
                if !keep.get(&path).is_some_and(|ok| ok.contains(&size)) {
                    on_line(format!(
                        "Removing a leftover download: {}",
                        path.file_name().unwrap_or_default().to_string_lossy()
                    ));
                    remove_file_ok(&path)?;
                }
            }
        }
    }
    for (path, size) in models {
        if let Ok(md) = path.metadata() {
            if md.len() != *size {
                on_line(format!(
                    "A large piece changed and will be fetched again: {}",
                    path.file_name().unwrap_or_default().to_string_lossy()
                ));
                remove_file_ok(path)?;
            }
        }
    }
    std::fs::write(
        dir.join(UPDATE_PENDING_MARKER),
        format!("{PENDING_PREPARED}\n{version}\n"),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// `prepare_update_in_with` driven by the compiled-in manifest.
pub fn prepare_update_in(dir: &Path, on_line: &dyn Fn(String)) -> Result<(), String> {
    let m = crate::manifest::manifest();
    let mut keep = std::collections::HashMap::new();
    for item in &m.items {
        if item.extract.is_some() {
            let accepted = if item.tree_sha256.is_some() {
                1..=item
                    .size
                    .saturating_mul(crate::manifest::TREE_BOUND_SIZE_SLACK)
            } else {
                item.size..=item.size
            };
            keep.insert(item.download_dest(dir), accepted);
        }
    }
    for w in &m.python.wheels {
        keep.insert(
            crate::manifest::wheelhouse_dir(dir).join(&w.filename),
            w.size..=w.size,
        );
    }
    let models: Vec<(PathBuf, u64)> = m
        .items
        .iter()
        .filter(|i| i.extract.is_none())
        .map(|i| (i.install_dest(dir), i.size))
        .collect();
    prepare_update_in_with(dir, &m.manifest_version, &keep, &models, on_line)
}

struct Proc {
    child: Child,
    port: u16,
}

#[derive(Default)]
struct Inner {
    comfy: Option<Proc>,
    llm: Option<Proc>,
    comfy_restarted: bool,
    // Ports are reserved once per session so client base URLs stay valid
    // across stop/start cycles and a ComfyUI crash-restart.
    comfy_port: Option<u16>,
    llm_port: Option<u16>,
}

impl Inner {
    fn reserve_port(slot: &mut Option<u16>, taken: Option<u16>) -> Result<u16, String> {
        if let Some(p) = *slot {
            return Ok(p);
        }
        let p = pick_free_port(taken)?;
        *slot = Some(p);
        Ok(p)
    }
}

pub struct Supervisor {
    inner: Mutex<Inner>,
    // Held for the app's lifetime; closing it (incl. on crash) kills every
    // assigned process tree.
    job: win32job::Job,
    // First-run may move this to another drive; persisted to
    // <appdata>/components-dir.txt so both the next launch and the
    // uninstaller find it.
    components_dir: std::sync::Mutex<PathBuf>,
    app_data_dir: PathBuf,
    log_dir: PathBuf,
    external_comfy: Option<String>,
    external_llm: Option<String>,
    // Bundled ComfyUI-Stillsong custom-node package (app resources), mirrored
    // into comfy-data/custom_nodes before each spawn. None = ship without it
    // (the engine probes the node and degrades to stock behavior).
    overlay_dir: Option<PathBuf>,
    // Set while prepare_update is tearing the runtime down. A spawn that
    // slips in between stop_all and the deletions (ensure_comfy registers
    // its child only after spawning) would otherwise hold the files open.
    updating: AtomicBool,
}

impl Supervisor {
    pub fn new(app_data_dir: PathBuf, overlay_dir: Option<PathBuf>) -> Result<Self, String> {
        let job = win32job::Job::create().map_err(|e| e.to_string())?;
        let mut info = job.query_extended_limit_info().map_err(|e| e.to_string())?;
        info.limit_kill_on_job_close();
        job.set_extended_limit_info(&info)
            .map_err(|e| e.to_string())?;

        let components_dir = std::env::var("STILLSONG_COMPONENTS")
            .map(PathBuf::from)
            .ok()
            .or_else(|| {
                std::fs::read_to_string(app_data_dir.join("components-dir.txt"))
                    .ok()
                    .map(|s| PathBuf::from(s.trim()))
            })
            .unwrap_or_else(default_components_dir);
        let log_dir = app_data_dir.join("logs");
        std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
        Ok(Self {
            inner: Mutex::new(Inner::default()),
            job,
            components_dir: std::sync::Mutex::new(components_dir),
            app_data_dir,
            log_dir,
            external_comfy: std::env::var("STILLSONG_COMFY_URL").ok(),
            external_llm: std::env::var("STILLSONG_LLM_URL").ok(),
            overlay_dir,
            updating: AtomicBool::new(false),
        })
    }

    /// Installed components versus this binary's manifest. An external dev
    /// ComfyUI is always "ready": nothing here manages it.
    pub fn install_state(&self) -> InstallState {
        let current = crate::manifest::manifest().manifest_version.as_str();
        if self.external_comfy.is_some() {
            return InstallState::Ready {
                version: current.to_string(),
            };
        }
        install_state_in(&self.components_dir(), current)
    }

    /// The spawn gate: a studio this binary did not install is never started
    /// (its ComfyUI may not know our flags, and the bundled overlay refuses
    /// a base it was not derived from — silently, from the UI's point of view).
    fn refuse_spawn_if_stale(&self) -> Result<(), String> {
        if self.updating.load(Ordering::SeqCst) {
            return Err(UPDATE_IN_PROGRESS.into());
        }
        if matches!(self.install_state(), InstallState::NeedsUpdate { .. }) {
            return Err(UPDATE_NEEDED.into());
        }
        Ok(())
    }

    /// Stops both children and clears the runtime directories so the regular
    /// setup install can rebuild them in place. Models, `comfy-data/` and the
    /// library are untouched; current-manifest files already in `_downloads`
    /// (a newer disc's seed, or a resumed update) are kept so the re-install
    /// fetches only what is missing.
    pub async fn prepare_update(
        &self,
        on_line: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<(), String> {
        if self.external_comfy.is_some() {
            return Err("The studio is managed outside the app in this session.".into());
        }
        self.updating.store(true, Ordering::SeqCst);
        let result = self.prepare_update_inner(on_line).await;
        self.updating.store(false, Ordering::SeqCst);
        result
    }

    async fn prepare_update_inner(
        &self,
        on_line: Arc<dyn Fn(String) + Send + Sync>,
    ) -> Result<(), String> {
        on_line("Closing the studio".into());
        self.stop_all().await;
        self.inner.lock().await.comfy_restarted = false;
        // kill() reaches the venv launcher only; the interpreter it runs is a
        // grandchild that still maps the DLLs under python-env. Every member
        // of the Job Object must be gone before anything is deleted.
        self.terminate_job_members();
        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        loop {
            let left = self
                .job
                .query_process_id_list()
                .map(|p| p.len())
                .unwrap_or(0);
            if left == 0 {
                break;
            }
            if std::time::Instant::now() > deadline {
                return Err(
                    "The studio is still shutting down. Wait a moment and try again.".into(),
                );
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let dir = self.components_dir();
        tokio::task::spawn_blocking(move || prepare_update_in(&dir, &|l| on_line(l)))
            .await
            .map_err(|e| e.to_string())?
    }

    /// Force-terminates every process still in the Job Object (grandchildren
    /// included). Best effort; the poll after it is what matters.
    fn terminate_job_members(&self) {
        let Ok(pids) = self.job.query_process_id_list() else {
            return;
        };
        if pids.is_empty() {
            return;
        }
        let mut cmd = Command::new("taskkill");
        cmd.arg("/F");
        for pid in pids {
            cmd.args(["/PID", &pid.to_string()]);
        }
        let _ = cmd
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }

    pub fn components_dir(&self) -> PathBuf {
        self.components_dir.lock().unwrap().clone()
    }

    pub fn set_components_dir(&self, dir: PathBuf) -> Result<(), String> {
        std::fs::create_dir_all(&self.app_data_dir).map_err(|e| e.to_string())?;
        std::fs::write(
            self.app_data_dir.join("components-dir.txt"),
            dir.to_string_lossy().as_bytes(),
        )
        .map_err(|e| e.to_string())?;
        write_components_dir_registry(&dir);
        *self.components_dir.lock().unwrap() = dir;
        Ok(())
    }

    fn log_file(&self, name: &str) -> Result<std::fs::File, String> {
        let path = self.log_dir.join(format!("{name}.log"));
        rotate_log(&path);
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| e.to_string())
    }

    fn assign_to_job(&self, child: &Child) -> Result<(), String> {
        self.job
            .assign_process(child.as_raw_handle() as isize)
            .map_err(|e| e.to_string())
    }

    /// Spawns llama-server if it isn't running (no-op with an external LLM).
    pub async fn start_llm(&self) -> Result<(), String> {
        if self.external_llm.is_some() {
            return Ok(());
        }
        self.refuse_spawn_if_stale()?;
        let mut inner = self.inner.lock().await;
        if let Some(p) = inner.llm.as_mut() {
            if p.child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Ok(()); // already running
            }
            inner.llm = None;
        }
        let comp = self.components_dir();
        let exe = comp.join("llama").join("llama-server.exe");
        let model = comp.join("models").join("gemma-4-12B-it-Q4_0.gguf");
        let mmproj = comp.join("models").join("mmproj-gemma-4-12B-it-Q8_0.gguf");
        if !exe.exists() || !model.exists() {
            return Err("The songwriter runtime is not installed.".into());
        }
        let taken = inner.comfy_port;
        let port = Inner::reserve_port(&mut inner.llm_port, taken)?;
        let log = self.log_file("llama-server")?;
        let log_err = log.try_clone().map_err(|e| e.to_string())?;
        let mut cmd = Command::new(&exe);
        cmd.args([
            "-m",
            &model.to_string_lossy(),
            "--mmproj",
            &mmproj.to_string_lossy(),
            "-c",
            "16384",
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "-ngl",
            "99",
            "--no-webui",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .creation_flags(CREATE_NO_WINDOW);
        crate::components::scrub_inherited_env(&mut cmd);
        let child = cmd
            .spawn()
            .map_err(|e| format!("could not start llama-server: {e}"))?;
        self.assign_to_job(&child)?;
        inner.llm = Some(Proc { child, port });
        Ok(())
    }

    /// Stops llama-server and resolves only once the process has exited —
    /// that exit is the VRAM arbiter's guarantee that the GPU is clear.
    pub async fn stop_llm(&self) -> Result<(), String> {
        if self.external_llm.is_some() {
            return Ok(());
        }
        let proc = { self.inner.lock().await.llm.take() };
        if let Some(mut p) = proc {
            let _ = p.child.kill();
            let _ = tokio::task::spawn_blocking(move || p.child.wait()).await;
        }
        Ok(())
    }

    /// Spawns headless ComfyUI if it isn't running (no-op with an external
    /// instance). Waits until it answers /system_stats and verifies our child
    /// owns the port, so we never attach to a stranger's ComfyUI.
    pub async fn ensure_comfy(&self) -> Result<String, String> {
        if let Some(url) = &self.external_comfy {
            return Ok(url.clone());
        }
        self.refuse_spawn_if_stale()?;
        {
            let mut inner = self.inner.lock().await;
            if let Some(p) = inner.comfy.as_mut() {
                if p.child.try_wait().map_err(|e| e.to_string())?.is_none() {
                    return Ok(format!("http://127.0.0.1:{}", p.port));
                }
                // Unexpected exit: restart once per app session.
                let port = p.port;
                inner.comfy = None;
                if inner.comfy_restarted {
                    return Err("The studio stopped and could not be restarted.".into());
                }
                inner.comfy_restarted = true;
                drop(inner);
                let _ = port;
                return self.spawn_comfy_and_wait().await;
            }
        }
        self.spawn_comfy_and_wait().await
    }

    async fn spawn_comfy_and_wait(&self) -> Result<String, String> {
        let comp = self.components_dir();
        let python = comp.join("python-env").join("Scripts").join("python.exe");
        let main_py = comp.join("ComfyUI").join("main.py");
        if !python.exists() || !main_py.exists() {
            return Err("The studio runtime is not installed.".into());
        }
        let port = {
            let mut inner = self.inner.lock().await;
            let taken = inner.llm_port;
            Inner::reserve_port(&mut inner.comfy_port, taken)?
        };
        // Models, inputs and outputs live under the components dir so big
        // files follow the user's chosen drive and uninstall wipes them.
        // ComfyUI's prestartup os.listdir()s custom_nodes (and assumes the
        // other standard folders) without creating them, so a fresh
        // --base-directory must be seeded or main.py dies before serving.
        let comfy_data = comp.join("comfy-data");
        for sub in ["custom_nodes", "models", "input", "output", "temp", "user"] {
            std::fs::create_dir_all(comfy_data.join(sub)).map_err(|e| e.to_string())?;
        }
        // Keep the vendored overlay in sync with this app version. Best-effort:
        // a failed copy means the engine sees a stock ComfyUI and degrades.
        if let Some(src) = &self.overlay_dir {
            if src.is_dir() {
                let dest = comfy_data.join("custom_nodes").join("ComfyUI-Stillsong");
                if let Err(e) = copy_dir_replace(src, &dest) {
                    eprintln!("stillsong: overlay install failed: {e}");
                }
            }
        }
        let log = self.log_file("comfyui")?;
        let log_err = log.try_clone().map_err(|e| e.to_string())?;
        let mut args = vec![
            "-s".into(),
            main_py.to_string_lossy().into_owned(),
            "--port".into(),
            port.to_string(),
            "--base-directory".into(),
            comfy_data.to_string_lossy().into_owned(),
            "--offline".into(),
        ];
        // Dev-only Patient-tier emulation (docs/PATIENT-TIER-MEASUREMENT.md):
        // hold N GB back from ComfyUI's memory budget. Never set in production.
        if let Some(gb) = std::env::var("STILLSONG_RESERVE_VRAM")
            .ok()
            .and_then(|v| v.trim().parse::<f64>().ok())
        {
            args.push("--reserve-vram".into());
            args.push(gb.to_string());
        }
        let mut cmd = Command::new(&python);
        cmd.args(&args)
            .current_dir(&comp)
            .env("HF_HUB_OFFLINE", "1")
            .env("DO_NOT_TRACK", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::from(log))
            .stderr(Stdio::from(log_err))
            .creation_flags(CREATE_NO_WINDOW);
        // The venv python must see none of the user's own Python setup.
        crate::components::scrub_inherited_env(&mut cmd);
        let child = cmd
            .spawn()
            .map_err(|e| format!("could not start ComfyUI: {e}"))?;
        self.assign_to_job(&child)?;
        let pid = child.id();
        {
            let mut inner = self.inner.lock().await;
            inner.comfy = Some(Proc { child, port });
        }
        // An update that began while we were spawning will delete the files
        // this child has just opened: back out before it holds anything.
        if self.updating.load(Ordering::SeqCst) {
            if let Some(mut p) = self.inner.lock().await.comfy.take() {
                let _ = p.child.kill();
                let _ = tokio::task::spawn_blocking(move || p.child.wait()).await;
            }
            self.terminate_job_members();
            return Err(UPDATE_IN_PROGRESS.into());
        }
        let url = format!("http://127.0.0.1:{port}");
        wait_for_health(&format!("{url}/system_stats"), Duration::from_secs(120)).await?;
        // Identity guard: the listener must be our direct child or any process
        // in our Job Object — the venv python.exe is a launcher that runs the
        // real interpreter as a grandchild, and job membership is inherited.
        if let Some(owner) = listening_pid(port) {
            let in_job = owner == pid
                || self
                    .job
                    .query_process_id_list()
                    .map(|pids| pids.contains(&(owner as usize)))
                    .unwrap_or(true);
            if !in_job {
                return Err("Another program answered on the studio's port.".into());
            }
        }
        Ok(url)
    }

    pub async fn stop_all(&self) {
        let (comfy, llm) = {
            let mut inner = self.inner.lock().await;
            (inner.comfy.take(), inner.llm.take())
        };
        if let Some(p) = &comfy {
            // Graceful interrupt first; the job object is the kernel backstop.
            let url = format!("http://127.0.0.1:{}/interrupt", p.port);
            let _ = crate::http::loopback_client(Duration::from_secs(2))
                .post(url)
                .send()
                .await;
        }
        for proc in [comfy, llm].into_iter().flatten() {
            let mut p = proc;
            let _ = p.child.kill();
            let _ = tokio::task::spawn_blocking(move || p.child.wait()).await;
        }
    }

    pub async fn status(&self) -> (ServiceState, ServiceState) {
        if self.external_comfy.is_some() || self.external_llm.is_some() {
            // External services: report running optimistically; the engine
            // health-probes them itself.
            let comfy = if self.external_comfy.is_some() {
                ServiceState::Running
            } else {
                self.supervised_state(true).await
            };
            let llm = if self.external_llm.is_some() {
                ServiceState::Running
            } else {
                self.supervised_state(false).await
            };
            return (comfy, llm);
        }
        (
            self.supervised_state(true).await,
            self.supervised_state(false).await,
        )
    }

    async fn supervised_state(&self, comfy: bool) -> ServiceState {
        let mut inner = self.inner.lock().await;
        let slot = if comfy {
            &mut inner.comfy
        } else {
            &mut inner.llm
        };
        match slot {
            None => ServiceState::Stopped,
            Some(p) => match p.child.try_wait() {
                Ok(None) => ServiceState::Running,
                Ok(Some(_)) => ServiceState::Error,
                Err(_) => ServiceState::Error,
            },
        }
    }

    /// True once first-run setup finished (the supervisor's own marker — the
    /// DB carries the user-facing flag, this one gates child spawning).
    pub fn install_complete(&self) -> bool {
        self.external_comfy.is_some() || self.components_dir().join(".install-complete").exists()
    }

    /// Records the manifest version this install was built from (setup's and
    /// the update's last step).
    pub fn mark_install_complete(&self) -> Result<(), String> {
        let dir = self.components_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        // The uninstaller finds the (possibly second-drive) components dir here.
        write_components_dir_registry(&dir);
        write_marker(&dir, &crate::manifest::manifest().manifest_version)
    }

    /// Deletes the first-run archive staging dir (`_downloads`). The archives
    /// are read exactly once, by the extract step; after that nothing reaches
    /// them ("Verify installation" hashes the installed model files, never
    /// the archives). Refuses to run unless the install is complete *and
    /// current*, so a paused or abandoned setup keeps its resumable state and
    /// a pending update keeps the files it will install from. Idempotent.
    pub fn remove_downloads(&self) -> Result<(), String> {
        let dir = self.components_dir();
        if !matches!(self.install_state(), InstallState::Ready { .. }) {
            return Ok(());
        }
        match std::fs::remove_dir_all(dir.join("_downloads")) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }

    /// The supervised ComfyUI's output root (`--base-directory` = comfy-data).
    fn comfy_output_dir(&self) -> PathBuf {
        self.components_dir().join("comfy-data").join("output")
    }

    /// Resolves a /history-shaped `{subfolder, filename}` to a path under
    /// comfy-data/output, refusing anything that could escape it. Subfolders
    /// from ComfyUI's history use backslashes on Windows; both are accepted.
    fn comfy_output_path(&self, subfolder: &str, filename: &str) -> Result<PathBuf, String> {
        fn safe_segment(seg: &str) -> bool {
            !seg.is_empty() && seg != "." && seg != ".." && !seg.contains(':')
        }
        if filename.contains(['/', '\\']) || !safe_segment(filename) {
            return Err(format!("invalid output filename: {filename}"));
        }
        let mut path = self.comfy_output_dir();
        for seg in subfolder.split(['/', '\\']).filter(|s| !s.is_empty()) {
            if !safe_segment(seg) {
                return Err(format!("invalid output subfolder: {subfolder}"));
            }
            path.push(seg);
        }
        path.push(filename);
        Ok(path)
    }

    /// Base URLs for the engine's clients. Reserves ports; never spawns — the
    /// app boots fine before first-run setup has installed anything.
    pub async fn urls(&self) -> Result<(String, String), String> {
        let comfy = if let Some(url) = &self.external_comfy {
            url.clone()
        } else {
            let mut inner = self.inner.lock().await;
            let taken = inner.llm_port;
            let port = Inner::reserve_port(&mut inner.comfy_port, taken)?;
            format!("http://127.0.0.1:{port}")
        };
        let llm = if let Some(url) = &self.external_llm {
            url.clone()
        } else {
            // The port is reserved even before the first start, so the base
            // URL handed to the engine stays valid for the whole session (the
            // engine only talks to the LLM after startLlm + health anyway).
            let mut inner = self.inner.lock().await;
            let taken = inner.comfy_port;
            let port = Inner::reserve_port(&mut inner.llm_port, taken)?;
            format!("http://127.0.0.1:{port}")
        };
        Ok((comfy, llm))
    }
}

/// Replace `dest` with a copy of `src` (skipping __pycache__). Used to mirror
/// the bundled ComfyUI-Stillsong overlay into comfy-data/custom_nodes.
fn copy_dir_replace(src: &Path, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        std::fs::remove_dir_all(dest).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if name == "__pycache__" {
            continue;
        }
        let from = entry.path();
        let to = dest.join(&name);
        if from.is_dir() {
            copy_dir_replace(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Best-effort HKCU record of the components path for the NSIS uninstaller.
fn write_components_dir_registry(dir: &Path) {
    let _ = Command::new("reg")
        .args([
            "add",
            r"HKCU\Software\Logiscape\Stillsong",
            "/v",
            "ComponentsDir",
            "/t",
            "REG_SZ",
            "/d",
            &dir.to_string_lossy(),
            "/f",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

fn default_components_dir() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".into());
    Path::new(&base)
        .join("com.logiscape.stillsong")
        .join("components")
}

fn pick_free_port(taken: Option<u16>) -> Result<u16, String> {
    for port in PORT_RANGE {
        if Some(port) == taken {
            continue;
        }
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err("no free local port in 17800-17899".into())
}

fn rotate_log(path: &Path) {
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() > LOG_MAX_BYTES {
            for i in (1..LOG_KEEP).rev() {
                let from = path.with_extension(format!("log.{i}"));
                let to = path.with_extension(format!("log.{}", i + 1));
                let _ = std::fs::rename(&from, &to);
            }
            let _ = std::fs::rename(path, path.with_extension("log.1"));
        }
    }
}

async fn wait_for_health(url: &str, timeout: Duration) -> Result<(), String> {
    let client = crate::http::loopback_client(Duration::from_secs(3));
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if let Ok(resp) = client.get(url).send().await {
            if resp.status().is_success() {
                return Ok(());
            }
        }
        if std::time::Instant::now() > deadline {
            return Err("the studio did not come up in time".into());
        }
        tokio::time::sleep(Duration::from_millis(750)).await;
    }
}

/// PID listening on the loopback port, if netstat can tell us. `None` means
/// "no answer" (netstat missing, or a race with the child's bind) — callers
/// treat that as best-effort acceptance since the health check already passed.
fn listening_pid(port: u16) -> Option<u32> {
    let out = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let needle = format!("127.0.0.1:{port}");
    for line in text.lines() {
        if line.contains(&needle) && line.contains("LISTENING") {
            return line.split_whitespace().last()?.parse().ok();
        }
    }
    None
}

// ---- Tauri commands --------------------------------------------------------

#[derive(serde::Serialize)]
pub struct RuntimeStatus {
    pub comfy: ServiceState,
    pub llm: ServiceState,
}

#[derive(serde::Serialize)]
pub struct RuntimeUrls {
    pub comfy: String,
    pub llm: String,
}

#[tauri::command]
pub async fn runtime_status(sup: tauri::State<'_, Supervisor>) -> Result<RuntimeStatus, String> {
    let (comfy, llm) = sup.status().await;
    Ok(RuntimeStatus { comfy, llm })
}

#[tauri::command]
pub async fn runtime_start_llm(sup: tauri::State<'_, Supervisor>) -> Result<(), String> {
    sup.start_llm().await
}

#[tauri::command]
pub async fn runtime_stop_llm(sup: tauri::State<'_, Supervisor>) -> Result<(), String> {
    sup.stop_llm().await
}

#[tauri::command]
pub async fn runtime_urls(sup: tauri::State<'_, Supervisor>) -> Result<RuntimeUrls, String> {
    let (comfy, llm) = sup.urls().await?;
    Ok(RuntimeUrls { comfy, llm })
}

/// Spawns supervised ComfyUI (idempotent) and waits until it answers — used by
/// the app at startup once setup is complete, and by first-run warm-up.
#[tauri::command]
pub async fn runtime_start_comfy(sup: tauri::State<'_, Supervisor>) -> Result<String, String> {
    sup.ensure_comfy().await
}

/// Writes the supervisor-side install-complete marker (first-run's last step).
#[tauri::command]
pub fn runtime_mark_install_complete(sup: tauri::State<'_, Supervisor>) -> Result<(), String> {
    sup.mark_install_complete()
}

#[derive(serde::Serialize)]
pub struct RuntimeInstallState {
    #[serde(flatten)]
    pub state: InstallState,
    #[serde(rename = "currentVersion")]
    pub current_version: String,
}

/// Installed components versus this build's manifest — what the store routes
/// on at boot (setup, update screen, or the app).
#[tauri::command]
pub fn runtime_install_state(sup: tauri::State<'_, Supervisor>) -> RuntimeInstallState {
    RuntimeInstallState {
        state: sup.install_state(),
        current_version: crate::manifest::manifest().manifest_version.clone(),
    }
}

/// The update screen's "Update now": stops the studio and clears its runtime
/// so the setup install can rebuild it in place. Streams one line per step.
#[tauri::command]
pub async fn components_prepare_update(
    sup: tauri::State<'_, Supervisor>,
    on_line: tauri::ipc::Channel<String>,
) -> Result<(), String> {
    sup.prepare_update(Arc::new(move |line: String| {
        let _ = on_line.send(line);
    }))
    .await
}

/// First-run "Where to keep them": moves the components dir (persisted).
#[tauri::command]
pub fn runtime_set_components_dir(
    sup: tauri::State<'_, Supervisor>,
    dir: String,
) -> Result<(), String> {
    sup.set_components_dir(PathBuf::from(dir))
}

/// Paths the UI needs to display or reveal.
#[derive(serde::Serialize)]
pub struct AppPaths {
    #[serde(rename = "componentsDir")]
    pub components_dir: String,
    #[serde(rename = "logsDir")]
    pub logs_dir: String,
    #[serde(rename = "installComplete")]
    pub install_complete: bool,
}

/// One file under the supervised ComfyUI's output dir, shaped like a
/// /history output entry so the engine can match harvested files to it.
#[derive(serde::Serialize, Clone)]
pub struct ComfyOutputRef {
    pub filename: String,
    /// Relative to comfy-data/output, forward slashes, "" at the root.
    pub subfolder: String,
}

fn walk_outputs(root: &Path, dir: &Path, out: &mut Vec<ComfyOutputRef>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk_outputs(root, &path, out);
        } else if let (Some(name), Ok(rel)) = (path.file_name(), dir.strip_prefix(root)) {
            out.push(ComfyOutputRef {
                filename: name.to_string_lossy().into_owned(),
                subfolder: rel.to_string_lossy().replace('\\', "/"),
            });
        }
    }
}

/// Every file ComfyUI has written under comfy-data/output. Only the
/// supervised instance's directory is visible — an external dev ComfyUI's
/// output tree is not ours to touch (its files simply never appear here).
#[tauri::command]
pub async fn runtime_comfy_outputs(
    sup: tauri::State<'_, Supervisor>,
) -> Result<Vec<ComfyOutputRef>, String> {
    let root = sup.comfy_output_dir();
    tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        walk_outputs(&root, &root, &mut out);
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Deletes one file under comfy-data/output (the engine's copy of a render
/// lives in the library; ComfyUI's original is a leftover). Missing files
/// are not an error.
#[tauri::command]
pub async fn runtime_remove_comfy_output(
    sup: tauri::State<'_, Supervisor>,
    subfolder: String,
    filename: String,
) -> Result<(), String> {
    let path = sup.comfy_output_path(&subfolder, &filename)?;
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Setup's last step, after the install-complete marker is written: the
/// extracted archives in `_downloads` have no further use.
#[tauri::command]
pub fn components_remove_downloads(sup: tauri::State<'_, Supervisor>) -> Result<(), String> {
    sup.remove_downloads()
}

#[tauri::command]
pub fn runtime_paths(sup: tauri::State<'_, Supervisor>) -> AppPaths {
    AppPaths {
        components_dir: sup.components_dir().to_string_lossy().into_owned(),
        logs_dir: sup.log_dir.to_string_lossy().to_string(),
        install_complete: sup.install_complete(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::windows::io::AsRawHandle;

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("stillsong-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn install_state_parses_markers() {
        let dir = scratch("state");
        let cur = "2026.10.22-1";
        assert_eq!(install_state_in(&dir, cur), InstallState::NotInstalled);
        for legacy in [&b"ok"[..], b"ok\r\n", b"", b"\xff\xfeo\0k\0"] {
            std::fs::write(dir.join(INSTALL_MARKER), legacy).unwrap();
            assert_eq!(
                install_state_in(&dir, cur),
                InstallState::NeedsUpdate {
                    installed_version: None
                },
                "{legacy:?}"
            );
        }
        std::fs::write(dir.join(INSTALL_MARKER), "2026.10.15-1\n").unwrap();
        assert_eq!(
            install_state_in(&dir, cur),
            InstallState::NeedsUpdate {
                installed_version: Some("2026.10.15-1".into())
            }
        );
        write_marker(&dir, cur).unwrap();
        assert_eq!(
            install_state_in(&dir, cur),
            InstallState::Ready {
                version: cur.into()
            }
        );
        // A BOM from a PowerShell `Set-Content -Encoding utf8` is tolerated.
        std::fs::write(dir.join(INSTALL_MARKER), format!("\u{feff}{cur}\r\n")).unwrap();
        assert!(matches!(
            install_state_in(&dir, cur),
            InstallState::Ready { .. }
        ));
        std::fs::write(
            dir.join(UPDATE_PENDING_MARKER),
            format!("preparing\n{cur}\n"),
        )
        .unwrap();
        assert_eq!(
            install_state_in(&dir, cur),
            InstallState::Updating { prepared: false }
        );
        std::fs::write(
            dir.join(UPDATE_PENDING_MARKER),
            format!("prepared\n{cur}\n"),
        )
        .unwrap();
        assert_eq!(
            install_state_in(&dir, cur),
            InstallState::Updating { prepared: true }
        );
        // Prepared for another build's manifest: that build may already have
        // extracted its runtime here, so this build must prepare again.
        std::fs::write(dir.join(UPDATE_PENDING_MARKER), "prepared\n2026.10.15-1\n").unwrap();
        assert_eq!(
            install_state_in(&dir, cur),
            InstallState::Updating { prepared: false }
        );
        std::fs::write(dir.join(UPDATE_PENDING_MARKER), "prepared\n").unwrap();
        assert_eq!(
            install_state_in(&dir, cur),
            InstallState::Updating { prepared: false }
        );
        write_marker(&dir, cur).unwrap();
        assert!(!dir.join(UPDATE_PENDING_MARKER).exists());
        assert!(matches!(
            install_state_in(&dir, cur),
            InstallState::Ready { .. }
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prepare_update_in_replaces_runtime_and_keeps_data() {
        let dir = scratch("prepare");
        let touch = |rel: &str, len: usize| {
            let p = dir.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, vec![b'x'; len]).unwrap();
            p
        };
        for d in RUNTIME_DIRS {
            touch(&format!("{d}/some/file.bin"), 3);
        }
        let user = touch("comfy-data/user/settings.json", 2);
        let overlay = touch("comfy-data/custom_nodes/ComfyUI-Stillsong/__init__.py", 2);
        let good_model = touch("comfy-data/models/vae/x.safetensors", 10);
        let bad_model = touch("models/gemma.gguf", 9);
        let old_uv = touch("_downloads/uv-x86_64-pc-windows-msvc.zip", 5);
        // ComfyUI's archive is tree-bound: its manifest size is nominal, so a
        // recompressed copy within the slack (a disc's seed) must survive.
        let cur_comfy = touch("_downloads/abc.tar.gz", 9);
        let wheel = touch("_downloads/wheelhouse/torch.whl", 4);
        let part = touch("_downloads/wheelhouse/numpy.whl.part", 1);
        let lock = touch("_downloads/wheelhouse/requirements.lock", 1);
        std::fs::write(dir.join(INSTALL_MARKER), "ok").unwrap();

        let keep = std::collections::HashMap::from([
            (old_uv.clone(), 6..=6u64), // the manifest's uv zip is a different size
            (cur_comfy.clone(), 1..=14u64), // nominal 7, accepted up to 2x
            (wheel.clone(), 4..=4u64),
        ]);
        let models = vec![(good_model.clone(), 10u64), (bad_model.clone(), 20u64)];
        let lines = std::sync::Mutex::new(Vec::new());
        let emit = |l: String| lines.lock().unwrap().push(l);
        prepare_update_in_with(&dir, "v2", &keep, &models, &emit).unwrap();

        for d in RUNTIME_DIRS {
            assert!(!dir.join(d).exists(), "{d} should be gone");
        }
        assert!(user.exists() && overlay.exists(), "comfy-data is kept");
        assert!(good_model.exists(), "a model of the pinned size is kept");
        assert!(!bad_model.exists(), "a model of another size is refetched");
        assert!(
            !old_uv.exists(),
            "an old archive with the current name is dropped"
        );
        assert!(
            cur_comfy.exists() && wheel.exists(),
            "current downloads survive"
        );
        assert!(
            !part.exists() && !lock.exists(),
            "partials and the lock are dropped"
        );
        assert!(!dir.join(INSTALL_MARKER).exists());
        assert_eq!(
            std::fs::read_to_string(dir.join(UPDATE_PENDING_MARKER)).unwrap(),
            "prepared\nv2\n"
        );
        assert_eq!(
            install_state_in(&dir, "v2"),
            InstallState::Updating { prepared: true }
        );
        assert!(lines
            .lock()
            .unwrap()
            .iter()
            .any(|l| l.starts_with("Removing python-env")));

        // Try again after a failure re-runs the same steps harmlessly.
        prepare_update_in_with(&dir, "v2", &keep, &models, &|_| {}).unwrap();
        assert!(cur_comfy.exists() && good_model.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn remove_dir_all_retries_while_a_file_is_open() {
        let dir = scratch("retry");
        let path = dir.join("held");
        std::fs::create_dir_all(&path).unwrap();
        let file = path.join("open.bin");
        std::fs::write(&file, b"x").unwrap();
        // Without FILE_SHARE_DELETE the open handle makes the delete fail
        // with a sharing violation until it is dropped.
        let handle = std::fs::File::open(&file).unwrap();
        let releaser = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(handle);
        });
        remove_dir_all_retry(&path).unwrap();
        releaser.join().unwrap();
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The kernel backstop: closing the job handle must kill assigned
    /// processes even when nobody calls kill() (app crash, kill -9).
    #[test]
    fn job_object_kills_children_on_close() {
        let job = win32job::Job::create().unwrap();
        let mut info = job.query_extended_limit_info().unwrap();
        info.limit_kill_on_job_close();
        job.set_extended_limit_info(&info).unwrap();
        let mut child = std::process::Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        job.assign_process(child.as_raw_handle() as isize).unwrap();
        drop(job);
        let start = std::time::Instant::now();
        loop {
            if child.try_wait().unwrap().is_some() {
                break;
            }
            assert!(
                start.elapsed() < std::time::Duration::from_secs(5),
                "child survived job close"
            );
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
}
