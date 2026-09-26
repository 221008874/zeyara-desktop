import React from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Alert,
  Skeleton,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { offlineGet } from '../lib/offlineDb';
import { fmtDateTime, fmtMoney, timeZoneLabel } from '../lib/format';
import { useAuthStore } from '../stores/auth';
import { checkForUpdate, downloadVerifiedUpdate, UpdateInfo } from '../lib/updateCheck';
import { useSseRefresh } from '../lib/useSseRefresh';
import PersonIcon from '@mui/icons-material/Person';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import PaymentsIcon from '@mui/icons-material/Payments';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import AddIcon from '@mui/icons-material/Add';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import MedicationIcon from '@mui/icons-material/Medication';
import AssessmentIcon from '@mui/icons-material/Assessment';
import BackupIcon from '@mui/icons-material/Backup';
import ScheduleIcon from '@mui/icons-material/Schedule';
import NotificationsIcon from '@mui/icons-material/Notifications';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { EmptyState } from '../design-system/EmptyState';

const kpiDefs = [
  { key: 'patientsToday', label: 'مرضى اليوم', icon: PersonIcon },
  { key: 'appointmentsToday', label: 'مواعيد اليوم', icon: CalendarMonthIcon },
  { key: 'revenueToday', label: 'إيرادات اليوم', icon: PaymentsIcon },
  { key: 'activeAlerts', label: 'تنبيهات نشطة', icon: NotificationsActiveIcon },
];

