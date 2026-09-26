use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::time::Duration;

// Global server child handle
static SERVER_CHILD: once_cell::sync::Lazy<Arc<Mutex<Option<Child>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(None)));
static SERVER_PORT: once_cell::sync::Lazy<Arc<Mutex<Option<u16>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(None)));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    pub ip: String,
    pub port: Option<u16>,
    pub mac: String,
    pub hostname: String,
    pub device_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerState {
    pub running: bool,
    pub port: Option<u16>,
    pub pid: Option<u32>,
    pub mode: String, // "sidecar" | "remote" | "offline"
}

fn find_available_port(start: u16) -> u16 {
    let mut port = start;
    while port < 65535 {
        if let Ok(listener) = TcpListener::bind(format!("127.0.0.1:{}", port)) {
            drop(listener);
            return port;
        }
        port += 1;
    }
    start
}

fn get_lan_ip() -> String {
    // Use get_if_addrs to find first non-loopback ipv4
    if let Ok(addrs) = get_if_addrs::get_if_addrs() {
        for addr in &addrs {
            if !addr.ip().is_loopback() && addr.ip().is_ipv4() {
                // Prefer ethernet-like interfaces (not vpn/tun)
                let name = addr.name.to_lowercase();
                if !name.contains("vpn") && !name.contains("tun") && !name.contains("tap") {
                    return addr.ip().to_string();
                }
            }
        }
        for addr in &addrs {
            if !addr.ip().is_loopback() && addr.ip().is_ipv4() {
                return addr.ip().to_string();
            }
        }
    }
    "127.0.0.1".to_string()
}

fn get_mac() -> String {
    mac_address::get_mac_address()
        .ok()
        .flatten()
        .map(|m| m.to_string())
        .unwrap_or_default()
}

fn get_hostname() -> String {
    hostname::get()
        .ok()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

fn get_device_fingerprint() -> String {
    // Try composite: wmic csproduct get UUID + wmic volume C: get SerialNumber
    // Fallback to MAC
    #[cfg(target_os = "windows")]
    {
        let uuid = Command::new("wmic")
            .args(["csproduct", "get", "UUID"])
            .output()
            .ok()
            .and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout).to_string();
                s.lines()
                    .skip(1)
                    .map(|l| l.trim().to_string())
                    .find(|l| !l.is_empty() && l != "UUID")
            })
            .unwrap_or_default();

        let serial = Command::new("wmic")
            .args(["volume", "where", "DriveLetter='C:'", "get", "SerialNumber"])
            .output()
            .ok()
            .and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout).to_string();
                s.lines()
                    .skip(1)
                    .map(|l| l.trim().to_string())
                    .find(|l| !l.is_empty() && l != "SerialNumber")
            })
            .unwrap_or_default();

        if !uuid.is_empty() || !serial.is_empty() {
            let combined = format!("{}:{}", uuid, serial);
            // SHA-256
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(combined.as_bytes());
            let result = hasher.finalize();
            return hex::encode(result);
        }
    }
    // Fallback to MAC
    get_mac()
}

fn configured_admin_password() -> Option<String> {
    std::env::var("ADMIN_PASSWORD")
        .ok()
        .filter(|value| !value.is_empty() && value != "admin123" && value != "CHANGE_ME_ADMIN_SET_VIA_ENV")
        .or_else(|| {
            let content = std::fs::read_to_string(r"D:\proj\Server\clinic-server\.env").ok()?;
            content.lines().find_map(|line| {
                let value = line.strip_prefix("ADMIN_PASSWORD=")?.trim();
                if value.is_empty() { None } else { Some(value.to_string()) }
            })
        })
}

fn configured_sync_secret() -> Option<String> {
    std::env::var("SYNC_SECRET")
        .ok()
        .filter(|value| !value.is_empty())
}

fn generated_admin_password() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("secure random");
    URL_SAFE_NO_PAD.encode(bytes)
}

fn app_data_dir() -> PathBuf {
    let base = if cfg!(windows) {
        std::env::var("APPDATA").ok().map(PathBuf::from)
    } else {
        std::env::var("XDG_DATA_HOME").ok().map(PathBuf::from)
    };
    base.unwrap_or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
            .unwrap_or_else(std::env::temp_dir)
    })
    .join("Zeyara")
    .join("server")
}

