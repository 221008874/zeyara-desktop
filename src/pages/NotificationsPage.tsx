import React from 'react';
import { Typography, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Button, Alert } from '@mui/material';
import { useAuthStore } from '../stores/auth';
import { notificationBus } from '../lib/notificationBus';
import { offlineGet, offlineWrite } from '../lib/offlineDb';
import { fmtDateTime, notificationTypeLabel } from '../lib/format';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { EmptyState } from '../design-system/EmptyState';

export const NotificationsPage: React.FC = () => {
  const { session } = useAuthStore();
  const isAdmin = session?.role === 'ADMIN';
  const [notifications, setNotifications] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const data = await offlineGet('/api/notifications?seen=false');
      setNotifications(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'فشل تحميل الإشعارات');
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
    const unsub = notificationBus.subscribe(() => {
      load();
    });
    return () => unsub();
  }, [load]);

  const markSeen = async (id: number) => {
    try {
      await offlineWrite('PUT', `/api/notifications/${id}/seen`);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, seen: true } : n)));
    } catch { /* ignore */ }
  };

  const markAllSeen = async () => {
    try {
      await offlineWrite('PUT', '/api/notifications/seen/all');
      setNotifications((prev) => prev.map((n) => ({ ...n, seen: true })));
    } catch { /* ignore */ }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>الإشعارات</Typography>
        {isAdmin && (
          <Button variant="outlined" onClick={markAllSeen}>تحديد الكل كمقروء</Button>
        )}
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>العنوان</TableCell>
                <TableCell>الرسالة</TableCell>
                <TableCell>التاريخ</TableCell>
                <TableCell>حالة</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableSkeleton cols={4} />
              ) : notifications.length === 0 ? (
                <TableRow><TableCell colSpan={4} sx={{ border: 0, p: 0 }}><EmptyState title="لا توجد إشعارات" hint="ستظهر الإشعارات الجديدة هنا فور وصولها." /></TableCell></TableRow>
              ) : (
                notifications.map((n) => (
                  <TableRow key={n.id} hover onClick={() => markSeen(n.id)} sx={{ cursor: 'pointer' }}>
                    {/* ScheduleNotification exposes `type` and `message`; there
                        is no `title`/`body`, so these two columns rendered empty
                        for every notification. */}
                    <TableCell>{notificationTypeLabel(n.type)}</TableCell>
                    <TableCell>{n.message ?? '—'}</TableCell>
                    <TableCell>{n.createdAt ? fmtDateTime(n.createdAt) : '—'}</TableCell>
                    <TableCell>{n.seen ? 'مقروء' : 'غير مقروء'}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};
