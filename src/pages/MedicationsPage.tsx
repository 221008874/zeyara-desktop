import React from 'react';
import {
  Typography,
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Alert,
  CircularProgress,
  Chip,
} from '@mui/material';
import { offlineGet, offlineWrite } from '../lib/offlineDb';
import { useSseRefresh } from '../lib/useSseRefresh';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { EmptyState } from '../design-system/EmptyState';
import { todayISO } from '../lib/format';
import { useAuthStore } from '../stores/auth';
import MedicationIcon from '@mui/icons-material/Medication';

export const MedicationsPage: React.FC = () => {
  const { session } = useAuthStore();
  const isClinician = session?.role === 'ADMIN' || session?.role === 'DOCTOR';

  const [medications, setMedications] = React.useState<any[]>([]);
  const [patients, setPatients] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [statusMsg, setStatusMsg] = React.useState<string | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);

  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    patientId: '',
    drugName: '',
    dosage: '',
    frequency: '',
    duration: '',
    instructions: '',
    startDate: todayISO(),
  });

  const [busyId, setBusyId] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await offlineGet('/api/medications');
      setMedications(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setStatusError(err.message || 'فشل تحميل الأدوية');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    offlineGet('/api/patients')
      .then((data) => setPatients(Array.isArray(data) ? data : []))
      .catch(() => { /* ignore */ });
  }, [load]);

  useSseRefresh(load);

  const patientName = (id: number) => {
    const p = patients.find((x) => Number(x.id) === Number(id));
    return p?.name ?? `#${id}`;
  };

  const openForm = () => {
    setForm({
      patientId: '',
      drugName: '',
      dosage: '',
      frequency: '',
      duration: '',
      instructions: '',
      startDate: todayISO(),
    });
    setOpen(true);
  };

  const handleSubmit = async () => {
    setStatusError(null);
    setStatusMsg(null);
    if (!form.patientId) {
      setStatusError('الرجاء اختيار المريض');
      return;
    }
    if (!form.drugName.trim()) {
      setStatusError('الرجاء إدخال اسم الدواء');
      return;
    }
    setSaving(true);
    try {
      const res = await offlineWrite('POST', '/api/medications', {
        patientId: Number(form.patientId),
        drugName: form.drugName.trim(),
        dosage: form.dosage.trim() || undefined,
        frequency: form.frequency.trim() || undefined,
        duration: form.duration.trim() || undefined,
        instructions: form.instructions.trim() || undefined,
        startDate: form.startDate || undefined,
        status: 'Active',
      });
      setStatusMsg(res.queued
        ? `أنت غير متصل. تمت جدولة وصف ${form.drugName.trim()} وسيُحفظ عند استعادة الاتصال`
        : `تم وصف الدواء لـ ${patientName(Number(form.patientId))}`);
      setOpen(false);
      load();
    } catch (err: any) {
      setStatusError(err.message || 'فشل حفظ الدواء');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (m: any, status: string) => {
    setBusyId(m.id);
    setStatusError(null);
    setStatusMsg(null);
    try {
      const res = await offlineWrite('PUT', `/api/medications/${m.id}`, { status });
      if (res.queued) {
        setStatusMsg(`أنت غير متصل. تمت جدولة ${status === 'Stopped' ? 'إيقاف' : 'إعادة تفعيل'} ${m.drugName}`);
      } else {
        setStatusMsg(status === 'Stopped'
          ? `تم إيقاف ${m.drugName}`
          : `تم إعادة تفعيل ${m.drugName}`);
      }
      load();
    } catch (err: any) {
      setStatusError(err.message || 'فشل تحديث الحالة');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>الأدوية</Typography>
          <Typography variant="body2" color="text.secondary">إدارة الأدوية الموصوفة للمرضى</Typography>
        </Box>
        {isClinician && (
          <Button variant="contained" startIcon={<MedicationIcon />} onClick={openForm}>وصف دواء جديد</Button>
        )}
      </Box>

      {statusMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setStatusMsg(null)}>{statusMsg}</Alert>}
      {statusError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setStatusError(null)}>{statusError}</Alert>}

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>الدواء</TableCell>
                <TableCell>المريض</TableCell>
                <TableCell>الجرعة</TableCell>
                <TableCell>التكرار</TableCell>
                <TableCell>المدة</TableCell>
                <TableCell>تعليمات</TableCell>
                <TableCell>تاريخ البدء</TableCell>
                <TableCell>الحالة</TableCell>
                {isClinician && <TableCell>إجراءات</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableSkeleton cols={isClinician ? 9 : 8} />
              ) : medications.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isClinician ? 9 : 8} sx={{ border: 0, p: 0 }}>
                    <EmptyState title="لا توجد أدوية" hint="لم يتم تسجيل أي أدوية بعد." />
                  </TableCell>
                </TableRow>
              ) : (
                medications.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.drugName}</TableCell>
                    <TableCell>{patientName(m.patientId)}</TableCell>
                    <TableCell>{m.dosage ?? '-'}</TableCell>
                    <TableCell>{m.frequency ?? '-'}</TableCell>
                    <TableCell>{m.duration ? `${m.duration} يوم` : '-'}</TableCell>
                    <TableCell>{m.instructions ?? '-'}</TableCell>
                    <TableCell>{m.startDate ?? '-'}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={m.status === 'Stopped' || m.status === 'Inactive' ? 'default' : 'success'}
                        label={m.status === 'Stopped' ? 'موقوف' : m.status === 'Inactive' ? 'غير نشط' : 'نشط'}
                      />
                    </TableCell>
                    {isClinician && (
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {(m.status === 'Stopped' || m.status === 'Inactive') ? (
                            <Button size="small" variant="outlined" disabled={busyId === m.id} onClick={() => setStatus(m, 'Active')}>
                              {busyId === m.id ? <CircularProgress size={16} /> : 'إعادة تفعيل'}
                            </Button>
                          ) : (
                            <Button size="small" variant="outlined" color="error" disabled={busyId === m.id} onClick={() => setStatus(m, 'Stopped')}>
                              {busyId === m.id ? <CircularProgress size={16} /> : 'إيقاف'}
                            </Button>
                          )}
                        </Box>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={open} onClose={() => !saving && setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>وصف دواء جديد</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <FormControl fullWidth required>
              <InputLabel>المريض *</InputLabel>
              <Select
                value={form.patientId}
                label="المريض *"
                onChange={(e) => setForm((f) => ({ ...f, patientId: e.target.value }))}
              >
                {patients.map((p) => (
                  <MenuItem key={p.id} value={String(p.id)}>{p.name} ({p.phone})</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="اسم الدواء *"
              value={form.drugName}
              onChange={(e) => setForm((f) => ({ ...f, drugName: e.target.value }))}
              fullWidth
              required
            />
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <TextField
                label="الجرعة"
                value={form.dosage}
                onChange={(e) => setForm((f) => ({ ...f, dosage: e.target.value }))}
                sx={{ flex: 1, minWidth: 140 }}
              />
              <TextField
                label="التكرار"
                value={form.frequency}
                onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
                sx={{ flex: 1, minWidth: 140 }}
              />
              <TextField
                label="المدة (أيام)"
                value={form.duration}
                onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                sx={{ flex: 1, minWidth: 140 }}
              />
            </Box>
            <TextField
              label="تاريخ البدء"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="تعليمات"
              value={form.instructions}
              onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
              fullWidth
              multiline
              minRows={2}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={saving}>إلغاء</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : 'حفظ'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
