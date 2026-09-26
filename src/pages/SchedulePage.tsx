import React from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
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
  Typography,
} from '@mui/material';
import { offlineGet, offlineWrite, getQueue } from '../lib/offlineDb';
import { useSseRefresh } from '../lib/useSseRefresh';
import { Notice } from '../design-system/Notice';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { EmptyState } from '../design-system/EmptyState';
import { timeZoneLabel, todayISO } from '../lib/format';
import HistoryIcon from '@mui/icons-material/History';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import WbSunnyIcon from '@mui/icons-material/WbSunny';
import CloudIcon from '@mui/icons-material/Cloud';
import NightlightIcon from '@mui/icons-material/Nightlight';

const HISTORY_KEY = 'zeyara_schedule_cancel_history';

interface CancelHistoryEntry {
  id: string;
  date: string;
  zone: string;
  startTime: string;
  endTime: string;
  action: 'CANCELLED' | 'REACTIVATED' | 'CREATED';
  at: string;
}

const loadHistory = (): CancelHistoryEntry[] => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const pushHistory = (entry: Omit<CancelHistoryEntry, 'id' | 'at'>) => {
  const history = loadHistory();
  history.unshift({ ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString() });
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 200)));
  } catch { /* storage full - ignore */ }
};

const DEFAULT_TIMES: Record<string, { start: string; end: string }> = {
  MORNING: { start: '09:00', end: '12:00' },
  AFTERNOON: { start: '13:00', end: '17:00' },
  NIGHT: { start: '18:00', end: '21:00' },
};

