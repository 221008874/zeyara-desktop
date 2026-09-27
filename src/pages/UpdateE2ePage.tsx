import React from 'react';
import { checkForUpdate, installUpdate, type UpdateInfo } from '../lib/updateCheck';
import { getAppVersion } from '../lib/version';

/**
 * Updater end-to-end harness.
 *
 * This page exists so the update path can be exercised without a Clinic Server. It calls
 * `checkForUpdate()` and `installUpdate()` - the exact functions `DashboardPage` uses for
 * the production banner - so nothing about the update path is reimplemented here. The
 * minisign verification, the HTTPS assertion and the no-downgrade policy all remain in
 * `updateCheck.ts` and `updatePolicy.ts`; this page cannot offer an unsigned or downgraded
 * release any more than the banner can.
 *
 * Mounted only when `ZEYARA_UPDATE_E2E` is set, and never registered in the router, so it
 * is absent from the sidebar and from production navigation. See `App.tsx`.
 *
 * Results are appended to a JSON-lines report rather than only shown, because half the
 * cycle happens after this process is replaced by the updater: the post-restart record has
 * to come from a different process and still land in the same place.
 */

/** One line of the report. `stage` is what a reader keys on. */
interface ReportEntry {
  stage: 'check' | 'install-start' | 'install-error' | 'post-restart';
  at: string;
  currentVersion: string;
  latestVersion: string | null;
  available: boolean;
  signed: boolean;
  artifactUrl: string | null;
  installedVersion?: string;
  error?: string;
  bytesDownloaded?: number;
  bytesTotal?: number;
  /** True when this process is the one the updater restarted. */
  afterRestart?: boolean;
  /** Proves app-owned state survived the reinstall. */
  sentinelBefore?: string | null;
  sentinelAfter?: string | null;
}

/** Marks this install as the target of an E2E run, so the relaunch can prove continuity. */
const SENTINEL_KEY = 'zeyara.updateE2e.sentinel';
/** Records the version that was running just before the update was installed. */
const PREVIOUS_KEY = 'zeyara.updateE2e.previousVersion';

interface E2eConfig {
  enabled: boolean;
  auto: boolean;
  reportPath: string;
  currentVersion: string;
}

async function config(): Promise<E2eConfig | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<E2eConfig>('update_e2e_config');
  } catch {
    return null;
  }
}

async function writeReport(entry: ReportEntry): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('update_e2e_write_report', { entry });
  } catch {
    // A missing report must never take the app down; the UI still shows the result.
  }
}

