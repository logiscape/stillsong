// First-run component downloader: reqwest streaming with HTTP Range resume
// from `.part` files, incremental sha256, atomic rename on verified
// completion, retry with backoff, cancellation, and per-file progress events.
//
// What may be fetched is decided entirely by the compiled-in manifest
// (manifest.rs): the frontend names an artifact by id and gets back exactly
// the bytes the manifest pins, or an error. Every connection starts at a
// pinned URL on an allowlisted host; redirects issued by that host are
// followed only over https (CDN hostnames change between releases, and the
// pinned size + sha256 — not the hostname — is what guarantees the bytes).
// The caller (first-run UI) gates when downloads may run at all (never after
// install completes, except explicit repair).
//
// One file is one connection. Two things watch that connection, because a
// multi-gigabyte transfer on a single TCP flow can go bad without the
// socket ever closing: a read timeout (no bytes at all for a minute) and
// the `Watchdog` (bytes still arriving, but at a small fraction of what this
// session has already shown the link can do). Either one drops the
// connection and resumes from the byte offset on a fresh one — a new
// source port and a fresh DNS answer, which is exactly what a manual
// pause/resume does. Neither ever fails the download by itself.

use crate::manifest::{self, Artifact};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

/// Hard failures per file: connect/read errors, bad status, hash mismatch.
/// Watchdog reconnects have their own budget (`Watchdog::MAX_RECONNECTS`).
const MAX_ATTEMPTS: u32 = 5;
const MAX_REDIRECTS: usize = 10;
/// A stream that delivers nothing for this long is dead; the read fails and
/// the retry path resumes on a new connection.
const READ_TIMEOUT: Duration = Duration::from_secs(60);
/// Pause before a watchdog reconnect: enough to be polite, short enough that
/// the user sees progress resume promptly.
const RECONNECT_PAUSE: Duration = Duration::from_secs(2);
/// Longest we honour a server's "retry after" before treating it as a
/// failed attempt; Hugging Face's windows are five minutes.
const MAX_RATE_LIMIT_WAIT: Duration = Duration::from_secs(300);
/// Fallback wait for a 429 that carries no timing.
const DEFAULT_RATE_LIMIT_WAIT: Duration = Duration::from_secs(30);
/// How often a sleeping retry checks for Pause.
const CANCEL_POLL: Duration = Duration::from_millis(250);
const USER_AGENT: &str = concat!("Stillsong/", env!("CARGO_PKG_VERSION"));

#[derive(Default)]
pub struct DownloadState {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// Best sustained rate (bytes/s) seen this session per manifest host:
    /// the watchdog's baseline for "this flow has collapsed". Keyed by host
    /// so a fast GitHub fetch cannot make a healthy but slower PyPI or
    /// Hugging Face connection look collapsed.
    best_bps: Mutex<HashMap<String, f64>>,
}

#[derive(Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub id: String,
    pub bytes: u64,
    pub total: u64,
    /// `"reconnecting"` while a collapsed connection is being replaced,
    /// `"rate-limited"` while waiting out a server's 429; absent on
    /// ordinary progress.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<&'static str>,
}

/// Progress callback: bytes written so far, plus an optional status note.
pub type Progress<'a> = &'a (dyn Fn(u64, Option<&'static str>) + Send + Sync);

/// Free bytes on the volume holding `path` (walking up to an existing parent).
pub fn free_space_at(path: &Path) -> Option<u64> {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let mut probe = path.to_path_buf();
    while !probe.exists() {
        probe = probe.parent()?.to_path_buf();
    }
    let mut free = 0u64;
    unsafe {
        GetDiskFreeSpaceExW(
            &HSTRING::from(probe.as_os_str()),
            Some(&mut free),
            None,
            None,
        )
        .ok()?;
    }
    Some(free)
}

/// Hash an existing partial file so the running sha256 can continue from it.
fn hash_existing(path: &Path) -> Result<(Sha256, u64), String> {
    let mut hasher = Sha256::new();
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 1024 * 1024];
    let mut len = 0u64;
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        len += n as u64;
    }
    Ok((hasher, len))
}