const addDays = (iso: string, days: number): string => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const SchedulePage: React.FC = () => {
  const [date, setDate] = React.useState(todayISO());
  const [schedules, setSchedules] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusMsg, setStatusMsg] = React.useState<string | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);

  const [dialog, setDialog] = React.useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
  const [tz, setTz] = React.useState('MORNING');
  const [startTime, setStartTime] = React.useState('09:00');
  const [endTime, setEndTime] = React.useState('12:00');
  const [cancelled, setCancelled] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyLog, setHistoryLog] = React.useState<CancelHistoryEntry[]>(() => loadHistory());

  const recordToHistory = (s: any, action: CancelHistoryEntry['action']) => {
    pushHistory({
      date: s.date ?? date,
      zone: s.timeZone ?? tz,
      startTime: s.startTime ?? startTime,
      endTime: s.endTime ?? endTime,
      action,
    });
    setHistoryLog(loadHistory());
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    setStatusMsg(null);
    setStatusError(null);
    try {
      const data = await offlineGet(`/api/schedule?date=${date}`);
      setSchedules(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setStatusError(err.message || 'فشل تحميل الجدول');
    } finally {
      setLoading(false);
    }
  }, [date]);

  React.useEffect(() => {
    load();
  }, [load]);

  useSseRefresh(load);

  const openAdd = () => {
    setTz('MORNING');
    setStartTime(DEFAULT_TIMES.MORNING.start);
    setEndTime(DEFAULT_TIMES.MORNING.end);
    setCancelled(false);
    setDialog({ open: true, editing: null });
  };

  const openEdit = (s: any) => {
    setTz(s.timeZone ?? 'MORNING');
    setStartTime(s.startTime ?? '');
    setEndTime(s.endTime ?? '');
    setCancelled(!!s.cancelled);
    setDialog({ open: true, editing: s });
  };

  const handleSave = async () => {
    if (!date) {
      setStatusError('الرجاء اختيار التاريخ');
      return;
    }
    if (!startTime || !endTime) {
      setStatusError('الرجاء إدخال وقت البداية والنهاية');
      return;
    }
    if (startTime >= endTime) {
      setStatusError('وقت البداية يجب أن يسبق وقت النهاية');
      return;
    }
    setBusy(true);
    setStatusError(null);
    setStatusMsg(null);
    try {
      const payload = { date, timeZone: tz, startTime, endTime, cancelled };
      if (dialog.editing) {
        const res = await offlineWrite('PUT', `/api/schedule/${dialog.editing.id}`, payload);
        setStatusMsg(res.queued ? 'أنت غير متصل. تمت جدولة تحديث الجلسة' : 'تم تحديث الجلسة');
        const action: CancelHistoryEntry['action'] = cancelled ? 'CANCELLED' : 'REACTIVATED';
        if (cancelled !== !!dialog.editing.cancelled) {
          recordToHistory({ date, timeZone: tz, startTime, endTime }, action);
        }
      } else {
        const res = await offlineWrite('POST', '/api/schedule', payload);
        setStatusMsg(res.queued ? 'أنت غير متصل. تمت جدولة إضافة الجلسة' : 'تمت إضافة الجلسة');
        recordToHistory({ date, timeZone: tz, startTime, endTime }, 'CREATED');
      }
      setDialog({ open: false, editing: null });
      load();
    } catch (err: any) {
      setStatusError(err.message || 'فشل الحفظ');
    } finally {
      setBusy(false);
    }
  };

  const toggleCancelled = async (s: any) => {
    setStatusError(null);
    setStatusMsg(null);
    try {
      const res = await offlineWrite('PUT', `/api/schedule/${s.id}`, { ...s, cancelled: !s.cancelled });
      setStatusMsg(res.queued
        ? 'أنت غير متصل. تمت جدولة العملية'
        : (s.cancelled ? 'تم إعادة تفعيل الجلسة' : 'تم إلغاء الجلسة'));
      recordToHistory(s, s.cancelled ? 'REACTIVATED' : 'CANCELLED');
      load();
    } catch (err: any) {
      setStatusError(err.message || 'فشل التحديث');
    }
  };

  const restoreDefaults = async () => {
    setBusy(true);
    setStatusError(null);
    setStatusMsg(null);
    try {
      for (const [zone, t] of Object.entries(DEFAULT_TIMES)) {
        await offlineWrite('PUT', '/api/schedule', { date, timeZone: zone, startTime: t.start, endTime: t.end, cancelled: false });
      }
      const queued = getQueue().length > 0;
      setStatusMsg(queued ? 'أنت غير متصل. تمت جدولة الاستعادة' : 'تمت استعادة الفترات الافتراضية');
      load();
    } catch (err: any) {
      setStatusError(err.message || 'فشلت الاستعادة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>إدارة الجدول</Typography>
          <Typography variant="body2" color="text.secondary">تكوين الفترات الزمنية، إلغاء الجلسات، عرض السجل</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<HistoryIcon />} onClick={() => setHistoryOpen(true)}>سجل الإلغاءات</Button>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={restoreDefaults} disabled={busy}>استعادة الافتراضي</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>إضافة جلسة</Button>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mb: 3, alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip icon={<WbSunnyIcon />} label="الصباح 09:00 - 12:00" variant="outlined" />
        <Chip icon={<CloudIcon />} label="بعد الظهر 13:00 - 17:00" variant="outlined" />
        <Chip icon={<NightlightIcon />} label="المساء 18:00 - 21:00" variant="outlined" />
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
        <IconButton size="small" onClick={() => setDate(addDays(date, -1))}>‹</IconButton>
        <TextField type="date" size="small" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} />
        <IconButton size="small" onClick={() => setDate(addDays(date, 1))}>›</IconButton>
        <Button size="small" variant="text" onClick={() => setDate(todayISO())}>اليوم</Button>
      </Box>

      {statusMsg && <Notice tone="success" msg={statusMsg} />}
      {statusError && <Notice tone="error" msg={statusError} />}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>التاريخ</TableCell>
                <TableCell>الفترة</TableCell>
                <TableCell>من</TableCell>
                <TableCell>إلى</TableCell>
                <TableCell>الحالة</TableCell>
                <TableCell>إجراءات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableSkeleton cols={6} />
              ) : schedules.length === 0 ? (
                <TableRow><TableCell colSpan={6} sx={{ border: 0, p: 0 }}>
                  <EmptyState title="لا توجد جداول لهذا اليوم" hint="أضف جلسة أو استعد الافتراضي لبدء الجدولة." />
                </TableCell></TableRow>
              ) : (
                schedules.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.date}</TableCell>
                    <TableCell>{timeZoneLabel(s.timeZone)}</TableCell>
                    <TableCell>{s.startTime ?? '—'}</TableCell>
                    <TableCell>{s.endTime ?? '—'}</TableCell>
                    <TableCell>
                      <Chip size="small" color={s.cancelled ? 'error' : 'success'} label={s.cancelled ? 'ملغاة' : 'نشطة'} />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Button size="small" variant="outlined" onClick={() => openEdit(s)}>تعديل</Button>
                        <Button size="small" variant="outlined" color={s.cancelled ? 'success' : 'error'} onClick={() => toggleCancelled(s)}>
                          {s.cancelled ? 'إعادة تفعيل' : 'إلغاء'}
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={dialog.open} onClose={() => !busy && setDialog({ open: false, editing: null })}>
        <DialogTitle>{dialog.editing ? 'تعديل الجلسة' : 'إضافة جلسة'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1, minWidth: 320 }}>
            <TextField label="التاريخ" type="date" value={date} onChange={(e) => setDate(e.target.value)} InputLabelProps={{ shrink: true }} />
            <FormControl fullWidth>
              <InputLabel>الفترة</InputLabel>
              <Select value={tz} label="الفترة" onChange={(e) => {
                const zone = e.target.value as string;
                setTz(zone);
                const def = DEFAULT_TIMES[zone];
                if (def && !dialog.editing) { setStartTime(def.start); setEndTime(def.end); }
              }}>
                <MenuItem value="MORNING">صباحاً</MenuItem>
                <MenuItem value="AFTERNOON">بعد الظهر</MenuItem>
                <MenuItem value="NIGHT">مساءً</MenuItem>
              </Select>
            </FormControl>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField label="من" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} InputLabelProps={{ shrink: true }} />
              <TextField label="إلى" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} InputLabelProps={{ shrink: true }} />
            </Box>
            <FormControlLabel
              control={<Checkbox checked={cancelled} onChange={(e) => setCancelled(e.target.checked)} />}
              label="إلغاء الفترة (منع الحجوزات)"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialog({ open: false, editing: null })} disabled={busy}>إلغاء</Button>
          <Button variant="contained" onClick={handleSave} disabled={busy}>
            {busy ? <CircularProgress size={18} /> : 'حفظ'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>سجل الجلسات والإلغاءات</DialogTitle>
        <DialogContent>
          {historyLog.length === 0 ? (
            <Typography sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
              لا يوجد سجل بعد — إلغاء أو إضافة جلسة سيسجل هنا
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>التاريخ</TableCell>
                    <TableCell>الوقت</TableCell>
                    <TableCell>الفترة</TableCell>
                    <TableCell>الإجراء</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {historyLog.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>{h.date}</TableCell>
                      <TableCell>{h.startTime} - {h.endTime}</TableCell>
                      <TableCell>{timeZoneLabel(h.zone)}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={h.action === 'CANCELLED' ? 'error' : h.action === 'REACTIVATED' ? 'success' : 'info'}
                          label={
                            h.action === 'CANCELLED' ? 'ملغاة' :
                            h.action === 'REACTIVATED' ? 'أعيد تفعيلها' : 'أضيفت'
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryOpen(false)}>إغلاق</Button>
          {historyLog.length > 0 && (
            <Button
              color="error"
              onClick={() => {
                localStorage.removeItem(HISTORY_KEY);
                setHistoryLog([]);
              }}
            >
              مسح السجل
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
};
