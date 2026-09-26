import React from 'react';
import {
  Typography, Box, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Alert, CircularProgress, Chip,
} from '@mui/material';
import { api } from '../lib/api';
import AddIcon from '@mui/icons-material/Add';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { EmptyState } from '../design-system/EmptyState';

type UserType = 'DOCTOR' | 'SECRETARY';

export const UsersPage: React.FC = () => {
  const [doctors, setDoctors] = React.useState<any[]>([]);
  const [secretaries, setSecretaries] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [open, setOpen] = React.useState(false);
  const [userType, setUserType] = React.useState<UserType>('DOCTOR');
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', username: '', phone: '', password: '' });
  const [editTarget, setEditTarget] = React.useState<{ type: UserType; id: number; name: string; username: string; phone: string } | null>(null);

  const [deleteTarget, setDeleteTarget] = React.useState<{ type: UserType; id: number; name: string } | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [drRes, secRes] = await Promise.all([
        api.get('/api/doctors'),
        api.get('/api/secretaries'),
      ]);
      setDoctors(drRes.data ?? []);
      setSecretaries(secRes.data ?? []);
    } catch (err: any) {
      setError(err.message || 'فشل تحميل المستخدمين');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const openRegister = (type: UserType) => {
    setUserType(type);
    setForm({ name: '', username: '', phone: '', password: '' });
    setOpen(true);
  };

  const openEdit = (type: UserType, u: any) => {
    setEditTarget({ type, id: u.id, name: u.name, username: u.username, phone: u.phone ?? '' });
    setForm({ name: u.name, username: u.username, phone: u.phone ?? '', password: '' });
    setOpen(true);
  };

  const handleSave = async () => {
    setError(null);
    setMessage(null);
    if (!form.name.trim()) { setError('الرجاء إدخال الاسم'); return; }
    if (editTarget && !form.username.trim()) { setError('الرجاء إدخال اسم المستخدم'); return; }
    if (!editTarget && !form.username.trim()) { setError('الرجاء إدخال اسم المستخدم'); return; }
    if (!editTarget && form.password.length < 8) { setError('كلمة المرور يجب أن تكون 8 أحرف على الأقل'); return; }
    setSaving(true);
    try {
      const type = editTarget ? editTarget.type : userType;
      const path = type === 'DOCTOR' ? 'doctors' : 'secretaries';
      if (editTarget) {
        const payload = {
          name: form.name.trim(),
          username: form.username.trim(),
          phone: form.phone.trim(),
          ...(form.password ? { password: form.password } : {}),
        };
        await api.put(`/api/${path}/${editTarget.id}`, payload);
        setMessage(`تم تحديث ${type === 'DOCTOR' ? 'الطبيب' : 'السكرتير'} ${form.name.trim()} بنجاح`);
      } else {
        const payload = {
          name: form.name.trim(),
          username: form.username.trim(),
          phone: form.phone.trim(),
          password: form.password,
          forcePasswordChange: true,
        };
        await api.post(`/api/${path}`, payload);
        setMessage(`تم تسجيل ${type === 'DOCTOR' ? 'طبيب' : 'سكرتير'} ${form.username.trim()} بنجاح`);
      }
      setOpen(false);
      setEditTarget(null);
      load();
    } catch (err: any) {
      setError(err.message || 'فشلت العملية — قد يكون اسم المستخدم مستخدماً');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      const { type, id } = deleteTarget;
      await api.delete(`/api/${type === 'DOCTOR' ? 'doctors' : 'secretaries'}/${id}`);
      setMessage(`تم حذف ${deleteTarget.name}`);
      setDeleteTarget(null);
      load();
    } catch (err: any) {
      setError(err.message || 'فشل الحذف');
    } finally {
      setDeleting(false);
    }
  };

  const userTable = (type: UserType, list: any[]) => (
    <Paper sx={{ p: 3, mb: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">{type === 'DOCTOR' ? `الأطباء (${list.length})` : `السكرتيرات (${list.length})`}</Typography>
        <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => openRegister(type)}>
          تسجيل {type === 'DOCTOR' ? 'طبيب' : 'سكرتير'}
        </Button>
      </Box>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>الاسم</TableCell>
              <TableCell>اسم المستخدم</TableCell>
              <TableCell>الهاتف</TableCell>
              <TableCell>تغيير كلمة المرور</TableCell>
              <TableCell>إجراءات</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableSkeleton cols={5} />
            ) : list.length === 0 ? (
              <TableRow><TableCell colSpan={5} sx={{ border: 0, p: 0 }}><EmptyState title="لا يوجد مستخدمون" hint="أضف مستخدماً لبدء العمل." /></TableCell></TableRow>
            ) : (
              list.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.name}</TableCell>
                  <TableCell>{d.username}</TableCell>
                  <TableCell>{d.phone}</TableCell>
                  <TableCell>
                    <Chip size="small" color={d.forcePasswordChange ? 'warning' : 'success'} label={d.forcePasswordChange ? 'مطلوب' : 'لا'} />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button size="small" color="primary" onClick={() => openEdit(type, d)}>
                        تعديل
                      </Button>
                      <Button size="small" color="error" onClick={() => setDeleteTarget({ type, id: d.id, name: d.name })}>
                        حذف
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>المستخدمون</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>إدارة حسابات الأطباء والسكرتيرات</Typography>

      {message && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : (
        <>
          {userTable('DOCTOR', doctors)}
          {userTable('SECRETARY', secretaries)}
        </>
      )}

      <Dialog open={open} onClose={() => { if (!saving) { setOpen(false); setEditTarget(null); } }} maxWidth="sm" fullWidth>
        <DialogTitle>{editTarget ? `تعديل ${editTarget.type === 'DOCTOR' ? 'طبيب' : 'سكرتير'}` : `تسجيل ${userType === 'DOCTOR' ? 'طبيب' : 'سكرتير'} جديد`}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField label="الاسم *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} fullWidth required />
            <TextField label="اسم المستخدم *" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} fullWidth required />
            <TextField label="الهاتف" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} fullWidth />
            {editTarget ? (
              <TextField label="كلمة المرور (اتركها فارغة للإبقاء على الحالية)" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} fullWidth />
            ) : (
              <TextField label="كلمة المرور * (8 أحرف على الأقل)" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} fullWidth required />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setOpen(false); setEditTarget(null); }} disabled={saving}>إلغاء</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? <CircularProgress size={20} /> : editTarget ? 'حفظ' : 'تسجيل'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)}>
        <DialogTitle>حذف المستخدم</DialogTitle>
        <DialogContent>
          <Typography>هل أنت متأكد من حذف {deleteTarget?.name}؟</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>تراجع</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? <CircularProgress size={18} /> : 'حذف'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};