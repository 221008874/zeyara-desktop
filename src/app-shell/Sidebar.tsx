import React from 'react';
import { Drawer, List, ListItemButton, ListItemIcon, ListItemText, Box, Typography, IconButton, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PersonIcon from '@mui/icons-material/Person';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import AddIcon from '@mui/icons-material/Add';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import LockIcon from '@mui/icons-material/Lock';
import PaymentsIcon from '@mui/icons-material/Payments';
import PaidIcon from '@mui/icons-material/Paid';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import AssessmentIcon from '@mui/icons-material/Assessment';
import MedicationIcon from '@mui/icons-material/Medication';
import HistoryIcon from '@mui/icons-material/History';
import NotificationsIcon from '@mui/icons-material/Notifications';
import GroupsIcon from '@mui/icons-material/Groups';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import BackupIcon from '@mui/icons-material/Backup';
import BuildIcon from '@mui/icons-material/Build';
import SettingsIcon from '@mui/icons-material/Settings';
import BadgeIcon from '@mui/icons-material/Badge';
import DnsIcon from '@mui/icons-material/Dns';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import MenuIcon from '@mui/icons-material/Menu';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSettingsStore } from '../stores/settings';
import { useAuthStore } from '../stores/auth';

const DRAWER_WIDTH = 260;
const DRAWER_WIDTH_COLLAPSED = 68;

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  roles: string[];
}

const allNavItems: NavItem[] = [
  { label: 'لوحة التحكم', path: '/', icon: DashboardIcon, roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { label: 'المرضى', path: '/patients', icon: PersonIcon, roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { label: 'المواعيد', path: '/appointments', icon: CalendarMonthIcon, roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { label: 'موعد جديد', path: '/appointments/new', icon: AddIcon, roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { label: 'الجدول الزمني', path: '/schedule', icon: CalendarTodayIcon, roles: ['ADMIN', 'DOCTOR'] },
  { label: 'المالية', path: '/financial', icon: AccountBalanceWalletIcon, roles: ['ADMIN', 'DOCTOR'] },
  { label: 'خزينة المال', path: '/money-safe', icon: LockIcon, roles: ['ADMIN', 'DOCTOR'] },
    { label: 'المبالغ المستحقة', path: '/outstanding', icon: PaidIcon, roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { label: 'المصروفات', path: '/expenses', icon: PaymentsIcon, roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { label: 'الحجوزات الإلكترونية', path: '/online-bookings', icon: WbSunnyIcon, roles: ['ADMIN', 'SECRETARY'] },
  { label: 'التقارير', path: '/reports', icon: AssessmentIcon, roles: ['ADMIN', 'DOCTOR'] },
  { label: 'الأدوية', path: '/medications', icon: MedicationIcon, roles: ['ADMIN', 'DOCTOR'] },
  { label: 'التاريخ الطبي', path: '/history', icon: HistoryIcon, roles: ['ADMIN', 'DOCTOR'] },
  { label: 'الإشعارات', path: '/notifications', icon: NotificationsIcon, roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { label: 'المستخدمون', path: '/users', icon: GroupsIcon, roles: ['ADMIN'] },
  { label: 'بيانات العيادة', path: '/clinic-profile', icon: LocalHospitalIcon, roles: ['ADMIN'] },
  { label: 'النسخ الاحتياطية', path: '/backups', icon: BackupIcon, roles: ['ADMIN'] },
  { label: 'صحة النظام', path: '/infra', icon: BuildIcon, roles: ['ADMIN'] },
  { label: 'إدارة الخادم', path: '/server-manager', icon: DnsIcon, roles: ['ADMIN'] },
  { label: 'الإعدادات', path: '/settings', icon: SettingsIcon, roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
  { label: 'تحديث البيانات', path: '/profile', icon: BadgeIcon, roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
];

export const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const {} = useSettingsStore();
  const { session } = useAuthStore();

  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('lg'));
  const [collapsed, setCollapsed] = React.useState(narrow);

  React.useEffect(() => {
    setCollapsed(narrow);
  }, [narrow]);

  const filteredItems = allNavItems.filter((item) =>
    session?.role ? item.roles.includes(session.role) : true
  );

  const width = collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH;

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        transition: 'width 0.2s ease',
        '& .MuiDrawer-paper': {
          width,
          boxSizing: 'border-box',
          borderLeft: '1px solid',
          borderColor: 'divider',
          overflowX: 'hidden',
          transition: 'width 0.2s ease',
        },
      }}
    >
      <Box sx={{ p: collapsed ? 1 : 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {!collapsed && (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main', whiteSpace: 'nowrap' }}>
              زيارة
            </Typography>
            {session && (
              <Typography variant="caption" color="text.secondary">
                {session.username} ({session.role})
              </Typography>
            )}
          </Box>
        )}
        <Tooltip title={collapsed ? 'توسيع' : 'طي'} arrow>
          <IconButton size="small" onClick={() => setCollapsed((c) => !c)} sx={{ mr: collapsed ? 'auto' : 0 }}>
            {collapsed ? <MenuIcon fontSize="small" /> : <MenuOpenIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      <List>
        {filteredItems.map((item) => (
          <Tooltip key={item.path} title={collapsed ? item.label : ''} placement="left" arrow>
            <ListItemButton
              selected={location.pathname === item.path || location.pathname.startsWith(item.path + '/')}
              onClick={() => navigate(item.path)}
              sx={{
                borderRadius: 1,
                mb: 0.5,
                mx: collapsed ? 0.5 : 0,
                justifyContent: collapsed ? 'center' : 'flex-start',
                '&.Mui-selected': {
                  backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
                  color: (theme) => theme.palette.text.primary,
                  fontWeight: 700,
                },
                '&.Mui-selected:hover': {
                  backgroundColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, justifyContent: 'center' }}>
                <item.icon fontSize="small" />
              </ListItemIcon>
              {!collapsed && <ListItemText primary={item.label} />}
            </ListItemButton>
          </Tooltip>
        ))}
      </List>
    </Drawer>
  );
};

