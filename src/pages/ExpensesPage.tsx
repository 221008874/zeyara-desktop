import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { offlineGet, offlineWrite } from '../lib/offlineDb';
import { useSseRefresh } from '../lib/useSseRefresh';
import { todayISO } from '../lib/format';
import { useAuthStore } from '../stores/auth';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { EmptyState } from '../design-system/EmptyState';

const CATEGORIES = ['RENT', 'SALARY', 'EQUIPMENT', 'MARKETING', 'UTILITIES', 'SUPPLIES', 'OTHER'];

const categoryLabel = (code: string): string => {
  const map: Record<string, string> = {
    RENT: 'إيجار',
    SALARY: 'رواتب',
    EQUIPMENT: 'معدات',
    MARKETING: 'تسويق',
    UTILITIES: 'مرافق',
    SUPPLIES: 'مستلزمات',
    OTHER: 'أخرى',
  };
  return map[code] ?? code;
};

const money = (v: any): string => `${Number(v ?? 0).toFixed(2)} ج.م`;

export const ExpensesPage: React.FC = () => {
  const { session } = useAuthStore();
  const canApprove = session?.role === 'ADMIN';

  const [expenses, setExpenses] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<'ALL' | 'PENDING' | 'APPROVED'>('ALL');
  const [statusMsg, setStatusMsg] = React.useState<string | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);

  const [title, setTitle] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [category, setCategory] = React.useState('SUPPLIES');
  const [expenseDate, setExpenseDate] = React.useState(todayISO());
  const [notes, setNotes] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingNotice, setPendingNotice] = React.useState<string | null>(null);

  const [confirm, setConfirm] = React.useState<{
    open: boolean;
    type: 'approve' | 'reject' | 'unapprove';
    expense: any;
    title: string;
    message: string;
  } | null>(null);
  const [actionBusy, setActionBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await offlineGet('/api/expenses');
      setExpenses(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setStatusError(err.message || 'فشل تحميل المصروفات');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  useSseRefresh(load);

  const handleSubmit = async () => {
    setStatusError(null);
    setStatusMsg(null);
    setPendingNotice(null);
    if (!title.trim()) {
      setStatusError('الرجاء إدخال الوصف');
      return;
    }
    const amountVal = Number(amount);
    if (!amountVal || amountVal <= 0) {
      setStatusError('المبلغ يجب أن يكون رقماً أكبر من صفر');
      return;
    }
    if (!expenseDate) {
      setStatusError('الرجاء اختيار التاريخ');
      return;
    }
    setSubmitting(true);
    try {
      const result = await offlineWrite('POST', '/api/expenses', {
        title: title.trim(),
        amount: amountVal,
        category,
        expenseDate,
        notes: notes.trim() || undefined,
      });
      const id = result?.data?.id;
      setPendingNotice(result?.queued
        ? `أنت غير متصل. تمت جدولة المصروف وسيُرسل عند استعادة الاتصال${id ? ` (المرجع: ${id ?? '—'})` : ''}`
        : `تم إرسال المصروف بنجاح | المعرف: ${id ?? '—'} | في انتظار موافقة الإدارة`);
      setTitle('');
      setAmount('');
      setCategory('SUPPLIES');
      setExpenseDate(todayISO());
      setNotes('');
      await load();
    } catch (err: any) {
      setStatusError(`فشل الإرسال: تحقق من الاتصال بالسيرفر\n${err.message || ''}`);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmAction = (type: 'approve' | 'reject' | 'unapprove', exp: any) => {
    if (type === 'approve') {
      setConfirm({
        open: true,
        type,
        expense: exp,
        title: 'تأكيد الموافقة',
        message: `هل تريد الموافقة على هذا المصروف؟\nالمبلغ: ${money(exp.amount)}\nالوصف: ${exp.title}\n\nسيتم خصم المبلغ فوراً من الخزينة`,
      });
    } else if (type === 'reject') {
      setConfirm({
        open: true,
        type,
        expense: exp,
        title: 'تأكيد الرفض',
        message: `هل تريد رفض هذا المصروف؟\nالوصف: ${exp.title}\nلن يتأثر رصيد الخزينة`,
      });
    } else {
      setConfirm({
        open: true,
        type,
        expense: exp,
        title: 'إلغاء الموافقة على المصروف',
        message: `هل أنت متأكد من إلغاء الموافقة على هذا المصروف؟ سيتم عكس قيد الأمانة المالية.\nالمبلغ: ${money(exp.amount)}\nالوصف: ${exp.title}`,
      });
    }
  };

  const runAction = async () => {
    if (!confirm) return;
    setActionBusy(true);
    setStatusError(null);
    try {
      const { expense, type } = confirm;
      let res;
      let msg: string;
      if (type === 'approve') {
        res = await offlineWrite('PUT', `/api/expenses/${expense.id}/approve`);
        msg = `تمت الموافقة — تم خصم ${money(expense.amount)} من الخزينة`;
      } else if (type === 'reject') {
        res = await offlineWrite('PUT', `/api/expenses/${expense.id}/reject`);
        msg = 'تم رفض المصروف — الخزينة لم تتأثر';
      } else {
        res = await offlineWrite('PUT', `/api/expenses/${expense.id}/unapprove`);
        msg = 'تم إلغاء الموافقة — تم عكس قيد الأمانة المالية';
      }
      if (res.queued) msg = `أنت غير متصل. تمت جدولة العملية وستُطبَّق عند استعادة الاتصال`;
      setStatusMsg(msg);
      setConfirm(null);
      await load();
    } catch (err: any) {
      setStatusError(`خطأ: ${err.message || 'فشل تنفيذ العملية'}`);
    } finally {
      setActionBusy(false);
    }
  };

  const filtered = expenses.filter((e) => (filter === 'ALL' ? true : e.status === filter));

  const totalApproved = expenses
    .filter((e) => e.status === 'APPROVED')
    .reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const pendingCount = expenses.filter((e) => e.status === 'PENDING').length;
  const approvedCount = expenses.filter((e) => e.status === 'APPROVED').length;

  const statusBadge = (s: string) => {
    if (s === 'APPROVED') return <Chip size="small" label="موافق عليه" color="success" />;
    if (s === 'REJECTED') return <Chip size="small" label="مرفوض" color="error" />;
    return <Chip size="small" label="معلق" color="warning" />;
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>إدارة المصروفات</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>إدارة مصروفات العيادة</Typography>

      {statusMsg && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setStatusMsg(null)}>{statusMsg}</Alert>}
      {statusError && <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-line' }} onClose={() => setStatusError(null)}>{statusError}</Alert>}
      {pendingNotice && <Alert severity="info" sx={{ mb: 2 }} onClose={() => setPendingNotice(null)}>{pendingNotice}</Alert>}

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>الملخص</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box>
                <Typography variant="body2" color="text.secondary">إجمالي المعتمد</Typography>
                <Typography variant="h6" fontWeight={700}>{money(totalApproved)}</Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">معلق</Typography>
                <Typography variant="h6" fontWeight={700}>{pendingCount}</Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">إجمالي الموافق عليه</Typography>
                <Typography variant="h6" fontWeight={700}>{approvedCount}</Typography>
              </Box>
            </Box>
          </Paper>

          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>تصفية</Typography>
            <ToggleButtonGroup
              value={filter}
              exclusive
              size="small"
              fullWidth
              onChange={(_, v) => v && setFilter(v)}
            >
              <ToggleButton value="ALL">الكل</ToggleButton>
              <ToggleButton value="PENDING">معلق</ToggleButton>
              <ToggleButton value="APPROVED">معتمد</ToggleButton>
            </ToggleButtonGroup>
          </Paper>

          <Paper sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>دليل الحالات</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#F59E0B' }} />
                <Typography variant="body2">معلق — في انتظار المسؤول</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#22C55E' }} />
                <Typography variant="body2">موافق عليه — تم الخصم من الخزينة</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#EF4444' }} />
                <Typography variant="body2">مرفوض — لا يؤثر على الخزينة</Typography>
              </Box>
            </Box>
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper sx={{ p: 3, mb: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 0.5 }}>
              {canApprove ? 'إضافة مصروف' : 'تقديم مصروف'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {canApprove ? 'أضف مصروفاً جديداً لموافقة الإدارة' : 'تقديم طلب مصروف لموافقة الإدارة'}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="الوصف *"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                fullWidth
                size="small"
                required
              />
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <TextField
                  label="المبلغ (ج.م) *"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  sx={{ flex: 1, minWidth: 160 }}
                  size="small"
                  required
                />
                <FormControl sx={{ minWidth: 160 }} size="small">
                  <InputLabel>الفئة *</InputLabel>
                  <Select value={category} label="الفئة *" onChange={(e) => setCategory(e.target.value)}>
                    {CATEGORIES.map((c) => (
                      <MenuItem key={c} value={c}>{categoryLabel(c)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="التاريخ *"
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  size="small"
                  InputLabelProps={{ shrink: true }}
                  sx={{ minWidth: 150 }}
                />
              </Box>
              <TextField
                label="ملاحظات"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                fullWidth
                multiline
                minRows={2}
                size="small"
              />
              <Button variant="contained" onClick={handleSubmit} disabled={submitting} sx={{ alignSelf: 'flex-start' }}>
                {submitting ? <CircularProgress size={20} /> : canApprove ? 'إضافة مصروف' : 'تقديم للموافقة'}
              </Button>
            </Box>
          </Paper>

          <Paper>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>المبلغ</TableCell>
                    <TableCell>الوصف</TableCell>
                    <TableCell>الفئة</TableCell>
                    <TableCell>التاريخ</TableCell>
                    <TableCell>الحالة</TableCell>
                    {canApprove && <TableCell>الإجراءات</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {loading ? (
                    <TableSkeleton cols={canApprove ? 6 : 5} />
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={canApprove ? 6 : 5} sx={{ border: 0, p: 0 }}>
                        <EmptyState title="لم يتم العثور على مصروفات" hint="استخدم النموذج على اليسار لإضافة مصروف جديد." />
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((exp: any) => (
                      <TableRow key={exp.id}>
                        <TableCell>{money(exp.amount)}</TableCell>
                        <TableCell>{exp.title}</TableCell>
                        <TableCell>{categoryLabel(exp.category)}</TableCell>
                        <TableCell>{exp.expenseDate ?? '—'}</TableCell>
                        <TableCell>{statusBadge(exp.status)}</TableCell>
                        {canApprove && (
                          <TableCell>
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                              {exp.status === 'PENDING' && exp.createdBy !== session?.username && (
                                <>
                                  <Button size="small" color="success" onClick={() => confirmAction('approve', exp)}>موافقة</Button>
                                  <Button size="small" color="error" onClick={() => confirmAction('reject', exp)}>رفض</Button>
                                </>
                              )}
                              {exp.status === 'APPROVED' && (
                                <Button size="small" color="inherit" onClick={() => confirmAction('unapprove', exp)}>إلغاء الموافقة</Button>
                              )}
                            </Box>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Grid>
      </Grid>

      <Dialog open={!!confirm} onClose={() => !actionBusy && setConfirm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{confirm?.title}</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ whiteSpace: 'pre-line' }}>{confirm?.message}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)} disabled={actionBusy}>إلغاء</Button>
          <Button
            variant="contained"
            color={confirm?.type === 'reject' ? 'error' : confirm?.type === 'approve' ? 'success' : 'primary'}
            onClick={runAction}
            disabled={actionBusy}
          >
            {actionBusy ? <CircularProgress size={20} /> : 'تأكيد'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
