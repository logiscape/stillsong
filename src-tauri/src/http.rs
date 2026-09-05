// Thin reqwest proxy so the webview never fights CORS. JSON in/out; binary
// downloads stream straight into the song library.
//
// This bridge is the only way the interface can reach a network at all (the
// CSP forbids browser fetches), so it is also where the offline boundary is
// enforced: every URL must be plain http:// (or ws:// for the socket bridge)
// to a loopback host, redirects are never followed, and downloads can only
// land inside the library. The engine builds its URLs from the supervisor's
// base URLs, which are loopback; anything else is refused regardless of what
// renderer code asks for.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};

#[derive(Serialize)]
pub struct HttpResult {
    pub status: u16,
    pub body: String,
}

/// Parses `url` and refuses anything that is not `scheme://<loopback>[:port]/…`.
/// Loopback means 127.0.0.1, ::1 or localhost; userinfo is rejected so a
/// `127.0.0.1@evil.example` form cannot read as local.
pub fn loopback_url(url: &str, schemes: &[&str]) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("bad url: {e}"))?;
    if !schemes.contains(&parsed.scheme()) {
        return Err(format!(
            "refused: scheme {}:// is not allowed",
            parsed.scheme()
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("refused: credentials in url".into());
    }
    let local = match parsed.host_str() {
        Some(h) => {
            let bare = h.trim_start_matches('[').trim_end_matches(']');
            match bare.parse::<std::net::IpAddr>() {
                Ok(ip) => ip.is_loopback(),
                Err(_) => h.eq_ignore_ascii_case("localhost"),
            }
        }
        None => false,
    };
    if !local {
        return Err(format!(
            "refused: {} is not a loopback host",
            parsed.host_str().unwrap_or("?")
        ));
    }
    Ok(parsed)
}

/// A library-relative path that stays inside the library: normal components
/// only (no `..`, no root, no drive prefix).
pub fn library_relative(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.as_os_str().is_empty()
        || rel_path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!(
            "refused: {rel} is not a plain library-relative path"
        ));
    }
    Ok(root.join(rel_path))
}

/// A client for talking to our own loopback servers: no redirects (a local
/// server must never be able to bounce us elsewhere) and no proxy. reqwest's
/// default honours the Windows Internet Options proxy and HTTP_PROXY, and its
/// matcher neither bypasses loopback nor understands the `<local>` token in
/// Windows' bypass list — so on a proxied corporate machine every call to
/// 127.0.0.1 would otherwise be sent to the proxy and fail.
pub fn loopback_client(timeout: std::time::Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .build()
        .expect("reqwest client")
}

fn client() -> &'static reqwest::Client {
    use std::sync::OnceLock;
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| loopback_client(std::time::Duration::from_secs(120)))
}

#[tauri::command]
pub async fn http_get(url: String) -> Result<HttpResult, String> {
    let url = loopback_url(&url, &["http"])?;
    let resp = client().get(url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResult { status, body })
}

#[tauri::command]
pub async fn http_post_json(
    url: String,
    body: serde_json::Value,
    timeout_ms: Option<u64>,
) -> Result<HttpResult, String> {
    let url = loopback_url(&url, &["http"])?;
    let mut req = client().post(url).json(&body);
    // Per-request override of the client's 120 s default: a non-streaming LLM
    // completion sends nothing until generation finishes, which can take minutes.
    if let Some(ms) = timeout_ms {
        req = req.timeout(std::time::Duration::from_millis(ms));
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(HttpResult { status, body })
}

/// Streams a loopback URL to `rel_path` inside the song library; creates
/// parent dirs. Returns the absolute path written.
#[tauri::command]
pub async fn http_download(
    app: tauri::AppHandle,
    url: String,
    rel_path: String,
) -> Result<String, String> {
    use futures_util::StreamExt;
    let url = loopback_url(&url, &["http"])?;
    let dest = library_relative(&crate::files::library_root(&app)?, &rel_path)?;
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let resp = client().get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download failed: HTTP {}", resp.status()));
    }
    let tmp = dest.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::io::AsyncWriteExt::flush(&mut file)
        .await
        .map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(&tmp, &dest)
        .await
        .map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_forms_are_accepted() {
        for u in [
            "http://127.0.0.1:17800/prompt",
            "http://127.0.0.1:8000/view?filename=a.mp3&type=output",
            "http://localhost:17801/v1/chat/completions",
            "http://LOCALHOST:1/",
            "http://[::1]:17800/history",
            "http://127.0.0.1/",
            "http://127.0.0.2:17800/", // all of 127/8 routes to this machine
        ] {
            assert!(loopback_url(u, &["http"]).is_ok(), "{u}");
        }
        assert!(loopback_url("ws://127.0.0.1:17800/ws?clientId=x", &["ws"]).is_ok());
    }

    #[test]
    fn everything_else_is_refused() {
        for u in [
            "https://127.0.0.1:17800/prompt", // wrong scheme, even on loopback
            "http://example.com/upload",
            "https://example.com/upload",
            "http://127.0.0.1@evil.example/",  // userinfo trick
            "http://user:pw@127.0.0.1:17800/", // credentials
            "http://0.0.0.0:17800/",
            "http://10.0.0.5:17800/",
            "http://localhost.evil.example/",
            "http://127.0.0.1.evil.example/",
            "ws://127.0.0.1:17800/ws", // ws is not http
            "file:///C:/Windows/win.ini",
            "not a url",
        ] {
            assert!(loopback_url(u, &["http"]).is_err(), "{u}");
        }
        assert!(loopback_url("wss://127.0.0.1/ws", &["ws"]).is_err());
        assert!(loopback_url("ws://example.com/ws", &["ws"]).is_err());
    }

    #[test]
    fn library_relative_stays_inside() {
        let root = Path::new(r"C:\lib");
        assert_eq!(
            library_relative(root, "songs/abc.mp3").unwrap(),
            Path::new(r"C:\lib\songs\abc.mp3")
        );
        assert_eq!(
            library_relative(root, r"songs\abc.mp3").unwrap(),
            Path::new(r"C:\lib\songs\abc.mp3")
        );
        for bad in [
            "",
            "../x.mp3",
            "songs/../../x.mp3",
            r"C:\x.mp3",
            "/x.mp3",
            r"\\srv\share\x",
        ] {
            assert!(library_relative(root, bad).is_err(), "{bad}");
        }
    }
}
