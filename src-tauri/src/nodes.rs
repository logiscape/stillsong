//! Stillsong 2's first-party ComfyUI node package (`comfy-nodes/ComfyUI-Stillsong2`),
//! compiled into the binary and written into `comfy-data/custom_nodes` before
//! every ComfyUI spawn. Embedding (rather than shipping a resource file) means
//! the copy ComfyUI loads always comes from this build: it cannot drift from
//! the ComfyUI pin it was derived for, and nothing on disk has to be trusted.
//!
//! It is the only custom node package the studio loads: the supervisor
//! launches ComfyUI with every other folder in `custom_nodes` disabled
//! (`launch_flags`), so a third-party pack dropped there never runs.

use std::path::Path;

/// Folder name under `custom_nodes`; also the name ComfyUI's whitelist matches.
pub const PACKAGE: &str = "ComfyUI-Stillsong2";

/// Every file of the package. A test keeps this list equal to the directory.
pub const FILES: [(&str, &str); 4] = [
    (
        "__init__.py",
        include_str!("../../comfy-nodes/ComfyUI-Stillsong2/__init__.py"),
    ),
    (
        "stillsong2_ar.py",
        include_str!("../../comfy-nodes/ComfyUI-Stillsong2/stillsong2_ar.py"),
    ),
    (
        "take_format.py",
        include_str!("../../comfy-nodes/ComfyUI-Stillsong2/take_format.py"),
    ),
    (
        "README.md",
        include_str!("../../comfy-nodes/ComfyUI-Stillsong2/README.md"),
    ),
];

/// ComfyUI arguments that load this package and no other custom node. The
/// whitelist takes one or more names, so these must come last on the command
/// line.
///
/// `installed` is whether `install` just succeeded. When it did not, the
/// folder may still hold an older build's files (or half of this one's), so
/// it is not whitelisted: ComfyUI then loads no custom node at all and the
/// engine falls back to the core nodes.
pub fn launch_flags(installed: bool) -> &'static [&'static str] {
    if installed {
        &[
            "--disable-all-custom-nodes",
            "--whitelist-custom-nodes",
            PACKAGE,
        ]
    } else {
        &["--disable-all-custom-nodes"]
    }
}

/// Replaces `<custom_nodes>/ComfyUI-Stillsong2` with the embedded sources.
/// Only that folder is touched.
pub fn install(custom_nodes: &Path) -> std::io::Result<()> {
    let dir = custom_nodes.join(PACKAGE);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
    }
    std::fs::create_dir_all(&dir)?;
    for (name, text) in FILES {
        std::fs::write(dir.join(name), text)?;
    }
    Ok(())
}

/// The sha256 of ComfyUI's `comfy/text_encoders/yue2.py` the package is pinned
/// to (`PINNED_YUE2_SHA256` in `stillsong2_ar.py`); the package refuses to load
/// against any other. Read by the tests that hold the pin to the pinned ComfyUI.
#[cfg(test)]
pub fn pinned_yue2_sha256() -> Option<&'static str> {
    let source = FILES.iter().find(|(n, _)| *n == "stillsong2_ar.py")?.1;
    let line = source
        .lines()
        .find(|l| l.starts_with("PINNED_YUE2_SHA256"))?;
    let value = line.split('"').nth(1)?;
    (value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_files_match_the_package_directory() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("comfy-nodes")
            .join(PACKAGE);
        let mut on_disk: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap())
            .filter(|e| e.file_type().unwrap().is_file())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        on_disk.sort();
        let mut embedded: Vec<String> = FILES.iter().map(|(n, _)| n.to_string()).collect();
        embedded.sort();
        assert_eq!(
            embedded, on_disk,
            "nodes::FILES must list every package file"
        );
    }

    #[test]
    fn the_pin_is_a_sha256() {
        assert!(pinned_yue2_sha256().is_some());
    }

    #[test]
    fn install_replaces_only_its_own_folder() {
        let root = std::env::temp_dir().join(format!("stillsong2-nodes-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let other = root.join("someone-elses-pack");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("__init__.py"), "x").unwrap();
        let stale = root.join(PACKAGE).join("old.py");
        std::fs::create_dir_all(stale.parent().unwrap()).unwrap();
        std::fs::write(&stale, "old").unwrap();

        install(&root).unwrap();

        assert!(!stale.exists(), "a file from an older build is removed");
        assert!(
            other.join("__init__.py").exists(),
            "other folders are left alone"
        );
        for (name, text) in FILES {
            assert_eq!(
                std::fs::read_to_string(root.join(PACKAGE).join(name)).unwrap(),
                text
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_whitelist_ends_the_flags() {
        let flags = launch_flags(true);
        assert_eq!(flags[0], "--disable-all-custom-nodes");
        assert_eq!(flags[flags.len() - 2], "--whitelist-custom-nodes");
        assert_eq!(flags[flags.len() - 1], PACKAGE);
    }

    #[test]
    fn a_failed_install_whitelists_nothing() {
        // Something that is not a folder sits where the package goes, so it
        // can be neither cleared nor written into.
        let root =
            std::env::temp_dir().join(format!("stillsong2-nodes-fail-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(PACKAGE), "not a folder").unwrap();

        let installed = install(&root).is_ok();

        assert!(!installed);
        // No custom node loads at all: whatever is left there is not ours to trust.
        assert_eq!(launch_flags(installed), ["--disable-all-custom-nodes"]);
        let _ = std::fs::remove_dir_all(&root);
    }
}
