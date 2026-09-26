import React from 'react';
import { useNavigate } from 'react-router-dom';
import { offlineGet, offlineWrite } from '../lib/offlineDb';
import { useSseRefresh } from '../lib/useSseRefresh';
import { useAuthStore } from '../stores/auth';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { EmptyState } from '../design-system/EmptyState';
import {
  Typography, Box, Button, TextField, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination,   Dialog, DialogActions, DialogContent, DialogTitle, Alert,
} from '@mui/material';

export const PatientsPage: React.FC = () => {
  const navigate = useNavigate();
  const { session } = useAuthStore();
  const isClinician = session?.role === 'ADMIN' || session?.role === 'DOCTOR';
  const [patients, setPatients] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);
  const [deleteTarget, setDeleteTarget] = React.useState<any | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [statusError, setStatusError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const data = await offlineGet<any[]>('/api/patients');
      setPatients(data ?? []);
    } catch (err: any) {
      setStatusError(err.message || 'فشل تحميل المرضى');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  useSseRefresh(load);

  const filtered = patients.filter(
    (p) =>
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.phone?.includes(search)
  );

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setStatusError(null);
    try {
      const res = await offlineWrite('DELETE', `/api/patients/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
      if (res.queued) setStatusError('أنت غير متصل الآن. تمت جدولة حذف المريض وسيُطبَّق عند استعادة الاتصال.');
    } catch (err: any) {
      setStatusError(err.message || 'فشل حذف المريض');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 700 }}>
        المرضى
      </Typography>
      {statusError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setStatusError(null)}>{statusError}</Alert>}
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <TextField
          label="بحث"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          sx={{ flex: 1 }}
        />
        <Button variant="contained" onClick={() => navigate('/patients/new')}>
          إضافة مريض
        </Button>
      </Box>
      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>الاسم</TableCell>
                <TableCell>الهاتف</TableCell>
                <TableCell>العمر</TableCell>
                <TableCell>الجنس</TableCell>
                <TableCell>الحالة</TableCell>
                <TableCell>إجراءات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableSkeleton cols={6} />
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} sx={{ border: 0, p: 0 }}>
                    <EmptyState
                      title="لا يوجد مرضى"
                      hint="ابدأ بإضافة أول مريض إلى النظام."
                      actionLabel="إضافة مريض"
                      onAction={() => navigate('/patients/new')}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filtered
                  .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                  .map((patient) => (
                    <TableRow
                      key={patient.id}
                      hover
                      onClick={() => navigate(`/patients/${patient.id}`)}
                      sx={{ cursor: 'pointer' }}
                    >
                      <TableCell>{patient.name}</TableCell>
                      <TableCell>{patient.phone}</TableCell>
                      <TableCell>{patient.age ?? '-'}</TableCell>
                      <TableCell>{patient.gender ?? '-'}</TableCell>
                      <TableCell>
                        {patient.synced === false ? 'غير مزامن' : 'مزامن'}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {isClinician && (
                            <>
                              <Button size="small" variant="outlined" onClick={() => navigate(`/patients/${patient.id}/edit`)}>
                                تعديل
                              </Button>
                              <Button size="small" variant="outlined" color="error" onClick={() => setDeleteTarget(patient)}>
                                حذف
                              </Button>
                            </>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          rowsPerPageOptions={[5, 10, 25]}
          component="div"
          count={filtered.length}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
        />
      </Paper>

      <Dialog open={!!deleteTarget} onClose={() => !deleting && setDeleteTarget(null)}>
        <DialogTitle>حذف المريض</DialogTitle>
        <DialogContent>
          <Typography>
            هل أنت متأكد من حذف المريض {deleteTarget?.name}؟ سيؤدي هذا إلى حذف سجله وبياناته المرتبطة نهائياً.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>تراجع</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? 'جاري الحذف...' : 'حذف نهائي'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
