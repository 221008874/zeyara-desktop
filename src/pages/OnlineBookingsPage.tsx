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
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { offlineGet, offlineWrite } from '../lib/offlineDb';
import { Notice } from '../design-system/Notice';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { EmptyState } from '../design-system/EmptyState';
import { todayISO, nowTimestampLocal } from '../lib/format';

const timeZoneLabel = (tz: string): string => {
  const map: Record<string, string> = {
    MORNING: 'صباحاً',
    AFTERNOON: 'بعد الظهر',
    NIGHT: 'مساءً',
    EVENING: 'مساءً',
  };
  return map[tz] ?? tz ?? '—';
};

const statusLabel = (s: string): string => {
  const map: Record<string, string> = {
    SCHEDULED: 'مجدول',
    CANCELLED: 'ملغي',
    COMPLETED: 'مكتمل',
    DONE: 'مكتمل',
    NO_SHOW: 'لم يحضر',
    CHECKED_IN: 'وصل',
  };
  return map[s] ?? s ?? '—';
};

/**
 * Strips the server-appended provenance marker from the notes column.
 *
 * Matches the current "[Booked via community app]" marker as well as historical
 * records written before the server-side encoding bug was fixed, whose marker
 * was mojibake (the leading glyphs were corrupted, not the phrase itself).
 * Anchoring on the phrase and consuming the rest of the line keeps old rows
 * clean without leaking garbage into the UI.
 */
const stripCommunityNote = (notes?: string | null): string => {
  if (!notes) return '';
  return notes
    .split('\n')
    .filter((line) => !/Booked via community app/i.test(line))
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
};

