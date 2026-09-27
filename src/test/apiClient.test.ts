import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api, setServerBaseUrl, resetServerBaseUrl, getBaseUrl, isServerConfigured } from '../lib/api';
import { useAuthStore } from '../stores/auth';

/**
 * The API client's failure behaviour.
 *
 * `_fetch` is the single place every screen's errors pass through, and it is the only
 * place that reacts to an expired session. Nothing else tested it: `auth.test.ts` mocks
 * `api` wholesale, so the 401 handling - a mutex, a retry, and a forced logout - had no
 * coverage at all. Those are the paths a user hits when their shift ends, so they matter
 * more than any page-level assertion.
 *
 * `localStorage` is seeded with a fixed fingerprint so the `X-Client-Fingerprint` header
 * is deterministic and `crypto.randomUUID` is never reached.
 */

const FINGERPRINT = 'test-fingerprint-0001';

function seedSession(overrides: Record<string, unknown> = {}) {
  const session = {
    username: 'doc',
    role: 'DOCTOR' as const,
    token: 'access-old',
    refreshToken: 'refresh-1',
    mustChangePassword: false,
    ...overrides,
  };
  // Seed the store as well as localStorage, because in production the two are kept in
  // step by the persist middleware and `refreshAuthToken` rotates the token through the
  // store. Seeding only localStorage would model a state the app can never be in, and the
  // replay would then appear to reuse the stale token for the wrong reason.
  localStorage.setItem('zeyara_session', JSON.stringify({ state: { session } }));
  useAuthStore.setState({ session, isLoading: false });
}

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    blob: async () => new Blob([JSON.stringify(body)]),
  } as unknown as Response;
}

beforeEach(() => {
  resetServerBaseUrl();
  localStorage.setItem('zeyara_fingerprint', FINGERPRINT);
  setServerBaseUrl('https://clinic.example.com');
  useAuthStore.setState({ session: null, isLoading: false });
  vi.restoreAllMocks();
});

describe('unconfigured server', () => {
  it('starts unconfigured rather than assuming a same-machine server', () => {
    resetServerBaseUrl();
    expect(getBaseUrl()).toBe('');
    expect(isServerConfigured()).toBe(false);
  });

  it('becomes configured only after a valid origin is accepted', () => {
    expect(getBaseUrl()).toBe('https://clinic.example.com');
    expect(isServerConfigured()).toBe(true);
  });

  it('leaves the active server untouched when an invalid origin is rejected', () => {
    const result = setServerBaseUrl('http://clinic.example.com');
    expect(result.ok).toBe(false);
    // A rejected configuration must not silently repoint a working client.
    expect(getBaseUrl()).toBe('https://clinic.example.com');
  });
});

describe('request construction', () => {
  it('sends the bearer token and the client fingerprint', async () => {
    seedSession();
    const fetchMock = vi.fn().mockResolvedValue(json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/api/patients');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://clinic.example.com/api/patients');
    expect(opts.headers.Authorization).toBe('Bearer access-old');
    expect(opts.headers['X-Client-Fingerprint']).toBe(FINGERPRINT);
  });

  it('omits the Authorization header when there is no session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/api/license/status');

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('never sends a body on GET', async () => {
    seedSession();
    const fetchMock = vi.fn().mockResolvedValue(json({}));
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/api/patients');

    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });
});

describe('error responses', () => {
  it('surfaces the server message from an error body', async () => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'Patient not found' }, 404)));

    await expect(api.get('/api/patients/9')).rejects.toThrow('Patient not found');
  });

  it('falls back to the message field when error is absent', async () => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ message: 'Not authorised' }, 403)));

    await expect(api.get('/api/users')).rejects.toThrow('Not authorised');
  });

  it('falls back to the status when the body is not JSON', async () => {
    seedSession();
    const bad = {
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bad));

    await expect(api.get('/api/patients')).rejects.toThrow('HTTP 500');
  });

  it('attaches the status code so callers can branch on it', async () => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: 'nope' }, 409)));

    await expect(api.post('/api/appointments', {})).rejects.toMatchObject({ status: 409 });
  });

  it('returns undefined for 204 rather than trying to parse a body', async () => {
    seedSession();
    const noContent = {
      ok: true,
      status: 204,
      json: async () => { throw new Error('no body'); },
    } as unknown as Response;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(noContent));

    await expect(api.delete('/api/patients/1')).resolves.toEqual({ data: undefined });
  });
});

