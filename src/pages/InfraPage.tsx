import React from 'react';
import { Typography, Box, Paper, Table, TableBody, TableCell, TableRow, Button, Alert } from '@mui/material';
import { fmtMoney } from '../lib/format';

const formatUptime = (v: any): string => {
  const ms = Number(v);
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  const now = Date.now();
  const durationMs = now - ms;
  if (durationMs <= 0) return '-';
  const days = Math.floor(durationMs / 86400000);
  const hours = Math.floor((durationMs % 86400000) / 3600000);
  const minutes = Math.floor((durationMs % 3600000) / 60000);
  const parts = [];
  if (days > 0) parts.push(`${days} يوم`);
  if (hours > 0) parts.push(`${hours} ساعة`);
  if (minutes > 0) parts.push(`${minutes} دقيقة`);
  return parts.length ? parts.join('، ') : 'أقل من دقيقة';
};

export const InfraPage: React.FC = () => {
  const [health, setHealth] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const checkHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const { api } = await import('../lib/api');
      const res = await api.get('/api/health/stats');
      setHealth(res.data);
    } catch (err: any) {
      setError('لا يمكن الوصول إلى الخادم');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    checkHealth();
  }, []);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>صحة النظام</Typography>
        <Button variant="outlined" onClick={checkHealth}>تحديث</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {loading ? (
        <Typography>جاري التحميل...</Typography>
      ) : health ? (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>حالة الخادم</Typography>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>مرضى اليوم</TableCell>
                <TableCell>{health.patientsToday ?? '-'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>مواعيد اليوم</TableCell>
                <TableCell>{health.appointmentsToday ?? '-'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>إيرادات اليوم</TableCell>
                <TableCell>{health.revenueToday ? fmtMoney(Number(health.revenueToday)) : '-'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>التنبيهات النشطة</TableCell>
                <TableCell>{health.activeAlerts ?? 0}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>مدة التشغيل</TableCell>
                <TableCell>{health.uptime ? formatUptime(health.uptime) : '-'}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Paper>
      ) : null}
    </Box>
  );
};

