import { isTauriApp, setServerBaseUrl, probeServer } from './api';
import { useHeartbeatStore, type HeartbeatServer } from '../stores/heartbeat';
import { useSettingsStore } from '../stores/settings';

let started = false;
let unlistenFns: Array<() => void> = [];
let currentServer: HeartbeatServer | null = null;

export function isHeartbeatSupported(): boolean {
  return isTauriApp;
}

function isLoopbackServer(info: HeartbeatServer): boolean {
  return info.ip === '127.0.0.1' || info.ip === 'localhost' || info.ip === '::1';
}

/**
 * Points the client at a server the operator has already approved.
 *
 * Only ever called for a server that passed verification in Rust, or one the operator
 * explicitly accepted from the candidate list. Discovery on its own never reaches here.
 *
 * Returns a validation message when the address is refused. Discovery identifies a
 * server on the LAN but must not bypass the transport policy: a bare IP implies plain
 * HTTP, which a production build refuses. The clinic then has to supply its HTTPS
 * endpoint in Settings, and the discovery result is what tells them which host it is.
 */
function applyServer(info: HeartbeatServer): { ok: true } | { ok: false; message: string } {
  const result = setServerBaseUrl(info.ip, info.port);
  if (!result.ok) return { ok: false, message: result.message };

  const isNew = !currentServer || currentServer.ip !== info.ip || currentServer.port !== info.port;
  currentServer = info;
  useSettingsStore.getState().setServerConfig(info.ip, String(info.port));
  if (isNew) {
    import('./notificationBus').then((m) => m.notificationBus.refresh()).catch(() => {});
  }
  return { ok: true };
}

async function attachListeners() {
  const { listen } = await import('@tauri-apps/api/event');
  const hb = useHeartbeatStore.getState();

  unlistenFns.push(
    await listen<HeartbeatServer>('heartbeat://online', (e) => {
      // A verified server still has to satisfy the transport policy. Recording it as
      // online while the address was refused would show a green light for a connection
      // that cannot exist.
      const applied = applyServer(e.payload);
      if (applied.ok) {
        hb.setOnline(e.payload);
      } else {
        hb.setError(applied.message);
        hb.setCandidates([e.payload], hb.unverifiedMode);
      }
    }),
    await listen<HeartbeatServer>('heartbeat://server-changed', (e) => {
      const applied = applyServer(e.payload);
      if (applied.ok) {
        hb.setServerChanged(e.payload);
      } else {
        hb.setError(applied.message);
      }
    }),
    await listen<HeartbeatServer>('heartbeat://offline', () => {
      hb.setOffline();
    }),
    // Replaces the old single-server requires-trust event. A clinic LAN can host more
    // than one Clinic Server, so the decision is made from a list.
    await listen<{ candidates: HeartbeatServer[]; unverifiedMode: boolean } | HeartbeatServer[]>(
      'heartbeat://candidates',
      (e) => {
        const payload = e.payload as any;
        if (Array.isArray(payload)) {
          hb.setCandidates(payload, false);
        } else {
          hb.setCandidates(payload.candidates ?? [], payload.unverifiedMode === true);
        }
      }
    ),
    await listen<string>('heartbeat://error', (e) => {
      hb.setError(e.payload);
    })
  );
}

export async function startHeartbeatMonitor(): Promise<boolean> {
  if (!isTauriApp || started) return started;
  started = true;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const { discoverySecret, acceptedServer } = useHeartbeatStore.getState();
    await attachListeners();
    try {
      // The secret and the accepted server come from persisted settings, not from the
      // environment: the Clinic Server is on another machine, so there is no shared
      // environment to inherit. SYNC_SECRET remains a Rust-side fallback.
      await invoke('start_heartbeat_monitor', {
        secret: discoverySecret || null,
        accepted: acceptedServer,
      });
    } catch {
      // The listener may already be running; state still arrives as events.
    }
    return true;
  } catch {
    started = false;
    return false;
  }
}

export async function stopHeartbeatMonitor(): Promise<void> {
  if (!isTauriApp || !started) return;
  started = false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('stop_heartbeat_monitor');
  } catch { /* ignore */ }
  unlistenFns.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  unlistenFns = [];
  useHeartbeatStore.getState().reset();
  currentServer = null;
}

/**
 * Approves one of the discovered candidates.
 *
 * Records the decision so it persists, verifies the server actually answers, then applies
 * the same transport policy as any other address. A candidate that does not respond, or
 * whose implied plain-HTTP address a production build refuses, is not adopted — so the
 * candidate list cannot be used to point the app at a dead host or to downgrade the
 * connection.
 */
export async function acceptCandidate(
  candidate: HeartbeatServer
): Promise<{ ok: boolean; message?: string }> {
  // Validate before recording the decision, so a refused address is not persisted as
  // "accepted" and then re-prompted on every launch.
  const applied = applyServer(candidate);
  if (!applied.ok) {
    useHeartbeatStore.getState().setCandidates(
      [candidate],
      useHeartbeatStore.getState().unverifiedMode
    );
    return {
      ok: false,
      message:
        `${applied.message} (اكتشف التطبيق الخادم على ${candidate.ip}:${candidate.port}، ` +
        'أدخل عنوان HTTPS الخاص به في الإعدادات.)',
    };
  }

  const probe = await probeServer(candidate.ip, String(candidate.port));
  if (!probe.ok) {
    // Undo: it answered the policy check but not an actual request.
    useHeartbeatStore.getState().setCandidates(
      [candidate],
      useHeartbeatStore.getState().unverifiedMode
    );
    currentServer = null;
    return { ok: false, message: probe.message };
  }

  useHeartbeatStore.getState().acceptServer(candidate);
  useHeartbeatStore.getState().setOnline(candidate);

  if (isTauriApp) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('accept_discovered_server', { ip: candidate.ip, port: candidate.port });
    } catch { /* the URL is already applied */ }
  }

  return { ok: true };
}

/** Forgets the approved server so the next launch asks again. */
export function forgetAcceptedServer(): void {
  useHeartbeatStore.setState({ acceptedServer: null, candidates: [], status: 'unknown' });
  currentServer = null;
}

export function getDiscoveredServer(): HeartbeatServer | null {
  return currentServer;
}

export function useHeartbeat() {
  return useHeartbeatStore();
}

export { isLoopbackServer };
