// File utilities: library dir management, imports, thumbnails + ambiance
// measurement, hashing, base64 for the vision pass, delete, and
// reveal-in-Explorer.

use base64::Engine as _;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

pub fn library_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = tauri::Manager::path(app)
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("library");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn files_library_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(library_root(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn files_import(
    app: tauri::AppHandle,
    src_path: String,
    rel_path: String,
) -> Result<String, String> {
    let dest = library_root(&app)?.join(&rel_path);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::fs::copy(&src_path, &dest)
        .await
        .map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
pub struct ThumbnailResult {
    pub path: String,
    /// Average luminance 0..1 (Rec. 709 weights on gamma-encoded values).
    pub luminance: f64,
    /// #rrggbb of the most common coarse colour bucket.
    #[serde(rename = "dominantColor")]
    pub dominant_color: String,
}

/// Downscales to `max_dim`, saves a WebP thumbnail, and measures average
/// luminance + dominant colour (they drive the lyric scrim and ambient wash).
#[tauri::command]
pub async fn files_make_thumbnail(
    app: tauri::AppHandle,
    src_path: String,
    rel_path: String,
    max_dim: u32,
) -> Result<ThumbnailResult, String> {
    let dest = library_root(&app)?.join(&rel_path);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::task::spawn_blocking(move || {
        let img = image::open(&src_path).map_err(|e| format!("could not read image: {e}"))?;
        let thumb = img.thumbnail(max_dim, max_dim).to_rgb8();

        let mut lum_sum = 0f64;
        // 3 bits per channel = 512 buckets; keep per-bucket sums for a
        // representative (not posterized) dominant colour.
        let mut counts = [0u32; 512];
        let mut sums = [[0u64; 3]; 512];
        for p in thumb.pixels() {
            let [r, g, b] = p.0;
            lum_sum += (0.2126 * r as f64 + 0.7152 * g as f64 + 0.0722 * b as f64) / 255.0;
            let bucket =
                (((r >> 5) as usize) << 6) | (((g >> 5) as usize) << 3) | ((b >> 5) as usize);
            counts[bucket] += 1;
            sums[bucket][0] += r as u64;
            sums[bucket][1] += g as u64;
            sums[bucket][2] += b as u64;
        }
        let n = (thumb.width() * thumb.height()).max(1) as f64;
        let luminance = lum_sum / n;
        let (best, best_count) = counts
            .iter()
            .enumerate()
            .max_by_key(|(_, c)| **c)
            .map(|(i, c)| (i, *c))
            .unwrap_or((0, 0));
        let dominant = if best_count > 0 {
            let c = best_count as u64;
            format!(
                "#{:02x}{:02x}{:02x}",
                (sums[best][0] / c) as u8,
                (sums[best][1] / c) as u8,
                (sums[best][2] / c) as u8
            )
        } else {
            "#808080".to_string()
        };

        thumb
            .save_with_format(&dest, image::ImageFormat::WebP)
            .map_err(|e| format!("could not write thumbnail: {e}"))?;
        Ok(ThumbnailResult {
            path: dest.to_string_lossy().to_string(),
            luminance,
            dominant_color: dominant,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copies a song out of the library to a user-chosen destination (Save As).
/// The exported copy gets an ID3 comment disclosing machine generation — the
/// MiniMax-Music3 AUP requires publicly shared AI content to be disclosed, so
/// the file carries it automatically wherever it travels.
#[tauri::command]
pub async fn files_export(src_path: String, dest_path: String) -> Result<String, String> {
    let dest = PathBuf::from(&dest_path);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::fs::copy(&src_path, &dest)
        .await
        .map_err(|e| e.to_string())?;
    let tag_dest = dest.clone();
    tokio::task::spawn_blocking(move || {
        use id3::TagLike;
        let mut tag = id3::Tag::read_from_path(&tag_dest).unwrap_or_default();
        tag.add_frame(id3::frame::Comment {
            lang: "eng".into(),
            description: "AI disclosure".into(),
            text: "AI-generated music (MiniMax-Music3), created locally with Stillsong.".into(),
        });
        let _ = tag.write_to_path(&tag_dest, id3::Version::Id3v24);
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(dest_path)
}

/// Writes base64-decoded bytes into the library (the canvas drawing's PNG
/// bytes exist only in the webview — there is no source file to copy).
#[tauri::command]
pub async fn files_write_base64(
    app: tauri::AppHandle,
    rel_path: String,
    b64: String,
) -> Result<String, String> {
    let dest = library_root(&app)?.join(&rel_path);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| e.to_string())?;
    tokio::fs::write(&dest, bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn files_sha256(path: String) -> Result<String, String> {
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub async fn files_read_base64(path: String) -> Result<String, String> {
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub async fn files_exists(path: String) -> Result<bool, String> {
    Ok(tokio::fs::metadata(&path).await.is_ok())
}

#[tauri::command]
pub async fn files_delete(path: String) -> Result<(), String> {
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Opens the OS file manager with the file selected (Windows Explorer).
#[tauri::command]
pub async fn files_reveal(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let p = PathBuf::from(&path);
        let dir = p.parent().map(|d| d.to_path_buf()).unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