fn java_executable() -> PathBuf {
    let executable = if cfg!(windows) { "java.exe" } else { "java" };
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidates = [
                dir.join("resources/jre/bin").join(executable),
                dir.join("_up_/resources/jre/bin").join(executable),
            ];
            for candidate in candidates {
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }
    PathBuf::from("java")
}

fn is_port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok()
}

fn get_app_dir() -> PathBuf {
    // Try to find clinic-server jar next to exe or in dev
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Check for jar in various locations
            let candidates = [
                dir.join("clinic-server-1.7.0.jar"),
                dir.join("resources").join("clinic-server-1.7.0.jar"),
                dir.join("_up_/Server/clinic-server/target/clinic-server-1.7.0.jar"),
                dir.join("_up_/_up_/Server/clinic-server/target/clinic-server-1.7.0.jar"),
                dir.join("../clinic-server/target/clinic-server-1.7.0.jar"),
                PathBuf::from(r"D:\proj\Server\clinic-server\target\clinic-server-1.7.0.jar"),
            ];
            for c in &candidates {
                if c.exists() {
                    return c.clone();
                }
            }
            return dir.to_path_buf();
        }
    }
    PathBuf::from(r"D:\proj\Server\clinic-server\target\clinic-server-1.7.0.jar")
}

fn get_log_path() -> PathBuf {
    app_data_dir().join("logs").join("clinic-server.log")
}

#[tauri::command]
pub async fn get_system_info() -> Result<SystemInfo, String> {
    let port = SERVER_PORT.lock().unwrap().clone();
    Ok(SystemInfo {
        ip: get_lan_ip(),
        port,
        mac: get_mac(),
        hostname: get_hostname(),
        device_fingerprint: get_device_fingerprint(),
    })
}

#[tauri::command]
pub async fn get_device_fingerprint_composite() -> Result<String, String> {
    Ok(get_device_fingerprint())
}

#[tauri::command]
pub async fn get_server_state() -> Result<ServerState, String> {
    let child_opt = SERVER_CHILD.lock().unwrap();
    let port_opt = SERVER_PORT.lock().unwrap().clone();

    if let Some(child) = child_opt.as_ref() {
        // Check if child still running by trying to see if pid is still alive
        // We can't easily check without try_wait, so we use port check + child existence
        let running = if let Some(p) = port_opt {
            is_port_open(p)
        } else {
            true // assume running if child exists but no port
        };
        if running {
            return Ok(ServerState {
                running: true,
                port: port_opt,
                pid: Some(child.id()),
                mode: "sidecar".to_string(),
            });
        }
    }
    // No sidecar child, check if there's a remote server via port 8081
    let check_port = port_opt.unwrap_or(8081);
    if is_port_open(check_port) {
        return Ok(ServerState {
            running: true,
            port: Some(check_port),
            pid: None,
            mode: "remote".to_string(),
        });
    }
    // Also check 8080
    if check_port != 8080 && is_port_open(8080) {
        return Ok(ServerState {
            running: true,
            port: Some(8080),
            pid: None,
            mode: "remote".to_string(),
        });
    }
    Ok(ServerState {
        running: false,
        port: port_opt,
        pid: None,
        mode: "offline".to_string(),
    })
}

