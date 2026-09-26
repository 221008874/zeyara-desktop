


const isTauriApp =
  typeof window !== 'undefined' &&
  ((window as any).isTauri === true ||
    (window as any).__TAURI_INTERNALS__ !== undefined ||
    (window as any).__TAURI__ !== undefined);

/**
 * No server is assumed up front.
 *
 * The Clinic Server is a separate application on a separate machine, so there is no
 * "same machine" default to fall back on. An empty base URL makes the unconfigured state
 * explicit, and the app then either adopts a discovered server or asks for one, instead
 * of silently talking to a localhost nothing is listening on.
 */
const UNCONFIGURED = '';

function getInitialBaseUrl(): string {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('zeyara_server_config');
    if (saved) return saved;
  }
  return UNCONFIGURED;
}

let BASE_URL = getInitialBaseUrl();

/**
 * Points all API/SSE calls at a server.
 *
 * Accepts a full origin so an HTTPS deployment can be used as-is; a bare host and port
 * are treated as plain HTTP. Hard-coding `http://` here would make a TLS-terminating
 * reverse proxy unreachable, because the page is served over a secure context and a
 * mixed-content request would be blocked.
 */
export function setServerBaseUrl(host: string, port?: number | string): void {
  const raw = String(host).trim();
  if (/^https?:\/\//i.test(raw)) {
    BASE_URL = raw.replace(/\/+$/, '');
  } else {
    const p = port === undefined || port === '' ? '' : `:${port}`;
    BASE_URL = `http://${raw}${p}`;
  }
  localStorage.setItem('zeyara_server_config', BASE_URL);
}

export function getBaseUrl(): string {
  return BASE_URL;
}

export function isServerConfigured(): boolean {
  return BASE_URL !== UNCONFIGURED;
}

export function resetServerBaseUrl(): void {
  BASE_URL = UNCONFIGURED;
  localStorage.removeItem('zeyara_server_config');
}

/**
 * Probe a candidate server (host:port) WITHOUT changing the active BASE_URL.
 * The server's /api/health endpoint returns the plain text "UP".
 */
