import { isTauriApp } from './api';

/**
 * Native document handling for the desktop shell.
 *
 * Previously every export duplicated the same `URL.createObjectURL` + synthetic
 * `<a download>` dance, which inside a Tauri webview drops the file silently into the
 * OS default download folder with no dialog and no way to find it. The retired JavaFX
 * clients used a real file chooser, so this was a parity gap as well as an annoyance.
 *
 * In the shell the flow is delegated to the `save_document` Rust command, which owns
 * the native dialog and the write. The webview is never given filesystem access and
 * never names a path. In a plain browser (dev server, contract tests) it falls back to
 * the old anchor download so the same code paths keep working.
 */

export interface SaveOutcome {
  saved: boolean;
  /** Absolute path written, when running in the shell and the user accepted. */
  path?: string;
}

const isTauri = () => isTauriApp;

/** Browser fallback: trigger a download through a temporary anchor. */
function downloadInBrowser(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoked on a delay: Safari/Edge can still be reading the blob when click() returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Reads a Blob into bytes.
 *
 * `Blob.arrayBuffer()` is used when present, with a FileReader fallback: it is absent
 * in some embedded webviews and test environments, and a missing method there would
 * otherwise turn every export into a hard failure.
 */
async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('could not read the document'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Writes a generated document, asking the user where to put it.
 *
 * @returns `saved: false` when the user dismissed the dialog — that is a normal
 * outcome, not a failure, and callers should not show an error for it.
 */
export async function saveDocument(blob: Blob, suggestedName: string): Promise<SaveOutcome> {
  if (!isTauri()) {
    downloadInBrowser(blob, suggestedName);
    return { saved: true };
  }

  const bytes = await blobToBytes(blob);
  // The Rust command returns null when the user dismisses the dialog, so this must be
  // treated as a normal outcome rather than dereferenced.
  const result = await invokeSaveDocument(suggestedName, Array.from(bytes));
  if (!result) return { saved: false };
  return { saved: result.saved, path: result.path ?? undefined };
}

async function invokeSaveDocument(
  suggestedName: string,
  data: number[]
): Promise<{ saved: boolean; path: string | null } | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('save_document', { suggestedName, data });
}

/**
 * Opens a document the app just wrote, in the OS default application.
 * No-op outside the shell.
 */
export async function openDocument(path: string | undefined): Promise<boolean> {
  if (!path || !isTauri()) return false;
  try {
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(path);
    return true;
  } catch {
    return false;
  }
}

/** Shows a written document in Explorer/Finder. No-op outside the shell. */
export async function revealDocument(path: string | undefined): Promise<boolean> {
  if (!path || !isTauri()) return false;
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(path);
    return true;
  } catch {
    return false;
  }
}

/** True when a document can be opened/revealed, i.e. we are in the shell. */
export const canOpenDocuments = (): boolean => isTauri();

// ─── OS notifications ────────────────────────────────────────────────────────

let notificationsEnabled: boolean | null = null;

/**
 * Asks for notification permission once and caches the answer.
 *
 * Resolves false rather than throwing when permission is refused, so a caller can
 * simply skip the OS popup and rely on the in-app indicator.
 */
export async function ensureNotificationsAllowed(): Promise<boolean> {
  if (!isTauri()) return false;
  if (notificationsEnabled !== null) return notificationsEnabled;
  try {
    const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
    let granted = await isPermissionGranted();
    if (!granted) {
      const asked = await requestPermission();
      granted = asked === 'granted';
    }
    notificationsEnabled = granted;
  } catch {
    notificationsEnabled = false;
  }
  return notificationsEnabled;
}

/** Shows an OS notification. Silently does nothing if not permitted. */
export async function notify(title: string, body: string): Promise<void> {
  if (!(await ensureNotificationsAllowed())) return;
  try {
    const { sendNotification } = await import('@tauri-apps/plugin-notification');
    sendNotification({ title, body });
  } catch {
    // A failed popup must never break the workflow that triggered it.
  }
}

/** Test seam. */
export function __resetNotificationCache(): void {
  notificationsEnabled = null;
}
