import React from 'react';
import { Box, Button, CircularProgress, Paper, TextField, Typography, Alert } from '@mui/material';
import { api } from '../lib/api';
import { invalidateClinicProfile } from '../lib/clinicProfile';

const fields: { key: string; label: string; type?: string; helper?: string; multiline?: boolean }[] = [
  { key: 'clinicName', label: 'اسم العيادة', helper: 'يظهر في ترويسة جميع المستندات والتقارير' },
  { key: 'address', label: 'العنوان', multiline: true },
  { key: 'phone', label: 'رقم الهاتف' },
  { key: 'email', label: 'البريد الإلكتروني' },
  { key: 'license', label: 'رقم الترخيص', helper: 'يظهر في توقيع الوصفة الطبية' },
  { key: 'doctorName', label: 'اسم الطبيب', helper: 'يظهر في توقيع الوصفة الطبية' },
  { key: 'doctorTitle', label: 'التخصص / اللقب', helper: 'مثال: استشاري باطنة' },
];

export const ClinicProfilePage: React.FC = () => {
  const [form, setForm] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  React.useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get<any>('/api/clinic-profile');
        const data = res.data && typeof res.data === 'object' ? res.data : {};
        setForm({
          clinicName: data.clinicName ?? '',
          address: data.address ?? '',
          phone: data.phone ?? '',
          email: data.email ?? '',
          license: data.license ?? '',
          doctorName: data.doctorName ?? '',
          doctorTitle: data.doctorTitle ?? '',
        });
      } catch (err: any) {
        setError(err.message || 'فشل تحميل بيانات العيادة');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const set = (key: string, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSuccess(false);
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      await api.put('/api/clinic-profile', form);
      invalidateClinicProfile();
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'فشل حفظ بيانات العيادة');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 620 }}>
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>بيانات العيادة</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        اسم العيادة والطبيب المستخدم في المستندات والتقارير المطبوعة — تظهر الحقول الفارغة فقط إن تُركت فارغة
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(false)}>تم حفظ بيانات العيادة بنجاح</Alert>}

      <Paper sx={{ p: 3 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {fields.map((f) => (
              <TextField
                key={f.key}
                label={f.label}
                value={form[f.key] ?? ''}
                onChange={(e) => set(f.key, e.target.value)}
                fullWidth
                size="small"
                multiline={f.multiline}
                minRows={f.multiline ? 2 : undefined}
                helperText={f.helper}
              />
            ))}
            <Button variant="contained" onClick={handleSave} disabled={saving} sx={{ alignSelf: 'flex-start', mt: 1 }}>
              {saving ? <CircularProgress size={20} /> : 'حفظ بيانات العيادة'}
            </Button>
          </Box>
        )}
      </Paper>
    </Box>
  );
};
