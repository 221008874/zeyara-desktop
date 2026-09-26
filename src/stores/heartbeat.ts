import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface HeartbeatServer {
  ip: string;
  port: number;
  name: string;
  verified: boolean;
  lastSeenAt: number;
}

export type HeartbeatStatus = 'unknown' | 'online' | 'offline' | 'awaiting-choice' | 'error';

interface HeartbeatState {
  status: HeartbeatStatus;
  server: HeartbeatServer | null;
  /** Servers heard from but not adopted. A LAN can hold more than one. */
  candidates: HeartbeatServer[];
  /** True when no shared secret is configured, so discovery cannot authenticate anyone. */
  unverifiedMode: boolean;
  error: string | null;
  /**
   * The server the operator approved, as "ip:port". Persisted so the decision survives a
   * restart and discovery does not re-prompt on every launch.
   */
  acceptedServer: string | null;
  /**
   * The Clinic Server's SYNC_SECRET. Held in the same persisted store as the URL because
   * both are per-clinic deployment settings, entered once by an administrator.
   *
   * This is a shared secret between two machines on a clinic LAN, not a user credential:
   * it authorises a server to announce itself, and grants no access to any record. It is
   * stored locally the same way the server URL is, which is plaintext in localStorage.
   * That is a deliberate trade-off and it is documented rather than hidden - a clinic
   * desktop already has the user's session token there too.
   */
  discoverySecret: string;
  setOnline: (s: HeartbeatServer) => void;
  setOffline: () => void;
  setCandidates: (c: HeartbeatServer[], unverifiedMode: boolean) => void;
  setError: (msg: string) => void;
  setServerChanged: (s: HeartbeatServer) => void;
  acceptServer: (s: HeartbeatServer) => void;
  setDiscoverySecret: (secret: string) => void;
  reset: () => void;
}

export const useHeartbeatStore = create<HeartbeatState>()(
  persist(
    (set) => ({
      status: 'unknown',
      server: null,
      candidates: [],
      unverifiedMode: false,
      error: null,
      acceptedServer: null,
      discoverySecret: '',

      // Only an authenticated server may put the client online. The Rust layer enforces
      // that, so reaching here means the HMAC validated (or the operator accepted it).
      setOnline: (s) => set({ status: 'online', server: s, candidates: [], error: null }),

      setOffline: () => set({ status: 'offline', error: null }),

      // Discovery never adopts a server on its own. The UI asks.
      setCandidates: (candidates, unverifiedMode) =>
        set({
          candidates,
          unverifiedMode,
          status: candidates.length > 0 ? 'awaiting-choice' : 'unknown',
        }),

      setError: (msg) => set({ status: 'error', error: msg }),
      setServerChanged: (s) => set({ server: s, error: null }),

      acceptServer: (s) =>
        set({
          acceptedServer: `${s.ip}:${s.port}`,
          candidates: [],
          status: 'unknown',
        }),

      setDiscoverySecret: (discoverySecret) => set({ discoverySecret }),

      // Deliberately keeps acceptedServer and discoverySecret: they are configuration,
      // not transient state, and clearing them would re-prompt on every launch.
      reset: () => set({ status: 'unknown', server: null, candidates: [], error: null }),
    }),
    {
      name: 'zeyara_discovery',
      partialize: (s) => ({
        acceptedServer: s.acceptedServer,
        discoverySecret: s.discoverySecret,
      }),
    }
  )
);
