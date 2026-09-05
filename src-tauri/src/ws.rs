// WebSocket bridge: connects to ComfyUI's /ws and forwards text frames to the
// webview over a tauri ipc Channel. Reconnection policy lives in TS; each
// connection gets an id so stale sockets can be closed.

use futures_util::StreamExt;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tokio::sync::oneshot;

#[derive(Clone, serde::Serialize)]
#[serde(tag = "kind")]
pub enum WsEvent {
    #[serde(rename = "open")]
    Open,
    #[serde(rename = "message")]
    Message { data: String },
    #[serde(rename = "close")]
    Close,
}

pub struct WsState {
    pub cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

impl Default for WsState {
    fn default() -> Self {
        Self {
            cancels: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub async fn ws_connect(
    state: tauri::State<'_, WsState>,
    id: String,
    url: String,
    on_event: Channel<WsEvent>,
) -> Result<(), String> {
    // Same offline boundary as the HTTP bridge: plain ws:// to loopback only.
    let url = crate::http::loopback_url(&url, &["ws"])?;
    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    state.cancels.lock().unwrap().insert(id.clone(), cancel_tx);

    let (stream, _) = tokio_tungstenite::connect_async(url.as_str())
        .await
        .map_err(|e| e.to_string())?;
    let _ = on_event.send(WsEvent::Open);
    let (_write, mut read) = stream.split();

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,
                msg = read.next() => {
                    match msg {
                        Some(Ok(tokio_tungstenite::tungstenite::Message::Text(t))) => {
                            let _ = on_event.send(WsEvent::Message { data: t });
                        }
                        Some(Ok(_)) => { /* ignore binary preview frames */ }
                        Some(Err(_)) | None => break,
                    }
                }
            }
        }
        let _ = on_event.send(WsEvent::Close);
    });
    Ok(())
}

#[tauri::command]
pub async fn ws_close(state: tauri::State<'_, WsState>, id: String) -> Result<(), String> {
    if let Some(tx) = state.cancels.lock().unwrap().remove(&id) {
        let _ = tx.send(());
    }
    Ok(())
}
