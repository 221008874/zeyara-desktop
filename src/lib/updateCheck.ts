import { getBaseUrl } from './api';

const CURRENT_VERSION = '1.0.0';
const APP_ID = 'desktop';

export interface UpdateInfo {
  available: boolean;
  latestVersion: string | null;
  downloadUrl: string | null;
  msiUrl: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  forceUpdate: boolean;
  currentVersion: string;
  /** SHA-256 of the installer artifact, as published by the server. */
  checksum: string | null;
}

/**
 * Non-blocking check for a newer release from the server's update endpoint.
 * Returns null on any network/error (best-effort, never blocks the UI).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const base = getBaseUrl();
  if (!base) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `${base}/api/update/check?app=${APP_ID}&currentVersion=${CURRENT_VERSION}`,
      {
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.updateAvailable) return null;
    return {
      available: true,
      latestVersion: json.latestVersion ?? null,
      downloadUrl: json.downloadUrl ?? json.msiUrl ?? null,
      msiUrl: json.msiUrl ?? null,
      releaseNotes: json.releaseNotes ?? null,
      releaseDate: json.releaseDate ?? null,
      forceUpdate: json.forceUpdate === true,
      currentVersion: CURRENT_VERSION,
      checksum: json.checksum ?? null,
    };
  } catch {
    return null;
  }
}

/** Normalises a published checksum to lowercase hex, accepting `sha256:<hex>` prefixes. */
function normaliseChecksum(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/^sha-?256[:=]/, '');
  return trimmed.replace(/^0x/, '');
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface VerifiedUpdate {
  downloadUrl: string;
  verified: boolean;
  expectedChecksum: string | null;
}

/**
 * Downloads the update artifact and verifies its SHA-256 against the checksum the
 * server published for that exact release. An unverified artifact is never handed
 * to the OS installer.
 *
 * The download is refused when:
 *  - no checksum was published (we cannot prove the artifact is authentic), or
 *  - the served bytes do not match the published checksum (tampered / wrong file).
 *
 * @throws if the artifact cannot be fetched or fails verification.
 */
export async function downloadVerifiedUpdate(info: UpdateInfo): Promise<VerifiedUpdate> {
  const url = info.msiUrl || info.downloadUrl;
  if (!url) throw new Error('No download URL was published for this release.');

  const expected = info.checksum ? normaliseChecksum(info.checksum) : null;
  if (!expected) {
    throw new Error(
      'This release has no published checksum, so the installer cannot be verified. Refusing to download.'
    );
  }

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to download update (HTTP ${res.status}).`);

  const buffer = await res.arrayBuffer();
  const actual = await sha256Hex(buffer);
  if (actual !== expected) {
    throw new Error(
      `Update verification failed. Expected SHA-256 ${expected} but the downloaded file hashed to ${actual}. The installer was discarded.`
    );
  }

  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const objectUrl = URL.createObjectURL(blob);
  const filename = artifactFilename(url, info.latestVersion);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

  return { downloadUrl: url, verified: true, expectedChecksum: expected };
}

/** Prefers the file name published by the server, so `.jar`/`.msi`/`.exe` all save correctly. */
function artifactFilename(url: string, version: string | null): string {
  try {
    const last = new URL(url, 'https://localhost').pathname.split('/').filter(Boolean).pop();
    if (last && /\.[A-Za-z0-9]{2,5}$/.test(last)) return decodeURIComponent(last);
  } catch {
    /* fall through to the generic name */
  }
  return `Zeyara-Update-${version || 'latest'}`;
}
