import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { post: vi.fn() },
  isTauriApp: false,
  getBaseUrl: () => 'http://localhost:8081',
  setServerBaseUrl: vi.fn(),
  resetServerBaseUrl: vi.fn(),
  probeServer: vi.fn(),
}));

const mockedPost = vi.mocked(api.post);

describe('session role comes from the server, not the login dropdown', () => {
  beforeEach(() => {
    useAuthStore.setState({ session: null, isLoading: false });
    mockedPost.mockReset();
  });

  it('uses the role the server returned', async () => {
    mockedPost.mockResolvedValue({
      data: { token: 't', refreshToken: 'r', username: 'real_name', role: 'DOCTOR', forceChange: false },
    });

    const result = await useAuthStore.getState().login('someone', 'pw', 'DOCTOR');

    expect(result.role).toBe('DOCTOR');
    expect(useAuthStore.getState().session?.role).toBe('DOCTOR');
  });

  it('trusts the server over the role the user picked in the UI', async () => {
    // The picker chooses the login ENDPOINT. If the server disagrees about the role,
    // the server wins - otherwise the UI would grant capabilities the backend never
    // granted, and every role gate in the app would be decorative.
    mockedPost.mockResolvedValue({
      data: { token: 't', refreshToken: 'r', role: 'SECRETARY', forceChange: false },
    });

    const result = await useAuthStore.getState().login('someone', 'pw', 'DOCTOR');

    expect(result.role).toBe('SECRETARY');
    expect(useAuthStore.getState().session?.role).toBe('SECRETARY');
  });

  it('falls back to the selected role only when the server omits one', async () => {
    mockedPost.mockResolvedValue({ data: { token: 't', refreshToken: 'r', forceChange: false } });

    const result = await useAuthStore.getState().login('someone', 'pw', 'SECRETARY');

    expect(result.role).toBe('SECRETARY');
  });

  it('ignores an unrecognised role value rather than storing it', async () => {
    mockedPost.mockResolvedValue({
      data: { token: 't', refreshToken: 'r', role: 'SUPERUSER', forceChange: false },
    });

    const result = await useAuthStore.getState().login('someone', 'pw', 'DOCTOR');

    expect(result.role).toBe('DOCTOR');
    expect(['ADMIN', 'DOCTOR', 'SECRETARY']).toContain(useAuthStore.getState().session?.role);
  });

  it('prefers the server-returned username', async () => {
    mockedPost.mockResolvedValue({
      data: { token: 't', refreshToken: 'r', username: 'canonical', role: 'ADMIN', forceChange: false },
    });

    await useAuthStore.getState().login('typed', 'pw', 'ADMIN');

    expect(useAuthStore.getState().session?.username).toBe('canonical');
  });

  it('carries the forced-password-change flag through', async () => {
    mockedPost.mockResolvedValue({ data: { token: 't', refreshToken: 'r', role: 'DOCTOR', forceChange: true } });

    const result = await useAuthStore.getState().login('someone', 'pw', 'DOCTOR');

    expect(result.mustChangePassword).toBe(true);
    expect(useAuthStore.getState().session?.mustChangePassword).toBe(true);
  });

  it('calls the endpoint matching the selected role', async () => {
    mockedPost.mockResolvedValue({ data: { token: 't', refreshToken: 'r', role: 'SECRETARY', forceChange: false } });

    await useAuthStore.getState().login('someone', 'pw', 'SECRETARY');

    expect(mockedPost).toHaveBeenCalledWith('/api/secretaries/login', { username: 'someone', password: 'pw' });
  });
});

describe('refresh re-reads the role', () => {
  beforeEach(() => {
    mockedPost.mockReset();
    useAuthStore.setState({
      session: { username: 'u', role: 'DOCTOR', token: 'old', refreshToken: 'r1', mustChangePassword: false },
      isLoading: false,
    });
  });

  it('narrows the session role when the server reports a downgrade', async () => {
    // If an administrator revokes doctor rights, the client must stop showing clinical
    // screens on the next refresh rather than at the next sign-in.
    mockedPost.mockResolvedValue({ data: { token: 'new', refreshToken: 'r2', role: 'SECRETARY' } });

    await useAuthStore.getState().refresh();

    expect(useAuthStore.getState().session?.role).toBe('SECRETARY');
  });

  it('keeps the current role when the refresh response omits one', async () => {
    mockedPost.mockResolvedValue({ data: { token: 'new', refreshToken: 'r2' } });

    await useAuthStore.getState().refresh();

    expect(useAuthStore.getState().session?.role).toBe('DOCTOR');
  });

  it('rotates both tokens', async () => {
    mockedPost.mockResolvedValue({ data: { token: 'new', refreshToken: 'r2', role: 'DOCTOR' } });

    await useAuthStore.getState().refresh();

    const s = useAuthStore.getState().session;
    expect(s?.token).toBe('new');
    expect(s?.refreshToken).toBe('r2');
  });

  it('logs out when the refresh is rejected', async () => {
    mockedPost.mockRejectedValue(new Error('Unauthorized'));

    await useAuthStore.getState().refresh();

    expect(useAuthStore.getState().session).toBeNull();
  });
});
