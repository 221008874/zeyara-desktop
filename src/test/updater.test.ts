import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkForUpdate, installUpdate, currentTarget } from '../lib/updateCheck';
import tauriConf from '../../src-tauri/tauri.conf.json';

vi.mock('../lib/version', () => ({
  getAppVersion: vi.fn(async () => '1.0.0'),
  // The module is mocked so the running version is pinned; the cache reset is not needed
  // because getAppVersion is a fresh mock per file, but the export must exist for any
  // code path that reaches for it.
  __resetVersionCache: vi.fn(),
}));
vi.mock('../lib/serverUrl', async (orig) => {
  const actual = await orig<typeof import('../lib/serverUrl')>();
  return { ...actual, isFetchableUrl: vi.fn(() => true) };
});

const checkMock = vi.fn();
vi.mock('@tauri-apps/plugin-updater', () => ({ check: () => checkMock() }));

const { isFetchableUrl } = await import('../lib/serverUrl');
const mockedFetchable = vi.mocked(isFetchableUrl);

/** A well-formed signed manifest for the running platform. */
function manifest(over: Record<string, unknown> = {}) {
  return {
    available: true,
    currentVersion: '1.0.0',
    version: '1.1.0',
    date: '2026-09-27T00:00:00Z',
    body: 'notes',
    rawJson: {
      version: '1.1.0',
      platforms: {
        [currentTarget()]: {
          url: 'https://github.com/o/r/releases/download/v1.1.0/Zeyara_1.1.0_x64-setup.nsis.zip',
          signature: 'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHNpZ25hdHVyZTov',
        },
      },
    },
    ...over,
  };
}

