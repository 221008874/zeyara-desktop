import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getAppVersion, __resetVersionCache } from '../lib/version';

vi.mock('../lib/api', () => ({
  isTauriApp: false,
  getBaseUrl: () => 'http://localhost:8081',
}));

describe('app version', () => {
  beforeEach(() => {
    __resetVersionCache();
    vi.resetModules();
  });

  it('falls back to the build-time value outside Tauri', async () => {
    // The bug this replaces: a hard-coded CURRENT_VERSION = '1.0.0' in updateCheck.ts,
    // duplicated in package.json, tauri.conf.json and Cargo.toml. Bumping the bundled
    // version did not change the string sent to /api/update/check, so the server could
    // never offer a newer release to a correctly built installer.
    const v = await getAppVersion();
    expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('memoises the lookup', async () => {
    const first = await getAppVersion();
    const second = await getAppVersion();
    expect(second).toBe(first);
  });

  it('reads the version from Tauri when running in the shell', async () => {
    vi.resetModules();
    vi.doMock('../lib/api', () => ({ isTauriApp: true }));
    vi.doMock('@tauri-apps/api/app', () => ({ getVersion: async () => '2.4.1' }));

    const mod = await import('../lib/version');
    expect(await mod.getAppVersion()).toBe('2.4.1');

    vi.doUnmock('../lib/api');
    vi.doUnmock('@tauri-apps/api/app');
  });
});

describe('update check uses the real version', () => {
  beforeEach(() => {
    __resetVersionCache();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('sends the running version, not a stale literal', async () => {
    vi.doMock('../lib/api', () => ({
      isTauriApp: true,
      getBaseUrl: () => 'http://localhost:8081',
    }));
    vi.doMock('../lib/version', () => ({ getAppVersion: async () => '3.1.4' }));
    vi.doMock('@tauri-apps/api/app', () => ({ getVersion: async () => '3.1.4' }));

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ updateAvailable: true, latestVersion: '3.2.0', downloadUrl: 'http://x/y.msi' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('../lib/updateCheck');
    const info = await mod.checkForUpdate();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('currentVersion=3.1.4');
    expect(url).not.toContain('1.0.0');
    expect(info?.currentVersion).toBe('3.1.4');

    vi.doUnmock('../lib/api');
    vi.doUnmock('../lib/version');
    vi.doUnmock('@tauri-apps/api/app');
  });

  it('returns null when the server says there is no update', async () => {
    vi.doMock('../lib/api', () => ({ isTauriApp: false, getBaseUrl: () => 'http://localhost:8081' }));
    vi.doMock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.0.0' }));

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ updateAvailable: false }) });
    vi.stubGlobal('fetch', fetchMock);

    const mod = await import('../lib/updateCheck');
    expect(await mod.checkForUpdate()).toBeNull();

    vi.doUnmock('../lib/api');
    vi.doUnmock('@tauri-apps/api/app');
  });

  it('never blocks the UI when the server is unreachable', async () => {
    vi.doMock('../lib/api', () => ({ isTauriApp: false, getBaseUrl: () => 'http://localhost:8081' }));
    vi.doMock('@tauri-apps/api/app', () => ({ getVersion: async () => '1.0.0' }));

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const mod = await import('../lib/updateCheck');
    expect(await mod.checkForUpdate()).toBeNull();

    vi.doUnmock('../lib/api');
    vi.doUnmock('@tauri-apps/api/app');
  });
});
