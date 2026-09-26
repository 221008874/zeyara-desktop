import React, { useState } from 'react';
import {
  TextField, Button, Typography, Box, Paper,
  Alert, CircularProgress,
} from '@mui/material';
import { useLicenseStore } from '../stores/license';

export const LicenseScreen: React.FC = () => {
  const { status, activate, check } = useLicenseStore();
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleActivate = async () => {
    setLoading(true);
    setError(null);
    try {
      await activate(key);
    } catch (err: any) {
      setError(err.message || 'فشل التفعيل');
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async () => {
    setLoading(true);
    setError(null);
    try {
      await check();
    } catch (err: any) {
      setError(err.message || 'فشل التحقق');
    } finally {
      setLoading(false);
    }
  };

  if (status?.locked && status?.serverOnline && status.reason) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', bgcolor: 'background.default', direction: 'rtl', p: 3 }}>
        <Paper elevation={3} sx={{ p: 4, width: 420, textAlign: 'center', borderRadius: 2 }}>
          <Typography variant="h5" color="error" sx={{ mb: 2 }}>النظام مقفول</Typography>
          <Alert severity="warning" sx={{ mb: 2, textAlign: 'start' }}>{status.reason}</Alert>
          {status.expiryDate && (
            <Alert
              severity={status.daysUntilExpiry != null && status.daysUntilExpiry < 0 ? 'error' : status.daysUntilExpiry != null && status.daysUntilExpiry <= 7 ? 'warning' : 'info'}
              sx={{ mb: 2, textAlign: 'start' }}
            >
              تاريخ انتهاء الترخيص: {status.expiryDate}
              {status.daysUntilExpiry != null && ` — متبقي ${status.daysUntilExpiry} يوم`}
            </Alert>
          )}
          <TextField
            label="مفتاح الترخيص"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            fullWidth
            margin="normal"
          />
          <Button variant="contained" fullWidth size="large" onClick={handleActivate} disabled={loading || !key.trim()}>
            {loading ? <CircularProgress size={24} /> : 'تفعيل الترخيص'}
          </Button>
          <Button variant="text" fullWidth onClick={handleRetry} disabled={loading} sx={{ mt: 1 }}>
            إعادة المحاولة
          </Button>
          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', bgcolor: 'background.default', direction: 'rtl', p: 3 }}>
      <Paper elevation={3} sx={{ p: 4, width: 420, borderRadius: 2 }}>
        <Typography variant="h5" align="center" sx={{ mb: 3, fontWeight: 700, color: 'primary.main' }}>
          تفعيل الترخيص
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {status?.serverOnline === false && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            لا يمكن الوصول إلى الخادم. تأكد من أن خادم العيادة يعمل وأن جهازك على نفس الشبكة.
          </Alert>
        )}
        <TextField
          label="مفتاح الترخيص"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          fullWidth
          margin="normal"
          placeholder="أدخل مفتاح الترخيص"
        />
        <Button
          variant="contained"
          fullWidth
          size="large"
          onClick={handleActivate}
          disabled={loading || !key.trim()}
          sx={{ mt: 2 }}
        >
          {loading ? <CircularProgress size={24} /> : 'تفعيل'}
        </Button>
      </Paper>
    </Box>
  );
};
