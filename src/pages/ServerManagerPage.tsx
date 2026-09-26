import React from 'react';
import {
  Box, Paper, Typography, Button, Alert, Chip, Stack, Divider, TextField,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import { api, getBaseUrl, probeServer, setServerBaseUrl } from '../lib/api';
import { useSettingsStore } from '../stores/settings';
import { useLicenseStore } from '../stores/license';

type Row = { label: string; value: React.ReactNode };

const themeOptions: { value: 'light' | 'dark'; label: string }[] = [
  { value: 'light', label: 'فاتح' },
  { value: 'dark', label: 'داكن' },
];

/**
 * Server and license administration for a Clinic Server that runs on its own machine.
 *
 * This page previously started, stopped and restarted a Clinic Server bundled inside
 * Tauri, read its log file off local disk, and edited the local Windows firewall. That
 * server no longer exists here: it is a standalone application on a separate machine in
 * the clinic, reached over the LAN. Everything on this page is therefore an HTTP call to
 * that server, and there is deliberately no control here that could affect it - closing
 * this window must not stop the clinic's server, and this client has no business
 * starting or killing it.
 */
export const ServerManagerPage: React.FC = () => {
  const { serverHost, serverPort, setServerConfig, theme, setTheme } = useSettingsStore();
  const license = useLicenseStore();

  const [host, setHost] = React.useState(serverHost);
  const [port, setPort] = React.useState(serverPort);
  const [probe, setProbe] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [probing, setProbing] = React.useState(false);

  const [health, setHealth] = React.useState<Record<string, unknown> | null>(null);
  const [infra, setInfra] = React.useState<Record<string, any> | null>(null);
  const [licenseStatus, setLicenseStatus] = React.useState<Record<string, any> | null>(null);
  const [telegram, setTelegram] = React.useState<any[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<{ severity: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [online, setOnline] = React.useState<boolean | null>(null);

  const load = React.useCallback(async () => {
    // Each probe is independent: the server may expose health but refuse the
    // admin-only infrastructure view, and a failure in one must not blank the others.
    const results = await Promise.allSettled([
      api.get('/api/health/stats'),
      api.get('/api/health/infrastructure'),
      api.get('/api/license/status'),
      api.get('/api/admin/telegram-links/pending'),
    ]);
    const [h, i, l, t] = results;

    setOnline(h.status === 'fulfilled');
    setHealth(h.status === 'fulfilled' ? (h.value as any) : null);
    setInfra(i.status === 'fulfilled' ? (i.value as any) : null);
    setLicenseStatus(l.status === 'fulfilled' ? (l.value as any) : null);
    setTelegram(t.status === 'fulfilled' ? ((t.value as any) ?? []) : null);
  }, []);

  React.useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const handleProbe = async () => {
    setProbing(true);
    setProbe(null);
    try {
      const result = await probeServer(host.trim(), port.trim());
      if (result.ok) {
        setProbe({ ok: true, text: `تم الاتصال بنجاح بـ ${host.trim()}:${port.trim()}` });
      } else {
        setProbe({ ok: false, text: `تعذر الاتصال: ${result.message}` });
      }
    } finally {
      setProbing(false);
    }
  };

  const handleApply = () => {
    const h = host.trim();
    const p = port.trim();
    if (!h || !Number.isInteger(Number(p))) {
      setProbe({ ok: false, text: 'أدخل عنواناً ورقماً منفذ صالحين.' });
      return;
    }
    setServerBaseUrl(h, p);
    setServerConfig(h, p);
    setProbe(null);
    void load();
  };

  const runAction = async (key: string, fn: () => Promise<any>, okText: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      setNotice({ severity: 'success', text: okText });
      await load();
    } catch (err: any) {
      setNotice({ severity: 'error', text: err?.message || 'فشلت العملية' });
    } finally {
      setBusy(null);
    }
  };

  const healthRows: Row[] = health
    ? [
        { label: 'الحالة', value: String(health.status ?? '—') },
        { label: 'مرضى اليوم', value: String(health.patientsToday ?? 0) },
        { label: 'مواعيد اليوم', value: String(health.appointmentsToday ?? 0) },
        { label: 'إيراد اليوم', value: String(health.revenueToday ?? 0) },
        { label: 'مدة التشغيل', value: String(health.uptime ?? '—') },
      ]
    : [];

  const infraRows: Row[] = infra
    ? Object.entries(infra)
        .filter(([k]) => k !== 'heartbeat')
        .map(([k, v]) => ({
          label: k,
          value: typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v),
        }))
    : [];

  return (
    <Box sx={{ p: 3, direction: 'rtl' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>الخادم والترخيص</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          {online === true && (
            <Chip icon={<CheckCircleIcon />} color="success" size="small" label="متصل" />
          )}
          {online === false && (
            <Chip icon={<CancelIcon />} color="error" size="small" label="غير متصل" />
          )}
          <Button startIcon={<RefreshIcon />} onClick={() => void load()} size="small">
            تحديث
          </Button>
        </Stack>
      </Stack>

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.text}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>عنوان الخادم</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          عنوان خادم العيادة داخل الشبكة. يتم اكتشافه تلقائياً، ويمكن تعديله هنا في أي وقت.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <TextField label="العنوان" value={host} onChange={(e) => setHost(e.target.value)} fullWidth />
          <TextField label="المنفذ" value={port} onChange={(e) => setPort(e.target.value)} fullWidth sx={{ maxWidth: 160 }} />
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={handleProbe} disabled={probing}>
            {probing ? 'جارٍ الاختبار…' : 'اختبار الاتصال'}
          </Button>
          <Button variant="contained" onClick={handleApply}>حفظ及应用</Button>
        </Stack>
        {probe && (
          <Alert severity={probe.ok ? 'success' : 'error'} sx={{ mt: 2 }}>{probe.text}</Alert>
        )}
        <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'text.secondary' }}>
          الاتصال الحالي: {getBaseUrl() || '(غير محدد)'}
        </Typography>
      </Paper>

      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>صحة الخادم</Typography>
        {healthRows.length ? (
          healthRows.map((r) => (
            <Stack key={r.label} direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
              <Typography variant="body2" color="text.secondary">{r.label}</Typography>
              <Typography variant="body2">{r.value}</Typography>
            </Stack>
          ))
        ) : (
          <Alert severity="warning">تعذر قراءة حالة الخادم. تحقق من العنوان ثم أعد المحاولة.</Alert>
        )}
      </Paper>

      {infraRows.length > 0 && (
        <Paper sx={{ p: 3, mb: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>معلومات النظام (الخادم)</Typography>
          {infraRows.map((r) => (
            <Stack key={r.label} direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
              <Typography variant="body2" color="text.secondary">{r.label}</Typography>
              <Typography variant="body2" sx={{ wordBreak: 'break-all', textAlign: 'left' }}>{r.value}</Typography>
            </Stack>
          ))}
        </Paper>
      )}

      <Paper sx={{ p: 3, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>الترخيص</Typography>
        {licenseStatus ? (
          <>
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              <Chip
                color={licenseStatus.locked ? 'error' : 'success'}
                size="small"
                label={licenseStatus.locked ? 'مقفل' : 'مفعّل'}
              />
              {licenseStatus.reason && (
                <Chip color="warning" size="small" label={String(licenseStatus.reason)} />
              )}
            </Stack>
            {licenseStatus.locked && (
              <Alert severity="info" sx={{ mb: 2 }}>
                تفعيل الترخيص يتم من جهاز الخادم نفسه. افتح Clinic Server على جهاز الخادم
                واستخدم واجهة الإدارة there، أو شغّل أداة التفعيل محليًا على ذلك الجهاز.
              </Alert>
            )}
          </>
        ) : (
          <Alert severity="warning">تعذر قراءة حالة الترخيص.</Alert>
        )}

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            size="small"
            disabled={busy === 'license-sync'}
            onClick={() =>
              runAction('license-sync', () => api.post('/api/license/sync', {}), 'تمت مزامنة الترخيص')
            }
          >
            مزامنة الترخيص
          </Button>
          <Button
            size="small"
            disabled={busy === 'sync-now'}
            onClick={() =>
              runAction('sync-now', () => api.post('/api/sync/now', {}), 'تم طلب مزامنة كاملة')
            }
          >
            مزامنة البيانات الآن
          </Button>
          <Button size="small" onClick={() => license.check()}>تحديث حالة الترخيص</Button>
        </Stack>
      </Paper>

      {telegram && telegram.length > 0 && (
        <Paper sx={{ p: 3, mb: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>
            طلبات ربط تيليجرام ({telegram.length})
          </Typography>
          {telegram.map((t: any) => (
            <Stack
              key={t.id ?? t.requestId}
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ py: 1 }}
            >
              <Typography variant="body2">
                {t.phone ?? t.chatId ?? t.requestId}
              </Typography>
              <Button
                size="small"
                disabled={busy === `tg-${t.id ?? t.requestId}`}
                onClick={() =>
                  runAction(
                    `tg-${t.id ?? t.requestId}`,
                    () => api.post(`/api/admin/telegram-links/${t.id ?? t.requestId}/approve`),
                    'تمت الموافقة على الربط'
                  )
                }
              >
                موافقة
              </Button>
            </Stack>
          ))}
        </Paper>
      )}

      <Paper sx={{ p: 3 }}>
        <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 700 }}>المظهر</Typography>
        <Stack direction="row" spacing={1}>
          {themeOptions.map((o) => (
            <Button
              key={o.value}
              size="small"
              variant={theme === o.value ? 'contained' : 'outlined'}
              onClick={() => setTheme(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </Stack>
        <Typography variant="caption" sx={{ display: 'block', mt: 2, color: 'text.secondary' }}>
          هذا التطبيق لا يحتوي على أي خادم أو بيئة تشغيل Java. خادم العيادة يُدار بشكل مستقل على
          جهاز منفصل، وإيقاف هذا التطبيق لا يؤثر عليه.
        </Typography>
      </Paper>
    </Box>
  );
};
