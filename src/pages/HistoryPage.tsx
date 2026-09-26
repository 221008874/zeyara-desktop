import React from 'react';
import {
  Alert,
  Typography,
  Box,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  TextField,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { offlineGet } from '../lib/offlineDb';
import { useSseRefresh } from '../lib/useSseRefresh';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { EmptyState } from '../design-system/EmptyState';

export const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [history, setHistory] = React.useState<any[]>([]);
  const [patients, setPatients] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');
  const [categoryFilter, setCategoryFilter] = React.useState('ALL');

  const load = React.useCallback(async () => {
    try {
      const data = await offlineGet('/api/history');
      setHistory(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'فشل تحميل السجل الطبي');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
    offlineGet('/api/patients')
      .then((data) => setPatients(Array.isArray(data) ? data : []))
      .catch(() => { /* ignore */ });
  }, [load]);

  useSseRefresh(load);

  const patientName = (id: number) => {
    const p = patients.find((x) => Number(x.id) === Number(id));
    return p?.name ?? `#${id}`;
  };

  const categories = React.useMemo(() => {
    const set = new Set<string>();
    history.forEach((h) => { if (h.category) set.add(h.category); });
    return Array.from(set);
  }, [history]);

  const filtered = history.filter((h) => {
    if (categoryFilter !== 'ALL' && h.category !== categoryFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      patientName(h.patientId).toLowerCase().includes(q) ||
      String(h.diagnosis ?? '').toLowerCase().includes(q) ||
      String(h.notes ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 3 }}>
        <Box>
          <Typography variant="h5" sx={{ mb: 0.5, fontWeight: 700 }}>التاريخ الطبي</Typography>
          <Typography variant="body2" color="text.secondary">السجل الطبي الكامل لجميع المرضى</Typography>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <TextField
          label="بحث (مريض / تشخيص / ملاحظات)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          sx={{ flex: 1, minWidth: 240 }}
        />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>التصنيف</InputLabel>
          <Select value={categoryFilter} label="التصنيف" onChange={(e) => setCategoryFilter(e.target.value)}>
            <MenuItem value="ALL">الكل</MenuItem>
            {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>

      <Paper>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>المريض</TableCell>
                <TableCell>الموعد</TableCell>
                <TableCell>التشخيص</TableCell>
                <TableCell>الفئة</TableCell>
                <TableCell>ملاحظات</TableCell>
                <TableCell>التاريخ</TableCell>
                <TableCell>إجراءات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableSkeleton cols={7} />
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} sx={{ border: 0, p: 0 }}><EmptyState title="لا يوجد سجل طبي" hint="لا يوجد تاريخ طبي مطابق للمعايير المحددة." /></TableCell></TableRow>
              ) : (
                filtered.map((h) => (
                  <TableRow key={h.id} hover>
                    <TableCell>
                      <Button
                        sx={{ textTransform: 'none', justifyContent: 'flex-start', p: 0, minWidth: 0 }}
                        onClick={() => navigate(`/patients/${h.patientId}`)}
                      >
                        {patientName(h.patientId)}
                      </Button>
                    </TableCell>
                    <TableCell>{h.appointmentId ?? '—'}</TableCell>
                    <TableCell>{h.diagnosis || '—'}</TableCell>
                    <TableCell>
                      {h.category
                        ? <Chip size="small" label={h.category} />
                        : '—'}
                    </TableCell>
                    <TableCell>{h.notes || '—'}</TableCell>
                    <TableCell>{h.createdAt || '—'}</TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => navigate(`/patients/${h.patientId}`)}
                      >
                        فتح الملف
                      </Button>
                    </TableCell>
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