/// A client that follows redirects only over https (`manifest::hop_allowed`).
/// The first request is pinned to an allowlisted host by `fetch`; where that
/// host redirects is its decision, and the bytes are still held to the
/// pinned size and sha256. Built fresh for every attempt so a reconnect
/// never reuses the pooled connection it is trying to escape.
fn client() -> Result<reqwest::Client, String> {
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            return attempt.error("too many redirects");
        }
        if manifest::hop_allowed(attempt.url()) {
            attempt.follow()
        } else {
            let target = attempt.url().to_string();
            attempt.error(format!("redirect to a non-https URL: {target}"))
        }
    });
    reqwest::Client::builder()
        .redirect(policy)
        .user_agent(USER_AGENT)
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(READ_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

/// Detects a TCP flow that has collapsed while the socket stays open.
///
/// Throughput is judged over rolling windows, and only ever relative to the
/// best window this session has seen, so a link that is slow from the first
/// byte is never touched. A window under `RATIO` of that best — with the
/// best itself above `FLOOR_BPS`, so the very first file has a real baseline
/// before anything can fire — asks for a fresh connection. Reconnects are
/// spaced `SPACING` apart, capped per file, and abandoned after
/// `MAX_FRUITLESS` in a row that did not help: at that point the slow rate is
/// the user's link, and the download simply keeps running on it.
pub struct Watchdog {
    best_bps: f64,
    window_start: Instant,
    window_bytes: u64,
    last_reconnect: Option<Instant>,
    reconnects: u32,
    /// A reconnect happened and the next complete window will say whether
    /// it helped.
    pending_verdict: bool,
    fruitless: u32,
    disabled: bool,
    /// Test hook: force one reconnect once this many bytes have been seen.
    #[cfg(test)]
    force_reconnect_at: Option<u64>,
    #[cfg(test)]
    total: u64,
}

impl Watchdog {
    pub const WINDOW: Duration = Duration::from_secs(60);
    pub const SPACING: Duration = Duration::from_secs(120);
    pub const RATIO: f64 = 0.1;
    pub const FLOOR_BPS: f64 = 256.0 * 1024.0;
    pub const MAX_RECONNECTS: u32 = 8;
    pub const MAX_FRUITLESS: u32 = 2;

    pub fn new(best_bps: f64, now: Instant) -> Self {
        Self {
            best_bps,
            window_start: now,
            window_bytes: 0,
            last_reconnect: None,
            reconnects: 0,
            pending_verdict: false,
            fruitless: 0,
            disabled: false,
            #[cfg(test)]
            force_reconnect_at: None,
            #[cfg(test)]
            total: 0,
        }
    }

    /// Best sustained rate seen so far (bytes/s), to carry to the next file.
    pub fn best_bps(&self) -> f64 {
        self.best_bps
    }

    /// A new connection is streaming: discard the partial window of the old
    /// one so its tail does not count against the new flow.
    pub fn connection_started(&mut self, now: Instant) {
        self.window_start = now;
        self.window_bytes = 0;
    }

    /// Accounts for `bytes` received at `now`. Returns true when the caller
    /// should drop the connection and resume on a new one.
    pub fn observe(&mut self, bytes: u64, now: Instant) -> bool {
        #[cfg(test)]
        {
            self.total += bytes;
            if self.force_reconnect_at.is_some_and(|n| self.total >= n) {
                self.force_reconnect_at = None;
                return true;
            }
        }
        self.window_bytes += bytes;
        let elapsed = now.saturating_duration_since(self.window_start);
        if elapsed < Self::WINDOW {
            return false;
        }
        let rate = self.window_bytes as f64 / elapsed.as_secs_f64();
        self.window_start = now;
        self.window_bytes = 0;
        if rate > self.best_bps {
            self.best_bps = rate;
        }
        let collapsed = self.best_bps >= Self::FLOOR_BPS && rate < Self::RATIO * self.best_bps;
        if !collapsed {
            self.fruitless = 0;
            self.pending_verdict = false;
            return false;
        }
        if self.pending_verdict {
            self.pending_verdict = false;
            self.fruitless += 1;
            if self.fruitless >= Self::MAX_FRUITLESS {
                self.disabled = true;
            }
        }
        if self.disabled || self.reconnects >= Self::MAX_RECONNECTS {
            return false;
        }
        if let Some(t) = self.last_reconnect {
            if now.saturating_duration_since(t) < Self::SPACING {
                return false;
            }
        }
        self.last_reconnect = Some(now);
        self.reconnects += 1;
        self.pending_verdict = true;
        true
    }
}

/// Why an attempt stopped short of the end of the file.
enum Halt {
    Cancelled,
    /// The watchdog asked for a fresh connection; not a failure.
    Reconnect,
    /// HTTP 429: wait this long (server-directed when it says) and retry.
    RateLimited(Duration),
    /// Retry cannot help: the server is not sending the pinned artifact.
    Fatal(String),
    Failed(String),
}

/// How long a 429 asks us to wait. Hugging Face implements the IETF
/// `RateLimit` header (`"resolvers";r=0;t=<seconds until reset>`); others
/// use `Retry-After` in delta-seconds. Clamped to [1 s, MAX_RATE_LIMIT_WAIT].
fn retry_after(headers: &reqwest::header::HeaderMap) -> Duration {
    let ratelimit_t = headers
        .get("ratelimit")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| {
            v.split(';')
                .map(str::trim)
                .find_map(|p| p.strip_prefix("t="))
                .and_then(|t| t.parse::<u64>().ok())
        });
    let retry_after = headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok());
    ratelimit_t
        .or(retry_after)
        .map(Duration::from_secs)
        .unwrap_or(DEFAULT_RATE_LIMIT_WAIT)
        .clamp(Duration::from_secs(1), MAX_RATE_LIMIT_WAIT)
}

