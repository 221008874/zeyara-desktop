import { describe, it, expect, beforeEach, vi } from 'vitest';
import { acceptCandidate, forgetAcceptedServer } from '../lib/heartbeat';
import { useHeartbeatStore } from '../stores/heartbeat';
import { probeServer } from '../lib/api';
import type { HeartbeatServer } from '../stores/heartbeat';

vi.mock('../lib/api', async (orig) => {
  const actual = await orig<typeof import('../lib/api')>();
  return { ...actual, isTauriApp: false, probeServer: vi.fn(), setServerBaseUrl: vi.fn() };
});

vi.mock('../lib/notificationBus', () => ({ notificationBus: { refresh: vi.fn() } }));

const mockedProbe = vi.mocked(probeServer);

const server = (over: Partial<HeartbeatServer> = {}): HeartbeatServer => ({
  ip: '192.168.1.8',
  port: 8081,
  name: 'ClinicServer',
  verified: true,
  lastSeenAt: Date.now(),
  ...over,
});

describe('discovery trust policy', () => {
  beforeEach(() => {
    useHeartbeatStore.setState({
      status: 'unknown',
      server: null,
      candidates: [],
      unverifiedMode: false,
      error: null,
      acceptedServer: null,
      discoverySecret: '',
    });
    mockedProbe.mockReset();
    mockedProbe.mockResolvedValue({ ok: true, message: 'ok' });
  });

  it('never reports online straight from an unverified candidate', () => {
    // The Rust layer must not emit heartbeat://online without a valid HMAC. This test
    // pins the frontend half of that contract: only setOnline may set 'online'.
    useHeartbeatStore.getState().setCandidates([server({ verified: false })], true);
    expect(useHeartbeatStore.getState().status).toBe('awaiting-choice');
    expect(useHeartbeatStore.getState().server).toBeNull();
  });

  it('flags unverified mode when no secret is configured', () => {
    useHeartbeatStore.getState().setCandidates([server({ verified: false })], true);
    expect(useHeartbeatStore.getState().unverifiedMode).toBe(true);
  });

  it('keeps multiple candidates so a choice can be made', () => {
    // A clinic LAN can host more than one Clinic Server; silently keeping the most
    // recent packet would make the choice depend on timing.
    useHeartbeatStore
      .getState()
      .setCandidates([server({ ip: '192.168.1.8' }), server({ ip: '192.168.1.20', verified: false })], false);
    expect(useHeartbeatStore.getState().candidates).toHaveLength(2);
  });

  it('adopts a candidate only after the server actually answers', async () => {
    useHeartbeatStore.getState().setCandidates([server()], false);

    const result = await acceptCandidate(server());

    expect(result.ok).toBe(true);
    expect(useHeartbeatStore.getState().status).toBe('online');
    expect(useHeartbeatStore.getState().acceptedServer).toBe('192.168.1.8:8081');
  });

  it('does not adopt a candidate that does not respond', async () => {
    // Otherwise the candidate list could be used to point the app at a dead or
    // hostile address that merely claims to be a Clinic Server.
    mockedProbe.mockResolvedValue({ ok: false, message: 'connection refused' });
    useHeartbeatStore.getState().setCandidates([server()], false);

    const result = await acceptCandidate(server());

    expect(result.ok).toBe(false);
    expect(result.message).toContain('refused');
    // Still not connected, and still asking - a refused probe must not count as online.
    expect(useHeartbeatStore.getState().status).toBe('awaiting-choice');
    expect(useHeartbeatStore.getState().server).toBeNull();
  });

  it('probes the exact host and port from the candidate', async () => {
    await acceptCandidate(server({ ip: '10.0.0.5', port: 9090 }));
    expect(mockedProbe).toHaveBeenCalledWith('10.0.0.5', '9090');
  });

  it('removes the accepted candidate from the pending list', async () => {
    useHeartbeatStore.getState().setCandidates([server()], false);
    await acceptCandidate(server());
    expect(useHeartbeatStore.getState().candidates).toEqual([]);
  });

  it('forgetting the server makes the next launch ask again', async () => {
    await acceptCandidate(server());
    expect(useHeartbeatStore.getState().acceptedServer).toBe('192.168.1.8:8081');

    forgetAcceptedServer();

    expect(useHeartbeatStore.getState().acceptedServer).toBeNull();
    expect(useHeartbeatStore.getState().status).toBe('unknown');
  });
});

describe('persisted discovery configuration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists the accepted server and the secret so the prompt does not repeat', () => {
    // The decision is deployment configuration, not transient state. Losing it would
    // mean re-prompting on every launch.
    useHeartbeatStore.getState().setDiscoverySecret('shared-secret');
    useHeartbeatStore.getState().acceptServer(server());

    const raw = JSON.parse(localStorage.getItem('zeyara_discovery') ?? '{}');
    expect(raw.state.discoverySecret).toBe('shared-secret');
    expect(raw.state.acceptedServer).toBe('192.168.1.8:8081');
  });

  it('does not persist transient connection status', () => {
    useHeartbeatStore.getState().setOnline(server());
    const raw = JSON.parse(localStorage.getItem('zeyara_discovery') ?? '{}');
    expect(raw.state.status).toBeUndefined();
  });

  it('keeps configuration when the connection resets', () => {
    useHeartbeatStore.getState().setDiscoverySecret('s');
    useHeartbeatStore.getState().acceptServer(server());

    useHeartbeatStore.getState().reset();

    const s = useHeartbeatStore.getState();
    expect(s.acceptedServer).toBe('192.168.1.8:8081');
    expect(s.discoverySecret).toBe('s');
  });
});
