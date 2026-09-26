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
      if (eventName === 'notification') {
        // Surface it in the OS tray as well as in-app. The window is frequently in the
        // background during a clinic day, so an in-app badge alone is easy to miss.
        void showOsNotification(payload);
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

/**
 * Turns an SSE notification payload into an OS notification.
 *
 * The server sends a shared clinic inbox, so the message can carry a patient name.
 * Notification text is visible on the desktop in plain sight, so the body is reduced to
 * the least identifying detail that still tells a receptionist something arrived, and the
 * patient name is deliberately left out.
 */
async function showOsNotification(payload: any): Promise<void> {
  if (!payload) return;
  const type = String(payload.type ?? '').toUpperCase();
  const title =
    type.includes('CANCEL')
      ? 'إلغاء موعد'
      : type.includes('SCHEDULE') || type.includes('RESCHEDULE') || type.includes('MOVED')
        ? 'تغيير موعد'
        : 'إشعار جديد';

  const body =
    type.includes('CANCEL')
      ? 'تم إلغاء موعد، يُرجى مراجعة قائمة المواعيد.'
      : type.includes('SCHEDULE') || type.includes('RESCHEDULE') || type.includes('MOVED')
        ? 'تم تغيير موعد، يُرجى مراجعة قائمة المواعيد.'
        : 'وصل إشعار جديد من العيادة.';

  const { notify } = await import('./native');
  await notify(title, body);
}

export function useNotificationBus(listener: Listener) {
  React.useEffect(() => notificationBus.subscribe(listener), [listener]);
}
