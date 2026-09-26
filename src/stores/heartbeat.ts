import { create } from 'zustand';

export interface HeartbeatServer {
  ip: string;
  port: number;
  name: string;
  verified: boolean;
  lastSeenAt: number;
}

export type HeartbeatStatus = 'unknown' | 'online' | 'offline' | 'requires-trust' | 'error';

interface HeartbeatState {
  status: HeartbeatStatus;
  server: HeartbeatServer | null;
  error: string | null;
  setOnline: (s: HeartbeatServer) => void;
  setOffline: () => void;
  setRequiresTrust: (s: HeartbeatServer) => void;
  setError: (msg: string) => void;
  setServerChanged: (s: HeartbeatServer) => void;
  reset: () => void;
}

export const useHeartbeatStore = create<HeartbeatState>()((set) => ({
  status: 'unknown',
  server: null,
  error: null,
  setOnline: (s) => set({ status: 'online', server: s, error: null }),
  setOffline: () => set({ status: 'offline', error: null }),
  setRequiresTrust: (s) => set({ status: 'requires-trust', server: s }),
  setError: (msg) => set({ status: 'error', error: msg }),
  setServerChanged: (s) => set({ server: s, error: null }),
  reset: () => set({ status: 'unknown', server: null, error: null }),
}));
