import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  TextField, Button, Typography, Box, Paper,
  FormControl, InputLabel, Select, MenuItem,
  Alert, CircularProgress,
} from '@mui/material';
import { api } from '../lib/api';
import { todayISO } from '../lib/format';

export const AddAppointmentPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefillId = searchParams.get('patientId');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const patientIdRef = React.useRef<HTMLInputElement>(null);
  const dateRef = React.useRef<HTMLInputElement>(null);
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
    setLoading(true);
    try {
      const payload = {
        ...form,
        patientId,
        requiredAmount: form.requiredAmount ? Number(form.requiredAmount) : undefined,
      };
      await api.post('/api/appointments', payload);
      navigate('/appointments', { replace: true });
    } catch (err: any) {
      setError(err.message || 'فشل حفظ الموعد');
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
      <Paper sx={{ p: 3 }}>
        <Box component="form" onSubmit={handleSubmit} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="رقم المريض"
            type="number"
            value={form.patientId}
            onChange={(e) => handleChange('patientId', e.target.value)}
            inputRef={patientIdRef}
            error={!!fieldErrors.patientId}
            helperText={fieldErrors.patientId}
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
          <Button type="submit" variant="contained" fullWidth size="large" disabled={loading}>
            {loading ? <CircularProgress size={24} /> : 'حفظ الموعد'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
};