interface QuickAction {
  label: string;
  path: string;
  icon: React.ElementType;
  roles: string[];
}

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { session } = useAuthStore();
  const [kpis, setKpis] = React.useState<Record<string, any> | null>(null);
  const [todayAppointments, setTodayAppointments] = React.useState<any[]>([]);
  const [recentPatients, setRecentPatients] = React.useState<any[]>([]);
  const [recentNotifications, setRecentNotifications] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = React.useState<UpdateInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = React.useState(false);
  const [updateError, setUpdateError] = React.useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await offlineGet('/api/dashboard/summary');
      const summary = data ?? {};
      const summaryKpis = summary.kpis ?? {};
      let activeAlerts = summaryKpis.activeAlerts ?? 0;
      try {
        const stats = await offlineGet('/api/health/stats');
        if (typeof stats.activeAlerts === 'number') {
          activeAlerts = stats.activeAlerts;
        }
      } catch { /* health/stats optional — keep summary value */ }
      setKpis({ ...summaryKpis, activeAlerts });
      setTodayAppointments(Array.isArray(summary.todayAppointments) ? summary.todayAppointments : []);
      setRecentPatients(Array.isArray(summary.recentPatients) ? summary.recentPatients : []);
      setRecentNotifications(Array.isArray(summary.recentNotifications) ? summary.recentNotifications : []);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || 'فشل تحميل لوحة التحكم');
      setKpis(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  React.useEffect(() => {
    checkForUpdate().then((info) => {
      if (info) setUpdateInfo(info);
    });
  }, []);

  useSseRefresh(load);

  const role = session?.role ?? '';
  const isAdmin = role === 'ADMIN';
  const isDoctor = role === 'DOCTOR';

  const handleUpdateDownload = async () => {
    if (!updateInfo || updateBusy) return;
    setUpdateBusy(true);
    setUpdateError(null);
    try {
      await downloadVerifiedUpdate(updateInfo);
    } catch (err: any) {
      setUpdateError(err?.message || 'Update download failed.');
    } finally {
      setUpdateBusy(false);
    }
  };

  const quickActions: QuickAction[] = [
    { label: 'موعد جديد', path: '/appointments/new', icon: ScheduleIcon, roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
    { label: 'مريض جديد', path: '/patients/new', icon: AddIcon, roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
    { label: 'إضافة مصروف', path: '/expenses', icon: PaymentsIcon, roles: ['ADMIN', 'DOCTOR', 'SECRETARY'] },
    { label: 'صرف دواء', path: '/medications', icon: MedicationIcon, roles: ['ADMIN', 'DOCTOR'] },
    { label: 'التقارير', path: '/reports', icon: AssessmentIcon, roles: ['ADMIN', 'DOCTOR'] },
    { label: 'نسخة احتياطية', path: '/backups', icon: BackupIcon, roles: ['ADMIN'] },
  ].filter((a) => a.roles.includes(role));

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>لوحة التحكم</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        إدارة النظام وتنسيق المرضى — مرحباً {session?.username}
      </Typography>

      {loadError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError(null)}>{loadError}</Alert>}

      {updateInfo && !updateDismissed && (
        <Alert
          severity={updateInfo.forceUpdate ? 'warning' : 'info'}
          sx={{ mb: 2 }}
          onClose={updateInfo.forceUpdate ? undefined : () => setUpdateDismissed(true)}
          action={
            updateInfo.downloadUrl || updateInfo.msiUrl ? (
              <Button color="inherit" size="small" disabled={updateBusy} onClick={handleUpdateDownload}>
                {updateBusy ? 'جارٍ التحقق…' : 'تحميل'}
              </Button>
            ) : undefined
          }
        >
          <strong>تحديث جديد متاح</strong> — الإصدار {updateInfo.latestVersion}
          {updateInfo.releaseNotes && ` — ${updateInfo.releaseNotes}`}
        </Alert>
      )}

      {updateError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setUpdateError(null)}>
          فشل تحميل التحديث: {updateError}
        </Alert>
      )}

      <Grid container spacing={3} sx={{ mb: 3 }}>
        {kpiDefs.map((k) => (
          <Grid item xs={12} sm={6} md={3} key={k.key}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <k.icon sx={{ color: 'text.secondary', fontSize: 22 }} />
                  <Typography variant="body2" color="text.secondary">{k.label}</Typography>
                </Box>
                <Typography variant="h4" sx={{ fontWeight: 700, color: k.key === 'activeAlerts' ? 'error.main' : 'text.primary' }}>
                  {loading ? '…' : kpis == null ? '—' : k.key === 'revenueToday' ? fmtMoney(kpis[k.key]) : String(kpis[k.key] ?? 0)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Typography variant="h6" sx={{ mb: 2 }}>إجراءات سريعة</Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 4 }}>
        {quickActions.map((a) => (
          <Button key={a.label} variant="outlined" onClick={() => navigate(a.path)} startIcon={<a.icon />}>
            {a.label}
          </Button>
        ))}
      </Box>

      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <Paper>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
              <ScheduleIcon sx={{ color: 'primary.main' }} />
              <Typography variant="h6">مواعيد اليوم ({todayAppointments.length})</Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>الوقت</TableCell>
                    <TableCell>الفترة</TableCell>
                    <TableCell>المريض</TableCell>
                    <TableCell>الحالة</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    <TableSkeleton cols={4} />
                  ) : todayAppointments.length === 0 ? (
                    <TableRow><TableCell colSpan={4} sx={{ border: 0, p: 0 }}><EmptyState title="لا توجد مواعيد اليوم" hint="لا مواعيد مجدولة اليوم." /></TableCell></TableRow>
                  ) : (
                    todayAppointments.map((a) => (
                      <TableRow key={a.id} hover onClick={() => navigate(`/appointments`)} sx={{ cursor: 'pointer' }}>
                        <TableCell>{a.time ?? '—'}</TableCell>
                        <TableCell>{timeZoneLabel(a.timeZone)}</TableCell>
                        <TableCell>{a.patientName ?? a.patientId}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={a.status ?? '—'}
                            color={a.status === 'CANCELLED' ? 'error' : a.status === 'DONE' ? 'success' : 'info'}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {(isAdmin || isDoctor) && (
            <Paper sx={{ mt: 3 }}>
              <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                <MedicalServicesIcon sx={{ color: 'primary.main' }} />
                <Typography variant="h6">المرضى المحدَّثون مؤخراً</Typography>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>الاسم</TableCell>
                      <TableCell>الهاتف</TableCell>
                      <TableCell>آخر تحديث</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {loading ? (
                      <TableSkeleton cols={3} />
                    ) : recentPatients.length === 0 ? (
                      <TableRow><TableCell colSpan={3} sx={{ border: 0, p: 0 }}><EmptyState title="لا يوجد مرضى بعد" hint="أضف أول مريض لبدء المتابعة." /></TableCell></TableRow>
                    ) : (
                      recentPatients.map((p) => (
                        <TableRow key={p.id} hover onClick={() => navigate(`/patients/${p.id}`)} sx={{ cursor: 'pointer' }}>
                          <TableCell>{p.name ?? p.patientName ?? '—'}</TableCell>
                          <TableCell>{p.phone ?? '—'}</TableCell>
                          {/* Patient has no `category` field (that belongs to
                              Appointment/HistoryCategory), so this column used
                              to render a permanent placeholder. The list is
                              "recently updated" patients, so show the update
                              time, which the endpoint actually returns. */}
                          <TableCell>{p.lastUpdated ? fmtDateTime(p.lastUpdated) : '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </Grid>

        <Grid item xs={12} md={5}>
          <Paper>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
              <NotificationsIcon sx={{ color: 'primary.main' }} />
              <Typography variant="h6">الإشعارات الحديثة</Typography>
            </Box>
            <Box sx={{ p: 2 }}>
              {loading ? (
                <Skeleton height={60} />
              ) : recentNotifications.length === 0 ? (
                <EmptyState title="لا توجد إشعارات" hint="ستظهر الإشعارات الجديدة هنا." />
              ) : (
                recentNotifications.map((n: any) => (
                  <Box key={n.id} sx={{ p: 1.5, mb: 1, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="body2">{n.message ?? n.text ?? n.title ?? 'إشعار'}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {n.createdAt ? String(n.createdAt).replace('T', ' ') : ''}
                    </Typography>
                  </Box>
                ))
              )}
              <Button size="small" sx={{ mt: 1 }} onClick={() => navigate('/notifications')}>عرض الكل ←</Button>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  );
};
