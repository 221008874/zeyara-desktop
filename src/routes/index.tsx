import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute, RoleGuard, Guarded, LicenseGate, SetupGate } from '../app-shell/accessControl';
import { LoginPage } from '../pages/LoginPage';
import { AppShell } from '../app-shell/AppShell';
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
                    {/* Every route below is wrapped in <Guarded path=...>, which reads the
                        role list from app-shell/navigation.ts. None relies on a hand-written
                        inline array, and none is left unguarded by omission. */}
                    <Route path="dashboard" element={<Guarded path="/dashboard"><DashboardPage /></Guarded>} />
                    <Route path="patients" element={<Guarded path="/patients"><PatientsPage /></Guarded>} />
                    <Route path="patients/new" element={<Guarded path="/patients/new"><AddPatientPage /></Guarded>} />
                    <Route path="patients/:id/edit" element={<Guarded path="/patients/:id/edit"><AddPatientPage /></Guarded>} />
                    <Route path="patients/:id" element={<Guarded path="/patients/:id"><PatientDashboardPage /></Guarded>} />
                    <Route path="appointments" element={<Guarded path="/appointments"><AppointmentsPage /></Guarded>} />
                    <Route path="appointments/new" element={<Guarded path="/appointments/new"><AddAppointmentPage /></Guarded>} />
                    <Route path="expenses" element={<Guarded path="/expenses"><ExpensesPage /></Guarded>} />
                    <Route path="online-bookings" element={<Guarded path="/online-bookings"><OnlineBookingsPage /></Guarded>} />
                    <Route path="profile" element={<Guarded path="/profile"><ProfilePage /></Guarded>} />
                    <Route path="notifications" element={<Guarded path="/notifications"><NotificationsPage /></Guarded>} />
                    <Route path="settings" element={<Guarded path="/settings"><SettingsPage /></Guarded>} />
                    <Route path="schedule" element={<Guarded path="/schedule"><SchedulePage /></Guarded>} />
                    <Route path="financial" element={<Guarded path="/financial"><FinancialPage /></Guarded>} />
                    <Route path="money-safe" element={<Guarded path="/money-safe"><MoneySafePage /></Guarded>} />
                    <Route path="outstanding" element={<Guarded path="/outstanding"><OutstandingBalancesPage /></Guarded>} />
                    <Route path="reports" element={<Guarded path="/reports"><ReportsPage /></Guarded>} />
                    <Route path="medications" element={<Guarded path="/medications"><MedicationsPage /></Guarded>} />
                    <Route path="history" element={<Guarded path="/history"><HistoryPage /></Guarded>} />
                    <Route path="users" element={<Guarded path="/users"><UsersPage /></Guarded>} />
                    <Route path="clinic-profile" element={<Guarded path="/clinic-profile"><ClinicProfilePage /></Guarded>} />
                    <Route path="backups" element={<Guarded path="/backups"><BackupsPage /></Guarded>} />
                    <Route path="infra" element={<Guarded path="/infra"><InfraPage /></Guarded>} />
                    {/* /server-manager has a top-level route above that deliberately
                        bypasses LicenseGate, so a locked ADMIN can still unlock. The nested
                        copy is unreachable and only shadowed it in the route tree. */}
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