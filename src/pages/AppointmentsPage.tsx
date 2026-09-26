import React from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { offlineGet, offlineWrite } from '../lib/offlineDb';
import { useSseRefresh } from '../lib/useSseRefresh';
import { useAuthStore } from '../stores/auth';
import { Notice } from '../design-system/Notice';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { EmptyState } from '../design-system/EmptyState';
import { addDaysISO, appointmentStatusColor, appointmentStatusLabel, nowTimestampLocal, timeZoneLabel, todayISO } from '../lib/format';
import AddIcon from '@mui/icons-material/Add';

export const AppointmentsPage: React.FC = () => {
  const navigate = useNavigate();
  const { session } = useAuthStore();
  const isClinician = session?.role === 'ADMIN' || session?.role === 'DOCTOR';
  const [appointments, setAppointments] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusMsg, setStatusMsg] = React.useState<string | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);
  const [dateFilter, setDateFilter] = React.useState<string>('ALL');
  const [searchDate, setSearchDate] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<string>('ALL');

  const [reschedule, setReschedule] = React.useState<any | null>(null);
  const [newDate, setNewDate] = React.useState('');
  const [newTimeZone, setNewTimeZone] = React.useState('MORNING');
  const [busy, setBusy] = React.useState(false);

  const [cancelTarget, setCancelTarget] = React.useState<any | null>(null);
  const [reactivateTarget, setReactivateTarget] = React.useState<any | null>(null);

  const [completeTarget, setCompleteTarget] = React.useState<any | null>(null);
  const [diagnosis, setDiagnosis] = React.useState('');
  const [completionNotes, setCompletionNotes] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await offlineGet('/api/appointments');
      setAppointments(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setStatusError(err.message || 'فشل تحميل المواعيد');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  useSseRefresh(load);

  const today = todayISO();
  const tomorrow = addDaysISO(1);
  const weekAhead = addDaysISO(7);

  const filtered = appointments.filter((a) => {
    if (dateFilter === 'TODAY' && a.date !== today) return false;
    if (dateFilter === 'TOMORROW' && a.date !== tomorrow) return false;
    if (dateFilter === 'WEEK' && !(a.date >= today && a.date <= weekAhead)) return false;
    if (searchDate && a.date !== searchDate) return false;
    if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
    return true;
  });

  const stats = [
    { label: 'إجمالي المواعيد', value: appointments.length, color: 'text.primary' },
    { label: 'مواعيد اليوم', value: appointments.filter((a) => a.date === today).length, color: 'text.primary' },
    { label: 'هذا الأسبوع', value: appointments.filter((a) => a.date >= today && a.date <= weekAhead && a.status !== 'CANCELLED').length, color: 'text.primary' },
    { label: 'ملغي', value: appointments.filter((a) => a.status === 'CANCELLED').length, color: 'error.main' },
  ];

  const openReschedule = (a: any) => {
    setReschedule(a);
    setNewDate(a.date ?? today);
    setNewTimeZone(a.timeZone ?? 'MORNING');
  };

  const handleReschedule = async () => {
    if (!reschedule || !newDate) return;
    if (newDate < todayISO()) {
      setStatusError('لا يمكن إعادة جدولة الموعد إلى تاريخ ماضٍ');
      return;
    }
    setBusy(true);
    setStatusError(null);
    setStatusMsg(null);
    try {
      const res = await offlineWrite('PUT', `/api/appointments/${reschedule.id}`, {
        date: newDate,
        timeZone: newTimeZone,
        lastUpdated: nowTimestampLocal(),
      });
      setStatusMsg(res.queued
        ? `تمت جدولة إعادة الجدولة #${reschedule.id} — ستُطبَّق عند استعادة الاتصال`
        : `تم إعادة جدولة الموعد #${reschedule.id} إلى ${newDate} ${timeZoneLabel(newTimeZone)}`);
      setReschedule(null);
      load();
    } catch (err: any) {
      setStatusError(err.message || 'فشلت إعادة الجدولة');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setBusy(true);
    setStatusError(null);
    setStatusMsg(null);
    try {
      const res = await offlineWrite('DELETE', `/api/appointments/${cancelTarget.id}`);
      setStatusMsg(res.queued
        ? `تمت جدولة إلغاء الموعد #${cancelTarget.id} — سيُطبَّق عند استعادة الاتصال`
        : `تم إلغاء الموعد #${cancelTarget.id}`);
      setCancelTarget(null);
      load();
    } catch (err: any) {
      setStatusError(err.message || 'فشل إلغاء الموعد');
    } finally {
      setBusy(false);
    }
  };

  const handleReactivate = async () => {
    if (!reactivateTarget) return;
    setBusy(true);
    setStatusError(null);
    setStatusMsg(null);
    try {
      const res = await offlineWrite('PUT', `/api/appointments/${reactivateTarget.id}`, { status: 'SCHEDULED' });
      setStatusMsg(res.queued
        ? `تمت جدولة إعادة تفعيل الموعد #${reactivateTarget.id} — سيُطبَّق عند استعادة الاتصال`
        : `تم إعادة تفعيل الموعد #${reactivateTarget.id}`);
      setReactivateTarget(null);
      load();
    } catch (err: any) {
      setStatusError(err.message || 'فشلت إعادة التفعيل');
    } finally {
      setBusy(false);
    }
  };

  const openComplete = (a: any) => {
    setCompleteTarget(a);
    setDiagnosis('');
    setCompletionNotes(a.notes ?? '');
  };

  const handleComplete = async () => {
    if (!completeTarget) return;
    setBusy(true);
    setStatusError(null);
    setStatusMsg(null);
    try {
      const res = await offlineWrite('POST', `/api/appointments/${completeTarget.id}/complete`, {
        diagnosis: diagnosis.trim() || undefined,
        notes: completionNotes.trim() || undefined,
      });
      setStatusMsg(res.queued
        ? `تمت جدولة إتمام الموعد #${completeTarget.id} — سيُحفظ السجل الطبي عند استعادة الاتصال`
        : `تم إتمام الموعد #${completeTarget.id} وحفظ السجل الطبي`);
      setCompleteTarget(null);
      load();
    } catch (err: any) {
      setStatusError(err.message || 'فشل إتمام الموعد');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>المواعيد</Typography>
          <Typography variant="body2" color="text.secondary">إدارة جداول المرضى</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/appointments/new')}>موعد جديد</Button>
      </Box>

      {statusMsg && <Notice tone="success" msg={statusMsg} />}
      {statusError && <Notice tone="error" msg={statusError} />}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {stats.map((s) => (
          <Grid item xs={6} md={3} key={s.label}>
            <Paper sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">{s.label}</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: s.color }}>{s.value}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <ToggleButtonGroup value={dateFilter} exclusive size="small" onChange={(_, v) => { if (v) { setDateFilter(v); setSearchDate(''); } }}>
          <ToggleButton value="ALL">الكل</ToggleButton>
          <ToggleButton value="TODAY">اليوم</ToggleButton>
          <ToggleButton value="TOMORROW">غداً</ToggleButton>
          <ToggleButton value="WEEK">هذا الأسبوع</ToggleButton>
        </ToggleButtonGroup>
        <TextField label="اختر التاريخ" type="date" size="small" value={searchDate}
          onChange={(e) => { setSearchDate(e.target.value); setDateFilter('ALL'); }} InputLabelProps={{ shrink: true }} />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>الحالة</InputLabel>
          <Select value={statusFilter} label="الحالة" onChange={(e) => setStatusFilter(e.target.value)}>
            <MenuItem value="ALL">الكل</MenuItem>
            <MenuItem value="SCHEDULED">مجدول</MenuItem>
            <MenuItem value="MOVED">مؤجل</MenuItem>
            <MenuItem value="DONE">مكتمل</MenuItem>
            <MenuItem value="CANCELLED">ملغي</MenuItem>
          </Select>
        </FormControl>
      </Box>

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>التاريخ</TableCell>
                <TableCell>الوقت</TableCell>
                <TableCell>الفترة</TableCell>
                <TableCell>المريض</TableCell>
                <TableCell>الحالة</TableCell>
                <TableCell>إجراءات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableSkeleton cols={6} />
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} sx={{ border: 0, p: 0 }}>
                    <EmptyState
                      title="لا توجد مواعيد"
                      hint="يمكنك حجز أول موعد الآن."
                      actionLabel="موعد جديد"
                      onAction={() => navigate('/appointments/new')}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage).map((apt) => (
                  <TableRow key={apt.id} hover>
                    <TableCell>{apt.date}</TableCell>
                    <TableCell>{apt.time ?? '—'}</TableCell>
                    <TableCell>{timeZoneLabel(apt.timeZone)}</TableCell>
                    <TableCell>{apt.patientName ?? apt.patientId}</TableCell>
                    <TableCell>
                      <Chip size="small" color={appointmentStatusColor(apt.status)} label={appointmentStatusLabel(apt.status)} />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        {apt.status === 'SCHEDULED' || apt.status === 'MOVED' ? (
                          <>
                            {isClinician && (
                              <Button size="small" variant="contained" color="success" onClick={() => openComplete(apt)}>إتمام</Button>
                            )}
                            <Button size="small" variant="outlined" onClick={() => openReschedule(apt)}>إعادة جدولة</Button>
                            <Button size="small" variant="outlined" color="error" onClick={() => setCancelTarget(apt)}>إلغاء</Button>
                          </>
                        ) : apt.status === 'CANCELLED' ? (
                          <Button size="small" variant="outlined" onClick={() => setReactivateTarget(apt)}>إعادة تفعيل</Button>
                        ) : null}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          rowsPerPageOptions={[5, 10, 25]}
          component="div"
          count={filtered.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        />
      </Paper>

      <Dialog open={!!reschedule} onClose={() => !busy && setReschedule(null)}>
        <DialogTitle>إعادة جدولة الموعد #{reschedule?.id}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, minWidth: 300 }}>
            <TextField label="التاريخ" type="date" value={newDate}
              onChange={(e) => setNewDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <FormControl fullWidth>
              <InputLabel>الفترة</InputLabel>
              <Select value={newTimeZone} label="الفترة" onChange={(e) => setNewTimeZone(e.target.value)}>
                <MenuItem value="MORNING">صباحاً</MenuItem>
                <MenuItem value="AFTERNOON">بعد الظهر</MenuItem>
                <MenuItem value="NIGHT">مساءً</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReschedule(null)} disabled={busy}>إلغاء</Button>
          <Button variant="contained" onClick={handleReschedule} disabled={busy || !newDate}>
            {busy ? <CircularProgress size={18} /> : 'حفظ'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!cancelTarget} onClose={() => !busy && setCancelTarget(null)}>
        <DialogTitle>إلغاء الموعد #{cancelTarget?.id}</DialogTitle>
        <DialogContent>
          <Typography>هل أنت متأكد من إلغاء هذا الموعد؟</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelTarget(null)} disabled={busy}>تراجع</Button>
          <Button variant="contained" color="error" onClick={handleCancel} disabled={busy}>
            {busy ? <CircularProgress size={18} /> : 'إلغاء الموعد'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!reactivateTarget} onClose={() => !busy && setReactivateTarget(null)}>
        <DialogTitle>إعادة تفعيل الموعد #{reactivateTarget?.id}</DialogTitle>
        <DialogContent>
          <Typography>هل أنت متأكد من إعادة تفعيل هذا الموعد الملغي؟</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReactivateTarget(null)} disabled={busy}>تراجع</Button>
          <Button variant="contained" color="success" onClick={handleReactivate} disabled={busy}>
            {busy ? <CircularProgress size={18} /> : 'إعادة التفعيل'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!completeTarget} onClose={() => !busy && setCompleteTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>إتمام الموعد #{completeTarget?.id}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {completeTarget?.patientName ?? `المريض #${completeTarget?.patientId}`} — {completeTarget?.date}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="التشخيص"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
            <TextField
              label="ملاحظات"
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompleteTarget(null)} disabled={busy}>إلغاء</Button>
          <Button variant="contained" color="success" onClick={handleComplete} disabled={busy}>
            {busy ? <CircularProgress size={18} /> : 'حفظ الإتمام'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
