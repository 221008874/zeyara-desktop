import { isTauriApp, setServerBaseUrl } from './api';
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

function applyServer(info: HeartbeatServer) {
  if (!info.verified && !isLoopbackServer(info)) return;
  const isNew =
    !currentServer || currentServer.ip !== info.ip || currentServer.port !== info.port;
  currentServer = info;
  // Advertised server -> point all API/SSE calls at it.
  setServerBaseUrl(info.ip, info.port);
  // Remember it in settings so a restart without heartbeat still connects.
  useSettingsStore.getState().setServerConfig(info.ip, String(info.port));
  if (isNew) {
    // Re-point the SSE stream at the new server.
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
    await listen<HeartbeatServer>('heartbeat://requires-trust', (e) => {
      hb.setRequiresTrust(e.payload);
    }),
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
    await attachListeners();
    try {
      await invoke('start_heartbeat_monitor', { secret: null });
    } catch {
      // listener is attached; state comes via events even if the command
      // reports "already running"
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

export function getDiscoveredServer(): HeartbeatServer | null {
  return currentServer;
}

export function useHeartbeat() {
  return useHeartbeatStore();
}
