import React from 'react';
import { SSEClient } from './sse';
import { getStoredSession, getBaseUrl } from './api';

type Listener = (event: any) => void;

class NotificationBus {
  private listeners = new Set<Listener>();
  private client: SSEClient | null = null;
  private static instance: NotificationBus | null = null;

  static get(): NotificationBus {
    if (!NotificationBus.instance) {
      NotificationBus.instance = new NotificationBus();
    }
    return NotificationBus.instance;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  connect() {
    if (this.client) return;
    const session = getStoredSession();
    if (!session?.token) return;
    const client = new SSEClient(getBaseUrl() + '/api/events/stream', session.token);
    this.client = client;
    client.on('message', (e: any) => {
      const eventName = e.event ?? 'message';
      let payload: any = null;
      try {
        payload = e.data ? JSON.parse(e.data) : null;
      } catch {
        payload = e.data;
      }
      this.listeners.forEach((l) => l({ event: eventName, payload, seq: e.seq }));
    });
    client.connect();
  }

  disconnect() {
    this.client?.disconnect();
    this.client = null;
  }

  /** Rebuild the SSE connection against the current base URL (server change). */
  refresh() {
    this.disconnect();
    const session = getStoredSession();
    if (session?.token) this.connect();
  }

  setToken(token: string) {
    this.client?.setToken(token);
  }
}

export const notificationBus = NotificationBus.get();

export function useNotificationBus(listener: Listener) {
  React.useEffect(() => notificationBus.subscribe(listener), [listener]);
}
