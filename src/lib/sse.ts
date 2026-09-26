import { getFingerprint, refreshAuthToken } from './api';

interface SSEEvent {
  event: string;
  data: string;
  retry?: number;
  seq?: number;
}

type SSEEventHandler = (event: SSEEvent) => void;

// If no SSE data (including server keep-alive comments) arrives within this
// window, the connection is considered stale/half-dead and is re-established.
const INACTIVITY_TIMEOUT_MS = 30_000;

export class SSEClient {
  private url: string;
  private token: string;
  private lastEventId: string = '';
  private eventHandlers: Map<string, SSEEventHandler[]> = new Map();
  private abortController: AbortController | null = null;
  private running: boolean = false;
  private reconnectDelay: number = 1000;
  private maxReconnectDelay: number = 30000;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  on(event: string, handler: SSEEventHandler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  off(event: string, handler: SSEEventHandler) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    }
  }

  setToken(token: string) {
    this.token = token;
  }

  async connect(): Promise<void> {
    if (this.running) this.disconnect();
    this.running = true;
    this.abortController = new AbortController();
    this._armInactivityTimer();

    // This loop runs for the lifetime of the client. Every stream teardown
    // (clean EOF, error, staleness, auth failure) falls through to a retry
    // with exponential backoff, so the connection is never silently dropped.
    while (this.running) {
      try {
        await this._connectOnce();
        // A successful live stream only ends via the while-running checks
        // inside _connectOnce; reaching here means the stream teardown
        // surfaced through an exception below. Fall through to backoff.
      } catch (err) {
        if (!this.running) break;
        // Refresh the token before retrying if the server rejected auth, so a
        // token that expired mid-connection doesn't cause an endless 401 loop.
        const status = (err as any)?.status;
        if (status === 401 || status === 403) {
          await this._refreshToken();
        }
      }
      if (!this.running) break;
      await this._backoff();
      this._armInactivityTimer();
    }
  }

  private _handleChunk(buffer: string) {
    const lines = buffer.split('\n');

    let event: SSEEvent = { event: 'message', data: '' };
    let lastLine: string | undefined;

    const flush = () => {
      if (event.data || event.event !== 'message') {
        this._dispatch(event);
      }
      event = { event: 'message', data: '' };
      lastLine = undefined;
    };

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        if (lastLine !== undefined || event.data) {
          flush();
        }
        continue;
      }
      lastLine = trimmed;
      if (trimmed.startsWith('event:')) {
        event.event = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        event.data += (event.data ? '\n' : '') + trimmed.slice(5).trim();
      } else if (trimmed.startsWith('id:')) {
        this.lastEventId = trimmed.slice(3).trim();
        event.seq = parseInt(this.lastEventId, 10) || undefined;
      } else if (trimmed.startsWith('retry:')) {
        const parsed = parseInt(trimmed.slice(6).trim(), 10);
        event.retry = Number.isNaN(parsed) ? undefined : parsed;
      }
      // Any non-empty line (including a ':' keep-alive comment with no data)
      // counts as liveness from the server — reset the staleness watchdog.
      this._armInactivityTimer();
    }
  }

  private async _connectOnce(): Promise<void> {
    const url = new URL(this.url, window.location.origin);
    if (this.lastEventId) {
      url.searchParams.set('lastEventId', this.lastEventId);
    }

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': 'Bearer ' + this.token,
        'Accept': 'text/event-stream',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-Client-Fingerprint': await getFingerprint(),
      },
      signal: this.abortController!.signal,
    });

    if (!res.ok) {
      const err: any = new Error('SSE connection failed: ' + res.status);
      err.status = res.status;
      throw err;
    }
    this.reconnectDelay = 1000;

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (this.running) {
      let chunk;
      try {
        const read = await reader.read();
        if (read.done) {
          // The server closed the stream cleanly (restart / proxy teardown).
          // Treat this as a transient failure so connect() reconnects rather
          // than treating it as a permanent success and going quiet forever.
          throw new Error('SSE stream ended by server');
        }
        chunk = read.value;
      } catch (e) {
        if (!this.running) throw e;
        const err: any = new Error('SSE connection lost: ' + (e as any)?.message);
        throw err;
      }
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      this._handleChunk(lines.join('\n') + '\n');
    }
  }

  private _dispatch(event: SSEEvent) {
    const handlers = this.eventHandlers.get(event.event);
    if (handlers) {
      handlers.forEach((h) => h(event));
    }
    const allHandlers = this.eventHandlers.get('message');
    if (allHandlers) {
      allHandlers.forEach((h) => h(event));
    }
  }

  private async _refreshToken() {
    try {
      const ok = await refreshAuthToken();
      if (ok) {
        // read the refreshed access token from the storage layer
        const { getStoredSession } = await import('./api');
        const session = getStoredSession();
        if (session?.token) this.token = session.token;
      }
    } catch {
      // ignore — next attempt will refresh again or the auth layer will log out
    }
  }

  /** Reset the staleness watchdog. If nothing arrives in time, force a reconnect. */
  private _armInactivityTimer() {
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      if (!this.running) return;
      this.abortController?.abort();
    }, INACTIVITY_TIMEOUT_MS);
  }

  private async _backoff() {
    const delay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    this.reconnectDelay = delay;
    await new Promise((r) => setTimeout(r, delay));
  }

  disconnect() {
    this.running = false;
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    this.abortController?.abort();
  }
}
