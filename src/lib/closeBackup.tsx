import { useAuthStore } from '../stores/auth';
import { promptAndBackup } from './backupOnClose';
import { isTauriApp } from './api';

let CLOSE_ALLOWED = false;

/**
 * Register close-time backup handling.
 *
 * - Tauri build: the Rust layer intercepts CloseRequested and emits a
 *   `before-close` event; we run the backup (with a confirm prompt) then signal
 *   `finish_close` to actually close.
 * - Browser build: a `beforeunload` handler is registered so closing the tab
 *   triggers the browser's own leave-confirmation (best-effort; the async
 *   backup cannot reliably complete across an unload).
 */
export function initCloseBackup(): void {
  const { session } = useAuthStore.getState();
  if (!session?.token) return;

  if (isTauriApp) {
    Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')])
      .then(([{ invoke }, { listen }]) => {
        listen('before-close', async () => {
          if (CLOSE_ALLOWED) {
            invoke('finish_close', { label: 'main' }).catch(() => {});
            return;
          }
          // Run the backup prompt (shows confirm dialog to the user). If the
          // user confirms, promptAndBackup runs the async export, then we close.
          // Either way, proceed with close after the prompt returns.
          await promptAndBackup();
          CLOSE_ALLOWED = true;
          invoke('finish_close', { label: 'main' }).catch(() => {});
        }).catch(() => {});
      })
      .catch(() => {});
    return;
  }

  // Browser fallback: just warn the user before close (best-effort).
  window.addEventListener('beforeunload', (e) => {
    e.preventDefault();
    e.returnValue = '';
  });
}