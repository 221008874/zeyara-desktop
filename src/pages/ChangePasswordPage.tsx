import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TextField, Button, Typography, Box, Paper,
  Alert, CircularProgress,
} from '@mui/material';
import { useAuthStore } from '../stores/auth';
import { api } from '../lib/api';

export const ChangePasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const { session, markPasswordChanged } = useAuthStore();
  const isAdmin = session?.role === 'ADMIN';
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('يجب أن تكون كلمة المرور الجديدة 8 أحرف على الأقل');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين');
      return;
    }
    if (!currentPassword) {
      setError('الرجاء إدخال كلمة المرور الحالية');
      return;
    }
    setLoading(true);
    try {
      if (isAdmin) {
        await api.post('/api/admin/change-password', {
          username: session?.username,
          password: newPassword,
          currentPassword,
        });
      } else {
        const endpoint = session?.role === 'DOCTOR' ? '/api/doctors/me' : '/api/secretaries/me';
        const res = await api.get(endpoint);
        const me: any = res.data;
        if (me?.id == null) throw new Error('لم يتم العثور على حسابك');
        await api.post('/api/auth/complete-password-change', {
          userType: session?.role?.toLowerCase(),
          userId: me.id,
          currentPassword,
          newPassword,
        });
      }
      markPasswordChanged();
      setSuccess(true);
      setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
    } catch (err: any) {
      setError(err.message || 'فشل تغيير كلمة المرور');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', bgcolor: 'background.default', direction: 'rtl', p: 3 }}>
      <Paper elevation={3} sx={{ p: 4, width: 400, borderRadius: 2 }}>
        <Typography variant="h6" align="center" sx={{ mb: 3 }}>
          تغيير كلمة المرور
        </Typography>
        {success ? (
          <Alert severity="success">تم تغيير كلمة المرور بنجاح</Alert>
        ) : (
          <>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            <Box component="form" onSubmit={handleSubmit} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="كلمة المرور الحالية"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                fullWidth
                required
              />
              <TextField
                label="كلمة المرور الجديدة"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                fullWidth
                required
                helperText="8 أحرف على الأقل"
              />
              <TextField
                label="تأكيد كلمة المرور"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                fullWidth
                required
              />
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={loading}
              >
                {loading ? <CircularProgress size={24} /> : 'تغيير كلمة المرور'}
              </Button>
            </Box>
          </>
        )}
      </Paper>
    </Box>
  );
};
