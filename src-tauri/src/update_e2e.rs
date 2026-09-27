//! Updater end-to-end test support.
//!
//! The update check itself has never needed a Clinic Server: `checkForUpdate()` talks to
//! the published `latest.json` and nothing else. What tied it to the dashboard was only the
//! *call site* - the banner lives on `DashboardPage`, which sits behind authentication, so
//! exercising the updater needed a running server plus real clinic credentials. That made
//! the single most security-relevant flow in the client the hardest one to test.
//!
//! This module adds the minimum needed to drive the real path unattended, and deliberately
//! nothing more:
//!
//! * **It does not reimplement the updater.** The E2E page calls the same
//!   `checkForUpdate()` and `installUpdate()` the production banner calls. Signature
//!   verification, the HTTPS assertion and the no-downgrade policy all stay in the places
//!   they already lived. Nothing here can accept an unsigned or downgraded release.
//! * **It is off unless the environment asks for it.** Without `ZEYARA_UPDATE_E2E` the
//!   application renders exactly as before, and the entry point is not mounted, so it is
//!   absent from the router, the sidebar and production navigation.
//! * **It changes no signing configuration.** Same key, same policy, same endpoints.
//!
//! Results are appended to a JSON-lines report rather than printed, because the interesting
//! half of the cycle happens *after* the process is replaced by the updater. A second
//! process has to be able to add to the same record, and a human-readable log line cannot
//! be correlated across the restart.

use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use tauri::AppHandle;

/// Environment variable that enables the E2E entry point at all.
const ENV_ENABLE: &str = "ZEYARA_UPDATE_E2E";
/// Environment variable that installs a detected update without a click.
const ENV_AUTO: &str = "ZEYARA_UPDATE_E2E_AUTO";
/// Environment variable naming the report file. Defaults under the temp directory.
const ENV_REPORT: &str = "ZEYARA_UPDATE_E2E_REPORT";

/// What the frontend needs to know at startup.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct E2eConfig {
    /// False unless the environment opted in. When false the page is not mounted.
    pub enabled: bool,
    /// Install a detected update without waiting for a click.
    pub auto: bool,
    /// Where results are appended.
    pub report_path: String,
    /// The version this process is actually running, straight from Tauri.
    pub current_version: String,
}

/// Truthy parsing that does not treat the mere presence of a variable as consent.
/// `1`, `true`, `yes`, `on` enable; everything else, including empty, does not.
fn truthy(raw: Option<String>) -> bool {
    match raw {
        Some(v) => matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        None => false,
    }
}

/// Whether the E2E entry point is switched on for this process.
pub fn enabled() -> bool {
    truthy(std::env::var(ENV_ENABLE).ok())
}

/// Where the report is written.
///
/// A path is required to be absolute or already resolved against the temp directory, so a
/// harness can predict it. A directory-looking value gets `report.jsonl` appended, which
/// lets the harness point at a folder without having to name a file.
pub fn report_path() -> PathBuf {
    match std::env::var(ENV_REPORT).ok().filter(|s| !s.trim().is_empty()) {
        Some(p) => {
            let path = PathBuf::from(p.trim());
            if p.trim().ends_with('\\') || p.trim().ends_with('/') {
                path.join("report.jsonl")
            } else {
                path
            }
        }
        None => std::env::temp_dir().join("zeyara-update-e2e").join("report.jsonl"),
    }
}

/// Reports the E2E configuration, including the real running version.
#[tauri::command]
pub async fn update_e2e_config(app: AppHandle) -> Result<E2eConfig, String> {
    let version = app.package_info().version.to_string();
    Ok(E2eConfig {
        enabled: enabled(),
        auto: truthy(std::env::var(ENV_AUTO).ok()),
        report_path: report_path().to_string_lossy().to_string(),
        current_version: version,
    })
}

/// Appends one result record.
///
/// Appended, not overwritten, and each line is flushed: the pre-install record is written
/// by a process that is about to be terminated by the updater, so a buffered write would
/// be lost exactly when it matters most.
#[tauri::command]
pub async fn update_e2e_write_report(entry: serde_json::Value) -> Result<String, String> {
    let path = report_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
    }

    let line = serde_json::to_string(&entry).map_err(|e| format!("serialise report: {e}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open {}: {e}", path.display()))?;
    file.write_all(line.as_bytes())
        .and_then(|_| file.write_all(b"\n"))
        .and_then(|_| file.flush())
        .map_err(|e| format!("write {}: {e}", path.display()))?;

    Ok(path.to_string_lossy().to_string())
}
