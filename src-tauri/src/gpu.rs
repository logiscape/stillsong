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
    /// NVIDIA driver version as nvidia-smi reports it ("617.42"). None when
    /// detection fell back to DXGI, which has no driver data. The setup check
    /// compares its major against the floor the bundled CUDA 13 runtimes need
    /// (`driverShortfall` in src/engine/domain/duration.ts).
    #[serde(rename = "driverVersion")]
    pub driver_version: Option<String>,
    /// CUDA compute capability ("12.0"). None without nvidia-smi or on an
    /// nvidia-smi too old to answer `compute_cap`. Turing (7.x) matters: the
    /// llama.cpp release build carries PTX, not machine code, for it.
    #[serde(rename = "computeCap")]
    pub compute_cap: Option<String>,
}

/// One nvidia-smi row; the best (most VRAM) one wins on multi-GPU machines.
#[derive(Debug, PartialEq)]
struct NvidiaGpu {
    name: String,
    vram_mb: u64,
    driver_version: Option<String>,
    compute_cap: Option<String>,
}

fn run_nvidia_smi(query: &str) -> Option<String> {
    let out = std::process::Command::new("nvidia-smi")
        .args([query, "--format=csv,noheader,nounits"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn from_nvidia_smi() -> Option<NvidiaGpu> {
    // `driver_version` and `compute_cap` are newer query fields; an old
    // nvidia-smi rejects the whole query, so fall back to the two-field form
    // rather than lose the NVIDIA path (and the hybrid-GPU immunity) entirely.
    if let Some(text) = run_nvidia_smi("--query-gpu=name,memory.total,driver_version,compute_cap") {
        if let Some(gpu) = parse_nvidia_smi(&text, true) {
            return Some(gpu);
        }
    }
    parse_nvidia_smi(&run_nvidia_smi("--query-gpu=name,memory.total")?, false)
}

/// Parses nvidia-smi CSV rows. The fixed fields follow the name, so they are
/// taken from the right and a comma inside a product name cannot shift them.
fn parse_nvidia_smi(text: &str, extended: bool) -> Option<NvidiaGpu> {
    let tail = if extended { 3 } else { 1 };
    text.lines()
        .filter_map(|line| {
            let fields: Vec<&str> = line.split(',').map(str::trim).collect();
            if fields.len() < tail + 1 {
                return None;
            }
            let name = fields[..fields.len() - tail].join(",");
            let rest = &fields[fields.len() - tail..];
            let vram_mb = rest[0].parse::<u64>().ok()?;
            // nvidia-smi prints "[N/A]" or "[Not Supported]" for fields it
            // cannot answer; only a digit-led value is a version.
            let numeric = |s: &str| {
                s.chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_digit())
                    .then(|| s.to_string())
            };
            let (driver_version, compute_cap) = if extended {
                (numeric(rest[1]), numeric(rest[2]))
            } else {
                (None, None)
            };
            Some(NvidiaGpu {
                name,
                vram_mb,
                driver_version,
                compute_cap,
            })
        })
        .max_by_key(|g| g.vram_mb)
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
    if let Some(gpu) = from_nvidia_smi() {
        return GpuInfo {
            vendor: "nvidia".into(),
            name: gpu.name,
            vram_mb: gpu.vram_mb,
            ram_mb,
            driver_version: gpu.driver_version,
            compute_cap: gpu.compute_cap,
        };
    }
    if let Some((vendor, name, vram_mb)) = from_dxgi() {
        return GpuInfo {
            vendor,
            name,
            vram_mb,
            ram_mb,
            driver_version: None,
            compute_cap: None,
        };
    }
    GpuInfo {
        vendor: "unknown".into(),
        name: "unknown".into(),
        vram_mb: 0,
        ram_mb,
        driver_version: None,
        compute_cap: None,
    }
}

#[tauri::command]
pub fn gpu_info() -> GpuInfo {
    detect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gpu(name: &str, vram_mb: u64, driver: Option<&str>, cap: Option<&str>) -> NvidiaGpu {
        NvidiaGpu {
            name: name.into(),
            vram_mb,
            driver_version: driver.map(str::to_string),
            compute_cap: cap.map(str::to_string),
        }
    }

    #[test]
    fn parses_extended_row() {
        let row = "NVIDIA GeForce RTX 5080, 16303, 617.42, 12.0";
        assert_eq!(
            parse_nvidia_smi(row, true),
            Some(gpu(
                "NVIDIA GeForce RTX 5080",
                16303,
                Some("617.42"),
                Some("12.0")
            ))
        );
    }

    #[test]
    fn parses_basic_row_without_versions() {
        assert_eq!(
            parse_nvidia_smi("NVIDIA GeForce RTX 3070, 8192", false),
            Some(gpu("NVIDIA GeForce RTX 3070", 8192, None, None))
        );
    }

    #[test]
    fn picks_the_largest_gpu_and_keeps_commas_in_names() {
        let nl = char::from(10u8);
        let text = format!(
            "Intel, Iris Xe, 128, 590.10, 9.0{nl}NVIDIA GeForce RTX 4070, 12282, 590.10, 8.9{nl}"
        );
        assert_eq!(
            parse_nvidia_smi(&text, true),
            Some(gpu(
                "NVIDIA GeForce RTX 4070",
                12282,
                Some("590.10"),
                Some("8.9")
            ))
        );
    }

    #[test]
    fn unsupported_fields_become_none() {
        assert_eq!(
            parse_nvidia_smi("NVIDIA GeForce GTX 1660, 6144, 581.57, [N/A]", true),
            Some(gpu("NVIDIA GeForce GTX 1660", 6144, Some("581.57"), None))
        );
        assert_eq!(parse_nvidia_smi("garbage", true), None);
        assert_eq!(parse_nvidia_smi("", false), None);
    }
}
