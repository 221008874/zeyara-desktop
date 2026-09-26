import React from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Workbook } from 'exceljs';
import { offlineGet } from '../lib/offlineDb';
import { PdfBlock, clinicHeaderBlock, docStamp, exportArabicDocumentPdf, footerBlock } from '../lib/arabicPdf';
import { getClinicProfile } from '../lib/clinicProfile';
import { categoryLabel, currentYearMonth, fmtDateTime, todayISO } from '../lib/format';
import { saveDocument } from '../lib/native';
import HistoryIcon from '@mui/icons-material/History';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';

const CATEGORIES: Record<string, string> = {
  PATIENTS: 'المرضى',
  APPOINTMENTS: 'المواعيد',
  EXPENSES: 'المصروفات',
  MONEY_SAFE: 'الخزينة',
  MEDICATIONS: 'الأدوية',
  HISTORY: 'السجل الطبي',
  FINANCIAL: 'ملخص مالي',
};


const normalizeData = (data: any): any[] => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.data)) return data.data;
    if (data.results && Array.isArray(data.results)) return data.results;
    if (data.items && Array.isArray(data.items)) return data.items;
    if (data.rows && Array.isArray(data.rows)) return data.rows;
    return [data];
  }
  return [];
};

const fetchCategory = async (category: string): Promise<any[]> => {
  switch (category) {
    case 'PATIENTS': {
      const res = await offlineGet('/api/patients');
      return normalizeData(res).map((p: any) => ({
        'المعرف': p.id,
        'الاسم': p.name ?? '',
        'الهاتف': p.phone ?? '',
        'العمر': p.age ?? '',
        'الجنس': p.gender ?? '',
        // Patient has no `category` (that field belongs to Appointment), so this
        // column was permanently blank. bmiCategory is the real classification.
        'التصنيف': p.bmiCategory ?? '',
      }));
    }
    case 'APPOINTMENTS': {
      const res = await offlineGet('/api/appointments');
      const tzMap: Record<string, string> = { MORNING: 'صباحاً', AFTERNOON: 'بعد الظهر', NIGHT: 'مساءً' };
      const statusMap: Record<string, string> = { SCHEDULED: 'مجدول', MOVED: 'مؤجل', DONE: 'مكتمل', CANCELLED: 'ملغي' };
      return normalizeData(res).map((a: any) => ({
        'المعرف': a.id,
        'التاريخ': a.date ?? '',
        'الفترة': tzMap[a.timeZone] ?? a.timeZone ?? '',
        'المريض': a.patientName ?? a.patientId ?? '',
        'الحالة': statusMap[a.status] ?? a.status ?? '',
      }));
    }
    case 'EXPENSES': {
      const res = await offlineGet('/api/expenses');
      return normalizeData(res).map((e: any) => ({
        'المعرف': e.id,
        'الوصف': e.title ?? '',
        'المبلغ': e.amount ?? '',
        'الفئة': categoryLabel(e.category),
        'التاريخ': e.expenseDate ?? '',
        'الحالة': e.status ?? '',
      }));
    }
    case 'MONEY_SAFE': {
      const res = await offlineGet('/api/money-safe/transactions');
      return normalizeData(res).map((t: any) => ({
        'المعرف': t.id,
        'التاريخ': fmtDateTime(t.createdAt),
        'النوع': t.type === 'CREDIT' ? 'إيداع' : t.type === 'DEBIT' ? 'سحب' : t.type ?? '',
        'الوصف': t.description ?? '',
        'المصدر': t.sourceType ?? '',
        'المبلغ': t.amount ?? '',
      }));
    }
    case 'MEDICATIONS': {
      const res = await offlineGet('/api/medications');
      return normalizeData(res).map((m: any) => ({
        'المعرف': m.id,
        'الاسم': m.drugName ?? m.name ?? m.medicationName ?? '',
        'الجرعة': m.dosage ?? m.dose ?? '',
        'المريض': m.patientId ?? '',
        'الحالة': m.status ?? '',
        // Medication has no prescribedAt/createdAt; the real date fields are
        // startDate/endDate, so the column used to render permanently blank.
        'التاريخ': m.startDate ?? m.endDate ?? '',
      }));
    }
    case 'HISTORY': {
      // Use the bulk /api/history endpoint instead of one request per patient:
      // this report previously issued N sequential requests (one per patient),
      // which is unusably slow on a real clinic roster. The server also applies
      // ownership filtering on the bulk route, so this stays correctly scoped.
      const [patRes, hisRes] = await Promise.all([
        offlineGet('/api/patients'),
        offlineGet('/api/history'),
      ]);
      const nameById = new Map<any, string>(
        normalizeData(patRes).map((p: any) => [p.id, p.name ?? String(p.id)]),
      );
      return normalizeData(hisRes).map((h: any) => ({
        'المريض': h.patientName ?? nameById.get(h.patientId) ?? h.patientId ?? '',
        'التاريخ': h.createdAt ?? h.date ?? '',
        'التصنيف': h.category ?? '',
        'التشخيص': h.diagnosis ?? '',
        'ملاحظات': h.notes ?? '',
      }));
    }
    case 'FINANCIAL': {
      const today = todayISO();
      const ym = currentYearMonth();
      const [dailyRes, monthRes, balRes] = await Promise.all([
        offlineGet(`/api/money-safe/report/daily?date=${today}`),
        offlineGet(`/api/money-safe/report/monthly?yearMonth=${ym}`),
        offlineGet('/api/money-safe/balance'),
      ]);
      const rows: any[] = [];
      rows.push({ 'الفترة': `يوم ${today}`, 'الدخل': dailyRes?.totalIncome ?? 0, 'المصروفات': dailyRes?.totalExpenses ?? 0, 'الصافي': dailyRes?.net ?? 0 });
      rows.push({ 'الفترة': `شهر ${ym}`, 'الدخل': monthRes?.totalIncome ?? 0, 'المصروفات': monthRes?.totalExpenses ?? 0, 'الصافي': monthRes?.net ?? 0 });
      rows.push({ 'الفترة': 'الرصيد الحالي', 'الدخل': 0, 'المصروفات': 0, 'الصافي': typeof balRes === 'number' ? balRes : 0 });
      return rows;
    }
    default:
      return [];
  }
};