export default function UpdateE2ePage() {
  const [cfg, setCfg] = React.useState<E2eConfig | null>(null);
  const [info, setInfo] = React.useState<UpdateInfo | null>(null);
  const [status, setStatus] = React.useState('starting…');
  const [progress, setProgress] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [sentinel, setSentinel] = React.useState<string | null>(null);
  // Guards against React 18 StrictMode double-invoking the effect and installing twice.
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      const c = await config();
      if (!c || !c.enabled) {
        setStatus('disabled: set ZEYARA_UPDATE_E2E to run this');
        return;
      }
      setCfg(c);

      const currentVersion = await getAppVersion();
      const previous = window.localStorage.getItem(PREVIOUS_KEY);
      const priorSentinel = window.localStorage.getItem(SENTINEL_KEY);
      const afterRestart = previous !== null && previous !== currentVersion;

      setStatus('checking the live release…');
      const result = await checkForUpdate();
      setInfo(result);

      await writeReport({
        stage: afterRestart ? 'post-restart' : 'check',
        at: new Date().toISOString(),
        currentVersion,
        latestVersion: result.latestVersion,
        available: result.available,
        signed: result.signed,
        artifactUrl: result.artifactUrl,
        afterRestart,
        sentinelBefore: priorSentinel,
        sentinelAfter: priorSentinel,
      });

      if (afterRestart) {
        setSentinel(priorSentinel);
        setStatus(
          result.available
            ? `restarted into ${currentVersion}, but ${result.latestVersion} is still offered`
            : `restarted into ${currentVersion}; no further update offered`
        );
        return;
      }

      if (!result.available) {
        setStatus(`running ${currentVersion}; no signed update available`);
        return;
      }

      setStatus(`update available: ${currentVersion} → ${result.latestVersion}`);

      if (c.auto) {
        await runInstall(result, currentVersion);
      }
    })();
  }, []);

  async function runInstall(updateInfo: UpdateInfo, currentVersion: string) {
    setError(null);
    setStatus('downloading and verifying…');

    // Stamped before the install so the relaunched process can prove the marker survived,
    // which is how "existing files and configuration remain intact" is checked rather
    // than assumed.
    const marker = `e2e-${currentVersion}-${Date.now()}`;
    window.localStorage.setItem(SENTINEL_KEY, marker);
    window.localStorage.setItem(PREVIOUS_KEY, currentVersion);
    setSentinel(marker);

    await writeReport({
      stage: 'install-start',
      at: new Date().toISOString(),
      currentVersion,
      latestVersion: updateInfo.latestVersion,
      available: updateInfo.available,
      signed: updateInfo.signed,
      artifactUrl: updateInfo.artifactUrl,
      sentinelBefore: marker,
      sentinelAfter: marker,
    });

    try {
      const outcome = await installUpdate(updateInfo, ({ downloaded, total }) => {
        const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
        setProgress(`${mb(downloaded)} / ${mb(total)} MB`);
        if (total > 0) setStatus(`verifying signature — ${Math.round((downloaded / total) * 100)}%`);
      });
      setStatus(`installer started for ${outcome.version}; the app will restart`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setStatus('install failed');
      await writeReport({
        stage: 'install-error',
        at: new Date().toISOString(),
        currentVersion,
        latestVersion: updateInfo.latestVersion,
        available: updateInfo.available,
        signed: updateInfo.signed,
        artifactUrl: updateInfo.artifactUrl,
        error: message,
      });
    }
  }

  const onInstall = () => {
    if (info?.available) void runInstall(info, info.currentVersion);
  };

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 32, maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Updater end-to-end</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Test-only. Calls the same update functions as the dashboard banner.
      </p>

      <table style={{ borderCollapse: 'collapse', marginBottom: 16 }}>
        <tbody>
          <tr>
            <td style={{ padding: '4px 16px 4px 0', color: '#666' }}>status</td>
            <td style={{ padding: '4px 0', fontFamily: 'monospace' }}>{status}</td>
          </tr>
          <tr>
            <td style={{ padding: '4px 16px 4px 0', color: '#666' }}>running</td>
            <td style={{ padding: '4px 0', fontFamily: 'monospace' }}>{cfg?.currentVersion ?? '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '4px 16px 4px 0', color: '#666' }}>detected</td>
            <td style={{ padding: '4px 0', fontFamily: 'monospace' }}>{info?.latestVersion ?? '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '4px 16px 4px 0', color: '#666' }}>signed</td>
            <td style={{ padding: '4px 0', fontFamily: 'monospace' }}>{info ? String(info.signed) : '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '4px 16px 4px 0', color: '#666' }}>artifact</td>
            <td style={{ padding: '4px 0', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
              {info?.artifactUrl ?? '—'}
            </td>
          </tr>
          <tr>
            <td style={{ padding: '4px 16px 4px 0', color: '#666' }}>progress</td>
            <td style={{ padding: '4px 0', fontFamily: 'monospace' }}>{progress ?? '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '4px 16px 4px 0', color: '#666' }}>sentinel</td>
            <td style={{ padding: '4px 0', fontFamily: 'monospace' }}>{sentinel ?? '—'}</td>
          </tr>
          <tr>
            <td style={{ padding: '4px 16px 4px 0', color: '#666' }}>report</td>
            <td style={{ padding: '4px 0', fontFamily: 'monospace', fontSize: 12 }}>{cfg?.reportPath ?? '—'}</td>
          </tr>
        </tbody>
      </table>

      {error && (
        <p style={{ color: '#b00020', fontFamily: 'monospace' }} data-testid="e2e-error">
          {error}
        </p>
      )}

      {info?.available && !cfg?.auto && (
        <button type="button" onClick={onInstall}>
          install {info.latestVersion}
        </button>
      )}
    </main>
  );
}
