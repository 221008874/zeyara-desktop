import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import {
  TextField, Button, Typography, Box, Paper,
  FormControl, InputLabel, Select, MenuItem,
  Alert, CircularProgress, Link,
} from '@mui/material';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { probeServer, setServerBaseUrl } from '../lib/api';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, session } = useAuthStore();
  const settings = useSettingsStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'DOCTOR' | 'SECRETARY'>(() => {
    const last = (typeof window !== 'undefined' ? window.localStorage.getItem('zeyara_last_role') : null) as 'ADMIN' | 'DOCTOR' | 'SECRETARY' | null;
    return last === 'ADMIN' || last === 'DOCTOR' || last === 'SECRETARY' ? last : 'DOCTOR';
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [serverHost, setServerHost] = useState(settings.serverHost);
  const [serverPort, setServerPort] = useState(settings.serverPort);
  const [showServerSetup, setShowServerSetup] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [serverSuccess, setServerSuccess] = useState<string | null>(null);

  // Keep the host/port fields in sync with heartbeat discovery / saved settings.
  useEffect(() => {
    return useSettingsStore.subscribe((s) => {
      setServerHost(s.serverHost);
      setServerPort(s.serverPort);
    });
  }, []);

  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  // Returns the validation message so a rejected address surfaces as an error rather than
  // silently leaving the app pointed at whatever it was using before.
  const applyServer = (host: string, port: string): string | null => {
    const result = setServerBaseUrl(host, port);
    if (!result.ok) return result.message;
    settings.setServerConfig(host, port);
    import('../lib/notificationBus')
      .then((m) => m.notificationBus.refresh())
      .catch(() => {});
    return null;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Use the server the user has configured, even without clicking test first. An
      // empty host is legitimate: the app then relies on LAN discovery.
      const host = serverHost.trim();
      if (host) {
        const problem = applyServer(host, serverPort.trim());
        if (problem) {
          setError(problem);
          return;
        }
      }
      if (typeof window !== 'undefined') window.localStorage.setItem('zeyara_last_role', role);
      const { mustChangePassword } = await login(username, password, role);
      if (mustChangePassword) {
        navigate('/change-password', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (err: any) {
      setError(err.message || 'فشل تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  const handleTestServer = async () => {
    setServerError(null);
    setServerSuccess(null);
    const host = serverHost.trim();
    const port = serverPort.trim();
    // A full origin carries its own scheme and port; the separate port box only applies
    // to a bare host, which in practice means loopback during development.
    const isFullOrigin = /^https?:\/\//i.test(host);
    if (!host) {
      setServerError('أدخل عنوان الخادم، أو اتركه فارغاً للاكتشاف التلقائي.');
      return;
    }
    if (!isFullOrigin) {
      const portNum = Number(port);
      if (!port || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        setServerError('أدخل عنواناً ومنفذاً صالحين (1-65535).');
        return;
      }
    }
    const probe = await probeServer(host, port);
    if (probe.ok) {
      const problem = applyServer(host, port);
      if (problem) {
        setServerError(problem);
        return;
      }
      setServerSuccess(`تم الاتصال بالخادم ${host}:${port} وتطبيقه.`);
    } else {
      setServerError('لا يمكن الوصول إلى الخادم: ' + probe.message);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
        direction: 'rtl',
      }}
    >
      <Paper elevation={3} sx={{ p: 4, width: 400, borderRadius: 2 }}>
        <Typography variant="h5" align="center" sx={{ mb: 3, fontWeight: 700, color: 'text.primary' }}>
          زيارة - عيادة زيارة
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box component="form" onSubmit={handleLogin} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <FormControl fullWidth>
            <InputLabel>الدور</InputLabel>
            <Select value={role} onChange={(e) => setRole(e.target.value as any)} label="الدور">
              <MenuItem value="ADMIN">مدير</MenuItem>
              <MenuItem value="DOCTOR">طبيب</MenuItem>
              <MenuItem value="SECRETARY">سكرتير</MenuItem>
            </Select>
          </FormControl>

          <TextField
            label="اسم المستخدم"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            fullWidth
            required
            autoFocus
          />

          <TextField
            label="كلمة المرور"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            fullWidth
            required
          />

          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={loading}
            sx={{ mt: 1 }}
          >
            {loading ? <CircularProgress size={24} /> : 'دخول'}
          </Button>
        </Box>

        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <Link
            component="button"
            variant="body2"
            onClick={() => setShowServerSetup(!showServerSetup)}
            sx={{ cursor: 'pointer' }}
          >
            {showServerSetup ? 'إخفاء إعدادات الخادم' : 'إعدادات الخادم'}
          </Link>
        </Box>

        {showServerSetup && (
          <Box sx={{ mt: 2, p: 2, border: '1px solid #E5E7EB', borderRadius: 1 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              إعدادات الاتصال بالخادم
            </Typography>
            <TextField
              label="عنوان الخادم"
              value={serverHost}
              onChange={(e) => setServerHost(e.target.value)}
              fullWidth
              size="small"
              sx={{ mb: 1 }}
              placeholder="https://192.168.1.8:8443"
              helperText="اتركه فارغاً للاكتشاف التلقائي. يجب أن يبدأ بـ https://"
            />
            <TextField
              label="المنفذ (للتطوير المحلي فقط)"
              value={serverPort}
              onChange={(e) => setServerPort(e.target.value)}
              fullWidth
              size="small"
              sx={{ mb: 1 }}
              helperText="يُستخدم فقط مع localhost أثناء التطوير"
            />
            <Button variant="outlined" fullWidth size="small" onClick={handleTestServer}>
              اختبار الاتصال وتطبيقه
            </Button>
            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: '#6B7280' }}>
              سيُستخدم الخادم المحدد أيضاً عند تسجيل الدخول.
            </Typography>
            {serverError && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {serverError}
              </Alert>
            )}
            {serverSuccess && (
              <Alert severity="success" sx={{ mt: 1 }}>
                {serverSuccess}
              </Alert>
            )}
          </Box>
        )}
      </Paper>
    </Box>
  );
};