export async function probeServer(
  host: string,
  port: string | number
): Promise<{ ok: boolean; message: string }> {
  const target = `http://${host}:${port}`;
  try {
    const res = await fetch(`${target}/api/health`, {
      headers: DEFAULT_HEADERS,
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status}` };
    }
    const text = (await res.text()).trim();
    return text === 'UP' || text.startsWith('UP')
      ? { ok: true, message: text }
      : { ok: false, message: 'استجابة غير متوقعة من الخادم.' };
  } catch {
    return { ok: false, message: 'لا يمكن الوصول إلى الخادم.' };
  }
}

const DEFAULT_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Client-Fingerprint': '',
};

let cachedFingerprint: string | null = null;

export async function getFingerprint(): Promise<string> {
  if (cachedFingerprint) return cachedFingerprint;
  try {
    if (isTauriApp) {
      const { invoke } = await import('@tauri-apps/api/core');
      const mac = await invoke<string>('get_device_fingerprint');
      if (mac) {
        cachedFingerprint = mac;
        return mac;
      }
    }
  } catch { /* fall through to browser fingerprint */ }
  let fp = localStorage.getItem('zeyara_fingerprint');
  if (!fp) {
    fp = crypto.randomUUID();
    localStorage.setItem('zeyara_fingerprint', fp);
  }
  cachedFingerprint = fp;
  return fp;
}

function getStoredSession(): any | null {
  try {
    const raw = localStorage.getItem('zeyara_session');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // zustand persist stores { state: {...}, version: N }; also accept bare session
    return parsed?.state?.session ?? parsed?.session ?? (parsed?.token ? parsed : null);
  } catch {
    return null;
  }
}

export { getStoredSession };

function getAuthToken(): string | null {
  return getStoredSession()?.token ?? null;
}

let refreshPromise: Promise<boolean> | null = null;

export async function refreshAuthToken(): Promise<boolean> {
  try {
    const session = getStoredSession();
    if (!session?.refreshToken) return false;
    const fingerprint = await getFingerprint();
    const res = await fetch(BASE_URL + '/api/auth/refresh', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': DEFAULT_HEADERS['Accept-Language'],
        'X-Client-Fingerprint': fingerprint,
      },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.token) return false;
    // Update the zustand store in-memory AND persist to localStorage (the
    // persist middleware writes the envelope on set()). This single write
    // avoids the previous dual-write mismatch where only raw localStorage was
    // updated and the in-memory store kept a stale token.
    const { useAuthStore } = await import('../stores/auth');
    useAuthStore.getState().setTokens(data.token, data.refreshToken ?? session.refreshToken);
    return true;
  } catch {
    return false;
  }
}

const api = {
  get<T = any>(path: string): Promise<{ data: T }> {
    return this.request<T>('GET', path);
  },

  blob<T = any>(path: string): Promise<{ data: T }> {
    return this.request<T>('GET', path, undefined, 'blob');
  },

  post<T = any>(path: string, body?: any): Promise<{ data: T }> {
    return this.request<T>('POST', path, body);
  },

  postForm<T = any>(path: string, formData: FormData): Promise<{ data: T }> {
    return this.requestForm<T>('POST', path, formData);
  },

  put<T = any>(path: string, body?: any): Promise<{ data: T }> {
    return this.request<T>('PUT', path, body);
  },

  delete<T = any>(path: string): Promise<{ data: T }> {
    return this.request<T>('DELETE', path);
  },

async request<T>(
    method: string,
    path: string,
    body?: any,
    responseType?: 'blob'
  ): Promise<{ data: T }> {
    const url = BASE_URL + path;
    const token = getAuthToken();
    const headers: Record<string, string> = { ...DEFAULT_HEADERS };
    headers['X-Client-Fingerprint'] = await getFingerprint();
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    const opts: RequestInit = {
      method,
      headers,
    };
    if (body && method !== 'GET') {
      opts.body = JSON.stringify(body);
    }

    return this._fetch(url, opts, responseType);
  },

  async requestForm<T>(
    method: string,
    path: string,
    formData: FormData
  ): Promise<{ data: T }> {
    const url = BASE_URL + path;
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    headers['X-Client-Fingerprint'] = await getFingerprint();
    if (token) {
      headers['Authorization'] = 'Bearer ' + token;
    }

    const opts: RequestInit = {
      method,
      headers,
      body: formData,
    };

    return this._fetch(url, opts);
  },

  async _fetch<T>(
    url: string,
    opts: RequestInit,
    responseType?: 'blob'
  ): Promise<{ data: T }> {
    let res = await fetch(url, opts);

    if (res.status === 401) {
      // Mutex: concurrent 401s share a single refresh so the refresh token is
      // only rotated once. Without this, two parallel refreshes would race and
      // the server would reject the second (already-rotated) token, logging the
      // user out.
      if (!refreshPromise) {
        refreshPromise = refreshAuthToken().finally(() => {
          refreshPromise = null;
        });
      }
      const refreshed = await refreshPromise;
      if (refreshed) {
        const newToken = getAuthToken();
        const headers = opts.headers as Record<string, string>;
        if (newToken && headers) {
          headers['Authorization'] = 'Bearer ' + newToken;
        }
        res = await fetch(url, { ...opts, headers });
      } else {
        try {
          const { useAuthStore } = await import('../stores/auth');
          useAuthStore.getState().clearSession();
        } catch {
          localStorage.removeItem('zeyara_session');
          if (typeof window !== 'undefined') window.location.href = '/login';
        }
        const error = new Error('Unauthorized') as Error & { status: number };
        error.status = 401;
        throw error;
      }
    }

    if (!res.ok) {
      let errorMsg = 'HTTP ' + res.status;
      try {
        const errBody = await res.json();
        errorMsg = errBody.error ?? errBody.message ?? errorMsg;
      } catch { /* use default */ }
      const error = new Error(errorMsg) as Error & { status: number };
      error.status = res.status;
      throw error;
    }

    if (res.status === 204) {
      return { data: undefined as T };
    }

    if (responseType === 'blob') {
      const blob = await res.blob();
      return { data: blob as T };
    }

    const data = await res.json();
    return { data: data as T };
  },
};

export { api, BASE_URL, isTauriApp };
