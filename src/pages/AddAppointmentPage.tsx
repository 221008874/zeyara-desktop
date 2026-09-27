import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  TextField, Button, Typography, Box, Paper,
  FormControl, InputLabel, Select, MenuItem,
  Alert, CircularProgress,
} from '@mui/material';
import { api } from '../lib/api';
import { createAppointment } from '../lib/clinicalActions';
import { todayISO } from '../lib/format';

export const AddAppointmentPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillId = searchParams.get('patientId');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Set when the server rejects a double booking, so the message can be shown in
  // place of the generic failure text instead of being swallowed by err.message.
  const [conflict, setConflict] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [checking, setChecking] = React.useState(false);
  const patientIdRef = React.useRef<HTMLInputElement>(null);
  const dateRef = React.useRef<HTMLInputElement>(null);
  // Appointment type + zone of any active booking found for this patient, used to
  // name the clash the way the retired JavaFX secretary client did.
  const [activeClash, setActiveClash] = React.useState<{ category: string; date: string; timeZone: string } | null>(null);
  const [form, setForm] = React.useState({
    patientId: prefillId ? String(prefillId) : '',
    date: '',
    timeZone: 'MORNING',
    category: 'EXAMINATION',
    notes: '',
    requiredAmount: '',
  });

  const handleChange = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const activeTypeLabel = (category?: string) =>
    category === 'FOLLOW_UP' ? 'متابعة' : 'كشف';

  const zoneLabel = (zone?: string) =>
    zone === 'MORNING' ? 'صباحاً' : zone === 'AFTERNOON' ? 'بعد الظهر' : 'مساءً';

  /**
   * Looks for an existing SCHEDULED/MOVED appointment for this patient.
   *
   * The server enforces this too (POST /api/appointments returns 400 with a clash
   * message). This client-side pass exists so the receptionist gets the warning
   * before submitting, and so the clash is named with its type, date and zone —
   * the behaviour the retired JavaFX secretary client had. It is a convenience,
   * not the boundary: the server check is authoritative.
   */
  const findActiveClash = React.useCallback(async (patientId: number) => {
    setChecking(true);
    try {
      const res = await api.get('/api/appointments');
      const all: any[] = Array.isArray(res.data) ? res.data : [];
      const active = all.find(
        (a) =>
          Number(a.patientId) === patientId &&
          (a.status === 'SCHEDULED' || a.status === 'MOVED'),
      );
      setActiveClash(
        active
          ? {
              category: active.category ?? 'EXAMINATION',
              date: active.date ?? '',
              timeZone: active.timeZone ?? '',
            }
          : null,
      );
    } catch {
      // A failed pre-check must not block booking; the server still guards it.
      setActiveClash(null);
    } finally {
      setChecking(false);
    }
  }, []);

  // Re-check whenever the patient id becomes a valid number.
  React.useEffect(() => {
    const id = Number(form.patientId);
    if (form.patientId && Number.isFinite(id) && id > 0) {
      findActiveClash(id);
    } else {
      setActiveClash(null);
    }
  }, [form.patientId, findActiveClash]);

const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const fe: Record<string, string> = {};
    const patientId = Number(form.patientId);
    if (!form.patientId || !Number.isFinite(patientId) || patientId <= 0) {
      fe.patientId = 'الرجاء إدخال رقم مريض صحيح';
    }
    if (!form.date) {
      fe.date = 'الرجاء اختيار التاريخ';
    } else if (form.date < todayISO()) {
      fe.date = 'لا يمكن حجز موعد في تاريخ ماضٍ';
    }
    setFieldErrors(fe);
    if (Object.keys(fe).length > 0) {
      if (fe.patientId) patientIdRef.current?.focus();
      else if (fe.date) dateRef.current?.focus();
      return;
    }
    // Block in the UI as well as on the server, so an accidental double booking
    // never reaches the API.
    if (activeClash) {
      setConflict(
        `المريض لديه بالفعل موعد ${activeTypeLabel(activeClash.category)} في ` +
          `${activeClash.date} (${zoneLabel(activeClash.timeZone)}). ` +
          'قم بإلغاء الموعد الحالي أو تعديله قبل حجز موعد آخر.',
      );
      return;
    }
    setConflict(null);
    setLoading(true);
    try {
      const payload = {
        ...form,
        patientId,
        requiredAmount: form.requiredAmount ? Number(form.requiredAmount) : undefined,
      };
      // Goes through the shared helper so this screen and the post-examination follow-up
      // cannot drift into two different appointment-creation contracts.
      await createAppointment(payload);
      navigate('/appointments', { replace: true });
    } catch (err: any) {
      // The server's clash message is more specific than the generic fallback, so
      // surface it verbatim when present.
      const message = err?.response?.data?.message || err?.message;
      if (typeof message === 'string' && /already has an active/i.test(message)) {
        setConflict(message);
      } else {
        setError(message || 'فشل حفظ الموعد');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 700 }}>
        إضافة موعد
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {conflict && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setConflict(null)}>
          {conflict}
        </Alert>
      )}
      <Paper sx={{ p: 3 }}>
        <Box component="form" onSubmit={handleSubmit} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="رقم المريض"
            type="number"
            value={form.patientId}
            onChange={(e) => handleChange('patientId', e.target.value)}
            inputRef={patientIdRef}
            error={!!fieldErrors.patientId}
            helperText={
              fieldErrors.patientId ||
              (checking
                ? 'جارٍ التحقق من مواعيد المريض…'
                : activeClash
                  ? `يوجد موعد ${activeTypeLabel(activeClash.category)} في ${activeClash.date} (${zoneLabel(activeClash.timeZone)})`
                  : ' ')
            }
            fullWidth
            required
          />
          <TextField
            label="التاريخ"
            type="date"
            value={form.date}
            onChange={(e) => handleChange('date', e.target.value)}
            inputRef={dateRef}
            error={!!fieldErrors.date}
            helperText={fieldErrors.date}
            fullWidth
            InputLabelProps={{ shrink: true }}
            required
          />
          <FormControl fullWidth>
            <InputLabel>الفترة</InputLabel>
            <Select value={form.timeZone} onChange={(e) => handleChange('timeZone', e.target.value)} label="الفترة">
              <MenuItem value="MORNING">صباحاً</MenuItem>
              <MenuItem value="AFTERNOON">بعد الظهر</MenuItem>
              <MenuItem value="NIGHT">مساءً</MenuItem>
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>الفئة</InputLabel>
            <Select value={form.category} onChange={(e) => handleChange('category', e.target.value)} label="الفئة">
              <MenuItem value="EXAMINATION">كشف</MenuItem>
              <MenuItem value="FOLLOW_UP">متابعة</MenuItem>
            </Select>
          </FormControl>
          <TextField label="المبلغ المطلوب" type="number" value={form.requiredAmount} onChange={(e) => handleChange('requiredAmount', e.target.value)} fullWidth />
          <TextField label="ملاحظات" value={form.notes} onChange={(e) => handleChange('notes', e.target.value)} fullWidth multiline rows={3} />
          <Button type="submit" variant="contained" fullWidth size="large" disabled={loading || checking || !!activeClash}>
            {loading ? <CircularProgress size={24} /> : 'حفظ الموعد'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
};

