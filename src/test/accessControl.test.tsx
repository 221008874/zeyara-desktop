import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ProtectedRoute, RoleGuard, Guarded, LicenseGate, SetupGate } from '../app-shell/accessControl';
import { useAuthStore, type Role } from '../stores/auth';
import { useLicenseStore } from '../stores/license';
import { useSetupStore } from '../stores/setup';
import { ROUTE_ACCESS, rolesFor } from '../app-shell/navigation';

/**
 * Access control at the router.
 *
 * `RoleGuard` and `ProtectedRoute` are the only thing between a typed URL and a screen a
 * role must not see, and they had no behavioural coverage. The only prior check was a
 * source-grep, which cannot tell whether a guard redirects or renders.
 *
 * These drive the real components from `app-shell/accessControl`, which were extracted out
 * of `routes/index.tsx` precisely so they could be rendered without pulling in every page
 * module behind the route table. Nothing here is transcribed: a copy would keep passing
 * after the real guard was broken, which is the opposite of a test.
 */

vi.mock('../pages/ChangePasswordPage', () => ({
  ChangePasswordPage: () => <div>CHANGE PASSWORD</div>,
}));
vi.mock('../pages/LicenseScreen', () => ({ LicenseScreen: () => <div>LICENSE SCREEN</div> }));
vi.mock('../pages/SetupWizardPage', () => ({ SetupWizardPage: () => <div>SETUP WIZARD</div> }));

const SECRET = 'SECRET CONTENT';

type SessionShape = {
  username: string;
  role: Role;
  token: string;
  refreshToken: string;
  mustChangePassword: boolean;
};

function session(role: Role | undefined, over: Partial<SessionShape> = {}) {
  return {
    username: 'u',
    role,
    token: 't',
    refreshToken: 'r',
    mustChangePassword: false,
    ...over,
  } as unknown as ReturnType<typeof useAuthStore.getState>['session'];
}

/** Records where the router ended up, so a redirect can be asserted rather than inferred. */
function WhereAmI() {
  const location = useLocation();
  return <div data-testid="path">{location.pathname}</div>;
}

function setSession(current: SessionShape | null) {
  useAuthStore.setState({ session: current, isLoading: false });
}

beforeEach(() => {
  setSession(null);
  useLicenseStore.setState({ status: null, isLoading: false });
  useSetupStore.setState({ firstUseComplete: true, isChecking: false });
});

