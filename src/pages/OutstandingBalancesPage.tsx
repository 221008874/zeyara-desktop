import React from 'react';
import {
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
  Typography,
} from '@mui/material';
import { api } from '../lib/api';
import { useSseRefresh } from '../lib/useSseRefresh';
import { fmtMoney } from '../lib/format';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { EmptyState } from '../design-system/EmptyState';
import { Notice } from '../design-system/Notice';
import PaidIcon from '@mui/icons-material/Paid';
import RefreshIcon from '@mui/icons-material/Refresh';
import FileDownloadIcon from '@mui/icons-material/FileDownload';

type OutstandingRow = {
  patientId: number;
  totalBilled: number;
  totalPaid: number;
  remaining: number;
  paymentCount: number;
};

type EnrichedRow = OutstandingRow & { patientName: string; phone: string };

const toNumber = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

const exportCsv = (rows: EnrichedRow[]) => {
  const header = ['المريض', 'الهاتف', 'إجمالي الفاتورة', 'المدفوع', 'المتبقي', 'عدد الدفعات'];
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        csvCell(r.patientName),
        csvCell(r.phone),
        toNumber(r.totalBilled).toFixed(2),
        toNumber(r.totalPaid).toFixed(2),
        toNumber(r.remaining).toFixed(2),
        String(r.paymentCount),
      ].join(','),
    ),
  ];
  // UTF-8 BOM so Excel opens the Arabic headers correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `outstanding-balances-${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};

/**
 * Clinic-wide outstanding balances ("who still owes money").
 *
 * Replaces the JavaFX secretary client's local-SQLite "View Unpaid" modal, which the
 * Tauri client has no equivalent of. Backed by GET /api/payments/outstanding, which
 * applies the same ownership scoping as the rest of the payments API: an admin sees the
 * whole clinic, other roles see only balances from payments they created.
 */
export const OutstandingBalancesPage: React.FC = () => {
  const [rows, setRows] = React.useState<EnrichedRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [onlyLarge, setOnlyLarge] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [outstandingRes, patientsRes] = await Promise.all([
        api.get('/api/payments/outstanding'),
        api.get('/api/patients'),
      ]);

      const outstanding: OutstandingRow[] = Array.isArray(outstandingRes.data) ? outstandingRes.data : [];
      const patients: any[] = Array.isArray(patientsRes.data) ? patientsRes.data : [];
      const byId = new Map<number, any>(patients.map((p) => [Number(p.id), p]));

      setRows(
        outstanding.map((r) => {
          const patient = byId.get(Number(r.patientId));
          return {
            ...r,
            patientId: Number(r.patientId),
            totalBilled: toNumber(r.totalBilled),
            totalPaid: toNumber(r.totalPaid),
            remaining: toNumber(r.remaining),
            paymentCount: Number(r.paymentCount) || 0,
            // A balance can outlive its patient record (the patient may have been
            // deleted), so fall back to the id rather than rendering a blank row.
            patientName: patient?.name ?? `مريض رقم ${r.patientId}`,
            phone: patient?.phone ?? '—',
          };
        }),
      );
      setError(null);
    } catch (err: any) {
      setError(err.message || 'تعذّر تحميل قائمة المديونيات');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  useSseRefresh(load);

  const totalRemaining = React.useMemo(() => rows.reduce((s, r) => s + r.remaining, 0), [rows]);
  const totalBilled = React.useMemo(() => rows.reduce((s, r) => s + r.totalBilled, 0), [rows]);
  const totalPaid = React.useMemo(() => rows.reduce((s, r) => s + r.totalPaid, 0), [rows]);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyLarge && r.remaining < 500) return false;
      if (!q) return true;
      return (
        r.patientName.toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        String(r.patientId) === q
      );
    });
  }, [rows, query, onlyLarge]);

  if (loading && rows.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
        <PaidIcon color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          المبالغ المستحقة
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        مرضى عليهم مبالغ لم تُحصّل بعد، مرتبين من الأكبر إلى الأصغر
      </Typography>

      {error && (
        <Box sx={{ mb: 2 }}>
          <Notice tone="error" msg={error} />
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2, mb: 3 }}>
        {[
          { label: 'إجمالي المستحق', value: totalRemaining, tone: totalRemaining > 0 ? 'error.main' : 'success.main' },
          { label: 'إجمالي المفوتر', value: totalBilled, tone: 'text.primary' },
          { label: 'إجمالي المحصّل', value: totalPaid, tone: 'success.main' },
        ].map((card) => (
          <Paper key={card.label} sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {card.label}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, color: card.tone }}>
              {fmtMoney(card.value)}
            </Typography>
          </Paper>
        ))}
      </Box>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            label="بحث بالاسم أو الهاتف أو رقم المريض"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            size="small"
            sx={{ minWidth: 280, flex: 1 }}
          />
          <Chip
            label="أكثر من 500 ج.م"
            color={onlyLarge ? 'primary' : 'default'}
            variant={onlyLarge ? 'filled' : 'outlined'}
            onClick={() => setOnlyLarge((v) => !v)}
          />
          <Chip
            label={`${visible.length} من ${rows.length}`}
            variant="outlined"
          />
          <Box sx={{ flex: 1 }} />
          <Button
            startIcon={<FileDownloadIcon />}
            onClick={() => exportCsv(visible)}
            disabled={visible.length === 0}
          >
            تصدير CSV
          </Button>
          <Button startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
            {loading ? 'جارٍ التحديث…' : 'تحديث'}
          </Button>
        </Box>
      </Paper>

      {loading && <TableSkeleton cols={6} rows={5} />}

      {!loading && visible.length === 0 && (
        <EmptyState
          title={rows.length === 0 ? 'لا توجد مبالغ مستحقة' : 'لا نتائج مطابقة'}
          hint={
            rows.length === 0
              ? 'جميع الفواتير محصّلة بالكامل.'
              : 'جرّب تعديل البحث أو إلغاء مرشح المبلغ.'
          }
        />
      )}

      {!loading && visible.length > 0 && (
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>المريض</TableCell>
                <TableCell>الهاتف</TableCell>
                <TableCell align="left">إجمالي الفاتورة</TableCell>
                <TableCell align="left">المدفوع</TableCell>
                <TableCell align="left">المتبقي</TableCell>
                <TableCell align="center">عدد الدفعات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={r.patientId} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{r.patientName}</TableCell>
                  <TableCell>{r.phone}</TableCell>
                  <TableCell align="left">{fmtMoney(r.totalBilled)}</TableCell>
                  <TableCell align="left" sx={{ color: 'success.main' }}>
                    {fmtMoney(r.totalPaid)}
                  </TableCell>
                  <TableCell align="left" sx={{ color: 'error.main', fontWeight: 700 }}>
                    {fmtMoney(r.remaining)}
                  </TableCell>
                  <TableCell align="center">{r.paymentCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Box sx={{ mt: 2 }}>
        <Notice
          tone="info"
          msg="تعرض هذه القائمة أرصدة المدفوعات التي يحق لك الاطلاع عليها فقط: مدير النظام يرى كل المبالغ، وكل دور آخر يرى ما أنشأه من دفعات."
        />
      </Box>
    </Box>
  );
};
