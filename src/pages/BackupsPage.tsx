import React from 'react';
import {
  Typography, Box, Paper, Button, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Alert, CircularProgress, Chip, LinearProgress, FormControl, InputLabel, Select, MenuItem,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import { api } from '../lib/api';
import { EmptyState } from '../design-system/EmptyState';

export const BackupsPage: React.FC = () => {
  const [backups, setBackups] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [maintenance, setMaintenance] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [restoring, setRestoring] = React.useState(false);
  const [restoreConfirm, setRestoreConfirm] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<any | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [res, maint] = await Promise.all([
        api.get('/api/admin/backups'),
        api.post('/api/admin/backups/maintenance', { action: 'status' }),
      ]);
      setBackups(res.data ?? []);
      setMaintenance(!!maint?.data?.maintenanceMode);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const toggleMaintenance = async () => {
    setMessage(null);
    try {
      const res = await api.post('/api/admin/backups/maintenance', { action: maintenance ? 'exit' : 'enter' });
      setMaintenance(!!res?.data?.maintenanceMode);
      setMessage(res?.data?.message ?? 'تم تغيير وضع الصيانة');
    } catch (err: any) {
      setMessage('فشل تغيير وضع الصيانة: ' + (err.message || ''));
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setMessage(null);
    try {
      await api.post('/api/admin/backups/create');
      setMessage('تم إنشاء النسخة الاحتياطية بنجاح');
      await load();
    } catch (err: any) {
      setMessage('فشل إنشاء النسخة: ' + (err.message || ''));
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async () => {
    if (!file) {
      setMessage('الرجاء اختيار ملف النسخة الاحتياطية (.sql)');
      return;
    }
    setRestoring(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.postForm('/api/admin/backups/restore', formData);
      setMessage('تمت الاستعادة بنجاح');
      setFile(null);
      setRestoreConfirm(false);
    } catch (err: any) {
      setMessage('فشل الاستعادة: ' + (err.message || ''));
    } finally {
      setRestoring(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setMessage(null);
    try {
      await api.delete(`/api/admin/backups/${encodeURIComponent(deleteTarget.filename)}`);
      setBackups((prev) => prev.filter((bk) => bk.filename !== deleteTarget.filename));
      setMessage(`تم حذف النسخة ${deleteTarget.filename}`);
      setDeleteTarget(null);
    } catch (err: any) {
      setMessage('فشل الحذف: ' + (err.message || ''));
      setDeleteTarget(null);
    }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>النسخ الاحتياطية</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>إنشاء واستعادة النسخ الاحتياطية لقاعدة البيانات</Typography>

      {message && (
        <Alert severity={message.includes('فشل') ? 'error' : 'success'} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
          {message}
        </Alert>
      )}

      <Paper sx={{ p: 3, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Chip
            color={maintenance ? 'warning' : 'success'}
            label={maintenance ? 'وضع الصيانة مفعل' : 'وضع الصيانة غير مفعل'}
          />
          <Typography variant="body2" color="text.secondary">
            وضع الصيانة يجب أن يكون مفعلاً قبل الإنشاء أو الاستعادة.
          </Typography>
          <Button variant="outlined" onClick={toggleMaintenance} sx={{ mr: 'auto' }}>
            {maintenance ? 'الخروج من وضع الصيانة' : 'الدخول في وضع الصيانة'}
          </Button>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={handleCreate} disabled={creating || !maintenance}>
            {creating ? <CircularProgress size={20} /> : 'إنشاء نسخة احتياطية'}
          </Button>
          {!maintenance && (
            <Typography variant="body2" color="text.warning" sx={{ color: '#B45309' }}>
              فعّل وضع الصيانة أولاً
            </Typography>
          )}
        </Box>

        <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid #E5E7EB' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>استعادة من ملف</Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 280 }}>
              <InputLabel shrink>ملف النسخة (.sql)</InputLabel>
              <Select
                label="ملف النسخة (.sql)"
                value={file?.name ?? ''}
                onChange={(e) => {
                  const f = e.target.value;
                  if (f === '__pick__') {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.sql';
                    input.onchange = () => {
                      if (input.files?.length) setFile(input.files[0]);
                    };
                    input.click();
                  }
                }}
              >
                <MenuItem value="__pick__">اختر ملف...</MenuItem>
                {file && <MenuItem value={file.name}>{file.name}</MenuItem>}
              </Select>
            </FormControl>
            <Button variant="contained" color="secondary" onClick={() => setRestoreConfirm(true)} disabled={restoring || !maintenance || !file}>
              {restoring ? <CircularProgress size={20} /> : 'استعادة'}
            </Button>
          </Box>
        </Box>
      </Paper>

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>الاسم</TableCell>
                <TableCell>الحجم</TableCell>
                <TableCell>التاريخ</TableCell>
                <TableCell>إجراءات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={4} align="center"><LinearProgress sx={{ my: 1 }} /></TableCell></TableRow>
              ) : backups.length === 0 ? (
                <TableRow><TableCell colSpan={4} sx={{ border: 0, p: 0 }}><EmptyState title="لا توجد نسخ احتياطية" hint="أنشئ نسخة احتياطية لبدء الحماية." /></TableCell></TableRow>
              ) : (
                backups.map((b) => (
                  <TableRow key={b.filename}>
                    <TableCell>{b.filename}</TableCell>
                    <TableCell>{b.sizeKb} KB</TableCell>
                    {/* BackupInfo is (filename, path, sizeKb, createdAt) — there
                        is no lastBackupTime per row, so this column rendered
                        blank for every backup. createdAt is an ISO instant, so
                        format it rather than dumping the raw string. */}
                    <TableCell>
                      {b.createdAt
                        ? new Date(b.createdAt).toLocaleString('en-GB', { hour12: false })
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Button size="small" onClick={async () => {
                        try {
                          const res = await api.blob(`/api/admin/backups/download/${encodeURIComponent(b.filename)}`);
                          const url = URL.createObjectURL(res.data as Blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = b.filename;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch { /* ignore */ }
                      }}>تحميل</Button>
                      <Button size="small" color="error" onClick={() => setDeleteTarget(b)}>حذف</Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={restoreConfirm} onClose={() => !restoring && setRestoreConfirm(false)} maxWidth="sm" fullWidth>
        <DialogTitle>تأكيد الاستعادة</DialogTitle>
        <DialogContent>
          <Typography sx={{ whiteSpace: 'pre-line' }}>
            هل أنت متأكد من استعادة قاعدة البيانات من الملف التالي؟
{'\n\n'} <strong>{file?.name ?? '—'}</strong>
{'\n\n'}سيتم استبدال جميع بيانات النظام الحالية ببيانات هذه النسخة.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRestoreConfirm(false)} disabled={restoring}>تراجع</Button>
          <Button variant="contained" color="error" onClick={handleRestore} disabled={restoring}>
            {restoring ? <CircularProgress size={20} /> : 'استعادة الآن'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>تأكيد الحذف</DialogTitle>
        <DialogContent>
          <Typography sx={{ whiteSpace: 'pre-line' }}>
            هل أنت متأكد من حذف النسخة الاحتياطية؟
{'\n\n'} <strong>{deleteTarget?.filename}</strong>
{'\n\n'}هذا الإجراء لا يمكن التراجع عنه.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>تراجع</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>حذف نهائياً</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};