export const OnlineBookingsPage: React.FC = () => {
  const [bookings, setBookings] = React.useState<any[]>([]);
  const [patients, setPatients] = React.useState<Record<number, any>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<'ALL' | 'SCHEDULED' | 'CANCELLED'>('ALL');
  const [statusMsg, setStatusMsg] = React.useState<string | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [reschedule, setReschedule] = React.useState<any | null>(null);
  const [newDate, setNewDate] = React.useState('');
  const [newTimeZone, setNewTimeZone] = React.useState('MORNING');
  const [cancelTarget, setCancelTarget] = React.useState<any | null>(null);
  const [reactivateTarget, setReactivateTarget] = React.useState<any | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [apptData, patData] = await Promise.all([
        offlineGet('/api/appointments'),
        offlineGet('/api/patients'),
      ]);
      const all = Array.isArray(apptData) ? apptData : [];
      const online = all.filter((a: any) => a.cloudAppointmentId);
      setBookings(online);
      const map: Record<number, any> = {};
      (Array.isArray(patData) ? patData : []).forEach((p: any) => {
        if (p?.id != null) map[p.id] = p;
      });
      setPatients(map);
    } catch (err: any) {
      setError(err.message || 'فشل تحميل الحجوزات الإلكترونية');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const openReschedule = (b: any) => {
    setReschedule(b);
    setNewDate(b.date ?? todayISO());
    setNewTimeZone(b.timeZone ?? 'MORNING');
  };

  const handleReschedule = async () => {
    if (!reschedule || !newDate) return;
    if (newDate < todayISO()) {
      setStatusError('لا يمكن إعادة جدولة الحجز إلى تاريخ ماضٍ');
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
        ? `تمت جدولة إعادة جدولة الحجز #${reschedule.id} — ستُطبَّق عند استعادة الاتصال`
        : `تم إعادة جدولة الحجز #${reschedule.id} إلى ${newDate} ${timeZoneLabel(newTimeZone)}`);
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
        ? `تمت جدولة إلغاء الحجز #${cancelTarget.id} — سيُطبَّق عند استعادة الاتصال`
        : `تم إلغاء الحجز #${cancelTarget.id}`);
      setCancelTarget(null);
      load();
    } catch (err: any) {
      setStatusError(err.message || 'فشل إلغاء الحجز');
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
        ? `تمت جدولة إعادة تفعيل الحجز #${reactivateTarget.id} — ستُطبَّق عند استعادة الاتصال`
        : `تم إعادة تفعيل الحجز #${reactivateTarget.id}`);
      setReactivateTarget(null);
      load();
    } catch (err: any) {
      setStatusError(err.message || 'فشلت إعادة التفعيل');
    } finally {
      setBusy(false);
    }
  };

  const today = todayISO();
  const total = bookings.length;
  const todayCount = bookings.filter((b) => b.date === today).length;
  const scheduled = bookings.filter((b) => b.status === 'SCHEDULED').length;
  const cancelled = bookings.filter((b) => b.status === 'CANCELLED').length;

  const filtered = bookings.filter((b) =>
    filter === 'ALL' ? true : b.status === filter
  );

  const stats = [
    { label: 'إجمالي الحجوزات', value: total, color: 'text.primary' },
    { label: 'حجوزات اليوم', value: todayCount, color: 'text.primary' },
    { label: 'مجدول', value: scheduled, color: 'text.primary' },
    { label: 'ملغي', value: cancelled, color: 'error.main' },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>الحجوزات الإلكترونية</Typography>
          <Typography variant="body2" color="text.secondary">المواعيد المحجوزة عبر تطبيق المجتمع</Typography>
        </Box>
        <Button variant="outlined" onClick={load} disabled={loading}>
          {loading ? <CircularProgress size={18} /> : '⟳ تحديث'}
        </Button>
      </Box>

      {error && <Notice tone="error" msg={error} />}
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

      <Box sx={{ mb: 2 }}>
        <ToggleButtonGroup
          value={filter}
          exclusive
          size="small"
          onChange={(_, v) => v && setFilter(v)}
        >
          <ToggleButton value="ALL">الكل</ToggleButton>
          <ToggleButton value="SCHEDULED">مجدول</ToggleButton>
          <ToggleButton value="CANCELLED">ملغي</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>المريض</TableCell>
                <TableCell>الهاتف</TableCell>
                <TableCell>العمر</TableCell>
                <TableCell>الجنس</TableCell>
                <TableCell>التاريخ</TableCell>
                <TableCell>الفترة</TableCell>
                <TableCell>الحالة</TableCell>
                <TableCell>ملاحظات</TableCell>
                <TableCell>إجراءات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableSkeleton cols={9} />
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} sx={{ border: 0, p: 0 }}>
                    <EmptyState title="لا توجد حجوزات إلكترونية بعد" hint="ستظهر الحجوزات الواردة من التطبيق المجتمعي هنا." />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((b: any) => {
                  const p = b.patientId != null ? patients[b.patientId] : null;
                  return (
                    <TableRow key={b.id}>
                      <TableCell>{b.patientName ?? p?.name ?? '—'}</TableCell>
                      <TableCell>{p?.phone ?? '—'}</TableCell>
                      <TableCell>{p?.age ?? '—'}</TableCell>
                      <TableCell>{p?.gender ?? '—'}</TableCell>
                      <TableCell>{b.date ?? '—'}</TableCell>
                      <TableCell>{timeZoneLabel(b.timeZone)}</TableCell>
                      <TableCell>
                        <Chip size="small" label={statusLabel(b.status)} color={b.status === 'CANCELLED' ? 'error' : b.status === 'SCHEDULED' ? 'success' : 'default'} />
                      </TableCell>
                      <TableCell>{stripCommunityNote(b.notes)}</TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {(b.status === 'SCHEDULED' || b.status === 'MOVED') && (
                            <>
                              <Button size="small" variant="outlined" onClick={() => openReschedule(b)}>إعادة جدولة</Button>
                              <Button size="small" variant="outlined" color="error" onClick={() => setCancelTarget(b)}>إلغاء</Button>
                            </>
                          )}
                          {b.status === 'CANCELLED' && (
                            <Button size="small" variant="outlined" onClick={() => setReactivateTarget(b)}>إعادة تفعيل</Button>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={!!reschedule} onClose={() => !busy && setReschedule(null)}>
        <DialogTitle>إعادة جدولة الحجز #{reschedule?.id}</DialogTitle>
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
        <DialogTitle>إلغاء الحجز #{cancelTarget?.id}</DialogTitle>
        <DialogContent>
          <Typography>هل أنت متأكد من إلغاء هذا الحجز؟</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCancelTarget(null)} disabled={busy}>تراجع</Button>
          <Button variant="contained" color="error" onClick={handleCancel} disabled={busy}>
            {busy ? <CircularProgress size={18} /> : 'إلغاء الحجز'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!reactivateTarget} onClose={() => !busy && setReactivateTarget(null)}>
        <DialogTitle>إعادة تفعيل الحجز #{reactivateTarget?.id}</DialogTitle>
        <DialogContent>
          <Typography>هل أنت متأكد من إعادة تفعيل هذا الحجز الملغي؟</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReactivateTarget(null)} disabled={busy}>تراجع</Button>
          <Button variant="contained" color="success" onClick={handleReactivate} disabled={busy}>
            {busy ? <CircularProgress size={18} /> : 'إعادة التفعيل'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