/// Sleeps for `d`, waking early — returning true — if the download is
/// cancelled meanwhile, so Pause is honoured during retry waits too.
async fn sleep_unless_cancelled(cancel: &AtomicBool, d: Duration) -> bool {
    let end = Instant::now() + d;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return true;
        }
        let now = Instant::now();
        if now >= end {
            return false;
        }
        tokio::time::sleep((end - now).min(CANCEL_POLL)).await;
    }
}

/// The running hash carried across attempts so a reconnect does not re-read
/// the whole partial file. Only trusted when `len` equals the file's length.
struct Carry {
    hasher: Sha256,
    len: u64,
}

async fn attempt(
    art: &Artifact,
    part: &Path,
    etag_file: &Path,
    cancel: &AtomicBool,
    carry: &mut Option<Carry>,
    wd: &mut Watchdog,
    on_progress: Progress<'_>,
) -> Result<(Sha256, u64), Halt> {
    if cancel.load(Ordering::Relaxed) {
        return Err(Halt::Cancelled);
    }
    let client = client().map_err(Halt::Failed)?;

    // Resume state: existing .part is only trusted if the server's ETag still
    // matches the one we recorded when the .part was started.
    let mut offset = part.metadata().map(|m| m.len()).unwrap_or(0);
    let recorded_etag = std::fs::read_to_string(etag_file).unwrap_or_default();

    let mut req = client.get(&art.url);
    if offset > 0 {
        req = req.header("Range", format!("bytes={offset}-"));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| Halt::Failed(format!("network error: {e}")))?;
    let status = resp.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(Halt::RateLimited(retry_after(resp.headers())));
    }
    let etag = resp
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let resuming = if offset > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT {
        // Only append when the ETag proves it is the same object.
        !recorded_etag.is_empty() && recorded_etag == etag
    } else {
        false
    };
    if !resuming {
        if !(status.is_success()) {
            return Err(Halt::Failed(format!("download failed: HTTP {status}")));
        }
        let _ = std::fs::remove_file(part);
        offset = 0;
        *carry = None;
    }
    if offset == 0 {
        let _ = std::fs::write(etag_file, &etag);
    }

    let (mut hasher, hashed_len) = match carry.take() {
        Some(c) if c.len == offset => (c.hasher, c.len),
        _ if offset > 0 => hash_existing(part).map_err(Halt::Failed)?,
        _ => (Sha256::new(), 0),
    };
    debug_assert_eq!(hashed_len, offset);

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(part)
        .map_err(|e| Halt::Failed(e.to_string()))?;
    let mut written = offset;
    let mut last_emit = Instant::now();
    let mut stream = resp.bytes_stream();
    wd.connection_started(Instant::now());
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            *carry = Some(Carry {
                hasher,
                len: written,
            });
            return Err(Halt::Cancelled);
        }
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                *carry = Some(Carry {
                    hasher,
                    len: written,
                });
                return Err(Halt::Failed(format!("network error: {e}")));
            }
        };
        // Never accept more than the manifest pins, from any host: the
        // overrun is discarded before it touches the disk and the file is
        // started over, since this server is not sending the pinned bytes.
        if written + chunk.len() as u64 > art.size {
            drop(file);
            let _ = std::fs::remove_file(part);
            let _ = std::fs::remove_file(etag_file);
            return Err(Halt::Fatal(format!(
                "server sent more than the pinned {} bytes",
                art.size
            )));
        }
        hasher.update(&chunk);
        // A failed write leaves the hash ahead of the file; the carry is
        // dropped so the next attempt re-hashes what is actually on disk.
        file.write_all(&chunk)
            .map_err(|e| Halt::Failed(e.to_string()))?;
        written += chunk.len() as u64;
        let now = Instant::now();
        if wd.observe(chunk.len() as u64, now) {
            let _ = file.flush();
            *carry = Some(Carry {
                hasher,
                len: written,
            });
            return Err(Halt::Reconnect);
        }
        if now.duration_since(last_emit).as_millis() > 150 {
            last_emit = now;
            on_progress(written, None);
        }
    }
    file.flush().map_err(|e| Halt::Failed(e.to_string()))?;
    Ok((hasher, written))
}

