import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore, type Role } from '../stores/auth';
import { rolesFor } from './navigation';
import { useLicenseStore } from '../stores/license';
import { useSetupStore } from '../stores/setup';
import { LicenseScreen } from '../pages/LicenseScreen';
import { SetupWizardPage } from '../pages/SetupWizardPage';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';

/**
 * The gates between "the app started" and "this user may see this screen".
 *
 * These lived inside `routes/index.tsx`, which exported only `AppRoutes`. That made them
 * impossible to test without rendering the entire route table and every page module behind
 * it, so the most security-relevant components in the client had no behavioural coverage at
 * all - the previous coverage was a source-grep, which cannot tell whether a guard redirects
 * or renders.
 *
 * They are separated here so the real implementations can be exercised directly. The
 * behaviour is unchanged; only the location moved.
 */

/** Requires a live session, and forces a password change before anything else. */
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuthStore();
  if (isLoading) return <div>Loading...</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (session.mustChangePassword) return <ChangePasswordPage />;
  return <>{children}</>;
}

/**
 * Restricts a subtree to an explicit role list.
 *
 * Fails closed. An earlier version used `session?.role && roles.includes(...)`, which fell
 * through and rendered the children when the role was missing, so a session without a role
 * reached every screen. The missing-role case is a deny, not an allow.
 */
export function RoleGuard({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { session } = useAuthStore();
  if (!session?.role || !roles.includes(session.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

/**
 * Applies the role list `navigation.ts` declares for a path, so the router and the sidebar
 * read one source instead of two that can drift.
 */
export function Guarded({ path, children }: { path: string; children: React.ReactNode }) {
  return <RoleGuard roles={rolesFor(path)}>{children}</RoleGuard>;
}

/** Blocks the app behind the license screen until the server reports it activated. */
export function LicenseGate({ children }: { children: React.ReactNode }) {
  const { status, isLoading, check } = useLicenseStore();
  const [checking, setChecking] = React.useState(true);

  React.useEffect(() => {
    const run = async () => {
      await check();
      setChecking(false);
    };
    run();
  }, [check]);

  if (checking || isLoading) return <div>Loading...</div>;
  if (!status?.activated) return <LicenseScreen />;
  return <>{children}</>;
}

/**
 * Shows the first-use registration wizard when the server has no users yet.
 *
 * The decision follows the **answer**, not `firstUseComplete`. Those are not the same
 * thing, and conflating them put the "create the first administrator" form in front of
 * returning users: `checkFirstUse` correctly reports "not first use" when the server is
 * unreachable, but it cannot persist that as `firstUseComplete` without stranding a genuine
 * fresh install. The gate used to render the wizard whenever `firstUseComplete` was false,
 * which discarded the answer and showed the wizard exactly when the server could not be
 * reached - the one screen that can create an owner account.
 *
 * So: the wizard appears only when the server positively says it has no users. An
 * inconclusive check falls through to the app, where no session sends the user to login.
 */
export function SetupGate({ children }: { children: React.ReactNode }) {
  const { firstUseComplete, isChecking, checkFirstUse } = useSetupStore();
  const [verdict, setVerdict] = React.useState<'checking' | 'firstUse' | 'ready'>('checking');

  React.useEffect(() => {
    // Already set up on this machine: never ask the server again.
    if (firstUseComplete) {
      setVerdict('ready');
      return;
    }
    let live = true;
    void (async () => {
      const firstUse = await checkFirstUse();
      if (live) setVerdict(firstUse ? 'firstUse' : 'ready');
    })();
    return () => {
      live = false;
    };
  }, [checkFirstUse, firstUseComplete]);

  if (verdict === 'checking' || isChecking) return <div>Loading...</div>;
  if (verdict === 'firstUse') return <SetupWizardPage />;
  return <>{children}</>;
}
