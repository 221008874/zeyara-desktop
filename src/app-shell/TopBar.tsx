import React from 'react';
import { AppBar, Toolbar, Typography, IconButton, Box, Avatar, Badge } from '@mui/material';
import NotificationsIcon from '@mui/icons-material/Notifications';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { notificationBus } from '../lib/notificationBus';
import { api } from '../lib/api';
import { ConfirmDialog } from '../design-system/ConfirmDialog';
import HeartbeatIndicator from './HeartbeatIndicator';

const pathLabels: Record<string, string> = {
  '/': 'لوحة التحكم',
  '/patients': 'المرضى',
  '/appointments': 'المواعيد',
  '/schedule': 'الجدول الزمني',
  '/financial': 'المالية',
  '/money-safe': 'خزينة المال',
    '/outstanding': 'المبالغ المستحقة',
  '/expenses': 'المصروفات',
  '/online-bookings': 'الحجوزات الإلكترونية',
  '/profile': 'تحديث البيانات',
  '/reports': 'التقارير',
  '/medications': 'الأدوية',
  '/history': 'التاريخ الطبي',
  '/notifications': 'الإشعارات',
  '/users': 'المستخدمون',
  '/clinic-profile': 'بيانات العيادة',
  '/backups': 'النسخ الاحتياطية',
  '/infra': 'صحة النظام',
  '/settings': 'الإعدادات',
};

const dynamicPathLabel = (pathname: string): string | null => {
  if (pathname.startsWith('/patients/')) return 'ملف المريض';
  if (pathname === '/patients/new') return 'إضافة مريض';
  if (pathname === '/appointments/new') return 'موعد جديد';
  if (pathname === '/change-password') return 'تغيير كلمة المرور';
  if (pathname === '/dashboard') return 'لوحة التحكم';
  return null;
};

export const TopBar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, logout } = useAuthStore();
  const { theme, setTheme } = useSettingsStore();
  const [unread, setUnread] = React.useState(0);
  const [confirmLogout, setConfirmLogout] = React.useState(false);

  const loadUnread = React.useCallback(async () => {
    try {
      const res = await api.get('/api/notifications/count/unread');
      const v = typeof res.data === 'number' ? res.data : Number((res.data as any)?.count ?? 0);
      setUnread(Number.isFinite(v) ? v : 0);
    } catch { /* ignore */ }
  }, []);

  React.useEffect(() => {
    if (!session?.token) return;
    loadUnread();
    const unsub = notificationBus.subscribe(() => loadUnread());
    const t = window.setInterval(loadUnread, 30000);
    return () => {
      unsub();
      window.clearInterval(t);
    };
  }, [session?.token, loadUnread]);

  const label = pathLabels[location.pathname] || dynamicPathLabel(location.pathname) || 'زيارة';

  return (
    <AppBar position="static" elevation={0} sx={{ bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
      <Toolbar sx={{ justifyContent: 'space-between' }}>
        <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 600 }}>
          {label}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <HeartbeatIndicator />
<IconButton size="small" onClick={() => navigate('/notifications')} title="الإشعارات">
            <Badge badgeContent={unread} color="error" max={99}>
              <NotificationsIcon fontSize="small" />
            </Badge>
          </IconButton>
          <IconButton
            size="small"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          >
            {theme === 'light' ? <DarkModeIcon fontSize="small" /> : <LightModeIcon fontSize="small" />}
          </IconButton>
          <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: '0.75rem' }}>
            {session?.username?.charAt(0).toUpperCase()}
          </Avatar>
          <Typography variant="body2" sx={{ color: 'text.primary', mr: 1 }}>
            {session?.username}
          </Typography>
          <IconButton size="small" onClick={() => navigate('/settings')} title="Settings">
            <SettingsIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={() => setConfirmLogout(true)} title="Logout">
            <LogoutIcon fontSize="small" />
          </IconButton>
        </Box>
      </Toolbar>
      <ConfirmDialog
        open={confirmLogout}
        title="تسجيل الخروج"
        message="هل تريد تسجيل الخروج من النظام؟"
        confirmLabel="خروج"
        cancelLabel="إلغاء"
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => { setConfirmLogout(false); logout(); }}
      />
    </AppBar>
  );
};