describe('session expiry', () => {
  it('refreshes once and replays the original request with the new token', async () => {
    seedSession();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'expired' }, 401)) // original request
      .mockResolvedValueOnce(json({ token: 'access-new', refreshToken: 'refresh-2' })) // refresh
      .mockResolvedValueOnce(json({ id: 7 })); // replay
    vi.stubGlobal('fetch', fetchMock);

    const clearSpy = vi.spyOn(useAuthStore.getState(), 'clearSession');

    await expect(api.get('/api/patients/7')).resolves.toEqual({ data: { id: 7 } });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const replay = fetchMock.mock.calls[2];
    expect(replay[0]).toBe('https://clinic.example.com/api/patients/7');
    expect((replay[1].headers as Record<string, string>).Authorization).toBe('Bearer access-new');
    // A successful refresh must not log the user out.
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('logs the user out when the refresh itself is rejected', async () => {
    seedSession();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'expired' }, 401)) // original request
      .mockResolvedValueOnce(json({ error: 'refresh revoked' }, 401)); // refresh rejected
    vi.stubGlobal('fetch', fetchMock);

    const clearSpy = vi.spyOn(useAuthStore.getState(), 'clearSession');

    await expect(api.get('/api/patients/7')).rejects.toMatchObject({ status: 401 });

    expect(clearSpy).toHaveBeenCalled();
  });

  it('does not retry the request when the refresh failed', async () => {
    seedSession();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({}, 401));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(useAuthStore.getState(), 'clearSession').mockImplementation(() => {});

    await expect(api.get('/api/patients/7')).rejects.toThrow();

    // Two calls only: the original and the refresh. A third would mean the client
    // replayed a request it had no fresh token for.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rotates the refresh token only once for concurrent 401s', async () => {
    // The mutex: two screens loading at once both get a 401. Without a single shared
    // refresh, both would present the same refresh token and the server would reject the
    // second as already-rotated, logging the user out mid-visit.
    seedSession();
    const seen = new Map<string, number>();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/auth/refresh')) {
        return json({ token: 'access-new', refreshToken: 'refresh-2' });
      }
      const n = (seen.get(url) ?? 0) + 1;
      seen.set(url, n);
      // First attempt at each URL is expired; the replay succeeds.
      return n === 1 ? json({ error: 'expired' }, 401) : json({ url });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(useAuthStore.getState(), 'clearSession').mockImplementation(() => {});

    const results = await Promise.allSettled([api.get('/api/patients'), api.get('/api/appointments')]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/api/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });
});

describe('probeServer', () => {
  it('accepts a server that answers UP', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'UP',
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const { probeServer } = await import('../lib/api');
    await expect(probeServer('https://clinic.example.com')).resolves.toMatchObject({ ok: true });
  });

  it('reports a server that is not reachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const { probeServer } = await import('../lib/api');
    const result = await probeServer('https://clinic.example.com');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/لا يمكن الوصول/);
  });

  it('refuses to probe a plain-HTTP origin in a production build', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { probeServer } = await import('../lib/api');
    const result = await probeServer('http://clinic.example.com');

    // The "test connection" button must not be a way to reach a server the app would
    // then refuse to use, so this must never reach the network.
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a response body that is not the expected health string', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html>captive portal</html>',
    } as unknown as Response));

    const { probeServer } = await import('../lib/api');
    await expect(probeServer('https://clinic.example.com')).resolves.toMatchObject({ ok: false });
  });
});
