use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;

type HmacSha256 = Hmac<Sha256>;

pub const HEARTBEAT_PORT: u16 = 8888;

/// Number of consecutive heartbeats needed to declare the server ONLINE.
const ONLINE_CONSECUTIVE: i64 = 2;

/// Heartbeats are sent every 5s; treat the server as OFFLINE after
/// this many missed beats (3 * 5s + margin = 20s).
const OFFLINE_AFTER: Duration = Duration::from_secs(20);

const RECV_TIMEOUT: Duration = Duration::from_secs(1);

/// Maximum tolerated skew between the client clock and the server's signed
/// timestamp (heartbeats are sent every 5s, so 60s is very generous).
/// Packets older than this window are rejected outright, blocking replay of
/// captured heartbeats.
const MAX_TIMESTAMP_SKEW_MS: i64 = 60_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub server_ip: String,
    pub server_port: u16,
    pub server_name: String,
    pub timestamp: i64,
    pub status: String,
    pub sequence: i64,
    pub nonce: String,
    pub signature: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub ip: String,
    pub port: u16,
    pub name: String,
    pub verified: bool,
    pub last_seen_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct HeartbeatState {
    pub online: bool,
    pub server: Option<ServerInfo>,
    /// When online but the sender could not be verified (no shared secret).
    pub requires_trust: bool,
}

struct Listener {
    app: tauri::AppHandle,
    secret: Arc<Option<Vec<u8>>>,
    running: Arc<AtomicBool>,
    state: Arc<Mutex<HeartbeatState>>,
    consecutive: Arc<Mutex<i64>>,
    last_beat: Arc<Mutex<SystemTime>>,
    trust_pinned: Arc<Mutex<Option<String>>>, // ip:port pinned via TOFU
    last_seq: Arc<Mutex<i64>>,                // last accepted heartbeat sequence
    last_ts: Arc<Mutex<i64>>,                 // last accepted heartbeat timestamp
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn compute_hmac(secret: &[u8], msg: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac key");
    mac.update(msg.as_bytes());
    BASE64.encode(mac.finalize().into_bytes())
}

/// v2 signing payload. The version prefix + every identity field are covered
/// by the HMAC, so a captured packet can no longer be replayed with a forged
/// serverIp/serverPort/serverName. MUST match HeartbeatService.java.
fn signable_payload(hb: &HeartbeatMessage) -> String {
    format!(
        "v2:{}:{}:{}:{}:{}:{}",
        hb.timestamp, hb.nonce, hb.server_ip, hb.server_port, hb.server_name, hb.sequence
    )
}

fn timestamp_is_fresh(hb: &HeartbeatMessage) -> bool {
    let now = now_millis();
    (now - hb.timestamp).abs() <= MAX_TIMESTAMP_SKEW_MS
}

/// True when a packet with (sequence, timestamp) is not a replay of the last
/// seen one. A server restart resets its sequence to 1 but sends a fresh
/// timestamp, so the OR-condition lets restarts through while blocking
/// in-window duplicates.
fn not_replay(seq: i64, ts: i64, last_seq: i64, last_ts: i64) -> bool {
    !(seq <= last_seq && ts <= last_ts)
}

fn verify_signature(secret: &[u8], hb: &HeartbeatMessage) -> bool {
    if secret.is_empty() {
        return false;
    }
    if !timestamp_is_fresh(hb) {
        return false;
    }
    let expected = compute_hmac(secret, &signable_payload(hb));
    constant_time_eq(&expected, &hb.signature)
}

impl Listener {
    fn verify(&self, hb: &HeartbeatMessage) -> bool {
        match self.secret.as_ref() {
            Some(secret) if !secret.is_empty() => verify_signature(secret, hb),
            _ => false, // no secret -> cannot verify; TOFU instead
        }
    }

    fn run(&self) {
        let socket = match UdpSocket::bind(format!("0.0.0.0:{}", HEARTBEAT_PORT)) {
            Ok(s) => s,
            Err(e) => {
                let _ = self.app.emit("heartbeat://error", format!("{}", e));
                return;
            }
        };
        if socket.set_read_timeout(Some(RECV_TIMEOUT)).is_err() {
            let _ = self.app.emit("heartbeat://error", "set_read_timeout failed");
            return;
        }
        let mut buf = [0u8; 4096];
        while self.running.load(Ordering::SeqCst) {
            match socket.recv_from(&mut buf) {
                Ok((n, _src)) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    if let Some(hb) = self.parse_and_filter(&text) {
                        self.on_heartbeat(hb);
                    }
                }
                Err(_) => {
                    // timeout or transient error: check liveness below
                }
            }
            self.check_offline();
        }
    }

