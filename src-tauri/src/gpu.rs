// Hardware detection for the first-run check and VRAM tiers. Prefers
// nvidia-smi (immune to hybrid-GPU enumeration order); falls back to DXGI
// adapter enumeration picking the max-VRAM adapter. System RAM via
// GlobalMemoryStatusEx.

use serde::Serialize;
use std::os::windows::process::CommandExt;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize, Clone, Debug)]
pub struct GpuInfo {
    /// "nvidia", "amd", "intel", or "unknown".
    pub vendor: String,
    pub name: String,
    #[serde(rename = "vramMb")]
    pub vram_mb: u64,
    #[serde(rename = "ramMb")]
    pub ram_mb: u64,
}

fn from_nvidia_smi() -> Option<(String, u64)> {
    let out = std::process::Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // Multiple GPUs: take the one with the most VRAM.
    text.lines()
        .filter_map(|line| {
            let (name, mem) = line.rsplit_once(',')?;
            Some((name.trim().to_string(), mem.trim().parse::<u64>().ok()?))
        })
        .max_by_key(|(_, mb)| *mb)
}

fn from_dxgi() -> Option<(String, String, u64)> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().ok()?;
        let mut best: Option<(String, String, u64)> = None;
        let mut i = 0u32;
        while let Ok(adapter) = factory.EnumAdapters1(i) {
            i += 1;
            let Ok(desc) = adapter.GetDesc1() else {
                continue;
            };
            // Skip the "Microsoft Basic Render Driver" software adapter.
            if desc.Flags & 0x2 != 0 {
                continue;
            }
            let name = String::from_utf16_lossy(&desc.Description)
                .trim_end_matches('\0')
                .to_string();
            let vendor = match desc.VendorId {
                0x10DE => "nvidia",
                0x1002 | 0x1022 => "amd",
                0x8086 => "intel",
                _ => "unknown",
            }
            .to_string();
            let vram_mb = (desc.DedicatedVideoMemory / (1024 * 1024)) as u64;
            if best.as_ref().map(|(_, _, b)| vram_mb > *b).unwrap_or(true) {
                best = Some((vendor, name, vram_mb));
            }
        }
        best
    }
}

fn system_ram_mb() -> u64 {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    unsafe {
        let mut status = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        if GlobalMemoryStatusEx(&mut status).is_ok() {
            status.ullTotalPhys / (1024 * 1024)
        } else {
            0
        }
    }
}

/// Dev-only tier emulation for the --reserve-vram measurement pass: lie about
/// capacity so hardwareTier()/capCeiling() take the low-VRAM paths while a
/// ballast + --reserve-vram constrain the GPU for real. Never set in production.
fn env_override_mb(var: &str) -> Option<u64> {
    std::env::var(var).ok()?.trim().parse().ok()
}

pub fn detect() -> GpuInfo {
    let mut info = detect_real();
    if let Some(mb) = env_override_mb("STILLSONG_VRAM_MB") {
        info.vram_mb = mb;
    }
    if let Some(mb) = env_override_mb("STILLSONG_RAM_MB") {
        info.ram_mb = mb;
    }
    info
}

fn detect_real() -> GpuInfo {
    let ram_mb = system_ram_mb();
    if let Some((name, vram_mb)) = from_nvidia_smi() {
        return GpuInfo {
            vendor: "nvidia".into(),
            name,
            vram_mb,
            ram_mb,
        };
    }
    if let Some((vendor, name, vram_mb)) = from_dxgi() {
        return GpuInfo {
            vendor,
            name,
            vram_mb,
            ram_mb,
        };
    }
    GpuInfo {
        vendor: "unknown".into(),
        name: "unknown".into(),
        vram_mb: 0,
        ram_mb,
    }
}

#[tauri::command]
pub fn gpu_info() -> GpuInfo {
    detect()
}
