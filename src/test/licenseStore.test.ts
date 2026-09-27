import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLicenseStore } from '../stores/license';

/**
 * The license gate's data source.
 *
 * `LicenseGate` blocks the whole application behind `status.activated`, so how `check()`
 * derives that one boolean decides whether a clinic sees their data. It had no tests, and
 * the derivation has a fail-open corner.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../lib/api', () => ({ api }));

beforeEach(() => {
  localStorage.clear();
  useLicenseStore.setState({ status: null, isLoading: true });
  api.get.mockReset();
  api.post.mockReset();
});

const check = () => useLicenseStore.getState().check();

describe('check', () => {
  it('reports activated when the server says the license is not locked', async () => {
    api.get.mockResolvedValueOnce({ data: { locked: false } });
    const status = await check();
    expect(status.activated).toBe(true);
    expect(status.locked).toBe(false);
    expect(status.serverOnline).toBe(true);
  });

  it('reports locked when the server says so', async () => {
    api.get.mockResolvedValueOnce({ data: { locked: true, reason: 'expired' } });
    const status = await check();
    expect(status.activated).toBe(false);
    expect(status.reason).toBe('expired');
  });

  it('attaches the expiry details when they are available', async () => {
    api.get
      .mockResolvedValueOnce({ data: { locked: false } })
      .mockResolvedValueOnce({ data: { expiryDate: '2027-01-01', daysUntilExpiry: 42 } });
    const status = await check();
    expect(status.expiryDate).toBe('2027-01-01');
    expect(status.daysUntilExpiry).toBe(42);
  });

  it('still reports activation when only the optional expiry call fails', async () => {
    // expiry-info may require auth; losing the countdown must not lock a licensed clinic out.
    api.get
      .mockResolvedValueOnce({ data: { locked: false } })
      .mockRejectedValueOnce(new Error('401'));
    const status = await check();
    expect(status.activated).toBe(true);
    expect(status.expiryDate).toBeNull();
  });

  it('fails closed when the server cannot be reached', async () => {
    api.get.mockRejectedValue(new TypeError('Failed to fetch'));
    const status = await check();
    expect(status.activated).toBe(false);
    expect(status.locked).toBe(true);
    expect(status.serverOnline).toBe(false);
  });

  it('fails closed on a response that does not say whether it is locked', async () => {
    // `activated` used to be derived as `!data.locked`, so an absent `locked` read as
    // `true` and unlocked the app - while `locked` was separately defaulted to true.
    // Only an explicit `locked: false` may activate.
    api.get.mockResolvedValueOnce({ data: {} });
    const status = await check();
    expect(status.activated).toBe(false);
    expect(status.locked).toBe(true);
  });

  it('leaves the store consistent with what it returns', async () => {
    api.get.mockResolvedValueOnce({ data: { locked: true } });
    const status = await check();
    expect(useLicenseStore.getState().status).toEqual(status);
    expect(useLicenseStore.getState().isLoading).toBe(false);
  });
});

describe('activate', () => {
  it('activates on a VALID verdict', async () => {
    api.post.mockResolvedValue({ data: { status: 'VALID', message: 'ok' } });
    await useLicenseStore.getState().activate('KEY-1');
    expect(useLicenseStore.getState().status?.activated).toBe(true);
  });

  it('activates on an OK verdict', async () => {
    api.post.mockResolvedValue({ data: { status: 'OK' } });
    await useLicenseStore.getState().activate('KEY-1');
    expect(useLicenseStore.getState().status?.activated).toBe(true);
  });

  it.each(['EXPIRED', 'INVALID', 'LOCKED', 'anything else'])(
    'stays locked on a %s verdict',
    async (status) => {
      api.post.mockResolvedValue({ data: { status, message: 'nope' } });
      await useLicenseStore.getState().activate('KEY-1');
      expect(useLicenseStore.getState().status?.activated).toBe(false);
      expect(useLicenseStore.getState().status?.locked).toBe(true);
    }
  );

  it('passes the key to the server rather than deciding locally', async () => {
    api.post.mockResolvedValue({ data: { status: 'VALID' } });
    await useLicenseStore.getState().activate('KEY-1');
    expect(api.post).toHaveBeenCalledWith('/api/license/validate-server', { licenseKey: 'KEY-1' });
  });

  it('surfaces the server message on a rejected key', async () => {
    api.post.mockResolvedValue({ data: { status: 'INVALID', message: 'Unknown key' } });
    const res = await useLicenseStore.getState().activate('BAD');
    expect(res.message).toBe('Unknown key');
  });
});
