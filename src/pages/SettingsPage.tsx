import React from 'react';
import { Typography, Box, Paper, TextField, Button, FormControl, InputLabel, Select, MenuItem, Alert } from '@mui/material';
import { useSettingsStore } from '../stores/settings';
import { useAuthStore } from '../stores/auth';
import { getBaseUrl, probeServer, resetServerBaseUrl, setServerBaseUrl } from '../lib/api';
import { getAppVersion } from '../lib/version';
import { useHeartbeatStore } from '../stores/heartbeat';
import {
  startHeartbeatMonitor,
  stopHeartbeatMonitor,
  forgetAcceptedServer,
} from '../lib/heartbeat';

export const SettingsPage: React.FC = () => {
  const { theme, setTheme, serverHost, serverPort, setServerConfig } = useSettingsStore();
  const { session, logout } = useAuthStore();
  const discoverySecret = useHeartbeatStore((s) => s.discoverySecret);
  const acceptedServer = useHeartbeatStore((s) => s.acceptedServer);
  const setDiscoverySecret = useHeartbeatStore((s) => s.setDiscoverySecret);
  const [host, setHost] = React.useState(serverHost);
  const [port, setPort] = React.useState(serverPort);
  const [testResult, setTestResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = React.useState(false);
  const [version, setVersion] = React.useState('');
  const [secretDraft, setSecretDraft] = React.useState('');
  const [secretNotice, setSecretNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    void getAppVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  const handleSaveSecret = () => {
    const value = secretDraft.trim();
    if (!value) return;
    setDiscoverySecret(value);
    setSecretDraft('');
    setSecretNotice('تم حفظ المفتاح. اضغط "تطبيق المفتاح وإعادة الاكتشاف" لتفعيله.');
  };

  // The secret is read once when the listener starts, so changing it means restarting
  // discovery rather than expecting it to take effect on the next heartbeat.
  const handleApplySecret = async () => {
    await stopHeartbeatMonitor();
    await startHeartbeatMonitor();
    setSecretNotice('أُعيد تشغيل الاكتشاف بالمفتاح الجديد.');
  };

  const handleForgetServer = () => {
    forgetAcceptedServer();
    setSecretNotice('تم نسيان الخادم المعتمد. سيُطلب اختياره مرة أخرى عند الاكتشاف.');
  };

  const refreshNotificationBus = () => {
    import('../lib/notificationBus')
      .then((m) => m.notificationBus.refresh())
      .catch(() => {});
  };

  const handleTestConnection = async () => {
    const h = host.trim();
    const p = port.trim();
    // A full origin carries its own port; the separate box only applies to a bare host,
    // which in practice means loopback during development.
    const isFullOrigin = /^https?:\/\//i.test(h);
    if (!h) {
      setTestResult({ ok: false, text: 'أدخل عنوان الخادم.' });
      return;
    }
    if (!isFullOrigin) {
      const portNum = Number(p);
      if (!p || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        setTestResult({ ok: false, text: 'أدخل عنواناً ومنفذاً صالحين (1-65535).' });
        return;
      }
    }
    setTesting(true);
    setTestResult(null);
    try {
      const probe = await probeServer(h, p);
      if (probe.ok) {
        const applied = setServerBaseUrl(h, p);
        if (!applied.ok) {
          setTestResult({ ok: false, text: applied.message });
          return;
        }
        setServerConfig(h, p);
        refreshNotificationBus();
        setTestResult({ ok: true, text: `تم الاتصال بالخادم وتطبيقه (${getBaseUrl()}).` });
      } else {
        setTestResult({ ok: false, text: 'فشل الاتصال: ' + probe.message });
      }
    } finally {
      setTesting(false);
    }
  };

  const handleResetServer = () => {
    // Clears the configured address entirely rather than restoring a localhost default:
    // there is no same-machine server to fall back on, and a localhost default would
    // read as "already configured" while silently failing.
    resetServerBaseUrl();
    setServerConfig('', '8081');
    setHost('');
    setPort('8081');
    refreshNotificationBus();
    setTestResult({ ok: true, text: 'تم مسح عنوان الخادم. سيعمل الاكتشاف التلقائي.' });
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
          الخادم الحالي: {getBaseUrl() || '(غير محدد — يُكتشف تلقائياً أو يُضبط يدوياً)'}
        </Typography>
        <TextField label="عنوان الخادم" value={host} onChange={(e) => setHost(e.target.value)} fullWidth size="small" sx={{ mb: 1 }} placeholder="https://192.168.1.8:8443" helperText="اتركه فارغاً للاكتشاف التلقائي. يجب أن يبدأ بـ https://" />
        <TextField label="المنفذ (للتطوير المحلي فقط)" value={port} onChange={(e) => setPort(e.target.value)} fullWidth size="small" sx={{ mb: 2 }} helperText="يُستخدم فقط مع localhost أثناء التطوير" />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" onClick={handleTestConnection} disabled={testing}>
            {testing ? 'جاري الاختبار...' : 'اختبار الاتصال وتطبيقه'}
          </Button>
          <Button variant="text" onClick={handleResetServer}>
            مسح العنوان المحفوظ
          </Button>
        </Box>
        {testResult && (
          <Alert severity={testResult.ok ? 'success' : 'error'} sx={{ mt: 1 }}>
            {testResult.text}
          </Alert>
        )}
      </Paper>

      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>اكتشاف الخادم والأمان</Typography>
        <Typography variant="caption" sx={{ display: 'block', mb: 2, color: '#6B7280' }}>
          خادم العيادة يعمل على جهاز منفصل. يتم التحقق من هويته عبر مفتاح مشترك
          (SYNC_SECRET) موجود على إعدادات جهاز الخادم. بدون هذا المفتاح يمكن للاكتشاف أن
          يجد الخادم، لكنه لا يستطيع التحقق من هويته، ولن يتم الاتصال به تلقائياً.
        </Typography>
        <TextField
          label="مفتاح التحقق (SYNC_SECRET)"
          type="password"
          value={secretDraft}
          onChange={(e) => setSecretDraft(e.target.value)}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
          helperText="نفس القيمة الموجودة في إعدادات خادم العيادة. لا تشاركها."
        />
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={handleSaveSecret} disabled={!secretDraft.trim()}>
            حفظ المفتاح
          </Button>
          <Button variant="outlined" onClick={handleApplySecret} disabled={!discoverySecret}>
            تطبيق المفتاح وإعادة الاكتشاف
          </Button>
          <Button variant="text" color="error" onClick={handleForgetServer}>
            نسيان الخادم المعتمد
          </Button>
        </Box>
        <Typography variant="caption" sx={{ display: 'block', mt: 2, color: '#6B7280' }}>
          الخادم المعتمد حالياً: {acceptedServer || '(لا يوجد — سيتم طلب الاختيار عند الاكتشاف)'}
        </Typography>
        {secretNotice && (
          <Alert severity="info" sx={{ mt: 1 }} onClose={() => setSecretNotice(null)}>
            {secretNotice}
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

      <Paper sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 2 }}>حول التطبيق</Typography>
        <Typography variant="body2" sx={{ color: '#6B7280' }}>
          Zeyara Desktop — الإصدار {version}
        </Typography>
      </Paper>
    </Box>
  );
};
