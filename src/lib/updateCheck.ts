import { getAppVersion } from './version';
import { isFetchableUrl } from './serverUrl';
import { decideUpdate, type UpdateDecision } from './updatePolicy';

/**
 * Update handling.
 *
 * Verification is delegated to `tauri-plugin-updater`, which checks a minisign signature
 * produced by the release signing key against the public key compiled into this build.
 * That public key is the only trust anchor: an artifact is accepted because it was signed
 * by the release key, not because a hash matched.
 *
 * This replaces a hand-rolled path that downloaded the artifact and compared a SHA-256
 * which had arrived over the same channel as the artifact. That was self-referential -
 * anything able to swap the file could swap the expected hash with it - and it had no
 * notion of a downgrade. There is deliberately **no unsigned fallback**: if the plugin
 * will not verify a release, no release is offered, and the installed version stays.
 */

export const APP_ID = 'desktop';

/** The Tauri target string for the running platform, e.g. `windows-x86_64`. */
export function currentTarget(): string {
  const arch =
    typeof navigator !== 'undefined' && /arm64|aarch64/i.test(navigator.userAgent)
      ? 'aarch64'
      : 'x86_64';
  const os =
    typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent)
      ? 'windows'
      : typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
        ? 'darwin'
        : 'linux';
  return `${os}-${arch}`;
}

export interface UpdateInfo {
  available: boolean;
  /** The version actually running, from the Tauri runtime. */
  currentVersion: string;
  latestVersion: string | null;
  notes: string | null;
  date: string | null;
  /** The manifest carried a non-empty signature for this platform. */
  signed: boolean;
  decision: UpdateDecision | null;
  /** Artifact URL for this platform, when the manifest exposed one. */
  artifactUrl: string | null;
}

export interface InstallProgress {
  downloaded: number;
  total: number;
}

export interface InstallResult {
  version: string;
}

const nothingToOffer = (currentVersion: string): UpdateInfo => ({
  available: false,
  currentVersion,
  latestVersion: null,
  notes: null,
  date: null,
  signed: false,
  decision: null,
  artifactUrl: null,
});

/** Reads the per-platform artifact entry out of the raw updater manifest. */
function platformEntry(rawJson: unknown): { url?: string; signature?: string } | null {
  if (!rawJson || typeof rawJson !== 'object') return null;
  const platforms = (rawJson as Record<string, unknown>).platforms;
  if (!platforms || typeof platforms !== 'object') return null;
  const entry = (platforms as Record<string, unknown>)[currentTarget()];
  if (!entry || typeof entry !== 'object') return null;
  return entry as { url?: string; signature?: string };
}

/**
 * Asks whether a signed update exists.
 *
 * Never throws and never blocks the UI. A network failure, an unreachable endpoint, a
 * manifest with no artifact for this platform, or a malformed version all resolve to
 * "no update", leaving the installed version exactly as it is.
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const currentVersion = await getAppVersion();

  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) return nothingToOffer(currentVersion);

    const latest = update.version;

    // Refuse a downgrade even if the plugin's own comparison were to change.
    const decision = decideUpdate(currentVersion, latest);
    if (!decision.offer) {
      return { ...nothingToOffer(currentVersion), latestVersion: latest, decision };
    }

    const entry = platformEntry(update.rawJson);
    const url = typeof entry?.url === 'string' ? entry.url : null;
    const signature = typeof entry?.signature === 'string' ? entry.signature : '';

    // Defence in depth. The configured metadata endpoint is asserted to be https by a
    // test on tauri.conf.json; the artifact URL comes from the manifest, so it is
    // re-checked here. A manifest naming an http artifact is refused.
    if (url && !isFetchableUrl(url)) {
      return {
        ...nothingToOffer(currentVersion),
        latestVersion: latest,
        decision,
        artifactUrl: url,
      };
    }

    return {
      available: true,
      currentVersion,
      latestVersion: latest,
      notes: update.body ?? null,
      date: update.date ?? null,
      signed: signature.length > 0,
      decision,
      artifactUrl: url,
    };
  } catch {
    return nothingToOffer(currentVersion);
  }
}

/**
 * Downloads, verifies and installs a signed update.
 *
 * The signature is verified inside `download()` on the Rust side, before the artifact is
 * written. Any failure throws, and nothing about the installed version changes, so a
 * network, download or signature failure leaves the current version running and usable.
 *
 * On Windows `install()` launches the installer and exits the app, so a resolved promise
 * here means the installer was started.
 */
export async function installUpdate(
  info: UpdateInfo,
  onProgress?: (p: InstallProgress) => void
): Promise<InstallResult> {
  if (!info.available) {
    throw new Error('لا يوجد تحديث موثّق-signature متاح للتثبيت.');
  }
  if (!info.signed) {
    throw new Error('تم رفض التثبيت: الإصدار لا يحمل توقيعاً صالحاً.');
  }
  if (info.artifactUrl && !isFetchableUrl(info.artifactUrl)) {
    throw new Error('تم رفض التثبيت: ملف التحديث يُقدَّم عبر قناة غير موثوقة.');
  }

  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) {
    throw new Error('لم يعد الخادم يعرض هذا الإصدار.');
  }

  let downloaded = 0;
  let total = 0;

  await update.download((event) => {
    if (event.event === 'Started') {
      total = event.data.contentLength ?? 0;
      downloaded = 0;
      onProgress?.({ downloaded, total });
    } else if (event.event === 'Progress') {
      downloaded += event.data.chunkLength;
      onProgress?.({ downloaded, total });
    }
  });

  // Signature already verified by download(). Install on Windows exits the process.
  await update.install();

  return { version: update.version };
}
