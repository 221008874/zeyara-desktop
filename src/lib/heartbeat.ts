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
 */
function applyServer(info: HeartbeatServer) {
  const isNew = !currentServer || currentServer.ip !== info.ip || currentServer.port !== info.port;
  currentServer = info;
  setServerBaseUrl(info.ip, info.port);
  useSettingsStore.getState().setServerConfig(info.ip, String(info.port));
  if (isNew) {
    import('./notificationBus').then((m) => m.notificationBus.refresh()).catch(() => {});
  }
}

async function attachListeners() {
  const { listen } = await import('@tauri-apps/api/event');
  const hb = useHeartbeatStore.getState();

  unlistenFns.push(
    await listen<HeartbeatServer>('heartbeat://online', (e) => {
      applyServer(e.payload);
      hb.setOnline(e.payload);
    }),
    await listen<HeartbeatServer>('heartbeat://server-changed', (e) => {
      applyServer(e.payload);
      hb.setServerChanged(e.payload);
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
 * Records the decision so it persists, verifies the server actually answers before
 * adopting it, and only then points the client at it. A candidate that does not respond
 * is not adopted, so the list cannot be used to point the app at a dead or hostile host.
 */
export async function acceptCandidate(candidate: HeartbeatServer): Promise<{ ok: boolean; message?: string }> {
  useHeartbeatStore.getState().acceptServer(candidate);

  const probe = await probeServer(candidate.ip, String(candidate.port));
  if (!probe.ok) {
    useHeartbeatStore.getState().setCandidates([candidate], useHeartbeatStore.getState().unverifiedMode);
    return { ok: false, message: probe.message };
  }

  if (!isTauriApp) {
    applyServer(candidate);
    useHeartbeatStore.getState().setOnline(candidate);
    return { ok: true };
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('accept_discovered_server', { ip: candidate.ip, port: candidate.port });
  } catch { /* the URL is still applied below */ }

  applyServer(candidate);
  useHeartbeatStore.getState().setOnline(candidate);
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
