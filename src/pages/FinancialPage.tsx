import React from 'react';
import { Alert, Box, Button, Card, CardContent, Grid, Paper, Typography, alpha } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { currentYearMonth, fmtMoney, todayISO } from '../lib/format';
import { useSseRefresh } from '../lib/useSseRefresh';
import AddIcon from '@mui/icons-material/Add';
import ReceiptIcon from '@mui/icons-material/Receipt';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import PaymentsIcon from '@mui/icons-material/Payments';
import AssessmentIcon from '@mui/icons-material/Assessment';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';

const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-');
  const names = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return `${names[Number(m) - 1]} ${y}`;
};

export const FinancialPage: React.FC = () => {
  const navigate = useNavigate();
  const [balance, setBalance] = React.useState<number>(0);
  const [daily, setDaily] = React.useState<any>(null);
  const [monthly, setMonthly] = React.useState<any>(null);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const ym = currentYearMonth();
      const [balRes, dailyRes, monthRes, expRes] = await Promise.all([
        api.get('/api/money-safe/balance'),
        api.get(`/api/money-safe/report/daily?date=${todayISO()}`),
        api.get(`/api/money-safe/report/monthly?yearMonth=${ym}`),
        api.get('/api/expenses'),
      ]);
      setBalance(typeof balRes.data === 'number' ? balRes.data : 0);
      setDaily(dailyRes.data ?? null);
      setMonthly(monthRes.data ?? null);
      setPendingCount((Array.isArray(expRes.data) ? expRes.data : []).filter((e: any) => e.status === 'PENDING').length);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err.message || 'فشل تحميل البيانات المالية');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // Keep the balance in step with payments/expenses recorded elsewhere instead
  // of showing a stale figure until the user manually reloads.
  useSseRefresh(load);

  const negativeBalance = balance < 0;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>لوحة التحكم المالية</Typography>
          <Typography variant="body2" color="text.secondary">نظرة عامة على مالية العيادة والمصروفات</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/expenses')}>إضافة مصروف</Button>
          <Button variant="outlined" startIcon={<ReceiptIcon />} onClick={() => navigate('/expenses')}>إدارة المصروفات</Button>
        </Box>
      </Box>

      {loadError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLoadError(null)}>فشل تحميل البيانات المالية: {loadError}</Alert>}

      {pendingCount > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} action={<Button size="small" onClick={() => navigate('/expenses')}>مراجعة ←</Button>}>
          مصروفات معلقة {pendingCount} طلب(طلبات)
        </Alert>
      )}

      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={4}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary">دخل اليوم</Typography>
              <Typography variant="h4" sx={{ color: '#2E7D32', fontWeight: 700 }}>
                {loading ? '…' : fmtMoney(daily?.totalIncome)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <Card>
            <CardContent>
              <Typography variant="body2" color="text.secondary">مصروفات اليوم</Typography>
              <Typography variant="h4" sx={{ color: '#D32F2F', fontWeight: 700 }}>
                {loading ? '…' : fmtMoney(daily?.totalExpenses)}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card
            sx={(theme) => ({
              bgcolor: alpha(negativeBalance ? '#D32F2F' : '#2E7D32', theme.palette.mode === 'dark' ? 0.18 : 0.1),
              border: `1px solid ${alpha(negativeBalance ? '#D32F2F' : '#2E7D32', theme.palette.mode === 'dark' ? 0.45 : 0.35)}`,
            })}
          >
            <CardContent>
              <Typography variant="body2" color="text.secondary">الرصيد الحالي (الخزينة)</Typography>
              <Typography variant="h4" sx={{ color: negativeBalance ? 'error.main' : 'text.primary', fontWeight: 700 }}>
                {loading ? '…' : fmtMoney(balance)}
              </Typography>
              <Typography variant="caption" sx={{ color: negativeBalance ? '#D32F2F' : '#15803D' }}>
                {negativeBalance ? 'رصيد سالب!' : 'حالة الخزينة جيدة'}
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <AssessmentIcon sx={{ color: 'primary.main' }} />
              <Typography variant="h6">تقرير اليوم</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">الدخل</Typography>
              <Typography variant="h5" sx={{ color: '#2E7D32', fontWeight: 600 }}>{loading ? '…' : fmtMoney(daily?.totalIncome)}</Typography>
              <Typography variant="body2" color="text.secondary">المصروفات</Typography>
              <Typography variant="h5" sx={{ color: '#D32F2F', fontWeight: 600 }}>{loading ? '…' : fmtMoney(daily?.totalExpenses)}</Typography>
              <Typography variant="body2" color="text.secondary">الصافي</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700, color: (daily?.net ?? 0) < 0 ? '#D32F2F' : '#2E7D32' }}>
                {loading ? '…' : fmtMoney(daily?.net)}
              </Typography>
            </Box>
          </Paper>
        </Grid>
        <Grid item xs={12} md={6}>
          <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <TrendingUpIcon sx={{ color: 'primary.main' }} />
              <Typography variant="h6">التقرير الشهري — {monthLabel(currentYearMonth())}</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">الدخل</Typography>
              <Typography variant="h5" sx={{ color: '#2E7D32', fontWeight: 600 }}>{loading ? '…' : fmtMoney(monthly?.totalIncome)}</Typography>
              <Typography variant="body2" color="text.secondary">المصروفات</Typography>
              <Typography variant="h5" sx={{ color: '#D32F2F', fontWeight: 600 }}>{loading ? '…' : fmtMoney(monthly?.totalExpenses)}</Typography>
              <Typography variant="body2" color="text.secondary">الصافي</Typography>
              <Typography variant="h5" sx={{ fontWeight: 700, color: (monthly?.net ?? 0) < 0 ? '#D32F2F' : '#2E7D32' }}>
                {loading ? '…' : fmtMoney(monthly?.net)}
              </Typography>
            </Box>
          </Paper>
        </Grid>
      </Grid>

      <Box sx={{ mt: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>إجراءات سريعة</Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button variant="outlined" startIcon={<AccountBalanceWalletIcon />} onClick={() => navigate('/money-safe')}>عرض المعاملات</Button>
          <Button variant="outlined" startIcon={<PaymentsIcon />} onClick={() => navigate('/expenses')}>مصروف جديد</Button>
        </Box>
      </Box>
    </Box>
  );
};
