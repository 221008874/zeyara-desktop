import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSetupStore } from '../stores/setup';
import { SetupGate } from '../app-shell/accessControl';

/**
 * The first-use gate.
 *
 * `checkFirstUse` decides whether to show the "create the first administrator" wizard. A
 * wrong answer in the permissive direction puts an admin-creation form in front of a
 * returning user whose server is merely unreachable or misconfigured - the one screen in
 * the app that can create an owner account. It had no tests.
 */

vi.mock('../pages/SetupWizardPage', () => ({ SetupWizardPage: () => <div>SETUP WIZARD</div> }));

const SECRET = 'THE APP';

function respondWith(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  );
}

async function check() {
  return useSetupStore.getState().checkFirstUse();
}

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <SetupGate>
        <div>{SECRET}</div>
      </SetupGate>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  useSetupStore.setState({ firstUseComplete: false, isChecking: false });
  vi.unstubAllGlobals();
});

describe('checkFirstUse', () => {
  it('reports first use when the server has no users yet', async () => {
    respondWith(200, { completed: false });
    await expect(check()).resolves.toBe(true);
  });

  it('reports not-first-use once the server says setup completed', async () => {
    respondWith(200, { completed: true });
    await expect(check()).resolves.toBe(false);
    expect(useSetupStore.getState().firstUseComplete).toBe(true);
  });

  it('treats a missing completed flag as first use', async () => {
    // A server that answers 200 with an unexpected shape must not be read as "set up".
    respondWith(200, {});
    await expect(check()).resolves.toBe(true);
  });

  it('does not report first use when the server rejects the status call', async () => {
    // A 401/403 means the server exists and has users; it is not a fresh install.
    respondWith(403, {});
    await expect(check()).resolves.toBe(false);
  });

  it('does not report first use when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(check()).resolves.toBe(false);
  });

  it('always leaves isChecking false so the gate cannot hang on Loading', async () => {
    respondWith(200, { completed: true });
    await check();
    expect(useSetupStore.getState().isChecking).toBe(false);

    useSetupStore.setState({ firstUseComplete: false, isChecking: false });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await check();
    expect(useSetupStore.getState().isChecking).toBe(false);
  });
});

describe('SetupGate with an unreachable server', () => {
  it('does not offer the first-administrator wizard to a returning user', async () => {
    // This is the fail-safe that the store's own comment claims but did not implement:
    // `checkFirstUse` returned false on a network failure while leaving
    // firstUseComplete false, and SetupGate renders the wizard whenever
    // firstUseComplete is false - so the "not first use" answer was discarded and the
    // admin-creation form appeared precisely when the server could not be reached.
    useSetupStore.setState({
      firstUseComplete: false,
      isChecking: false,
      checkFirstUse: async () => {
        // Mirrors the store's unreachable-server branch: reports false, changes nothing.
        useSetupStore.setState({ isChecking: false });
        return false;
      },
    });

    renderGate();

    await waitFor(() => {
      expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    });
    expect(screen.getByText(SECRET)).toBeInTheDocument();
    expect(screen.queryByText('SETUP WIZARD')).not.toBeInTheDocument();
  });

  it('does offer the wizard on a genuine fresh install', async () => {
    useSetupStore.setState({
      firstUseComplete: false,
      isChecking: false,
      checkFirstUse: async () => {
        useSetupStore.setState({ isChecking: false });
        return true;
      },
    });

    renderGate();

    expect(await screen.findByText('SETUP WIZARD')).toBeInTheDocument();
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('never shows the wizard once setup is complete', async () => {
    useSetupStore.setState({
      firstUseComplete: true,
      isChecking: false,
      checkFirstUse: async () => true,
    });

    renderGate();

    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(screen.queryByText('SETUP WIZARD')).not.toBeInTheDocument();
  });
});