#[tauri::command]
pub async fn start_server(port: Option<u16>) -> Result<HashMap<String, String>, String> {
    {
        let child = SERVER_CHILD.lock().unwrap();
        if child.is_some() {
            return Err("Server already running".to_string());
        }
    }

    let target_port = port.unwrap_or_else(|| find_available_port(8081));
    // Double-check port is free
    if is_port_open(target_port) {
        return Err(format!("Port {} already in use", target_port));
    }

    let jar_path = get_app_dir();
    let jar_str = if jar_path.is_file() {
        jar_path.to_string_lossy().to_string()
    } else {
        // Try to find jar
        r"D:\proj\Server\clinic-server\target\clinic-server-1.7.0.jar".to_string()
    };

    if !std::path::Path::new(&jar_str).exists() {
        return Err(format!("Server jar not found at {}", jar_str));
    }

    // Get ADMIN_PASSWORD from env or generate
    let admin_pw = configured_admin_password().unwrap_or_else(generated_admin_password);
    let sync_secret = configured_sync_secret().unwrap_or_else(generated_admin_password);

    // Spawn java
    let data_dir = app_data_dir();
    std::fs::create_dir_all(data_dir.join("logs")).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(java_executable());
    cmd.current_dir(&data_dir);
    cmd.arg("-jar")
        .arg(&jar_str)
        .arg(format!("--server.port={}", target_port));

    // Inherit env
    cmd.env("ADMIN_PASSWORD", &admin_pw);
    cmd.env("SYNC_SECRET", &sync_secret);

    // On Windows, hide console
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd.spawn().map_err(|e| format!("Failed to start server: {}", e))?;
    let pid = child.id();

    {
        let mut child_lock = SERVER_CHILD.lock().unwrap();
        *child_lock = Some(child);
        let mut port_lock = SERVER_PORT.lock().unwrap();
        *port_lock = Some(target_port);
    }

    let mut ready = false;
    let mut waited = 0;
    while waited < 15 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        if is_port_open(target_port) {
            ready = true;
            break;
        }
        waited += 1;
    }

    if !ready {
        if let Some(mut child) = SERVER_CHILD.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *SERVER_PORT.lock().unwrap() = None;
        return Err("Server did not become ready within 15 seconds".to_string());
    }

    let mut map = HashMap::new();
    map.insert("port".to_string(), target_port.to_string());
    map.insert("pid".to_string(), pid.to_string());
    map.insert("status".to_string(), "started".to_string());
    Ok(map)
}

#[tauri::command]
pub async fn stop_server() -> Result<String, String> {
    let mut child_opt = SERVER_CHILD.lock().unwrap();
    if let Some(mut child) = child_opt.take() {
        // Try graceful kill
        #[cfg(target_os = "windows")]
        {
            let _ = child.kill();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = child.kill();
        }
        let _ = child.wait();
        let mut port_lock = SERVER_PORT.lock().unwrap();
        *port_lock = None;
        return Ok("Server stopped".to_string());
    }
    // No sidecar child, try to find and kill by port
    Err("No sidecar server running (remote mode, cannot stop)".to_string())
}

#[tauri::command]
pub async fn restart_server() -> Result<HashMap<String, String>, String> {
    let port = SERVER_PORT.lock().unwrap().clone();
    let _ = stop_server().await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    start_server(port).await
}

#[tauri::command]
pub async fn get_server_logs(lines: Option<usize>) -> Result<String, String> {
    let n = lines.unwrap_or(200);
    let log_path = get_log_path();
    if !log_path.exists() {
        return Ok("(No log file found at ".to_string() + &log_path.to_string_lossy().to_string() + ")");
    }
    let content = std::fs::read_to_string(&log_path).map_err(|e| e.to_string())?;
    let all_lines: Vec<&str> = content.lines().collect();
    let start = if all_lines.len() > n {
        all_lines.len() - n
    } else {
        0
    };
    Ok(all_lines[start..].join("\n"))
}

#[tauri::command]
pub async fn check_firewall() -> Result<bool, String> {
    let output = Command::new("netsh")
        .args(["advfirewall", "firewall", "show", "rule", "name=Zeyara Server"])
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    Ok(stdout.contains("Zeyara Server"))
}

#[tauri::command]
pub async fn fix_firewall() -> Result<String, String> {
    // Try non-elevated add
    let exe_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("Zeyara.exe").to_string_lossy().to_string()))
        .unwrap_or_else(|| r"C:\Program Files\Zeyara\Zeyara.exe".to_string());

    let output = Command::new("netsh")
        .args([
            "advfirewall",
            "firewall",
            "add",
            "rule",
            "name=Zeyara Server",
            "dir=in",
            "action=allow",
            &format!("program={}", exe_path),
            "enable=yes",
        ])
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.contains("Ok.") {
        return Ok("Firewall rule added".to_string());
    }
    // Try elevated via powershell
    let ps_script = format!(
        "Start-Process -FilePath 'netsh' -ArgumentList 'advfirewall firewall add rule name=\"Zeyara Server\" dir=in action=allow program=\"{}\" enable=yes' -Verb RunAs -Wait",
        exe_path
    );
    let _ = Command::new("powershell")
        .args(["-Command", &ps_script])
        .output();
    // Check again
    tokio::time::sleep(Duration::from_secs(3)).await;
    let check = check_firewall().await?;
    if check {
        Ok("Firewall rule added (elevated)".to_string())
    } else {
        Err("Failed to add firewall rule, please run as administrator".to_string())
    }
}
