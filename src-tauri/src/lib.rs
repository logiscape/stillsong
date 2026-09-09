mod components;
mod downloads;
mod files;
mod gpu;
mod http;
mod manifest;
mod supervisor;
mod ws;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(ws::WsState::default())
        .manage(downloads::DownloadState::default())
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            // Bundled ComfyUI-Stillsong overlay (comfy-overlay/ in the repo),
            // seeded into comfy-data/custom_nodes before each ComfyUI spawn.
            let overlay = app
                .path()
                .resource_dir()
                .ok()
                .map(|r| r.join("comfy-overlay").join("ComfyUI-Stillsong"));
            let sup =
                supervisor::Supervisor::new(app_data, overlay).map_err(std::io::Error::other)?;
            app.manage(sup);
            // Boot the studio in the background once setup has completed
            // (no-op with an external dev ComfyUI URL).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let sup = handle.state::<supervisor::Supervisor>();
                if sup.install_complete() {
                    // Installs that finished before archive cleanup existed
                    // still carry _downloads; the marker check inside keeps
                    // this a no-op for anything but a completed install.
                    let _ = sup.remove_downloads();
                    let _ = sup.ensure_comfy().await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            http::http_get,
            http::http_post_json,
            http::http_download,
            ws::ws_connect,
            ws::ws_close,
            files::files_library_dir,
            files::files_examples_dir,
            files::files_import,
            files::files_export,
            files::files_make_thumbnail,
            files::files_write_base64,
            files::files_sha256,
            files::files_read_base64,
            files::files_exists,
            files::files_delete,
            files::files_reveal,
            supervisor::runtime_status,
            supervisor::runtime_start_llm,
            supervisor::runtime_stop_llm,
            supervisor::runtime_urls,
            supervisor::runtime_start_comfy,
            supervisor::runtime_mark_install_complete,
            supervisor::runtime_set_components_dir,
            supervisor::runtime_paths,
            supervisor::runtime_comfy_outputs,
            supervisor::runtime_remove_comfy_output,
            supervisor::components_remove_downloads,
            gpu::gpu_info,
            downloads::download_component,
            downloads::download_cancel,
            components::components_extract,
            components::components_bootstrap_python,
            components::components_verify,
            components::components_free_space,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Graceful child shutdown; the Job Object is the kernel
                // backstop if this never runs (crash, kill -9).
                let sup = app_handle.state::<supervisor::Supervisor>();
                tauri::async_runtime::block_on(sup.stop_all());
            }
        });
}
