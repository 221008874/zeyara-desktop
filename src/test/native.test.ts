import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveDocument, openDocument, revealDocument, notify, canOpenDocuments, __resetNotificationCache } from '../lib/native';
import { isTauriApp } from '../lib/api';

vi.mock('../lib/api', () => ({
  isTauriApp: true,
  getBaseUrl: () => 'http://localhost:8081',
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openPath: vi.fn().mockResolvedValue(undefined),
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

const invokeMock = vi.mocked((await import('@tauri-apps/api/core')).invoke);
// vi.mocked() so the mock methods (mockClear, mockRejectedValueOnce, ...) are typed.
const { isPermissionGranted, requestPermission, sendNotification } = vi.mocked(
  await import('@tauri-apps/plugin-notification')
);
const { openPath, revealItemInDir } = vi.mocked(await import('@tauri-apps/plugin-opener'));

/** Shape the frontend actually sends to the `save_document` command. */
interface SavePayload {
  suggestedName: string;
  data: number[];
}

/** Reads the recorded `save_document` invocation out of the mock's call log. */
function saveCall(index = 0): { cmd: string; payload: SavePayload } {
  const call = invokeMock.mock.calls[index] as unknown as [string, SavePayload];
  return { cmd: call[0], payload: call[1] };
}

describe('saveDocument in the shell', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    __resetNotificationCache();
  });

  it('delegates to the Rust command so the webview never names a path', async () => {
    // Granting the webview fs:allow-write-file would let it write anywhere the user
    // can reach. The save dialog and the write both live in Rust instead.
    invokeMock.mockResolvedValue({ saved: true, path: 'C:\\Users\\x\\report.pdf', suggestedName: 'report.pdf' });

    const blob = new Blob(['hello'], { type: 'application/pdf' });
    const result = await saveDocument(blob, 'report.pdf');

    expect(result.saved).toBe(true);
    expect(result.path).toBe('C:\\Users\\x\\report.pdf');

    const { cmd, payload } = saveCall();
    expect(cmd).toBe('save_document');
    expect(payload.suggestedName).toBe('report.pdf');
    expect(Array.isArray(payload.data)).toBe(true);
  });

  it('transmits the exact bytes', async () => {
    invokeMock.mockResolvedValue({ saved: true, path: '/tmp/a.bin', suggestedName: 'a.bin' });
    const bytes = new Uint8Array([1, 2, 3, 250]);

    await saveDocument(new Blob([bytes]), 'a.bin');

    const { payload } = saveCall();
    expect(payload.data).toEqual([1, 2, 3, 250]);
  });

  it('reports a dismissed dialog as not-saved rather than throwing', async () => {
    // The user closing the save dialog is a normal outcome, not an error to surface.
    invokeMock.mockResolvedValue(null);

    const result = await saveDocument(new Blob(['x']), 'x.pdf');

    expect(result.saved).toBe(false);
    expect(result.path).toBeUndefined();
  });

  it('propagates a real write failure', async () => {
    invokeMock.mockRejectedValue(new Error('disk full'));

    await expect(saveDocument(new Blob(['x']), 'x.pdf')).rejects.toThrow('disk full');
  });
});

describe('openDocument / revealDocument', () => {
  beforeEach(() => {
    openPath.mockClear();
    revealItemInDir.mockClear();
  });

  it('opens the exact path the app wrote', async () => {
    expect(await openDocument('C:\\docs\\a.pdf')).toBe(true);
    expect(openPath).toHaveBeenCalledWith('C:\\docs\\a.pdf');
  });

  it('reveals the file in the OS file manager', async () => {
    expect(await revealDocument('C:\\docs\\a.pdf')).toBe(true);
    expect(revealItemInDir).toHaveBeenCalledWith('C:\\docs\\a.pdf');
  });

  it('does nothing without a path', async () => {
    // Cancelled saves have no path; calling the opener with undefined would throw.
    expect(await openDocument(undefined)).toBe(false);
    expect(await revealDocument(undefined)).toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('reports failure instead of throwing when the opener rejects', async () => {
    openPath.mockRejectedValueOnce(new Error('no association'));
    expect(await openDocument('C:\\docs\\a.xyz')).toBe(false);
  });

  it('reports that documents can be opened only in the shell', () => {
    expect(canOpenDocuments()).toBe(isTauriApp);
  });
});

describe('OS notifications', () => {
  beforeEach(() => {
    __resetNotificationCache();
    isPermissionGranted.mockReset();
    requestPermission.mockReset();
    sendNotification.mockClear();
  });

  it('asks once and reuses the answer', async () => {
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue('granted');

    await notify('a', 'one');
    await notify('b', 'two');

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });

  it('shows nothing when permission is refused', async () => {
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue('denied');

    await notify('title', 'body');

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('shows nothing when already granted without re-asking', async () => {
    isPermissionGranted.mockResolvedValue(true);

    await notify('title', 'body');

    expect(requestPermission).not.toHaveBeenCalled();
    expect(sendNotification).toHaveBeenCalledWith({ title: 'title', body: 'body' });
  });

  it('never lets a failing popup break the workflow that triggered it', async () => {
    isPermissionGranted.mockResolvedValue(true);
    sendNotification.mockImplementationOnce(() => {
      throw new Error('no notification service');
    });

    await expect(notify('title', 'body')).resolves.toBeUndefined();
  });
});

describe('browser fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../lib/api', () => ({ isTauriApp: false, getBaseUrl: () => '' }));
    vi.doUnmock('@tauri-apps/api/core');
  });

  it('uses an anchor download when not running under Tauri', async () => {
    // Dev server and contract tests have no shell; the same call sites must still work.
    const click = vi.fn();
    const created: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') {
        created.push(el);
        el.click = click;
      }
      return el;
    });
    // jsdom implements neither createObjectURL nor revokeObjectURL.
    const createdUrls: string[] = [];
    const origCreateUrl = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => {
      const u = `blob:mock/${createdUrls.length}`;
      createdUrls.push(u);
      return u;
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;

    const mod = await import('../lib/native');
    const result = await mod.saveDocument(new Blob(['x']), 'fallback.csv');

    expect(result.saved).toBe(true);
    expect(click).toHaveBeenCalled();
    expect(created[0]?.getAttribute('download')).toBe('fallback.csv');
    expect(created[0]?.getAttribute('href')).toBe(createdUrls[0]);

    URL.createObjectURL = origCreateUrl;
    URL.revokeObjectURL = origRevoke;
    vi.restoreAllMocks();
    vi.doUnmock('../lib/api');
  });

  it('cleans up the object URL it created', async () => {
    // A leaked blob URL pins the whole file in memory for the life of the document.
    vi.resetModules();
    vi.doMock('../lib/api', () => ({ isTauriApp: false, getBaseUrl: () => '' }));
    // Fake timers must be installed BEFORE the call, otherwise the real setTimeout is
    // already scheduled and advancing them does nothing.
    vi.useFakeTimers();
    const revoke = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:mock/leak') as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revoke as unknown as typeof URL.revokeObjectURL;
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLAnchorElement;
      el.click = vi.fn();
      return el;
    });

    const mod = await import('../lib/native');
    await mod.saveDocument(new Blob(['x']), 'a.csv');

    // Not immediate: the browser may still be reading the blob after click() returns.
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(61_000);
    expect(revoke).toHaveBeenCalledWith('blob:mock/leak');
    vi.useRealTimers();

    vi.restoreAllMocks();
    vi.doUnmock('../lib/api');
  });
});
