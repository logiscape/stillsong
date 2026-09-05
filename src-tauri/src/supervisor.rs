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
        })
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
            "--disable-api-nodes".into(),
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

    pub fn mark_install_complete(&self) -> Result<(), String> {
        let dir = self.components_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        // The uninstaller finds the (possibly second-drive) components dir here.
        write_components_dir_registry(&dir);
        std::fs::write(dir.join(".install-complete"), b"ok").map_err(|e| e.to_string())
    }

    /// Deletes the first-run archive staging dir (`_downloads`). The archives
    /// are read exactly once, by the extract step; after that nothing reaches
    /// them ("Verify installation" hashes the installed model files, never
    /// the archives). Refuses to run before the install is marked complete
    /// so a paused or abandoned setup keeps its resumable state. Idempotent.
    pub fn remove_downloads(&self) -> Result<(), String> {
        let dir = self.components_dir();
        if !dir.join(".install-complete").exists() {
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
    use std::os::windows::io::AsRawHandle;

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
