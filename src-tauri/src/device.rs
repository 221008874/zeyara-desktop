//! Stable device identity.
//!
//! This value is sent as `X-Client-Fingerprint` on every request. The server mixes it
//! with the User-Agent and Accept-Language into the JWT `clientHash`
//! (`JwtUtil.computeClientHash`); if the value changes between requests, the server
//! stops recognising the token and the user is bounced to the login screen.
//!
//! A MAC address is therefore the wrong source. Clinic PCs move between wired and
//! Wi-Fi, get new virtual adapters when a VPN is connected, and can be re-imaged with a
//! different primary adapter - any of which changes the MAC and logs the user out. The
//! machine GUID and the system volume serial survive all of that, so they are preferred
//! and the MAC is only a last resort.

use once_cell::sync::Lazy;
use sha2::{Digest, Sha256};

/// Resolved once per launch. Probing the registry and the volume table costs a few
/// hundred milliseconds, which is fine once and unacceptable per request.
static FINGERPRINT: Lazy<String> = Lazy::new(compute_fingerprint);

/// Heuristic length matching the server's device-binding hash.
const FINGERPRINT_LEN: usize = 32;

fn compute_fingerprint() -> String {
    let mut material = String::new();

    if let Some(guid) = windows_machine_guid() {
        material.push_str(&guid);
    }
    if let Some(serial) = windows_system_volume_serial() {
        material.push('|');
        material.push_str(&serial);
    }

    // Hostname is a weak but stable addition, and it keeps two identically-imaged
    // machines apart when the GUID read fails.
    if let Ok(host) = hostname::get() {
        material.push('|');
        material.push_str(&host.to_string_lossy());
    }

    if material.trim_matches('|').is_empty() {
        // Last resort: the MAC, which is at least stable within a session.
        material = mac_address::get_mac_address()
            .ok()
            .flatten()
            .map(|m| m.to_string())
            .unwrap_or_else(|| "unknown-device".to_string());
    }

    let digest = Sha256::digest(material.as_bytes());
    hex::encode(digest)[..FINGERPRINT_LEN].to_string()
}

/// `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`.
///
/// `winreg` would be tidier, but a read-only `reg query` avoids a new dependency for a
/// value we read exactly once.
fn windows_machine_guid() -> Option<String> {
    if !cfg!(windows) {
        return None;
    }
    let out = std::process::Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    parse_reg_value(&text, "MachineGuid")
}

/// Serial number of the volume the OS is installed on.
fn windows_system_volume_serial() -> Option<String> {
    if !cfg!(windows) {
        return None;
    }
    let out = std::process::Command::new("cmd")
        .args(["/c", "vol", "C:"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    // " Volume in drive C has no label. Volume Serial Number is 1A2B-3C4D"
    let idx = text.find("Volume Serial Number is")?;
    let serial = text[idx + "Volume Serial Number is".len()..].trim();
    if serial.is_empty() {
        None
    } else {
        Some(serial.to_string())
    }
}

/// Pulls the value that follows a `REG_SZ` line's key name.
fn parse_reg_value(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(key) {
            let value = rest.trim_start_matches([' ', '\t', '=']).trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// The stable fingerprint for this machine.
#[tauri::command]
pub async fn get_device_fingerprint() -> Result<String, String> {
    Ok(FINGERPRINT.clone())
}

#[cfg(test)]
mod tests {
    use super::parse_reg_value;

    #[test]
    fn parses_a_reg_query_value() {
        let out = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    4f9a2b1c-8d3e-4a5f-9b7c-1d2e3f4a5b6c\r\n\r\n";
        assert_eq!(
            parse_reg_value(out, "MachineGuid").as_deref(),
            Some("4f9a2b1c-8d3e-4a5f-9b7c-1d2e3f4a5b6c")
        );
    }

    #[test]
    fn returns_none_when_absent() {
        assert_eq!(parse_reg_value("HKEY_...\r\n    Other REG_SZ x\r\n", "MachineGuid"), None);
    }

    #[test]
    fn returns_none_for_empty_output() {
        assert_eq!(parse_reg_value("", "MachineGuid"), None);
    }
}