    fn parse_and_filter(&self, text: &str) -> Option<HeartbeatMessage> {
        let parsed: HeartbeatMessage = serde_json::from_str(text).ok()?;
        if parsed.msg_type != "HEARTBEAT" {
            return None;
        }
        if parsed.server_port == 0 {
            return None;
        }
        Some(parsed)
    }

    fn on_heartbeat(&self, hb: HeartbeatMessage) {
        let verified = self.verify(&hb);
        let key = format!("{}:{}", hb.server_ip, hb.server_port);

        let mut pinned = self.trust_pinned.lock().unwrap();
        let mut state = self.state.lock().unwrap();

        let has_secret = matches!(self.secret.as_ref(), Some(s) if !s.is_empty());
        let trust_ok = if has_secret {
            // A shared secret is configured: the HMAC signature MUST validate.
            verified
        } else {
            // TOFU: first-ever sender is pinned; later different senders need trust.
            match pinned.as_deref() {
                None => {
                    *pinned = Some(key.clone());
                    true
                }
                Some(p) if *p == key => true,
                Some(_) => false,
            }
        };

        if !trust_ok {
            // A new, unverified server is speaking; surface it for a trust decision.
            let _ = self.app.emit("heartbeat://requires-trust", &ServerInfo {
                ip: hb.server_ip,
                port: hb.server_port,
                name: hb.server_name,
                verified: false,
                last_seen_at: now_millis(),
            });
            return;
        }

        // Reject replayed / duplicate packets inside the freshness window.
        {
            let mut last_seq = self.last_seq.lock().unwrap();
            let mut last_ts = self.last_ts.lock().unwrap();
            if !not_replay(hb.sequence, hb.timestamp, *last_seq, *last_ts) {
                return;
            }
            *last_seq = hb.sequence;
            *last_ts = hb.timestamp;
        }

        *self.last_beat.lock().unwrap() = SystemTime::now();

        let was_online = state.online;
        let was_server = state.server.clone();

        let info = ServerInfo {
            ip: hb.server_ip,
            port: hb.server_port,
            name: hb.server_name,
            verified,
            last_seen_at: now_millis(),
        };

        let mut consecutive = self.consecutive.lock().unwrap();
        *consecutive += 1;

        if *consecutive >= ONLINE_CONSECUTIVE {
            state.online = true;
            state.requires_trust = false;
            state.server = Some(info.clone());
        }

        if state.online && was_online {
            // Same server still online; nothing to emit except server-change.
            if let Some(prev) = &was_server {
                if prev.ip != info.ip || prev.port != info.port {
                    let _ = self.app.emit("heartbeat://server-changed", &info);
                }
            }
        } else if state.online && !was_online {
            let _ = self.app.emit("heartbeat://online", &info);
        }
    }

    fn check_offline(&self) {
        let mut state = self.state.lock().unwrap();
        if !state.online {
            return;
        }
        let idle = SystemTime::now()
            .duration_since(*self.last_beat.lock().unwrap())
            .unwrap_or(Duration::ZERO);
        if idle >= OFFLINE_AFTER {
            state.online = false;
            let info = state.server.clone();
            let _ = self.app.emit("heartbeat://offline", &info);
        }
    }
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub struct HeartbeatController {
    running: Arc<AtomicBool>,
    state: Arc<Mutex<HeartbeatState>>,
    handle: Arc<Mutex<Option<std::thread::JoinHandle<()>>>>,
}

impl HeartbeatController {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            state: Arc::new(Mutex::new(HeartbeatState {
                online: false,
                server: None,
                requires_trust: false,
            })),
            handle: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start(&self, app: tauri::AppHandle, secret: Option<String>) -> Result<(), String> {
        let mut handle = self.handle.lock().unwrap();
        if handle.is_some() {
            return Err("heartbeat listener already running".into());
        }

        let secret = secret.filter(|s| !s.is_empty());
        let secret_bytes = secret.as_ref().map(|s| s.as_bytes().to_vec());
        let listener = Listener {
            app: app.clone(),
            secret: Arc::new(secret_bytes),
            running: self.running.clone(),
            state: self.state.clone(),
            consecutive: Arc::new(Mutex::new(0)),
            last_beat: Arc::new(Mutex::new(SystemTime::now())),
            trust_pinned: Arc::new(Mutex::new(None)),
            last_seq: Arc::new(Mutex::new(0)),
            last_ts: Arc::new(Mutex::new(0)),
        };

        self.running.store(true, Ordering::SeqCst);
        let h = std::thread::Builder::new()
            .name("heartbeat-listener".into())
            .spawn(move || listener.run())
            .map_err(|e| format!("{}", e))?;

        *handle = Some(h);
        Ok(())
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(h) = self.handle.lock().unwrap().take() {
            let _ = h.join();
        }
        let mut st = self.state.lock().unwrap();
        st.online = false;
        st.server = None;
        st.requires_trust = false;
    }

