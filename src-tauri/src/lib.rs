mod documents;
mod heartbeat;
mod server;

use tauri::{Emitter, Manager, WindowEvent};

struct DiscoveredServer(std::sync::Mutex<Option<String>>);

/// Guards against a close-request that never receives a matching `finish_close`.
/// If the frontend doesn't run the backup and finish within the timeout, we
/// force-close so the user is never stuck with a window that cannot close.
const CLOSE_TIMEOUT_SECS: u64 = 20;

#[tauri::command]
async fn finish_close(
    app: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    let window = app.get_webview_window(&label)
        .ok_or_else(|| "window not found".to_string())?;
    let _ = window.destroy();
    Ok(())
}

#[tauri::command]
async fn get_device_fingerprint() -> Result<String, String> {
    let mac = mac_address::get_mac_address()
        .ok()
        .flatten()
        .map(|m| m.to_string())
        .unwrap_or_default();
    Ok(mac)
}

#[tauri::command]
async fn get_network_interfaces() -> Result<Vec<String>, String> {
    let addrs = get_if_addrs::get_if_addrs()
        .map(|a| {
            a.iter()
                .filter(|addr| !addr.ip().is_loopback() && addr.ip().is_ipv4())
                .map(|addr| addr.ip().to_string())
                .collect()
        })
        .unwrap_or_default();
    Ok(addrs)
}

#[tauri::command]
async fn start_heartbeat_monitor(
    app: tauri::AppHandle,
    secret: Option<String>,
) -> Result<(), String> {
    let ctrl = app.state::<heartbeat::HeartbeatController>();
    let app = app.clone();
    // Fall back to the shared SYNC_SECRET env var (same source the server uses).
    let secret = match secret {
        Some(s) if !s.is_empty() => Some(s),
        _ => std::env::var("SYNC_SECRET").ok(),
    };
    ctrl.start(app, secret)
}

#[tauri::command]
async fn stop_heartbeat_monitor(app: tauri::AppHandle) -> Result<(), String> {
    let ctrl = app.state::<heartbeat::HeartbeatController>();
    ctrl.stop();
    Ok(())
}

#[tauri::command]
async fn get_heartbeat_state(app: tauri::AppHandle) -> Result<heartbeat::HeartbeatState, String> {
    let ctrl = app.state::<heartbeat::HeartbeatController>();
    Ok(ctrl.state())
}

#[cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
pub fn run() {
    tauri::Builder::default()
        // Native capabilities used by the client (Phase 6):
        //   dialog      - native open/save so generated PDF/CSV/XLSX files land where the
        //                 user chooses instead of a silent browser download
        //   opener      - open a generated document or reveal it in Explorer
        //   notification- OS-level alerts for appointments and new messages
        // Permissions are granted individually in capabilities/default.json; the
        // shell plugin is intentionally NOT registered, because nothing used it.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(DiscoveredServer(std::sync::Mutex::new(None)))
        .manage(heartbeat::HeartbeatController::new())
        .on_window_event(|window, event| {
            // Intercept close requests so the frontend can run an async
            // best-effort backup before the window actually closes.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let label = window.label().to_string();
                let app = window.app_handle().clone();
                let _ = window.emit("before-close", label.clone());
                api.prevent_close();

                tauri::async_runtime::spawn(async move {
                    // Force-close if the frontend never acknowledges the prompt.
                    tokio::time::sleep(std::time::Duration::from_secs(CLOSE_TIMEOUT_SECS)).await;
                    if let Some(win) = app.get_webview_window(&label) {
                        let _ = win.destroy();
                    }
                });
            }
        })
        .invoke_handler(tauri::generate_handler![
            documents::save_document,
            get_device_fingerprint,
            get_network_interfaces,
            start_heartbeat_monitor,
            stop_heartbeat_monitor,
            get_heartbeat_state,
            finish_close,
            server::get_system_info,
            server::get_device_fingerprint_composite,
            server::get_server_state,
            server::start_server,
            server::stop_server,
            server::restart_server,
            server::get_server_logs,
            server::check_firewall,
            server::fix_firewall,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