const applyPeriodFilter = (rows: any[], type: string, from = '', to = ''): any[] => {
  if (type === 'DAILY' && rows.some((r) => r['التاريخ'])) {
    const today = todayISO();
    return rows.filter((r) => String(r['التاريخ']).slice(0, 10) === today);
  }
  if (type === 'MONTHLY' && rows.some((r) => r['التاريخ'])) {
    const ym = currentYearMonth();
    return rows.filter((r) => String(r['التاريخ']).slice(0, 7) === ym);
  }
  if (from || to) {
    // Range filter over whichever date column exists; rows without a parseable
    // date (e.g. financial summary rows) pass through untouched.
    return rows.filter((r) => {
      const d = String(r['التاريخ'] ?? '').slice(0, 10);
      if (!d || d.length !== 10) return true;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });
  }
  return rows;
};

export const ReportsPage: React.FC = () => {
  const [category, setCategory] = React.useState('PATIENTS');
  const [reportType, setReportType] = React.useState('SUMMARY');
  const [fromDate, setFromDate] = React.useState('');
  const [toDate, setToDate] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<any[]>([]);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [reportHistory, setReportHistory] = React.useState<{ time: string; category: string; count: number }[]>(() => {
    try {
      const raw = localStorage.getItem('zeyara_report_history');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  const persistHistory = React.useCallback((next: { time: string; category: string; count: number }[]) => {
    setReportHistory(next);
    localStorage.setItem('zeyara_report_history', JSON.stringify(next));
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      let data = await fetchCategory(category);
      data = applyPeriodFilter(data, reportType, fromDate, toDate);
      setRows(data);
      setHeaders(data.length ? Object.keys(data[0]) : []);
      if (data.length) {
        persistHistory([
          { time: new Date().toLocaleString('ar-EG'), category: CATEGORIES[category], count: data.length },
          ...reportHistory,
        ].slice(0, 50));
      }
    } catch (err: any) {
      setError(err.message || 'فشل إنشاء التقرير');
      setRows([]);
      setHeaders([]);
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!rows.length || !headers.length) return;
    const csvContent = [
      headers.join(','),
      ...rows.map((row: any) => headers.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    void saveDocument(new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' }), `report-${todayISO()}.csv`);
  };

  const exportPDF = async () => {
    if (!rows.length || !headers.length) return;

    const profile = await getClinicProfile();
    const visible = rows.slice(0, 1000);
    const docId = `RPT-${category}-${docStamp()}`;
    const periodLabel =
      reportType === 'DAILY' ? 'يومي' : reportType === 'MONTHLY' ? 'شهري' : 'ملخص';
    const range = fromDate || toDate ? `${fromDate || '…'} ← ${toDate || '…'}` : 'غير محددة';

    const blocks: PdfBlock[] = [
      ...clinicHeaderBlock(profile),
      { kind: 'docTitle', text: `تقرير ${CATEGORIES[category]}` },
      { kind: 'docId', text: docId },
      { kind: 'section', text: 'معايير التقرير' },
      { kind: 'kv', label: 'الفئة', value: CATEGORIES[category] },
      { kind: 'kv', label: 'النوع', value: periodLabel },
      { kind: 'kv', label: 'الفترة', value: range },
      { kind: 'kv', label: 'عدد السجلات', value: String(rows.length) },
      { kind: 'section', text: 'البيانات' },
      ...(rows.length > 1000
        ? [{ kind: 'paragraph' as const, text: `تم اقتصاص النتائج إلى أول 1000 سجل (الإجمالي ${rows.length}).` }]
        : []),
      {
        kind: 'table',
        headers,
        rows: visible.map((row: any) => headers.map((h) => String(row[h] ?? ''))),
      },
      ...footerBlock(docId),
      { kind: 'signature', text: 'إدارة العيادة' },
    ];

    exportArabicDocumentPdf({ filename: `report-${todayISO()}.pdf`, blocks });
  };

  const exportExcel = async () => {
    if (!rows.length || !headers.length) return;
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Report');
    sheet.addRow(headers);
    rows.forEach((row: any) => { sheet.addRow(headers.map((h) => row[h] ?? '')); });
    const buffer = await workbook.xlsx.writeBuffer();
    void saveDocument(new Blob([buffer]), `report-${todayISO()}.xlsx`);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>مركز التقارير</Typography>
          <Typography variant="body2" color="text.secondary">إنشاء وتصدير تقارير العيادة</Typography>
        </Box>
        <Button variant="outlined" startIcon={<HistoryIcon />} onClick={() => setHistoryOpen(true)}>سجل التقارير</Button>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ p: 3, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <FormControl sx={{ minWidth: 200 }}>
            <InputLabel>الفئة *</InputLabel>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} label="الفئة *" size="small">
              {Object.entries(CATEGORIES).map(([k, v]) => (
                <MenuItem key={k} value={k}>{v}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth: 160 }}>
            <InputLabel>نوع التقرير</InputLabel>
            <Select value={reportType} onChange={(e) => setReportType(e.target.value)} label="نوع التقرير" size="small">
              <MenuItem value="DAILY">يومي</MenuItem>
              <MenuItem value="MONTHLY">شهري</MenuItem>
              <MenuItem value="SUMMARY">ملخص</MenuItem>
            </Select>
          </FormControl>
          <TextField label="من" type="date" size="small" value={fromDate} onChange={(e) => setFromDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField label="إلى" type="date" size="small" value={toDate} onChange={(e) => setToDate(e.target.value)} InputLabelProps={{ shrink: true }} />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={<RefreshIcon />} onClick={handleGenerate} disabled={loading}>
            {loading ? <CircularProgress size={18} /> : 'إنشاء'}
          </Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportCSV} disabled={!rows.length}>تصدير CSV</Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportPDF} disabled={!rows.length}>تصدير PDF</Button>
          <Button variant="outlined" startIcon={<DownloadIcon />} onClick={exportExcel} disabled={!rows.length}>تصدير Excel</Button>
        </Box>
      </Paper>

      <Paper>
        <Box sx={{ p: 2, borderBottom: '1px solid #E5E7EB' }}>
          <Typography variant="h6">{rows.length ? `النتائج (${rows.length})` : 'النتائج'}</Typography>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {headers.map((h) => <TableCell key={h}>{h}</TableCell>)}
                {!headers.length && <TableCell>لا توجد بيانات</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={Math.max(headers.length, 1)} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  {loading ? 'جاري التحميل...' : 'اضغط "إنشاء" لتوليد التقرير'}
                </TableCell></TableRow>
              ) : (
                rows.slice(0, 100).map((row, idx) => (
                  <TableRow key={idx}>
                    {headers.map((h) => <TableCell key={h}>{String(row[h] ?? '')}</TableCell>)}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>سجل التقارير</DialogTitle>
        <DialogContent>
          {reportHistory.length === 0 ? (
            <Typography variant="body2" color="text.secondary">لا توجد تقارير بعد</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>الوقت</TableCell>
                    <TableCell>الفئة</TableCell>
                    <TableCell>عدد السجلات</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {reportHistory.map((h, i) => (
                    <TableRow key={i}>
                      <TableCell>{h.time}</TableCell>
                      <TableCell>{h.category}</TableCell>
                      <TableCell>{h.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryOpen(false)}>إغلاق</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
