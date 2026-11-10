// Stillsong 2's machine-level identity, and the studio lock it shares with
// other Stillsong versions.
//
// Stillsong 2 installs and runs beside Stillsong 1 on the same PC. Everything
// v1 keys on (identifier `com.logiscape.stillsong`, registry key
// `HKCU\Software\Logiscape\Stillsong`, ports 17800-17899, `STILLSONG_*` dev
// variables) must stay untouched by this build. The app data dirs follow the
// Tauri identifier (`com.logiscape.stillsong2`); the few names Tauri does not
// derive live here, in one place.

use std::os::windows::process::CommandExt;
use std::process::Command;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE};
use windows::Win32::System::Threading::CreateMutexW;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Where the app records the components dir for the NSIS uninstaller
/// (`installer-hooks.nsh` reads the same key).
pub const REGISTRY_KEY: &str = r"HKCU\Software\Logiscape\Stillsong 2";

/// Loopback ports for the supervised children. Stillsong 1 scans
/// 17800-17899, so the two versions never pick the same port.
pub const PORT_RANGE: std::ops::Range<u16> = 17900..18000;

/// Held (as an open handle) while this app's studio runs. Any Stillsong
/// version that opens the same name is refused while another holds it: one
/// renderer on the GPU at a time, across apps. Session-local (`Local\`), so
/// another signed-in user is unaffected.
pub const STUDIO_LOCK_NAME: &str = r"Local\Logiscape.Stillsong.Studio";

/// Stillsong 1's executable. It predates the studio lock, so while it is
/// running this build treats the GPU as taken.
pub const V1_IMAGE_NAME: &str = "Stillsong.exe";

pub const STUDIO_BUSY: &str =
    "Another copy of Stillsong is using the graphics card. Close it, then try again.";
pub const V1_RUNNING: &str =
    "Stillsong is open. Close it so Stillsong 2 can use the graphics card, then try again.";

/// An open handle on the named studio lock; dropping it releases the lock.
pub struct StudioLock(HANDLE);

// The handle is a kernel object reference with no thread affinity (the lock is
// the object's existence, not mutex ownership), so it may move between the
// async runtime's threads.
unsafe impl Send for StudioLock {}
unsafe impl Sync for StudioLock {}

impl StudioLock {
    /// Opens `name`, failing if any other process (or an earlier handle in
    /// this one) already holds it.
    pub fn acquire(name: &str) -> Result<Self, String> {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        // No initial ownership: ownership is per thread, existence is not.
        let handle = unsafe { CreateMutexW(None, false, PCWSTR(wide.as_ptr())) }
            .map_err(|e| format!("could not create the studio lock: {e}"))?;
        if unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
            unsafe {
                let _ = CloseHandle(handle);
            }
            return Err(STUDIO_BUSY.into());
        }
        Ok(Self(handle))
    }
}

impl Drop for StudioLock {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// True if Stillsong 1 is running (best effort: `false` if tasklist fails).
pub fn v1_running() -> bool {
    let Ok(out) = Command::new("tasklist")
        .args([
            "/FI",
            &format!("IMAGENAME eq {V1_IMAGE_NAME}"),
            "/FO",
            "CSV",
            "/NH",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return false;
    };
    tasklist_has_image(&String::from_utf8_lossy(&out.stdout), V1_IMAGE_NAME)
}

/// Parses `tasklist /FO CSV /NH` output: one quoted row per process, image
/// name first. Any other text (e.g. "INFO: No tasks are running…") is no.
fn tasklist_has_image(csv: &str, image: &str) -> bool {
    let want = format!("\"{}\"", image.to_ascii_lowercase());
    csv.lines()
        .any(|l| l.trim_start().to_ascii_lowercase().starts_with(&want))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_never_names_stillsong_1() {
        assert!(!REGISTRY_KEY.ends_with(r"\Stillsong"));
        const {
            assert!(
                PORT_RANGE.start >= 17900,
                "17800-17899 belongs to Stillsong 1"
            )
        };
    }

    #[test]
    fn studio_lock_is_exclusive_and_released_on_drop() {
        let name = format!(r"Local\Stillsong2.Test.{}", std::process::id());
        let first = StudioLock::acquire(&name).expect("first acquire");
        assert_eq!(
            StudioLock::acquire(&name).err().as_deref(),
            Some(STUDIO_BUSY)
        );
        drop(first);
        StudioLock::acquire(&name).expect("free again once dropped");
    }

    #[test]
    fn tasklist_parsing() {
        let running = "\"Stillsong.exe\",\"1234\",\"Console\",\"1\",\"210,000 K\"\r\n";
        assert!(tasklist_has_image(running, "Stillsong.exe"));
        // A dev build of v1 is the lower-case cargo binary name.
        assert!(tasklist_has_image(
            "\"stillsong.exe\",\"9\",\"Console\",\"1\",\"1 K\"",
            "Stillsong.exe"
        ));
        assert!(!tasklist_has_image(
            "INFO: No tasks are running which match the specified criteria.\r\n",
            "Stillsong.exe"
        ));
        // Stillsong 2's own executable must not count as v1.
        assert!(!tasklist_has_image(
            "\"Stillsong 2.exe\",\"5\",\"Console\",\"1\",\"1 K\"",
            "Stillsong.exe"
        ));
    }
}
