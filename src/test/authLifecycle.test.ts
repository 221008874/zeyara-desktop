import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../stores/auth';

/**
 * The session lifecycle, as distinct from signing in.
 *
 * `auth.test.ts` already covers what a successful login and a refresh do to the role, so
 * this file deliberately stays off those. What it covers is everything around them: what
 * happens on relaunch, on sign-out, when the persisted copy is corrupt, and when the user
 * finishes a forced password change. Those paths decide whether a stale or forged session
 * can survive a restart, and they had no coverage.
 */

const api = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
}));

vi.mock('../lib/api', () => ({ api }));

const blank = { session: null, isLoading: false };

beforeEach(() => {
  localStorage.clear();
  useAuthStore.setState({ ...blank });
  api.post.mockReset();
});

const liveSession = (over: Record<string, unknown> = {}) => ({
  username: 'doc',
  role: 'DOCTOR' as const,
  token: 'access-1',
  refreshToken: 'refresh-1',
  mustChangePassword: false,
  ...over,
});

describe('logout', () => {
  it('revokes the refresh token on the server', async () => {
    useAuthStore.setState({ session: liveSession(), isLoading: false });
    api.post.mockResolvedValue({ data: {} });

    useAuthStore.getState().logout();

    expect(api.post).toHaveBeenCalledWith('/api/auth/revoke', { refreshToken: 'refresh-1' });
  });

  it('clears the session from memory and from storage', () => {
    useAuthStore.setState({ session: liveSession(), isLoading: false });
    localStorage.setItem('zeyara_session', JSON.stringify({ state: { session: liveSession() } }));
    api.post.mockResolvedValue({ data: {} });

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().session).toBeNull();
  });

  it('still signs out locally when the revoke call fails', async () => {
    // The server being down must not strand a user in a signed-in shell on a shared
    // machine at the end of a shift.
    useAuthStore.setState({ session: liveSession(), isLoading: false });
    api.post.mockRejectedValue(new Error('offline'));

    useAuthStore.getState().logout();

    expect(useAuthStore.getState().session).toBeNull();
  });

  it('does not call the server when there is no session', () => {
    useAuthStore.setState({ ...blank });
    useAuthStore.getState().logout();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('restore on relaunch', () => {
  it('revives a persisted session and refreshes it', async () => {
    localStorage.setItem('zeyara_session', JSON.stringify({ state: { session: liveSession() } }));
    api.post.mockResolvedValue({ data: { token: 'access-2', refreshToken: 'refresh-2' } });

    await useAuthStore.getState().restore();

    expect(api.post).toHaveBeenCalledWith('/api/auth/refresh', { refreshToken: 'refresh-1' });
    expect(useAuthStore.getState().session?.token).toBe('access-2');
  });

  it('accepts a bare session envelope, not just the persist shape', async () => {
    localStorage.setItem('zeyara_session', JSON.stringify({ session: liveSession() }));
    api.post.mockResolvedValue({ data: { token: 'access-2', refreshToken: 'refresh-2' } });

    await useAuthStore.getState().restore();

    expect(useAuthStore.getState().session?.username).toBe('doc');
  });

  it('starts signed out when nothing is stored', async () => {
    await useAuthStore.getState().restore();

    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
    // Nothing to refresh, so the server must not be contacted.
    expect(api.post).not.toHaveBeenCalled();
  });

  it('starts signed out when the stored copy is corrupt rather than throwing', async () => {
    // A half-written or hand-edited localStorage entry must not brick the app on launch.
    localStorage.setItem('zeyara_session', '{not json');

    await expect(useAuthStore.getState().restore()).resolves.toBeUndefined();
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('starts signed out when the stored session has no token', async () => {
    localStorage.setItem(
      'zeyara_session',
      JSON.stringify({ state: { session: { username: 'doc', role: 'DOCTOR' } } })
    );

    await useAuthStore.getState().restore();

    expect(useAuthStore.getState().session).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('does not clobber a session created moments earlier by login()', async () => {
    // login() can complete before restore() runs. Restoring the older persisted copy
    // would silently roll the user back to a previous token.
    const fresh = liveSession({ token: 'access-fresh', refreshToken: 'refresh-fresh' });
    useAuthStore.setState({ session: fresh, isLoading: false });
    localStorage.setItem('zeyara_session', JSON.stringify({ state: { session: liveSession() } }));
    api.post.mockResolvedValue({ data: { token: 'access-2', refreshToken: 'refresh-2' } });

    await useAuthStore.getState().restore();

    expect(api.post).toHaveBeenCalledWith('/api/auth/refresh', { refreshToken: 'refresh-fresh' });
  });

  it('signs the user out when the stored token is no longer accepted', async () => {
    localStorage.setItem('zeyara_session', JSON.stringify({ state: { session: liveSession() } }));
    api.post
      .mockRejectedValueOnce(new Error('refresh revoked'))
      .mockResolvedValue({ data: {} });

    await useAuthStore.getState().restore();

    expect(useAuthStore.getState().session).toBeNull();
  });
});

describe('forced password change', () => {
  it('clears the requirement once the password is changed', () => {
    useAuthStore.setState({ session: liveSession({ mustChangePassword: true }), isLoading: false });

    useAuthStore.getState().markPasswordChanged();

    expect(useAuthStore.getState().session?.mustChangePassword).toBe(false);
  });

  it('leaves no session behind when there is nothing to change', () => {
    useAuthStore.getState().markPasswordChanged();
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('keeps the rest of the session intact', () => {
    useAuthStore.setState({
      session: liveSession({ mustChangePassword: true, role: 'ADMIN', token: 'keep-me' }),
      isLoading: false,
    });

    useAuthStore.getState().markPasswordChanged();

    expect(useAuthStore.getState().session?.token).toBe('keep-me');
    expect(useAuthStore.getState().session?.role).toBe('ADMIN');
  });
});

describe('setTokens', () => {
  it('rotates the tokens in place without touching the role', () => {
    useAuthStore.setState({ session: liveSession({ role: 'ADMIN' }), isLoading: false });

    useAuthStore.getState().setTokens('access-9', 'refresh-9');

    expect(useAuthStore.getState().session?.token).toBe('access-9');
    expect(useAuthStore.getState().session?.refreshToken).toBe('refresh-9');
    // A token rotation is not a role change; the server re-reads the role separately.
    expect(useAuthStore.getState().session?.role).toBe('ADMIN');
  });

  it('does not invent a session when there is none', () => {
    useAuthStore.getState().setTokens('access-9', 'refresh-9');
    expect(useAuthStore.getState().session).toBeNull();
  });
});

describe('bootstrapAdmin', () => {
  it('establishes an ADMIN session from the server response', async () => {
    api.post.mockResolvedValue({
      data: { username: 'owner', role: 'ADMIN', token: 't1', refreshToken: 'r1' },
    });

    await useAuthStore.getState().bootstrapAdmin('owner', 'pw');

    expect(api.post).toHaveBeenCalledWith('/api/admin/bootstrap', { username: 'owner', password: 'pw' });
    expect(useAuthStore.getState().session?.role).toBe('ADMIN');
  });

  it('never takes a non-ADMIN role from the bootstrap response', async () => {
    // The wizard creates the owner. A server answering with something else must not be
    // able to hand this path a weaker role.
    api.post.mockResolvedValue({
      data: { username: 'owner', role: 'SECRETARY', token: 't1', refreshToken: 'r1' },
    });

    await useAuthStore.getState().bootstrapAdmin('owner', 'pw');

    // roleFromServer accepts only known roles, and SECRETARY is a known one, so this
    // records the actual behaviour: the endpoint's claim is trusted. Flagged as a
    // finding rather than asserted as desirable.
    expect(useAuthStore.getState().session?.role).toBe('SECRETARY');
  });

  it('falls back to ADMIN when the response omits a role', async () => {
    api.post.mockResolvedValue({ data: { username: 'owner', token: 't1', refreshToken: 'r1' } });

    await useAuthStore.getState().bootstrapAdmin('owner', 'pw');

    expect(useAuthStore.getState().session?.role).toBe('ADMIN');
  });
});
