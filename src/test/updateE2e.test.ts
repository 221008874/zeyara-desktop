import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROUTE_ACCESS, NAV_ITEMS } from '../app-shell/navigation';

/**
 * The updater E2E harness must stay out of production navigation, and the updater plugin
 * must actually be reachable. Both are asserted here as source-level invariants because
 * neither is visible at runtime once the flag is unset: an E2E page quietly added to the
 * route table, or an updater call with no capability granted, both look like a working app
 * right up until a clinic tries to update.
 */
const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/**
 * Source with comments removed.
 *
 * The negative assertions below look for forbidden logic, and prose describing that logic
 * is not a violation - the first draft of this file failed on the E2E page's own doc
 * comment, which mentions minisign while explaining that the page does not do minisign.
 * Only `//` at the start of a line is stripped, so a `https://` inside a string is safe.
 */
function code(p: string): string {
  return read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('E2E entry point is not production navigation', () => {
  it('is not registered as a route', () => {
    // The harness is an alternate root in App.tsx precisely so it cannot land here.
    expect(read('routes/index.tsx')).not.toMatch(/update-e2e|UpdateE2ePage/);
  });

  it('is not in the sidebar or the role access map', () => {
    expect(NAV_ITEMS.some((i) => /e2e/i.test(i.path))).toBe(false);
    expect(Object.keys(ROUTE_ACCESS).some((p) => /e2e/i.test(p))).toBe(false);
  });

  it('renders only behind the environment flag, defaulting to the normal app', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/updateE2eEnabled/);
    // Unknown must render the normal app, not the harness: a failed probe degrades to
    // production rather than showing a test page to a clinician.
    expect(app).toMatch(/e2e === true/);
  });
});

describe('E2E harness drives the production update path', () => {
  const page = read('pages/UpdateE2ePage.tsx');

  it('calls the same functions the dashboard banner calls', () => {
    // Reimplementing the updater here would mean the E2E proves nothing about the code
    // that ships. It must go through updateCheck.ts.
    expect(page).toMatch(/from '\.\.\/lib\/updateCheck'/);
    expect(page).toMatch(/checkForUpdate\(\)/);
    expect(page).toMatch(/installUpdate\(/);
  });

  it('does not contain its own signature, hash or version comparison', () => {
    // Any of these would be a second, unaudited trust decision.
    const src = code('pages/UpdateE2ePage.tsx');
    expect(src).not.toMatch(/sha256|createHash|subtle\.digest/i);
    expect(src).not.toMatch(/minisign|verifySignature/i);
    expect(src).not.toMatch(/compareVersions|decideUpdate/);
  });

  it('does not read the version literal anywhere in code', () => {
    const src = code('pages/UpdateE2ePage.tsx');
    expect(src).toMatch(/getAppVersion/);
    expect(src).not.toMatch(/version\s*[:=]\s*['"]1\.\d+\.\d+['"]/);
  });
});

describe('updater plugin is reachable', () => {
  it('grants exactly the three updater calls the app makes', () => {
    const caps = JSON.parse(read('capabilities/../../src-tauri/capabilities/default.json'));
    const updater = caps.permissions.filter((p: string) => p.startsWith('updater:'));
    expect(updater.sort()).toEqual([
      'updater:allow-check',
      'updater:allow-download',
      'updater:allow-install',
    ]);
  });

  it('does not grant the combined download-and-install path', () => {
    // download() and install() are called separately so the signature-verified download
    // step stays a distinct step; the combined permission would allow bypassing it.
    const raw = read('capabilities/../../src-tauri/capabilities/default.json');
    expect(raw).not.toMatch(/updater:allow-download-and-install/);
  });
});

describe('E2E flag parsing fails closed', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockReset();
    vi.doMock('@tauri-apps/api/core', () => ({ invoke }));
  });

  afterEach(() => {
    vi.doUnmock('@tauri-apps/api/core');
    vi.resetModules();
  });

  it('is disabled when the command reports enabled: false', async () => {
    invoke.mockResolvedValue({ enabled: false, auto: false, reportPath: 'r', currentVersion: '1.0.0' });
    const { updateE2eEnabled } = await import('../lib/updateE2e');
    expect(await updateE2eEnabled()).toBe(false);
  });

  it('is disabled when the Tauri runtime is unavailable', async () => {
    invoke.mockRejectedValue(new Error('no IPC'));
    const { updateE2eEnabled } = await import('../lib/updateE2e');
    expect(await updateE2eEnabled()).toBe(false);
  });

  it('is enabled only on an explicit true', async () => {
    invoke.mockResolvedValue({ enabled: true, auto: true, reportPath: 'r', currentVersion: '1.0.3' });
    const { updateE2eEnabled } = await import('../lib/updateE2e');
    expect(await updateE2eEnabled()).toBe(true);
  });
});
