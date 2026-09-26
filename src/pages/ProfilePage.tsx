import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  CircularProgress,
  Paper,
  TextField,
  Typography,
  Alert,
  IconButton,
  Divider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';

export const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { session, markPasswordChanged } = useAuthStore();
  const isAdmin = session?.role === 'ADMIN';

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [username, setUsername] = React.useState(session?.username ?? '');
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [record, setRecord] = React.useState<any>(null);

  React.useEffect(() => {
    const load = async () => {
      if (isAdmin || !session) {
        setLoading(false);
        return;
      }
      try {
        const endpoint = session.role === 'DOCTOR' ? '/api/doctors/me' : '/api/secretaries/me';
        const res = await api.get(endpoint);
        const me: any = res.data;
        if (me) {
          setRecord(me);
          setName(me.name ?? '');
          setPhone(me.phone ?? '');
          setUsername(me.username ?? session.username);
        }
      } catch (err: any) {
        setError(err.message || 'فشل تحميل بياناتك');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isAdmin, session]);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(false);

    if (!isAdmin && !name.trim()) {
      setError('الرجاء إدخال الاسم');
      return;
    }

    const changingPassword = newPassword.length > 0;
    if (changingPassword) {
      if (!isAdmin && !currentPassword) {
        setError('الرجاء إدخال كلمة المرور الحالية');
        return;
      }
      if (newPassword.length < 8) {
        setError('يجب أن تكون كلمة المرور الجديدة 8 أحرف على الأقل');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('كلمتا المرور غير متطابقتين');
        return;
      }
    }

    if (isAdmin && !changingPassword) {
      setError('لا توجد تغييرات للحفظ — يمكن للإدارة فقط تغيير كلمة المرور هنا');
      return;
    }

    setSaving(true);
    try {
      if (isAdmin) {
        if (changingPassword) {
          await api.post('/api/admin/change-password', {
            username: session?.username,
            password: newPassword,
          });
        }
      } else {
        const endpoint = session?.role === 'DOCTOR' ? '/api/doctors/me' : '/api/secretaries/me';
        if (!isAdmin && changingPassword) {
          await api.post('/api/auth/complete-password-change', {
            userType: session?.role?.toLowerCase(),
            userId: record?.id,
            currentPassword,
            newPassword,
          });
        }
        if (!isAdmin) {
          await api.put(endpoint, {
            name: name.trim(),
            phone: phone.trim(),
          });
        }
      }
      if (changingPassword) markPasswordChanged();
      setSuccess(true);
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
    } catch (err: any) {
      setError(`فشل الحفظ: ${err.message || 'خطأ غير معروف'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <IconButton onClick={() => navigate(-1)} size="small" title="رجوع">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>تحديث البيانات</Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, mr: 6 }}>
        تحديث معلومات الحساب الشخصي
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>تم تحديث البيانات بنجاح!</Alert>}

      <Paper sx={{ p: 3, maxWidth: 520 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {!isAdmin && (
              <>
                <TextField
                  label="الاسم *"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  fullWidth
                  size="small"
                  required
                />
                <TextField
                  label="رقم الهاتف"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  fullWidth
                  size="small"
                />
                <TextField
                  label="اسم المستخدم"
                  value={username}
                  onChange={() => {}}
                  fullWidth
                  size="small"
                  disabled
                  helperText="لا يمكن تغيير اسم المستخدم"
                />
              </>
            )}

            {isAdmin && (
              <TextField
                label="اسم المستخدم"
                value={username}
                onChange={() => {}}
                fullWidth
                size="small"
                disabled
                helperText="مالك العيادة — لا يمكن تغيير اسم المستخدم"
              />
            )}

            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" color="text.secondary">
              تغيير كلمة المرور
            </Typography>

            {!isAdmin && (
              <TextField
                label="كلمة المرور الحالية"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                fullWidth
                size="small"
                helperText="مطلوبة فقط إذا كنت تغيّر كلمة المرور"
              />
            )}
            <TextField
              label="كلمة المرور الجديدة"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              fullWidth
              size="small"
              helperText="8 أحرف على الأقل — اتركها فارغة إذا كنت لا تريد التغيير"
            />
            <TextField
              label="تأكيد كلمة المرور"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              fullWidth
              size="small"
            />

            <Button variant="contained" onClick={handleSubmit} disabled={saving} sx={{ alignSelf: 'flex-start', mt: 1 }}>
              {saving ? <CircularProgress size={20} /> : 'حفظ التغييرات'}
            </Button>
          </Box>
        )}
      </Paper>
    </Box>
  );
};