describe('RoleGuard', () => {
  function renderGuarded(path: string, current: SessionShape | null) {
    setSession(current);
    return render(
      <MemoryRouter initialEntries={[path]}>
        <WhereAmI />
        <Routes>
          <Route path="/dashboard" element={<div>DASHBOARD</div>} />
          <Route
            path={path}
            element={
              <RoleGuard roles={rolesFor(path)}>
                <div>{SECRET}</div>
              </RoleGuard>
            }
          />
        </Routes>
      </MemoryRouter>
    );
  }

  it('renders the children for a permitted role', () => {
    renderGuarded('/users', session('ADMIN'));
    expect(screen.getByText(SECRET)).toBeInTheDocument();
  });

  it('refuses a role that is not permitted and redirects home', () => {
    renderGuarded('/users', session('SECRETARY'));
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/dashboard');
  });

  it('refuses a session carrying no role at all', () => {
    // The defect this replaced: a truthiness check fell through and rendered the children
    // when the role was missing, so a role-less session reached every screen.
    renderGuarded('/users', session(undefined));
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('refuses an unrecognised role string', () => {
    renderGuarded('/users', session('OWNER' as Role));
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('refuses when there is no session at all', () => {
    renderGuarded('/users', null);
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('refuses a path that declares no roles', () => {
    // The default has to be deny: a new screen missing from ROUTE_ACCESS must not be
    // reachable by every signed-in user.
    renderGuarded('/a-page-that-does-not-exist', session('ADMIN'));
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('honours the role list from ROUTE_ACCESS, not a second copy of it', () => {
    // Every screen in the app is wrapped in <Guarded path=...>; this is the wrapper under
    // test, so a divergence between the sidebar's map and the router's would show here.
    setSession(session('DOCTOR'));
    render(
      <MemoryRouter initialEntries={['/financial']}>
        <WhereAmI />
        <Routes>
          <Route path="/dashboard" element={<div>DASHBOARD</div>} />
          <Route
            path="/financial"
            element={
              <Guarded path="/financial">
                <div>{SECRET}</div>
              </Guarded>
            }
          />
        </Routes>
      </MemoryRouter>
    );
    // DOCTOR is allowed on /financial by the map, so the child renders.
    expect(screen.getByText(SECRET)).toBeInTheDocument();
  });
});

describe('ProtectedRoute', () => {
  function renderProtected(current: SessionShape | null, isLoading = false) {
    useAuthStore.setState({ session: current, isLoading });
    return render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <WhereAmI />
        <Routes>
          <Route path="/login" element={<div>LOGIN SCREEN</div>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <div>{SECRET}</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    );
  }

  it('renders the children for a live session', () => {
    renderProtected(session('DOCTOR'));
    expect(screen.getByText(SECRET)).toBeInTheDocument();
  });

  it('redirects to login when there is no session', () => {
    renderProtected(null);
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/login');
  });

  it('forces the password-change screen before any clinical screen', () => {
    // A user who must change their password must not reach patient data first.
    renderProtected(session('DOCTOR', { mustChangePassword: true }));
    expect(screen.getByText('CHANGE PASSWORD')).toBeInTheDocument();
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('shows nothing but a loading state while the session is being restored', () => {
    // Persisted sessions hydrate asynchronously; rendering children during that window
    // would flash protected content to a signed-out user.
    renderProtected(null, true);
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/dashboard');
  });
});

describe('LicenseGate', () => {
  function renderLicense(status: { activated: boolean } | null) {
    useLicenseStore.setState({ status: status as never, isLoading: false });
    // check() must not overwrite the seeded status in this test.
    useLicenseStore.setState({
      status: status as never,
      isLoading: false,
      check: async () => status as never,
    });
    return render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <LicenseGate>
          <div>{SECRET}</div>
        </LicenseGate>
      </MemoryRouter>
    );
  }

  it('renders the app when the license is activated', async () => {
    renderLicense({ activated: true });
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
  });

  it('blocks the app behind the license screen when it is not activated', async () => {
    renderLicense({ activated: false });
    expect(await screen.findByText('LICENSE SCREEN')).toBeInTheDocument();
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it('blocks the app when the license status is unknown', async () => {
    // An unanswered check must not be read as permission.
    renderLicense(null);
    expect(await screen.findByText('LICENSE SCREEN')).toBeInTheDocument();
  });
});

describe('SetupGate', () => {
  it('renders the app when setup is already complete', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <SetupGate>
          <div>{SECRET}</div>
        </SetupGate>
      </MemoryRouter>
    );
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
  });

  it('does not show the first-use wizard while a fresh check is in flight', () => {
    useSetupStore.setState({
      firstUseComplete: false,
      isChecking: true,
      checkFirstUse: async () => true,
    });
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <SetupGate>
          <div>{SECRET}</div>
        </SetupGate>
      </MemoryRouter>
    );
    expect(screen.queryByText('SETUP WIZARD')).not.toBeInTheDocument();
  });
});

describe('ROUTE_ACCESS contract', () => {
  it('gives every declared path a non-empty role list', () => {
    for (const [path, roles] of Object.entries(ROUTE_ACCESS)) {
      expect(Array.isArray(roles), `${path} has no role list`).toBe(true);
      expect(roles.length, `${path} allows nobody`).toBeGreaterThan(0);
    }
  });

  it('declares only roles the application knows', () => {
    const known: Role[] = ['ADMIN', 'DOCTOR', 'SECRETARY'];
    for (const [path, roles] of Object.entries(ROUTE_ACCESS)) {
      for (const r of roles) expect(known, `${path} declares unknown role ${r}`).toContain(r);
    }
  });

  it('defaults an undeclared path to nobody', () => {
    expect(rolesFor('/a-page-that-does-not-exist')).toEqual([]);
  });
});
