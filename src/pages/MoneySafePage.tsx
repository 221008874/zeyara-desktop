import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { offlineGet } from '../lib/offlineDb';
import { useSseRefresh } from '../lib/useSseRefresh';
import { fmtDateTime, fmtMoney, moneySafeTypeLabel, sourceTypeLabel, todayISO } from '../lib/format';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { EmptyState } from '../design-system/EmptyState';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';

const downloadBlob = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

type SourceFilter = 'ALL' | 'PAYMENT' | 'EXPENSE' | 'MANUAL';

const sourceMatches = (t: any, f: SourceFilter): boolean => {
  if (f === 'ALL') return true;
  if (f === 'MANUAL') return ['MANUAL', 'REFUND', 'ADJUSTMENT'].includes(t.sourceType);
  return t.sourceType === f;
};

export const MoneySafePage: React.FC = () => {
  const [balance, setBalance] = React.useState(0);
  const [transactions, setTransactions] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<SourceFilter>('ALL');
  const [fromDate, setFromDate] = React.useState('');
  const [toDate, setToDate] = React.useState('');

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const qs = params.toString();
      const [balData, txData] = await Promise.all([
        offlineGet('/api/money-safe/balance'),
        offlineGet(`/api/money-safe/transactions${qs ? `?${qs}` : ''}`),
      ]);
      setBalance(typeof balData === 'number' ? balData : 0);
      setTransactions(Array.isArray(txData) ? txData : []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'فشل تحميل المعاملات');
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  React.useEffect(() => {
    load();
  }, [load]);

  useSseRefresh(load);

  const withRunningBalance = React.useMemo(() => {
    // Walk newest -> oldest, anchored to the server-reported balance: the newest
    // row shows the true current balance and each older row shows the balance
    // AFTER that transaction. Starting from the server balance (instead of 0)
    // keeps the column correct even when a date/source filter hides earlier rows.
    let running = Number(balance) || 0;
    return transactions.map((t) => {
      const r = running;
      const signed = t.type === 'CREDIT' ? Number(t.amount) : -Number(t.amount);
      running -= Number.isFinite(signed) ? signed : 0;
      return { ...t, running: r };
    });
  }, [transactions, balance]);

  const filtered = withRunningBalance.filter((t) => sourceMatches(t, filter));

  const credits = filtered.reduce((s, t) => s + (t.type === 'CREDIT' ? Number(t.amount) : 0), 0);
  const debits = filtered.reduce((s, t) => s + (t.type === 'DEBIT' ? Number(t.amount) : 0), 0);

  const exportCSV = () => {
    if (!filtered.length) return;
    const headers = ['التاريخ', 'النوع', 'الوصف', 'المصدر', 'المبلغ', 'الرصيد'];
    const rows = filtered.map((t) => [
      t.createdAt ?? '',
      moneySafeTypeLabel(t.type),
      t.description ?? '',
      sourceTypeLabel(t.sourceType),
      String(t.amount ?? ''),
      String(t.running ?? ''),
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    downloadBlob(new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' }), `money-safe-${todayISO()}.csv`);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>معاملات الخزينة</Typography>
          <Typography variant="body2" color="text.secondary">عرض جميع الإيداعات والسحب وخصومات المصروفات</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCSV} disabled={filtered.length === 0}>تصدير</Button>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
            {loading ? <CircularProgress size={18} /> : 'تحديث'}
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
        <ToggleButtonGroup
          value={filter}
          exclusive
          size="small"
          onChange={(_, v) => v && setFilter(v)}
        >
          <ToggleButton value="ALL">الكل</ToggleButton>
          <ToggleButton value="PAYMENT">مدفوعات المرضى</ToggleButton>
          <ToggleButton value="EXPENSE">المصروفات</ToggleButton>
          <ToggleButton value="MANUAL">إدخالات يدوية</ToggleButton>
        </ToggleButtonGroup>
        <TextField label="من تاريخ" type="date" size="small" value={fromDate}
          onChange={(e) => setFromDate(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField label="إلى تاريخ" type="date" size="small" value={toDate}
          onChange={(e) => setToDate(e.target.value)} InputLabelProps={{ shrink: true }} />
        <Button variant="contained" size="small" onClick={load} disabled={loading}>تطبيق التصفية</Button>
      </Box>

      <Paper sx={{ p: 2, mb: 2, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box>
          <Typography variant="body2" color="text.secondary">الرصيد الحالي</Typography>
          <Typography variant="h4" sx={{ color: balance < 0 ? 'error.main' : 'text.primary', fontWeight: 700 }}>
            {fmtMoney(balance)}
          </Typography>
        </Box>
        <Box>
          <Typography variant="body2" color="text.secondary">ملخص الفترة — إيداعات</Typography>
          <Typography variant="h6" sx={{ color: '#2E7D32', fontWeight: 700 }}>+{fmtMoney(credits)}</Typography>
        </Box>
        <Box>
          <Typography variant="body2" color="text.secondary">ملخص الفترة — سحوبات</Typography>
          <Typography variant="h6" sx={{ color: '#D32F2F', fontWeight: 700 }}>−{fmtMoney(debits)}</Typography>
        </Box>
        <Box>
          <Typography variant="body2" color="text.secondary">ملخص الفترة — الصافي</Typography>
          <Typography variant="h6" sx={{ fontWeight: 700, color: credits - debits < 0 ? '#D32F2F' : '#2E7D32' }}>
            {fmtMoney(credits - debits)}
          </Typography>
        </Box>
      </Paper>

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>التاريخ</TableCell>
                <TableCell>النوع</TableCell>
                <TableCell>الوصف</TableCell>
                <TableCell>المصدر</TableCell>
                <TableCell>المبلغ</TableCell>
                <TableCell>الرصيد</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableSkeleton cols={6} />
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} sx={{ border: 0, p: 0 }}>
                    <EmptyState title="لا توجد عمليات" hint="لم تسجّل أي حركة خزينة ضمن هذا النطاق." />
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{fmtDateTime(t.createdAt)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={t.type === 'CREDIT' ? 'success' : 'error'}
                        label={moneySafeTypeLabel(t.type)}
                      />
                    </TableCell>
                    <TableCell>{t.description ?? '—'}</TableCell>
                    <TableCell>{sourceTypeLabel(t.sourceType)}</TableCell>
                    <TableCell sx={{ color: t.type === 'CREDIT' ? '#2E7D32' : '#D32F2F', fontWeight: 600 }}>
                      {t.type === 'CREDIT' ? '+' : '−'}{fmtMoney(t.amount)}
                    </TableCell>
                    <TableCell>{fmtMoney(t.running)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
  );
};
