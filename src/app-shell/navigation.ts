import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import PersonIcon from '@mui/icons-material/People';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import AddIcon from '@mui/icons-material/AddCircleOutline';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import LockIcon from '@mui/icons-material/Lock';
import PaidIcon from '@mui/icons-material/Paid';
import PaymentsIcon from '@mui/icons-material/ReceiptLong';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import AssessmentIcon from '@mui/icons-material/Assessment';
import MedicationIcon from '@mui/icons-material/Medication';
import HistoryIcon from '@mui/icons-material/History';
import NotificationsIcon from '@mui/icons-material/Notifications';
import GroupsIcon from '@mui/icons-material/Groups';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import BackupIcon from '@mui/icons-material/Backup';
import BuildIcon from '@mui/icons-material/Build';
import DnsIcon from '@mui/icons-material/Dns';
import SettingsIcon from '@mui/icons-material/Settings';
import BadgeIcon from '@mui/icons-material/Badge';
import type React from 'react';
import type { Role } from '../stores/auth';

/** Every authenticated user. */
export const ALL_ROLES: Role[] = ['ADMIN', 'DOCTOR', 'SECRETARY'];
/** Roles that may see clinical/financial records. Mirrors `isClinician` in the pages. */
export const CLINICIAN_ROLES: Role[] = ['ADMIN', 'DOCTOR'];
export const ADMIN_ROLES: Role[] = ['ADMIN'];

/**
 * Single source of truth for which roles may reach which path.
 *
 * This previously lived twice: as `roles: string[]` on each sidebar entry, and as a
 * hand-scattered subset of `<RoleGuard>` on the routes. They disagreed — the sidebar
 * hid patient editing from SECRETARY while `patients/:id/edit` carried no guard at
 * all, so a typed URL walked straight past the navigation into a screen the user was
 * not meant to have. Keeping the lists here means the nav and the router cannot drift.
 */
export const ROUTE_ACCESS: Record<string, Role[]> = {
  '/dashboard': ALL_ROLES,
  '/patients': ALL_ROLES,
  '/patients/new': ALL_ROLES,
  // A receptionist registers patients but does not edit an existing clinical record;
  // the retired Secretary client marked such edits for re-sync instead of applying them.
  '/patients/:id': ALL_ROLES,
  '/patients/:id/edit': CLINICIAN_ROLES,
  '/appointments': ALL_ROLES,
  '/appointments/new': ALL_ROLES,
  '/expenses': ALL_ROLES,
  '/online-bookings': ['ADMIN', 'SECRETARY'],
  '/profile': ALL_ROLES,
  '/notifications': ALL_ROLES,
  '/settings': ALL_ROLES,
  '/schedule': CLINICIAN_ROLES,
  '/financial': CLINICIAN_ROLES,
  '/money-safe': CLINICIAN_ROLES,
  '/outstanding': ALL_ROLES,
  '/reports': CLINICIAN_ROLES,
  '/medications': CLINICIAN_ROLES,
  '/history': CLINICIAN_ROLES,
  '/users': ADMIN_ROLES,
  '/clinic-profile': ADMIN_ROLES,
  '/backups': ADMIN_ROLES,
  '/infra': ADMIN_ROLES,
  '/server-manager': ADMIN_ROLES,
};

/**
 * Roles permitted to reach `path`.
 *
 * An unregistered path returns no roles rather than all of them. A route added without
 * a matching entry is therefore blocked and immediately visible as "I cannot open that
 * page", instead of silently being exposed to every role.
 */
export function rolesFor(path: string): Role[] {
  return ROUTE_ACCESS[path] ?? [];
}

export function canAccess(path: string, role: Role | undefined): boolean {
  // An unknown role is treated as no access rather than full access, so a malformed or
  // absent session can never widen the UI.
  if (!role) return false;
  return rolesFor(path).includes(role);
}

export interface NavItem {
  label: string;
  /** Absolute path. Must be a key in ROUTE_ACCESS. */
  path: string;
  icon: React.ElementType;
}

/** Sidebar entries, in display order. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'لوحة التحكم', path: '/dashboard', icon: DashboardIcon },
  { label: 'المرضى', path: '/patients', icon: PersonIcon },
  { label: 'المواعيد', path: '/appointments', icon: CalendarMonthIcon },
  { label: 'موعد جديد', path: '/appointments/new', icon: AddIcon },
  { label: 'الجدول الزمني', path: '/schedule', icon: CalendarTodayIcon },
  { label: 'المالية', path: '/financial', icon: AccountBalanceWalletIcon },
  { label: 'خزينة المال', path: '/money-safe', icon: LockIcon },
  { label: 'المبالغ المستحقة', path: '/outstanding', icon: PaidIcon },
  { label: 'المصروفات', path: '/expenses', icon: PaymentsIcon },
  { label: 'الحجوزات الإلكترونية', path: '/online-bookings', icon: WbSunnyIcon },
  { label: 'التقارير', path: '/reports', icon: AssessmentIcon },
  { label: 'الأدوية', path: '/medications', icon: MedicationIcon },
  { label: 'التاريخ الطبي', path: '/history', icon: HistoryIcon },
  { label: 'الإشعارات', path: '/notifications', icon: NotificationsIcon },
  { label: 'المستخدمون', path: '/users', icon: GroupsIcon },
  { label: 'بيانات العيادة', path: '/clinic-profile', icon: LocalHospitalIcon },
  { label: 'النسخ الاحتياطية', path: '/backups', icon: BackupIcon },
  { label: 'صحة النظام', path: '/infra', icon: BuildIcon },
  { label: 'إدارة الخادم', path: '/server-manager', icon: DnsIcon },
  { label: 'الإعدادات', path: '/settings', icon: SettingsIcon },
  { label: 'تحديث البيانات', path: '/profile', icon: BadgeIcon },
];