/// Fetches one manifest artifact to its destination: resumes any partial
/// file, verifies size + sha256, renames atomically on success. Idempotent —
/// an existing destination (only ever produced by that verified rename) is
/// accepted as complete; "Verify installation" re-hashes on demand.
/// `best_bps` is the session-wide throughput baseline shared between files.
pub async fn fetch(
    art: &Artifact,
    cancel: &AtomicBool,
    on_progress: Progress<'_>,
    best_bps: &Mutex<HashMap<String, f64>>,
) -> Result<(), String> {
    let url = reqwest::Url::parse(&art.url).map_err(|e| e.to_string())?;
    if !manifest::host_allowed(&url) {
        return Err(format!("host not allowed: {}", art.url));
    }
    let dest = &art.dest;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if dest.exists() {
        on_progress(art.size, None);
        return Ok(());
    }
    let part = dest.with_extension(format!(
        "{}.part",
        dest.extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default()
    ));
    let etag_file = dest.with_extension("part-etag");

    let have = part.metadata().map(|m| m.len()).unwrap_or(0);
    if let Some(free) = free_space_at(dest) {
        let needed = art.size.saturating_sub(have) + 512 * 1024 * 1024; // headroom
        if free < needed {
            return Err("Not enough free space on the chosen drive.".into());
        }
    }

    let host = reqwest::Url::parse(&art.url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default();
    let seed = best_bps.lock().unwrap().get(&host).copied().unwrap_or(0.0);
    let wd = Watchdog::new(seed, Instant::now());
    let (result, wd) = fetch_with(art, &part, &etag_file, cancel, on_progress, wd).await;
    let mut best = best_bps.lock().unwrap();
    let entry = best.entry(host).or_insert(0.0);
    *entry = entry.max(wd.best_bps());
    result
}

/// The attempt loop behind `fetch`, with the watchdog injected (tests force
/// a reconnect through it). Returns the watchdog so its baseline can be kept.
async fn fetch_with(
    art: &Artifact,
    part: &Path,
    etag_file: &Path,
    cancel: &AtomicBool,
    on_progress: Progress<'_>,
    mut wd: Watchdog,
) -> (Result<(), String>, Watchdog) {
    let dest = &art.dest;
    let mut carry: Option<Carry> = None;
    let mut failures = 0u32;
    let result = loop {
        let err = match attempt(
            art,
            part,
            etag_file,
            cancel,
            &mut carry,
            &mut wd,
            on_progress,
        )
        .await
        {
            Ok((hasher, written)) => {
                let got = format!("{:x}", hasher.finalize());
                if written == art.size && got.eq_ignore_ascii_case(&art.sha256) {
                    if let Err(e) = std::fs::rename(part, dest) {
                        break Err(e.to_string());
                    }
                    let _ = std::fs::remove_file(etag_file);
                    on_progress(art.size, None);
                    break Ok(());
                }
                // Corrupt or tampered: never keep the bytes.
                let _ = std::fs::remove_file(part);
                let _ = std::fs::remove_file(etag_file);
                carry = None;
                format!(
                    "verification failed for {} (got {written} bytes, sha {got})",
                    art.id
                )
            }
            Err(Halt::Cancelled) => break Err("cancelled".into()), // keep .part for a later resume
            Err(Halt::Reconnect) => {
                on_progress(on_disk(part), Some("reconnecting"));
                if sleep_unless_cancelled(cancel, RECONNECT_PAUSE).await {
                    break Err("cancelled".into());
                }
                continue;
            }
            Err(Halt::RateLimited(wait)) => {
                failures += 1;
                if failures >= MAX_ATTEMPTS {
                    break Err(format!("{} kept rate-limiting the download", art.url));
                }
                on_progress(on_disk(part), Some("rate-limited"));
                if sleep_unless_cancelled(cancel, wait).await {
                    break Err("cancelled".into());
                }
                continue;
            }
            Err(Halt::Fatal(e)) => break Err(e),
            Err(Halt::Failed(e)) => e,
        };
        failures += 1;
        if failures >= MAX_ATTEMPTS {
            break Err(err);
        }
        if sleep_unless_cancelled(cancel, Duration::from_secs(2u64.pow(failures))).await {
            break Err("cancelled".into());
        }
    };
    (result, wd)
}

fn on_disk(part: &Path) -> u64 {
    part.metadata().map(|m| m.len()).unwrap_or(0)
}

/// Downloads the manifest artifact `id` (an item id or a wheel filename)
/// into the current components dir. Emits progress on the channel.
#[tauri::command]
pub async fn download_component(
    state: tauri::State<'_, DownloadState>,
    sup: tauri::State<'_, crate::supervisor::Supervisor>,
    id: String,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let comp: PathBuf = sup.components_dir();
    let art = manifest::artifact(&comp, &id).ok_or_else(|| format!("unknown component: {id}"))?;
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .cancels
        .lock()
        .unwrap()
        .insert(id.clone(), cancel.clone());
    let total = art.size;
    let pid = id.clone();
    let progress = move |bytes: u64, note: Option<&'static str>| {
        let _ = on_progress.send(DownloadProgress {
            id: pid.clone(),
            bytes,
            total,
            note,
        });
    };
    let result = fetch(&art, &cancel, &progress, &state.best_bps).await;
    // Only retire our own flag: a Resume issued while this invocation was
    // still winding down has already registered its own.
    let mut cancels = state.cancels.lock().unwrap();
    if cancels.get(&id).is_some_and(|c| Arc::ptr_eq(c, &cancel)) {
        cancels.remove(&id);
    }
    result
}

