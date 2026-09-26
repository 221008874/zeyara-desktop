import React from 'react';
import { Typography, Box, Paper, TextField, Button, FormControl, InputLabel, Select, MenuItem, Alert } from '@mui/material';
import { useSettingsStore } from '../stores/settings';
import { useAuthStore } from '../stores/auth';
import { getBaseUrl, probeServer, resetServerBaseUrl, setServerBaseUrl } from '../lib/api';

export const SettingsPage: React.FC = () => {
  const { theme, setTheme, serverHost, serverPort, setServerConfig } = useSettingsStore();
  const { session, logout } = useAuthStore();
  const [host, setHost] = React.useState(serverHost);
  const [port, setPort] = React.useState(serverPort);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = React.useState(false);

  const refreshNotificationBus = () => {
    import('../lib/notificationBus')
      .then((m) => m.notificationBus.refresh())
      .catch(() => {});
  };

  const handleTestConnection = async () => {
    const h = host.trim();
    const p = port.trim();
    const portNum = Number(p);
    if (!h || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setTestResult({ ok: false, text: 'أدخل عنواناً ومنفذاً صالحين (1-65535).' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const probe = await probeServer(h, p);
      if (probe.ok) {
        setServerBaseUrl(h, p);
        setServerConfig(h, p);
        refreshNotificationBus();
        setTestResult({ ok: true, text: `تم الاتصال بالخادم ${h}:${p} وتطبيقه.` });
      } else {
        setTestResult({ ok: false, text: 'فشل الاتصال: ' + probe.message });
      }
    } finally {
      setTesting(false);
    }
  };

  const handleResetServer = () => {
    resetServerBaseUrl();
    setServerConfig('localhost', '8081');
    setHost('localhost');
    setPort('8081');
    refreshNotificationBus();
    setTestResult({ ok: true, text: 'تمت استعادة الخادم الافتراضي (localhost:8081).' });
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 700 }}>الإعدادات</Typography>
      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>المظهر</Typography>
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>المظهر</InputLabel>
          <Select value={theme} onChange={(e) => setTheme(e.target.value as any)} label="المظهر">
            <MenuItem value="light">فاتح</MenuItem>
            <MenuItem value="dark">داكن</MenuItem>
          </Select>
        </FormControl>
      </Paper>

      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>إعدادات الخادم</Typography>
        <Typography variant="caption" sx={{ display: 'block', mb: 2, color: '#6B7280' }}>
          الخادم الحالي: {getBaseUrl()}
        </Typography>
        <TextField label="عنوان الخادم" value={host} onChange={(e) => setHost(e.target.value)} fullWidth size="small" sx={{ mb: 1 }} />
        <TextField label="المنفذ" value={port} onChange={(e) => setPort(e.target.value)} fullWidth size="small" sx={{ mb: 2 }} />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" onClick={handleTestConnection} disabled={testing}>
            {testing ? 'جاري الاختبار...' : 'اختبار الاتصال وتطبيقه'}
          </Button>
          <Button variant="text" onClick={handleResetServer}>
            استعادة الافتراضي
          </Button>
        </Box>
        {testResult && (
          <Alert severity={testResult.ok ? 'success' : 'error'} sx={{ mt: 1 }}>
            {testResult.text}
          </Alert>
        )}
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>الجلسة</Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>
          المستخدم: {session?.username} ({session?.role})
        </Typography>
        <Button variant="outlined" color="error" onClick={logout}>
          تسجيل الخروج
        </Button>
      </Paper>
    </Box>
  );
};
