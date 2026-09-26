import { isTauriApp } from './api';

/**
 * Injected by vite.config.ts from package.json, for browser/dev runs only.
 * Declared here rather than in a global .d.ts so the contract lives with its only consumer.
 */
declare const __APP_VERSION__: string;

let cached: string | null = null;

/**
 * The running application version.
 *
 * Previously this was a hard-coded `const CURRENT_VERSION = '1.0.0'` in updateCheck.ts,
 * alongside three other copies in package.json, tauri.conf.json and Cargo.toml. Bumping
 * the bundled version did not change the string sent to `/api/update/check`, so an
 * installer built as 1.1.0 still reported itself as 1.0.0 and the server could never
 * offer it a newer release.
 *
 * In a packaged app the authority is Tauri itself, which reports the version the
 * installer was actually built from. In a browser (dev server, contract tests) there is
 * no Tauri runtime, so the value is injected at build time from package.json.
 */
export async function getAppVersion(): Promise<string> {
  if (cached) return cached;

  if (isTauriApp) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      const v = await getVersion();
      if (v) {
        cached = v;
        return v;
      }
    } catch {
      // Not available (older runtime, or the dynamic import failed) - use the fallback.
    }
  }

  cached = typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0';
  return cached;
}

/** Test seam: forget the memoised value. */
export function __resetVersionCache(): void {
  cached = null;
}
