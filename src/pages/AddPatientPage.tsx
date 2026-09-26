import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  TextField, Button, Typography, Box, Paper,
  FormControl, InputLabel, Select, MenuItem,
  FormHelperText, Alert, CircularProgress,
} from '@mui/material';
import { api } from '../lib/api';

export const AddPatientPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const isEdit = !!editId;
  const [loading, setLoading] = React.useState(isEdit);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [form, setForm] = React.useState({
    name: '',
    phone: '',
    age: '',
    gender: '',
    diagnosis: '',
    heightCm: '',
    weightKg: '',
    isPregnant: false,
    pregnancyWeeks: '',
    allergies: '',
    chronicConditions: '',
    notes: '',
    followUpDate: '',
  });

  const nameRef = React.useRef<HTMLInputElement>(null);
  const phoneRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const res = await api.get(`/api/patients/${editId}`);
        const p = res.data ?? {};
        setForm({
          name: p.name ?? '',
          phone: p.phone ?? '',
          age: p.age != null ? String(p.age) : '',
          gender: p.gender ?? '',
          diagnosis: p.diagnosis ?? '',
          heightCm: p.heightCm != null ? String(p.heightCm) : '',
          weightKg: p.weightKg != null ? String(p.weightKg) : '',
          isPregnant: !!p.isPregnant,
          pregnancyWeeks: p.pregnancyWeeks != null ? String(p.pregnancyWeeks) : '',
          allergies: p.allergies ?? '',
          chronicConditions: p.chronicConditions ?? '',
          notes: p.notes ?? '',
          followUpDate: p.followUpDate ?? '',
        });
      } catch (err: any) {
        setError(err.message || 'فشل تحميل بيانات المريض');
      } finally {
        setLoading(false);
      }
    })();
  }, [editId]);

  const handleChange = (field: string, value: any) => {
    // pregnancyWeeks is the single source of truth for isPregnant — a patient
    // with a week count selected IS pregnant; the separate boolean was previously
    // sent to the server but never set from any control.
    if (field === 'pregnancyWeeks') {
      setForm((prev) => ({ ...prev, pregnancyWeeks: value, isPregnant: !!value }));
      return;
    }
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const validate = (): Record<string, string> => {
    const fe: Record<string, string> = {};
    const name = form.name.trim();
    if (!name) fe.name = 'الرجاء إدخال اسم المريض';
    else if (name.length > 200) fe.name = 'الاسم لا يمكن أن يتجاوز 200 حرف';
    const phone = form.phone.trim();
    if (!phone) fe.phone = 'الرجاء إدخال رقم الهاتف';
    else if (!/^\+?[0-9\s\-()]+$/.test(phone)) fe.phone = 'رقم الهاتف غير صالح — يُسمح بالأرقام والمسافات والشرطات والأقواس فقط';
    if (form.age && !Number.isFinite(Number(form.age))) fe.age = 'العمر يجب أن يكون رقماً';
    else if (form.age) {
      const age = Number(form.age);
      if (age < 0 || age > 150) fe.age = 'العمر يجب أن يكون بين 0 و 150 سنة';
    }
    if (form.heightCm && !Number.isFinite(Number(form.heightCm))) fe.heightCm = 'الطول يجب أن يكون رقماً';
    else if (form.heightCm) {
      const h = Number(form.heightCm);
      if (h < 1 || h > 300) fe.heightCm = 'الطول يجب أن يكون بين 1 و 300 سم';
    }
    if (form.weightKg && !Number.isFinite(Number(form.weightKg))) fe.weightKg = 'الوزن يجب أن يكون رقماً';
    else if (form.weightKg) {
      const w = Number(form.weightKg);
      if (w < 1 || w > 500) fe.weightKg = 'الوزن يجب أن يكون بين 1 و 500 كغ';
    }
    if (form.pregnancyWeeks && form.gender.trim().toLowerCase() !== 'female') {
      fe.pregnancyWeeks = 'فترة الحمل تُحدد فقط للمرضى الإناث';
    }
    if (form.followUpDate) {
      const maxPast = new Date();
      maxPast.setFullYear(maxPast.getFullYear() - 1);
      const fu = new Date(form.followUpDate + 'T00:00:00');
      if (fu < maxPast) fe.followUpDate = 'تاريخ المتابعة لا يمكن أن يكون قبل أكثر من سنة';
    }
    return fe;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const fieldErrors = validate();
    setFieldErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      if (fieldErrors.name) { nameRef.current?.focus(); }
      else if (fieldErrors.phone) { phoneRef.current?.focus(); }
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        age: form.age ? Number(form.age) : undefined,
        heightCm: form.heightCm ? Number(form.heightCm) : undefined,
        weightKg: form.weightKg ? Number(form.weightKg) : undefined,
        pregnancyWeeks: form.pregnancyWeeks ? Number(form.pregnancyWeeks) : undefined,
        isPregnant: form.isPregnant,
      };
      if (editId) {
        await api.put(`/api/patients/${editId}`, payload);
      } else {
        await api.post('/api/patients', payload);
      }
      navigate(editId ? `/patients/${editId}` : '/patients', { replace: true });
    } catch (err: any) {
      setError(err.message || (isEdit ? 'فشل تحديث المريض' : 'فشل إضافة المريض'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const fe = fieldErrors;

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 700 }}>
        {isEdit ? 'تعديل بيانات المريض' : 'إضافة مريض جديد'}
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Paper sx={{ p: 3 }}>
        <Box component="form" onSubmit={handleSubmit} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="الاسم"
            value={form.name}
            onChange={(e) => handleChange('name', e.target.value)}
            inputRef={nameRef}
            error={!!fe.name}
            helperText={fe.name}
            fullWidth
            required
          />
          <TextField
            label="الهاتف"
            value={form.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            inputRef={phoneRef}
            error={!!fe.phone}
            helperText={fe.phone}
            fullWidth
            required
          />
          <TextField label="العمر" type="number" value={form.age} onChange={(e) => handleChange('age', e.target.value)} error={!!fe.age} helperText={fe.age} fullWidth />
          <FormControl fullWidth error={!!fe.gender}>
            <InputLabel>الجنس</InputLabel>
            <Select value={form.gender} onChange={(e) => handleChange('gender', e.target.value)} label="الجنس">
              <MenuItem value="male">ذكر</MenuItem>
              <MenuItem value="female">أنثى</MenuItem>
            </Select>
            {fe.gender && <FormHelperText>{fe.gender}</FormHelperText>}
          </FormControl>
          <TextField label="التشخيص" value={form.diagnosis} onChange={(e) => handleChange('diagnosis', e.target.value)} fullWidth multiline rows={2} />
          <TextField label="الطول (سم)" type="number" value={form.heightCm} onChange={(e) => handleChange('heightCm', e.target.value)} error={!!fe.heightCm} helperText={fe.heightCm} fullWidth />
          <TextField label="الوزن (كغ)" type="number" value={form.weightKg} onChange={(e) => handleChange('weightKg', e.target.value)} error={!!fe.weightKg} helperText={fe.weightKg} fullWidth />
          <FormControl fullWidth error={!!fe.pregnancyWeeks}>
            <InputLabel>فترة الحمل</InputLabel>
            <Select value={form.pregnancyWeeks} onChange={(e) => handleChange('pregnancyWeeks', e.target.value)} label="فترة الحمل">
              <MenuItem value="">غير حامل</MenuItem>
              {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40].map((w) => (
                <MenuItem key={w} value={w}>{w} أسابيع</MenuItem>
              ))}
            </Select>
            {fe.pregnancyWeeks && <FormHelperText>{fe.pregnancyWeeks}</FormHelperText>}
          </FormControl>
          <TextField label="الحساسيات" value={form.allergies} onChange={(e) => handleChange('allergies', e.target.value)} fullWidth multiline rows={2} />
          <TextField label="الأمراض المزمنة" value={form.chronicConditions} onChange={(e) => handleChange('chronicConditions', e.target.value)} fullWidth multiline rows={2} />
          <TextField label="ملاحظات" value={form.notes} onChange={(e) => handleChange('notes', e.target.value)} fullWidth multiline rows={3} />
          <TextField label="تاريخ المتابعة" type="date" value={form.followUpDate} onChange={(e) => handleChange('followUpDate', e.target.value)} error={!!fe.followUpDate} helperText={fe.followUpDate} fullWidth InputLabelProps={{ shrink: true }} />
          <Button type="submit" variant="contained" fullWidth size="large" disabled={saving}>
            {saving ? <CircularProgress size={24} /> : isEdit ? 'حفظ التعديلات' : 'حفظ'}
          </Button>
        </Box>
      </Paper>
    </Box>
  );
};
