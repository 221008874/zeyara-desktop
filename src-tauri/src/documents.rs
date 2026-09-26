//! Native document handling.
//!
//! The webview is deliberately given **no filesystem permission**. Asking the frontend
//! to write a path would mean granting `fs:allow-write-file`, which on Windows is a
//! capability to write anywhere the user can reach. Instead the whole flow lives here:
//! Rust opens the native save dialog, writes the bytes, and reports the path it used.
//! The frontend never names a location, so there is nothing for it to abuse.
//!
//! Reading a generated document back (open / reveal) is a separate, much narrower
//! capability handled by `tauri-plugin-opener`, because opening a file in its default
//! application carries far less risk than writing one.

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::DialogExt;

/// What happened to a save request, so the UI can report it accurately.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    /// False when the user dismissed the dialog. Not an error.
    pub saved: bool,
    /// Absolute path written, when `saved`.
    pub path: Option<String>,
    /// The file name the dialog proposed, whether or not it was accepted.
    pub suggested_name: String,
}

/// Hard ceiling on a single document. Generous for a PDF or spreadsheet, and it stops a
/// malformed or hostile payload from filling the disk.
const MAX_DOCUMENT_BYTES: usize = 256 * 1024 * 1024;

/// Writes `data` to a location the user picks in the native save dialog.
///
/// Returns `Ok(None)` when the user cancels, so the caller can distinguish
/// "declined" from "failed".
#[tauri::command]
pub async fn save_document<R: Runtime>(
    app: AppHandle<R>,
    suggested_name: String,
    data: Vec<u8>,
) -> Result<Option<SaveResult>, String> {
    if data.len() > MAX_DOCUMENT_BYTES {
        return Err(format!(
            "document is {} MB, which exceeds the {} MB limit",
            data.len() / (1024 * 1024),
            MAX_DOCUMENT_BYTES / (1024 * 1024)
        ));
    }

    // Guard against a suggested name that escapes its own directory or is not a plain
    // file name. The dialog would sanitise it anyway, but nothing should reach the
    // filesystem unvalidated.
    let safe_name = sanitise_file_name(&suggested_name);

    let ext = std::path::Path::new(&safe_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string();

    // Bound first: `ext.to_uppercase()` inline would be a temporary dropped while
    // borrowed.
    let ext_label = if ext.is_empty() {
        "All files".to_string()
    } else {
        ext.to_uppercase()
    };

    let picked = app
        .dialog()
        .file()
        .set_file_name(&safe_name)
        .add_filter(&ext_label, &[ext.as_str()])
        .blocking_save_file();

    let Some(path) = picked else {
        return Ok(None);
    };

    let path = path.into_path().map_err(|e| format!("invalid save path: {e}"))?;
    std::fs::write(&path, &data).map_err(|e| format!("could not write {}: {e}", path.display()))?;

    Ok(Some(SaveResult {
        saved: true,
        path: Some(path.to_string_lossy().to_string()),
        suggested_name: safe_name,
    }))
}

/// Reduces a caller-supplied name to a bare file name.
///
/// Rejects separators, `..`, drive letters and NUL/control characters by discarding
/// anything that is not a plain file-name character, then falls back to a default.
fn sanitise_file_name(input: &str) -> String {
    let cleaned: String = input
        .chars()
        .filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim();

    if cleaned.is_empty() || cleaned == "CON" || cleaned.starts_with('.') {
        return "document".to_string();
    }
    if cleaned.chars().count() > 200 {
        let truncated: String = cleaned.chars().take(200).collect();
        return truncated;
    }
    cleaned.to_string()
}

#[cfg(test)]
mod tests {
    use super::sanitise_file_name;

    #[test]
    fn keeps_ordinary_names() {
        assert_eq!(sanitise_file_name("report_2026-09-26.pdf"), "report_2026-09-26.pdf");
        assert_eq!(sanitise_file_name("كشف المرضى.xlsx"), "كشف المرضى.xlsx");
    }

    #[test]
    fn strips_path_traversal() {
        // A name that tries to escape must not keep its separators.
        let out = sanitise_file_name("../../etc/passwd");
        assert!(!out.contains('/'), "separators must not survive: {out}");
        assert!(!out.contains(".."), "parent refs must not survive: {out}");
    }

    #[test]
    fn strips_windows_device_and_drive_characters() {
        assert!(!sanitise_file_name(r"C:\Windows\System32\evil.dll").contains(':'));
        assert!(!sanitise_file_name("a|b>c.txt").contains('|'));
        assert!(!sanitise_file_name("a|b>c.txt").contains('>'));
    }

    #[test]
    fn falls_back_when_nothing_usable_is_left() {
        assert_eq!(sanitise_file_name(""), "document");
        assert_eq!(sanitise_file_name("   "), "document");
        assert_eq!(sanitise_file_name("..."), "document");
        assert_eq!(sanitise_file_name("CON"), "document");
    }

    #[test]
    fn caps_absurd_length() {
        let out = sanitise_file_name(&"a".repeat(500));
        assert_eq!(out.chars().count(), 200);
    }
}
