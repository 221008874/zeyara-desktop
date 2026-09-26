import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useLicenseStore } from '../stores/license';
import { LoginPage } from '../pages/LoginPage';
import { LicenseScreen } from '../pages/LicenseScreen';
import { SetupWizardPage } from '../pages/SetupWizardPage';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { AppShell } from '../app-shell/AppShell';
import { useSetupStore } from '../stores/setup';
import { DashboardPage } from '../pages/DashboardPage';
import { PatientsPage } from '../pages/PatientsPage';
import { PatientDashboardPage } from '../pages/PatientDashboardPage';
import { AddAppointmentPage } from '../pages/AddAppointmentPage';
import { AddPatientPage } from '../pages/AddPatientPage';
import { AppointmentsPage } from '../pages/AppointmentsPage';
import { ExpensesPage } from '../pages/ExpensesPage';
import { OnlineBookingsPage } from '../pages/OnlineBookingsPage';
import { ProfilePage } from '../pages/ProfilePage';
import { NotificationsPage } from '../pages/NotificationsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SchedulePage } from '../pages/SchedulePage';
import { FinancialPage } from '../pages/FinancialPage';
import { MoneySafePage } from '../pages/MoneySafePage';
import { OutstandingBalancesPage } from '../pages/OutstandingBalancesPage';
import { ReportsPage } from '../pages/ReportsPage';
import { MedicationsPage } from '../pages/MedicationsPage';
import { HistoryPage } from '../pages/HistoryPage';
import { UsersPage } from '../pages/UsersPage';
import { BackupsPage } from '../pages/BackupsPage';
import { InfraPage } from '../pages/InfraPage';
import { ClinicProfilePage } from '../pages/ClinicProfilePage';
import { ServerManagerPage } from '../pages/ServerManagerPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuthStore();
  if (isLoading) return <div>Loading...</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (session.mustChangePassword) return <ChangePasswordPage />;
  return <>{children}</>;
}

function RoleGuard({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { session } = useAuthStore();
  if (session?.role && !roles.includes(session.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function LicenseGate({ children }: { children: React.ReactNode }) {
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
 * Once setup is complete (or users already exist) it renders the protected app.
 */
function SetupGate({ children }: { children: React.ReactNode }) {
  const { firstUseComplete, isChecking, checkFirstUse } = useSetupStore();
  const [checking, setChecking] = React.useState(true);

  React.useEffect(() => {
    const run = async () => {
      if (!firstUseComplete) {
        const firstUse = await checkFirstUse();
        if (firstUse) {
          setChecking(false);
          return;
        }
      }
      setChecking(false);
    };
    run();
  }, [checkFirstUse, firstUseComplete]);

  if (checking || isChecking) return <div>Loading...</div>;
  if (!firstUseComplete) return <SetupWizardPage />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Server Manager — accessible even when license is locked, so ADMIN can unlock */}
      <Route
        path="/server-manager"
        element={
          <ProtectedRoute>
            <RoleGuard roles={['ADMIN']}>
              <AppShell>
                <ServerManagerPage />
              </AppShell>
            </RoleGuard>
          </ProtectedRoute>
        }
      />
      <Route
        path="/*"
        element={
          <SetupGate>
            <LicenseGate>
              <ProtectedRoute>
                <AppShell>
                  <Routes>
                    <Route index element={<Navigate to="/dashboard" replace />} />
                    <Route path="dashboard" element={<DashboardPage />} />
                    <Route path="patients" element={<PatientsPage />} />
                    <Route path="patients/new" element={<AddPatientPage />} />
                    <Route path="patients/:id/edit" element={<AddPatientPage />} />
                    <Route path="patients/:id" element={<PatientDashboardPage />} />
                    <Route path="appointments" element={<AppointmentsPage />} />
                    <Route path="appointments/new" element={<AddAppointmentPage />} />
                    <Route path="expenses" element={<ExpensesPage />} />
                    <Route path="online-bookings" element={<RoleGuard roles={['ADMIN', 'SECRETARY']}><OnlineBookingsPage /></RoleGuard>} />
                    <Route path="profile" element={<ProfilePage />} />
                    <Route path="notifications" element={<NotificationsPage />} />
                    <Route path="settings" element={<SettingsPage />} />
                    <Route path="schedule" element={<RoleGuard roles={['ADMIN', 'DOCTOR']}><SchedulePage /></RoleGuard>} />
                    <Route path="financial" element={<RoleGuard roles={['ADMIN', 'DOCTOR']}><FinancialPage /></RoleGuard>} />
                    <Route path="money-safe" element={<RoleGuard roles={['ADMIN', 'DOCTOR']}><MoneySafePage /></RoleGuard>} />
        <Route path="outstanding" element={<RoleGuard roles={['ADMIN', 'DOCTOR', 'SECRETARY']}><OutstandingBalancesPage /></RoleGuard>} />
                    <Route path="reports" element={<RoleGuard roles={['ADMIN', 'DOCTOR']}><ReportsPage /></RoleGuard>} />
                    <Route path="medications" element={<RoleGuard roles={['ADMIN', 'DOCTOR']}><MedicationsPage /></RoleGuard>} />
                    <Route path="history" element={<RoleGuard roles={['ADMIN', 'DOCTOR']}><HistoryPage /></RoleGuard>} />
                    <Route path="users" element={<RoleGuard roles={['ADMIN']}><UsersPage /></RoleGuard>} />
                    <Route path="clinic-profile" element={<RoleGuard roles={['ADMIN']}><ClinicProfilePage /></RoleGuard>} />
                    <Route path="backups" element={<RoleGuard roles={['ADMIN']}><BackupsPage /></RoleGuard>} />
                    <Route path="infra" element={<RoleGuard roles={['ADMIN']}><InfraPage /></RoleGuard>} />
                    <Route path="server-manager" element={<RoleGuard roles={['ADMIN']}><ServerManagerPage /></RoleGuard>} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                  </Routes>
                </AppShell>
              </ProtectedRoute>
            </LicenseGate>
          </SetupGate>
        }
      />
    </Routes>
  );
}