    pub fn state(&self) -> HeartbeatState {
        self.state.lock().unwrap().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_SECRET: &str = "PUIb68qALBPI1VPS2IHD2abbWvdAswK2BTMA94ewxlMC";

    fn fresh_message() -> HeartbeatMessage {
        HeartbeatMessage {
            msg_type: "HEARTBEAT".into(),
            server_ip: "192.168.1.8".into(),
            server_port: 8081,
            server_name: "ClinicServer".into(),
            timestamp: now_millis(),
            status: "ONLINE".into(),
            sequence: 1,
            nonce: "fa7492b3-6ad7-4acf-9a5f-1c6a696be93c".into(),
            signature: String::new(),
        }
    }

    fn sign(hb: &HeartbeatMessage) -> String {
        compute_hmac(TEST_SECRET.as_bytes(), &signable_payload(hb))
    }

    #[test]
    fn verifies_fresh_v2_packet() {
        let hb = fresh_message();
        let hb = HeartbeatMessage { signature: sign(&hb), ..hb };
        assert!(verify_signature(TEST_SECRET.as_bytes(), &hb));
    }

    #[test]
    fn signature_binds_server_identity() {
        // A captured packet's signature must NOT validate once any identity
        // field (ip, port, name) is forged.
        let base = fresh_message();
        let sig = sign(&base);

        let forged_ip = HeartbeatMessage { server_ip: "10.0.0.99".into(), ..base.clone() };
        let forged_ip = HeartbeatMessage { signature: sig.clone(), ..forged_ip };
        assert!(!verify_signature(TEST_SECRET.as_bytes(), &forged_ip));

        let forged_port = HeartbeatMessage { server_port: 9999, ..base.clone() };
        let forged_port = HeartbeatMessage { signature: sig.clone(), ..forged_port };
        assert!(!verify_signature(TEST_SECRET.as_bytes(), &forged_port));

        let forged_name = HeartbeatMessage { server_name: "Attacker".into(), ..base };
        let forged_name = HeartbeatMessage { signature: sig.clone(), ..forged_name };
        assert!(!verify_signature(TEST_SECRET.as_bytes(), &forged_name));
    }

    #[test]
    fn rejects_stale_timestamp() {
        // A captured packet replayed hours later must be refused.
        let mut hb = fresh_message();
        hb.timestamp = now_millis() - 2 * MAX_TIMESTAMP_SKEW_MS;
        hb.signature = sign(&hb);
        assert!(!verify_signature(TEST_SECRET.as_bytes(), &hb));
    }

    #[test]
    fn rejects_wrong_secret() {
        let hb = fresh_message();
        let hb = HeartbeatMessage { signature: sign(&hb), ..hb };
        assert!(!verify_signature(b"wrong-secret", &hb));
    }

    #[test]
    fn rejects_replayed_sequence() {
        assert!(!not_replay(1, 1000, 1, 1000)); // same seq + older/equal ts
        assert!(!not_replay(1, 999, 5, 2000));  // older seq + older ts
        assert!(not_replay(1, 3000, 5, 2000));  // server restart: seq reset, fresh ts
        assert!(not_replay(6, 2500, 5, 2000));  // normal increment
    }

    #[test]
    fn parses_real_heartbeat_shape() {
        let hb: HeartbeatMessage = serde_json::from_str(
            r#"{"type":"HEARTBEAT","serverIp":"192.168.1.8","serverPort":8081,"serverName":"ClinicServer","timestamp":1786255423892,"status":"ONLINE","sequence":1,"nonce":"fa7492b3-6ad7-4acf-9a5f-1c6a696be93c","signature":"x"}"#,
        )
        .expect("fixture must parse");
        assert_eq!(hb.msg_type, "HEARTBEAT");
        assert_eq!(hb.server_port, 8081);
        assert_eq!(hb.status, "ONLINE");
        assert_eq!(hb.sequence, 1);
    }
}

