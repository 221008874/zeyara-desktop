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