describe('AC13 — signed update acceptance', () => {
  beforeEach(async () => {
    checkMock.mockReset();
    mockedFetchable.mockReset();
    mockedFetchable.mockReturnValue(true);
    // Restored every time: a test that changes the running version must not leak it.
    const { getAppVersion } = await import('../lib/version');
    vi.mocked(getAppVersion).mockResolvedValue('1.0.0');
  });

  it('offers a newer signed release', async () => {
    checkMock.mockResolvedValue(manifest());
    const info = await checkForUpdate();
    expect(info.available).toBe(true);
    expect(info.latestVersion).toBe('1.1.0');
    expect(info.signed).toBe(true);
    expect(info.artifactUrl).toMatch(/^https:\/\//);
  });

  it('accepts an https artifact endpoint', async () => {
    checkMock.mockResolvedValue(manifest());
    const info = await checkForUpdate();
    expect(mockedFetchable).toHaveBeenCalledWith(info.artifactUrl);
    expect(info.available).toBe(true);
  });

  it('compares against the runtime version, never a hard-coded literal', async () => {
    // The regression this guards: a literal CURRENT_VERSION meant an installer built as
    // 1.1.0 still reported 1.0.0, so the server could never offer it a newer release.
    const { getAppVersion } = await import('../lib/version');
    vi.mocked(getAppVersion).mockResolvedValue('1.4.2');

    checkMock.mockResolvedValue(manifest({ version: '1.4.2', currentVersion: '1.4.2' }));
    const info = await checkForUpdate();

    expect(info.currentVersion).toBe('1.4.2');
    // Same version as the running build, so nothing is offered.
    expect(info.available).toBe(false);
    expect(info.decision).toEqual({ offer: false, reason: 'same' });
  });

  it('installs a signed release through the plugin', async () => {
    const download = vi.fn(async () => {});
    const install = vi.fn(async () => {});
    checkMock.mockResolvedValue({ ...manifest(), download, install });

    const info = await checkForUpdate();
    const result = await installUpdate(info);

    expect(download).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
    expect(result.version).toBe('1.1.0');
  });
});

describe('AC13 — rejection', () => {
  beforeEach(async () => {
    checkMock.mockReset();
    mockedFetchable.mockReset();
    mockedFetchable.mockReturnValue(true);
    // Restored every time: a test that changes the running version must not leak it.
    const { getAppVersion } = await import('../lib/version');
    vi.mocked(getAppVersion).mockResolvedValue('1.0.0');
  });

  it('refuses a manifest with no signature', async () => {
    const m = manifest();
    m.rawJson.platforms[currentTarget()].signature = '';
    checkMock.mockResolvedValue(m);

    const info = await checkForUpdate();
    // The signature lives in the manifest; an empty one is not a signed release.
    expect(info.signed).toBe(false);
    await expect(installUpdate(info)).rejects.toThrow(/توقيع/);
    expect(info.available).toBe(true); // discovered, but not installable
  });

  it('refuses to install an unsigned release', async () => {
    const download = vi.fn();
    const install = vi.fn();
    checkMock.mockResolvedValue({ ...manifest(), download, install });

    await expect(
      installUpdate({ available: true, signed: false } as never)
    ).rejects.toThrow(/توقيع/);
    expect(download).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it('refuses an http artifact endpoint', async () => {
    mockedFetchable.mockReturnValue(false);
    checkMock.mockResolvedValue(manifest());

    const info = await checkForUpdate();
    expect(info.available).toBe(false);
  });

  it('refuses to install over an http artifact endpoint', async () => {
    const download = vi.fn();
    const install = vi.fn();
    checkMock.mockResolvedValue({ ...manifest(), download, install });
    mockedFetchable.mockReturnValue(false);

    // check() already refuses to offer it, so exercise the install guard directly too:
    // a manifest must not be able to reach the download step over a bad transport.
    await expect(
      installUpdate({
        available: true,
        currentVersion: '1.0.0',
        latestVersion: '1.1.0',
        notes: null,
        date: null,
        signed: true,
        decision: { offer: true, from: '1.0.0', to: '1.1.0' },
        artifactUrl: 'http://insecure.example/Zeyary.zip',
      })
    ).rejects.toThrow(/غير موثوقة/);
    expect(download).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it('refuses a downgrade', async () => {
    checkMock.mockResolvedValue(manifest({ version: '0.9.0' }));
    const info = await checkForUpdate();
    expect(info.available).toBe(false);
    expect(info.decision).toEqual({ offer: false, reason: 'older' });
  });

  it('refuses the same version', async () => {
    checkMock.mockResolvedValue(manifest({ version: '1.0.0' }));
    const info = await checkForUpdate();
    expect(info.available).toBe(false);
    expect(info.decision).toEqual({ offer: false, reason: 'same' });
  });

  it('refuses a malformed announced version', async () => {
    checkMock.mockResolvedValue(manifest({ version: 'not-a-version' }));
    const info = await checkForUpdate();
    expect(info.available).toBe(false);
    expect(info.decision).toEqual({ offer: false, reason: 'unparseable-latest' });
  });

  it('refuses a manifest with no platform entry for this machine', async () => {
    const m = manifest();
    m.rawJson.platforms = { 'solaris-sparc': { url: 'https://x/y.zip', signature: 'sig' } };
    checkMock.mockResolvedValue(m);
    const info = await checkForUpdate();
    // No artifact means nothing to install, so it is not offered.
    expect(info.artifactUrl).toBeNull();
    expect(info.signed).toBe(false);
  });
});

describe('AC13 — failure safety', () => {
  beforeEach(async () => {
    checkMock.mockReset();
    mockedFetchable.mockReset();
    mockedFetchable.mockReturnValue(true);
    // Restored every time: a test that changes the running version must not leak it.
    const { getAppVersion } = await import('../lib/version');
    vi.mocked(getAppVersion).mockResolvedValue('1.0.0');
  });

  it('a network failure resolves to no update and does not throw', async () => {
    checkMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(checkForUpdate()).resolves.toMatchObject({ available: false });
  });

  it('malformed metadata resolves to no update and does not throw', async () => {
    checkMock.mockResolvedValue({ version: null, rawJson: 'not-an-object' });
    await expect(checkForUpdate()).resolves.toMatchObject({ available: false });
  });

  it('a tampered artifact fails during download and install is never reached', async () => {
    // download() is where the plugin verifies the signature; a mismatch rejects there.
    const download = vi.fn(async () => {
      throw new Error('signature verification failed');
    });
    const install = vi.fn();
    checkMock.mockResolvedValue({ ...manifest(), download, install });

    const info = await checkForUpdate();
    await expect(installUpdate(info)).rejects.toThrow(/signature verification failed/);
    expect(install).not.toHaveBeenCalled();
  });

  it('refuses to install when nothing is available', async () => {
    await expect(
      installUpdate({
        available: false,
        currentVersion: '1.0.0',
        latestVersion: null,
        notes: null,
        date: null,
        signed: false,
        decision: null,
        artifactUrl: null,
      })
    ).rejects.toThrow();
  });

  it('refuses when the release disappears between check and install', async () => {
    checkMock.mockResolvedValueOnce(manifest()).mockResolvedValueOnce(null);
    const info = await checkForUpdate();
    await expect(installUpdate(info)).rejects.toThrow();
  });
});

describe('AC13 — shipped updater configuration', () => {
  const updater = (tauriConf as any).plugins?.updater;

  it('the updater is active', () => {
    expect(updater?.active).toBe(true);
  });

  it('updater artifacts are generated and signed', () => {
    expect((tauriConf as any).bundle.createUpdaterArtifacts).toBe(true);
  });

  it('a production public key is embedded', () => {
    expect(typeof updater?.pubkey).toBe('string');
    expect(updater.pubkey.length).toBeGreaterThan(80);
    // Must be a minisign public key, not a private one.
    const decoded = atob(updater.pubkey);
    expect(decoded).toContain('minisign public key');
    expect(decoded).not.toContain('secret');
  });

  it('every endpoint is https', () => {
    const endpoints: string[] = updater?.endpoints ?? [];
    expect(endpoints.length).toBeGreaterThan(0);
    for (const e of endpoints) {
      expect(e.startsWith('https://')).toBe(true);
    }
  });

  it('the built-in dialog is off, so the app controls the update UX', () => {
    expect(updater?.dialog).toBe(false);
  });
});
