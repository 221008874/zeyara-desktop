import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Paper, Typography, TextField, Button, Alert, CircularProgress, Stepper, Step, StepLabel,
} from '@mui/material';
import { api } from '../lib/api';
import { useSetupStore } from '../stores/setup';
import { useAuthStore } from '../stores/auth';
import { useSettingsStore } from '../stores/settings';
import { setServerBaseUrl } from '../lib/api';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

const STEPS = ['تسجيل المدير', 'إضافة سكرتير (اختياري)', 'تفعيل الخادم والبدء'];

interface FormState {
  name: string;
  username: string;
  phone: string;
  password: string;
}

const empty: FormState = { name: '', username: '', phone: '', password: '' };

export const SetupWizardPage: React.FC = () => {
  const navigate = useNavigate();
  const markSetupComplete = useSetupStore((s) => s.markSetupComplete);
  const bootstrapAdmin = useAuthStore((s) => s.bootstrapAdmin);
  const settings = useSettingsStore();

  const [activeStep, setActiveStep] = React.useState(0);
  const [form, setForm] = React.useState<FormState>(empty);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState(false);

  // Only applies an already-configured address. An empty host is the normal state on
  // first run, and an address that fails the HTTPS policy is left alone rather than
  // being applied, so the wizard cannot silently downgrade the connection.
  const applyServer = React.useCallback(() => {
    const host = settings.serverHost?.trim();
    if (!host) return;
    setServerBaseUrl(host, settings.serverPort);
  }, [settings.serverHost, settings.serverPort]);

  const handleNext = async () => {
    setError(null);
    if (!form.name.trim()) { setError('الرجاء إدخال الاسم'); return; }
    if (!form.username.trim()) { setError('الرجاء إدخال اسم المستخدم'); return; }
    if (form.password.length < 8) { setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل'); return; }
    setSaving(true);
    try {
      applyServer();
      if (activeStep === 0) {
        await bootstrapAdmin(form.username.trim(), form.password);
      } else if (activeStep === 1) {
        const license = await api.get('/api/license/status');
        if (license.data?.locked) {
          setForm(empty);
          setActiveStep(2);
          return;
        }
        await api.post('/api/secretaries', {
          name: form.name.trim(),
          username: form.username.trim(),
          phone: form.phone.trim(),
          password: form.password,
          forcePasswordChange: true,
        });
      }
      setForm(empty);
      setActiveStep((s) => s + 1);
    } catch (err: any) {
      setError(err.message || 'فشل الحفظ — قد يكون اسم المستخدم مستخدماً');
    } finally {
      setSaving(false);
    }
  };

  const handleSkipSecretary = () => {
    setError(null);
    setForm(empty);
    setActiveStep(2);
  };

  const handleFinish = async () => {
    // Mark setup complete and navigate to login (wizard users must log in with
    // the account they just created; the force-password-change flag will prompt
    // them to set a new password on first login).
    markSetupComplete();
    setDone(true);
    navigate('/server-manager', { replace: true });
  };

  if (done) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', bgcolor: 'background.default', direction: 'rtl' }}>
        <Paper elevation={3} sx={{ p: 5, width: 460, borderRadius: 2, textAlign: 'center' }}>
          <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 700 }}>تم إعداد النظام بنجاح</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            تم إنشاء حساباتك. سجّل الدخول الآن بالحساب الذي أنشأته للبدء.
          </Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh',
        bgcolor: 'background.default', direction: 'rtl',
      }}
    >
      <Paper elevation={3} sx={{ p: 4, width: 520, borderRadius: 2 }}>
        <Typography variant="h5" align="center" sx={{ mb: 0.5, fontWeight: 700, color: 'primary.main' }}>
          تجهيز العيادة
        </Typography>
        <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 3 }}>
          هذه هي المرة الأولى على هذا النظام. أنشئ حسابك الرئيسي للبدء.
        </Typography>

        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
        )}

        {activeStep === 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            أنشئ حساب المدير للبدء. ستتمكن من إضافة الأطباء والسكرتيرات لاحقاً.
          </Alert>
        )}
        {activeStep === 1 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            يمكنك إضافة سكرتير الآن. إذا لم يكن الترخيص مفعّلاً، ستتخطى هذه الخطوة وتضيف المستخدمين بعد التفعيل.
          </Alert>
        )}
        {activeStep === 2 && (
          <Alert severity="success" sx={{ mb: 2 }}>
            اكتمل إنشاء حساب المدير. انتقل الآن إلى خادم العيادة لتفعيل الترخيص.
          </Alert>
        )}

        {activeStep < 2 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label={activeStep === 0 ? 'اسم المدير/الطبيب *' : 'اسم السكرتير *'}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              fullWidth required autoFocus
            />
            <TextField
              label="اسم المستخدم *"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              fullWidth required
            />
            <TextField
              label="الهاتف"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              fullWidth
            />
            <TextField
              label="كلمة المرور * (8 أحرف على الأقل)"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              fullWidth required
            />
            <Button variant="contained" size="large" onClick={handleNext} disabled={saving} sx={{ mt: 1 }}>
              {saving ? <CircularProgress size={22} /> : activeStep === 0 ? 'إنشاء حساب المدير والمتابعة' : 'إنشاء حساب السكرتير والمتابعة'}
            </Button>
            {activeStep === 1 && (
              <Button variant="text" onClick={handleSkipSecretary} disabled={saving}>
                تخطي هذه الخطوة
              </Button>
            )}
          </Box>
        )}

        {activeStep === 2 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Button variant="contained" size="large" onClick={handleFinish}>
              الانتقال إلى تسجيل الدخول
            </Button>
          </Box>
        )}
      </Paper>
    </Box>
  );
};