#[tauri::command]
pub fn download_cancel(state: tauri::State<'_, DownloadState>, id: String) {
    if let Some(c) = state.cancels.lock().unwrap().get(&id) {
        c.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: f64 = 1024.0 * 1024.0;
    const W: u64 = Watchdog::WINDOW.as_secs();

    fn headers(pairs: &[(&str, &str)]) -> reqwest::header::HeaderMap {
        let mut h = reqwest::header::HeaderMap::new();
        for (k, v) in pairs {
            h.insert(
                reqwest::header::HeaderName::from_bytes(k.as_bytes()).unwrap(),
                v.parse().unwrap(),
            );
        }
        h
    }

    #[test]
    fn retry_after_prefers_the_ratelimit_reset() {
        let h = headers(&[
            ("RateLimit", "\"resolvers\";r=0;t=87"),
            ("Retry-After", "5"),
        ]);
        assert_eq!(retry_after(&h), Duration::from_secs(87));
    }

    #[test]
    fn retry_after_falls_back_then_defaults_and_clamps() {
        assert_eq!(
            retry_after(&headers(&[("Retry-After", "12")])),
            Duration::from_secs(12)
        );
        assert_eq!(retry_after(&headers(&[])), DEFAULT_RATE_LIMIT_WAIT);
        // An HTTP-date Retry-After is not parsed; use the default.
        assert_eq!(
            retry_after(&headers(&[(
                "Retry-After",
                "Wed, 21 Oct 2026 07:28:00 GMT"
            )])),
            DEFAULT_RATE_LIMIT_WAIT
        );
        assert_eq!(
            retry_after(&headers(&[("RateLimit", "\"api\";r=0;t=9999")])),
            MAX_RATE_LIMIT_WAIT
        );
        assert_eq!(
            retry_after(&headers(&[("Retry-After", "0")])),
            Duration::from_secs(1)
        );
    }

    #[tokio::test]
    async fn retry_sleep_wakes_on_cancel() {
        let cancel = Arc::new(AtomicBool::new(false));
        let c = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            c.store(true, Ordering::Relaxed);
        });
        let t0 = Instant::now();
        assert!(sleep_unless_cancelled(&cancel, Duration::from_secs(30)).await);
        assert!(t0.elapsed() < Duration::from_secs(5));
        assert!(!sleep_unless_cancelled(&AtomicBool::new(false), Duration::from_millis(10)).await);
    }

    /// One complete window ending `at` seconds after `base`, carrying bytes
    /// for `mbps` MB/s over the window.
    fn window(wd: &mut Watchdog, base: Instant, at: u64, mbps: f64) -> bool {
        wd.observe(
            (mbps * MB * W as f64) as u64,
            base + Duration::from_secs(at),
        )
    }

    #[test]
    fn first_file_has_no_baseline_and_is_left_alone() {
        let base = Instant::now();
        let mut wd = Watchdog::new(0.0, base);
        for i in 1..=10 {
            assert!(!window(&mut wd, base, i * W, 0.01), "window {i}");
        }
    }

    #[test]
    fn slow_but_steady_link_never_triggers() {
        let base = Instant::now();
        let mut wd = Watchdog::new(0.0, base);
        assert!(!window(&mut wd, base, W, 3.0));
        for i in 2..=30 {
            assert!(!window(&mut wd, base, i * W, 2.0), "window {i}");
        }
        assert_eq!(wd.best_bps(), 3.0 * MB);
    }

    #[test]
    fn collapse_against_session_baseline_triggers() {
        let base = Instant::now();
        let mut wd = Watchdog::new(30.0 * MB, base);
        assert!(window(&mut wd, base, W, 0.4));
    }

    #[test]
    fn baseline_rises_within_a_file() {
        let base = Instant::now();
        let mut wd = Watchdog::new(0.0, base);
        assert!(!window(&mut wd, base, W, 30.0));
        assert_eq!(wd.best_bps(), 30.0 * MB);
        assert!(window(&mut wd, base, 2 * W, 0.4));
    }

    #[test]
    fn partial_window_before_a_boundary_does_not_fire() {
        let base = Instant::now();
        let mut wd = Watchdog::new(30.0 * MB, base);
        // 20 s in, and only a trickle so far: not judged yet.
        assert!(!wd.observe(1024, base + Duration::from_secs(20)));
        wd.connection_started(base + Duration::from_secs(30));
        // The old partial window was discarded; the new one starts at 30 s.
        assert!(!wd.observe(1024, base + Duration::from_secs(80)));
        assert!(window(&mut wd, base, 90, 0.4));
    }

    #[test]
    fn spacing_then_two_fruitless_reconnects_then_give_up() {
        let base = Instant::now();
        let mut wd = Watchdog::new(30.0 * MB, base);
        let mut fired = Vec::new();
        for i in 1..=12 {
            if window(&mut wd, base, i * W, 0.4) {
                fired.push(i * W);
            }
        }
        // First at 60 s; 120 s is inside the spacing; second at 180 s; the
        // window after each reconnect was still collapsed, so after the
        // second the watchdog stands down for good.
        assert_eq!(fired, vec![W, 3 * W]);
    }

    #[test]
    fn a_healthy_window_after_a_reconnect_resets_the_verdict() {
        let base = Instant::now();
        let mut wd = Watchdog::new(30.0 * MB, base);
        assert!(window(&mut wd, base, W, 0.4)); // reconnect #1
        assert!(!window(&mut wd, base, 2 * W, 25.0)); // it helped
        assert!(!window(&mut wd, base, 3 * W, 25.0));
        assert!(window(&mut wd, base, 4 * W, 0.4)); // collapsed again: allowed
        assert!(!window(&mut wd, base, 5 * W, 25.0));
    }

    #[test]
    fn per_file_reconnect_cap() {
        let base = Instant::now();
        let mut wd = Watchdog::new(30.0 * MB, base);
        let mut fired = 0;
        // Collapse, reconnect, healthy, collapse, ... every reconnect helps,
        // so nothing is fruitless; only the cap can stop it.
        for i in 1..=60 {
            let mbps = if i % 2 == 1 { 0.4 } else { 25.0 };
            if window(&mut wd, base, i * W, mbps) {
                fired += 1;
            }
        }
        assert_eq!(fired, Watchdog::MAX_RECONNECTS);
    }

    /// Live redirect check: the smallest manifest item (uv, ~17 MB) goes
    /// github.com -> release-assets.githubusercontent.com; the pinned first
    /// hop is allowlisted, the CDN hop is followed because it is https, and
    /// the bytes must hash. Skipped without STILLSONG_LIVE_DOWNLOAD=1.
    #[tokio::test]
    async fn redirect_hops_are_followed_live() {
        if std::env::var("STILLSONG_LIVE_DOWNLOAD").is_err() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("stillsong-dl-{}", std::process::id()));
        let art = manifest::artifact(&dir, "uv").unwrap();
        let cancel = AtomicBool::new(false);
        let best = Mutex::new(HashMap::new());
        fetch(&art, &cancel, &|_, _| {}, &best).await.unwrap();
        assert_eq!(art.dest.metadata().unwrap().len(), art.size);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A server that sends more than the pinned size is cut off before the
    /// overrun reaches the disk, the partial file is discarded, and the
    /// download fails at once rather than retrying five times. Served from
    /// a throwaway loopback listener, so no network is needed.
    #[tokio::test]
    async fn oversized_response_is_fatal_and_leaves_nothing() {
        use std::io::{BufRead, BufReader};
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut rd = BufReader::new(sock.try_clone().unwrap());
            let mut line = String::new();
            while rd.read_line(&mut line).unwrap() > 0 && line != "\r\n" {
                line.clear();
            }
            let body = vec![0u8; 1000];
            sock.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .as_bytes(),
            )
            .unwrap();
            let _ = sock.write_all(&body);
        });
        let dir = std::env::temp_dir().join(format!("stillsong-dl-big-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let art = Artifact {
            id: "big".into(),
            url: format!("http://127.0.0.1:{port}/big.bin"),
            size: 100,
            sha256: "0".repeat(64),
            dest: dir.join("big.bin"),
        };
        let part = dir.join("big.bin.part");
        let etag_file = dir.join("big.part-etag");
        let cancel = AtomicBool::new(false);
        let t0 = Instant::now();
        let wd = Watchdog::new(0.0, t0);
        let (result, _) = fetch_with(&art, &part, &etag_file, &cancel, &|_, _| {}, wd).await;
        let err = result.unwrap_err();
        assert!(err.contains("more than the pinned 100 bytes"), "{err}");
        assert!(
            t0.elapsed() < Duration::from_secs(2),
            "must not back off and retry"
        );
        assert!(!part.exists() && !etag_file.exists() && !art.dest.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Live splice check: a forced watchdog reconnect 4 MB into the uv zip
    /// must resume from that offset on a new connection with the carried
    /// hash, and the file must verify. Progress after the "reconnecting"
    /// note never drops (a restart from zero would show as a smaller value),
    /// so a broken carry cannot hide behind the retry path. Skipped without
    /// STILLSONG_LIVE_DOWNLOAD=1.
    #[tokio::test]
    async fn watchdog_reconnect_resumes_and_verifies_live() {
        if std::env::var("STILLSONG_LIVE_DOWNLOAD").is_err() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("stillsong-dl-wd-{}", std::process::id()));
        let art = manifest::artifact(&dir, "uv").unwrap();
        std::fs::create_dir_all(art.dest.parent().unwrap()).unwrap();
        let part = art.dest.with_extension("zip.part");
        let etag_file = art.dest.with_extension("part-etag");
        let cancel = AtomicBool::new(false);
        let mut wd = Watchdog::new(0.0, Instant::now());
        wd.force_reconnect_at = Some(4 * 1024 * 1024);
        let seen: Mutex<Vec<(u64, bool)>> = Mutex::new(Vec::new());
        let progress =
            |b: u64, n: Option<&'static str>| seen.lock().unwrap().push((b, n.is_some()));
        let (result, _) = fetch_with(&art, &part, &etag_file, &cancel, &progress, wd).await;
        result.unwrap();
        assert_eq!(art.dest.metadata().unwrap().len(), art.size);
        let seen = seen.lock().unwrap();
        let notes: Vec<u64> = seen.iter().filter(|(_, n)| *n).map(|(b, _)| *b).collect();
        assert_eq!(notes.len(), 1, "exactly one reconnect: {seen:?}");
        assert!(
            notes[0] >= 4 * 1024 * 1024 && notes[0] < art.size,
            "{}",
            notes[0]
        );
        let after: Vec<u64> = seen
            .iter()
            .skip_while(|(_, n)| !*n)
            .map(|(b, _)| *b)
            .collect();
        assert!(
            after.windows(2).all(|w| w[0] <= w[1]),
            "progress went backwards: {after:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
