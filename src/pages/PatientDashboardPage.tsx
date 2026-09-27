import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
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
  Tab,
  Tabs,
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
import { completeVisit, EXAMINATION_CATEGORY, FOLLOW_UP_OFFSET_DAYS, FOLLOW_UP_TIME_ZONE } from '../lib/clinicalActions';
import {
  collectAgainstPayment,
  outstandingPayments,
  remainingOf,
  type CollectionRejection,
} from '../lib/paymentCollection';
import { todayISO } from '../lib/format';

/** User-facing text for a refused collection. Shared by every entry point. */
function collectionError(reason: CollectionRejection | undefined, remaining?: number): string {
  const bal = remaining !== undefined ? ` (${remaining.toFixed(2)} ج.م)` : '';
  switch (reason) {
    case 'no-payment':
      return 'لا يوجد دفعة مفتوحة للتحصيل.';
    case 'not-outstanding':
      return 'لا يوجد رصيد مستحق على هذه الدفعة.';
    case 'exceeds-remaining':
      return `المبلغ يتجاوز الرصيد المتبقي${bal}.`;
    default:
      return 'المبلغ المحصل يجب أن يكون أكبر من صفر.';
  }
}
import { ConfirmDialog } from '../design-system/ConfirmDialog';
import { EmptyState } from '../design-system/EmptyState';
import {
  exportDiagnosisDocumentPdf,
  exportPatientHistoryDocumentPdf,
  exportPaymentDocumentPdf,
  exportPrescriptionDocumentPdf,
} from '../lib/patientDocs';
import { useAuthStore } from '../stores/auth';

const fmt = (v: any) => (v == null || isNaN(Number(v)) ? '0' : Number(v).toFixed(2));

export const PatientDashboardPage: React.FC = () => {
  const { id } = useParams();
  const patientId = Number(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') ?? 'payments';
  const { session } = useAuthStore();
  const isClinician = session?.role === 'ADMIN' || session?.role === 'DOCTOR';

  const [patient, setPatient] = React.useState<any>(null);
  const [payments, setPayments] = React.useState<any[]>([]);
  const [summary, setSummary] = React.useState<any>(null);
  const [appointments, setAppointments] = React.useState<any[]>([]);
  const [history, setHistory] = React.useState<any[]>([]);
  const [medications, setMedications] = React.useState<any[]>([]);
  const [tab, setTab] = React.useState(initialTab);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [collectOpen, setCollectOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [payForm, setPayForm] = React.useState({
    totalAmount: '',
    paidAmount: '',
    paymentMethod: 'CASH',
    paymentDate: todayISO(),
    notes: '',
  });
  // Which existing payment a collection settles. Null means "record a new charge", which is
  // what the form did before; a value means "add this to what is already owed".
  const [collectTarget, setCollectTarget] = React.useState<any | null>(null);
  const [collectAmount, setCollectAmount] = React.useState('');

  const [completeTarget, setCompleteTarget] = React.useState<any | null>(null);
  const [diagnosis, setDiagnosis] = React.useState('');
  const [completionNotes, setCompletionNotes] = React.useState('');
  // Only meaningful for an examination, matching the legacy app where the amount field was
  // shown exclusively in that branch.
  const [followUpAmount, setFollowUpAmount] = React.useState('');
  const [completeNotice, setCompleteNotice] = React.useState<string | null>(null);
  const [completing, setCompleting] = React.useState(false);

  const [stopTarget, setStopTarget] = React.useState<any | null>(null);
  const [stopping, setStopping] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const [pRes, payRes, apptRes, histRes, medRes] = await Promise.all([
        api.get(`/api/patients/${patientId}`),
        api.get(`/api/payments/patient/${patientId}`),
        api.get('/api/appointments/range?start=2000-01-01&end=2100-12-31'),
        api.get(`/api/patients/${patientId}/history`),
        api.get(`/api/medications/patient/${patientId}`),
      ]);
      setPatient(pRes.data);
      setPayments(Array.isArray(payRes.data) ? payRes.data : []);
      setAppointments(
        (Array.isArray(apptRes.data) ? apptRes.data : []).filter(
          (a: any) => Number(a.patientId) === patientId
        )
      );
      setHistory(Array.isArray(histRes.data) ? histRes.data : []);
      setMedications(Array.isArray(medRes.data) ? medRes.data : []);
      try {
        const s = await api.get(`/api/payments/patient/${patientId}/summary`);
        setSummary(s.data ?? null);
      } catch {
        const list = Array.isArray(payRes.data) ? payRes.data : [];
        const totalBilled = list.reduce((s: number, p: any) => s + Number(p.totalAmount ?? 0), 0);
        const totalPaid = list.reduce((s: number, p: any) => s + Number(p.paidAmount ?? 0), 0);
        setSummary({
          totalBilled,
          totalPaid,
          totalRemaining: totalBilled - totalPaid,
          totalPayments: list.length,
        });
      }
    } catch (err: any) {
      setError(err.message || 'فشل تحميل بيانات المريض');
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  React.useEffect(() => {
    load();
  }, [load]);

  // The payments this patient still owes on. The first is the default target, matching the
  // legacy quick-pay which always acted on `unpaid.get(0)`.
  const openPayments = React.useMemo(() => outstandingPayments(payments), [payments]);

  const openCollectNew = () => {
    setCollectTarget(null);
    setCollectAmount('');
    setError(null);
    const remaining = summary?.totalRemaining ?? patient?.remainingBalance ?? 0;
    setPayForm({
      totalAmount: String(remaining || ''),
      paidAmount: String(remaining || ''),
      paymentMethod: 'CASH',
      paymentDate: todayISO(),
      notes: '',
    });
    setCollectOpen(true);
  };

  /** Collect against a payment that already exists, rather than recording a second charge. */
  const openCollectExisting = (payment: any) => {
    setCollectTarget(payment);
    setCollectAmount(String(remainingOf(payment) || ''));
    setError(null);
    setPayForm((prev) => ({ ...prev, paymentMethod: payment.paymentMethod ?? 'CASH' }));
    setCollectOpen(true);
  };

  const submitCollectExisting = async () => {
    if (!collectTarget) return;
    setSaving(true);
    setError(null);
    try {
      const result = await collectAgainstPayment(
        collectTarget,
        Number(collectAmount),
        payForm.paymentMethod
      );
      if (!result.ok) {
        setError(collectionError(result.reason, result.remaining));
        return;
      }
      setCollectOpen(false);
      setCollectTarget(null);
      await load();
    } catch (err: any) {
      setError(err.message || 'فشل تحصيل الدفعة');
    } finally {
      setSaving(false);
    }
  };

  const submitPayment = async () => {
    const totalAmount = Number(payForm.totalAmount);
    const paidAmount = Number(payForm.paidAmount);
    if (!totalAmount || totalAmount <= 0) {
      setError('المبلغ الإجمالي يجب أن يكون أكبر من صفر');
      return;
    }
    if (paidAmount < 0 || paidAmount > totalAmount) {
      setError('المبلغ المدفوع يجب أن يكون بين صفر والمبلغ الإجمالي');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/payments', {
        patientId,
        totalAmount,
        paidAmount,
        remainingAmount: totalAmount - paidAmount,
        paymentMethod: payForm.paymentMethod,
        notes: payForm.notes,
        paymentDate: payForm.paymentDate,
      });
      setCollectOpen(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'فشل حفظ الدفعة');
    } finally {
      setSaving(false);
    }
  };

  const submitCollect = () => {
    if (collectTarget) return submitCollectExisting();
    return submitPayment();
  };

  const exportPDF = () => {
    exportPaymentDocumentPdf({
      patient,
      payments,
      summary,
      filename: `payment-${patient?.name ?? 'patient'}-${Date.now()}.pdf`,
    });
  };

  const exportDiagnosisPDF = () => {
    exportDiagnosisDocumentPdf({
      patient,
      history,
      filename: `diagnosis-${patient?.name ?? 'patient'}-${Date.now()}.pdf`,
    });
  };

  const exportPrescriptionPDF = () => {
    exportPrescriptionDocumentPdf({
      patient,
      medications,
      doctorName: session?.username,
      filename: `prescription-${patient?.name ?? 'patient'}-${Date.now()}.pdf`,
    });
  };

  const exportFullRecordPDF = () => {
    exportPatientHistoryDocumentPdf({
      patient,
      appointments,
      history,
      medications,
      payments,
      summary,
      filename: `record-${patient?.name ?? 'patient'}-${Date.now()}.pdf`,
    });
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!patient) {
    return (
      <Box>
        <Alert severity="error" sx={{ mb: 2 }}>{error || 'المريض غير موجود'}</Alert>
        <Button variant="outlined" onClick={() => navigate('/patients')}>العودة للمرضى</Button>
      </Box>
    );
  }

  const remaining = Number(summary?.totalRemaining ?? patient?.remainingBalance ?? 0);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Button variant="outlined" onClick={() => navigate('/patients')}>رجوع</Button>
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          {patient.name}
        </Typography>
        <Button variant="contained" onClick={() => navigate(`/appointments/new?patientId=${patientId}`)}>
          حجز موعد
        </Button>
        {isClinician && (
          <>
            <Button variant="outlined" onClick={() => navigate(`/patients/${patientId}/edit`)}>
              تعديل
            </Button>
            <Button variant="outlined" onClick={exportDiagnosisPDF} disabled={!history.length}>
              تشخيص PDF
            </Button>
            <Button variant="outlined" onClick={exportPrescriptionPDF} disabled={!medications.length}>
              وصفة PDF
            </Button>
          </>
        )}
        <Button variant="outlined" onClick={exportFullRecordPDF}>
          الملف الشامل PDF
        </Button>
        <Button variant="outlined" onClick={exportPDF} disabled={!payments.length}>
          تصدير PDF
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Chip label={`الهاتف: ${patient.phone ?? '-'}`} />
        <Chip label={`العمر: ${patient.age ?? '-'}`} />
        <Chip label={`الجنس: ${patient.gender ?? '-'}`} />
        {isClinician && (
          <>
            {patient.heightCm && <Chip label={`الطول: ${patient.heightCm} سم`} />}
            {patient.weightKg && <Chip label={`الوزن: ${patient.weightKg} كجم`} />}
            {patient.bmi && <Chip label={`مؤشر الكتلة: ${fmt(patient.bmi)} (${patient.bmiCategory ?? ''})`} />}
            {patient.chronicConditions && <Chip label={`أمراض مزمنة: ${patient.chronicConditions}`} />}
            {patient.allergies && <Chip label={`حساسية: ${patient.allergies}`} />}
          </>
        )}
      </Box>

      {remaining > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          رصيد مستحق: {fmt(remaining)} جنيه
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ mb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
          <Tab label="المدفوعات" value="payments" />
          <Tab label="المواعيد" value="appointments" />
          {isClinician && <Tab label="التاريخ الطبي" value="history" />}
          {isClinician && <Tab label="الأدوية" value="medications" />}
        </Tabs>
      </Paper>

      {tab === 'payments' && (
        <Box>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={4}>
              <Paper sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">إجمالي المطلوب</Typography>
                <Typography variant="h6" fontWeight={700}>{fmt(summary?.totalBilled)} جنيه</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Paper sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">المدفوع</Typography>
                <Typography variant="h6" fontWeight={700} color="success.main">{fmt(summary?.totalPaid)} جنيه</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Paper sx={{ p: 2, textAlign: 'center' }}>
                <Typography variant="body2" color="text.secondary">المتبقي</Typography>
                <Typography variant="h6" fontWeight={700} color="error.main">{fmt(summary?.totalRemaining)} جنيه</Typography>
              </Paper>
            </Grid>
          </Grid>
          <Paper>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>التاريخ</TableCell>
                    <TableCell>الإجمالي</TableCell>
                    <TableCell>المدفوع</TableCell>
                    <TableCell>المتبقي</TableCell>
                    <TableCell>طريقة الدفع</TableCell>
                    <TableCell>الملاحظات</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {payments.length === 0 ? (
                    <TableRow><TableCell colSpan={6} sx={{ border: 0, p: 0 }}><EmptyState title="لا توجد مدفوعات" hint="لم تُسجّل أي دفعة لهذا المريض بعد." /></TableCell></TableRow>
                  ) : (
                    payments.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.paymentDate ?? '-'}</TableCell>
                        <TableCell>{fmt(p.totalAmount)}</TableCell>
                        <TableCell>{fmt(p.paidAmount)}</TableCell>
                        <TableCell>{fmt(p.remainingAmount)}</TableCell>
                        <TableCell>{p.paymentMethod ?? '-'}</TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <span>{p.notes ?? '-'}</span>
                            {remainingOf(p) > 0 && (
                              <Button size="small" onClick={() => openCollectExisting(p)}>
                                تحصيل
                              </Button>
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button variant="contained" color="primary" onClick={openCollectNew}>
              تسجيل دفعة جديدة
            </Button>
            {openPayments.length > 0 && (
              <Button variant="outlined" color="primary" onClick={() => openCollectExisting(openPayments[0])}>
                {`تحصيل من الأقدم (${openPayments.length} مفتوحة)`}
              </Button>
            )}
          </Box>
        </Box>
      )}

      {tab === 'appointments' && (
        <Paper>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>التاريخ</TableCell>
                  <TableCell>الفترة</TableCell>
                  <TableCell>الفئة</TableCell>
                  <TableCell>الحالة</TableCell>
                  <TableCell>المبلغ</TableCell>
                  <TableCell>ملاحظات</TableCell>
                  {isClinician && <TableCell>إجراءات</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {appointments.length === 0 ? (
                  <TableRow><TableCell colSpan={isClinician ? 7 : 6} sx={{ border: 0, p: 0 }}><EmptyState title="لا توجد مواعيد" hint="لم تُسجّل مواعيد لهذا المريض بعد." /></TableCell></TableRow>
                ) : (
                  appointments.map((a: any) => (
                    <TableRow key={a.id}>
                      <TableCell>{a.date ?? '-'}</TableCell>
                      <TableCell>{a.timeZone ?? '-'}</TableCell>
                      <TableCell>{a.category ?? '-'}</TableCell>
                      <TableCell>
                        <Chip size="small" label={a.status ?? '-'} color={a.status === 'CANCELLED' ? 'error' : a.status === 'DONE' ? 'success' : 'primary'} />
                      </TableCell>
                      <TableCell>{a.requiredAmount ? `${fmt(a.requiredAmount)} جنيه` : '-'}</TableCell>
                      <TableCell>{a.notes ?? '-'}</TableCell>
                      {isClinician && (
                        <TableCell>
                          {(a.status === 'SCHEDULED' || a.status === 'MOVED') && (
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              onClick={() => {
                                setCompleteTarget(a);
                                setDiagnosis('');
                                setCompletionNotes(a.notes ?? '');
                              }}
                            >
                              إتمام
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {isClinician && tab === 'history' && (
        <Box>
          {history.length === 0 ? (
            <EmptyState title="لا يوجد تاريخ طبي" hint="لم يُسجّل أي فحص أو تاريخ لهذا المريض بعد." />
          ) : (
            history.map((h: any) => (
              <Paper key={h.id} sx={{ p: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1 }}>
                  <Chip size="small" label={h.category ?? '-'} />
                  <Typography variant="caption" color="text.secondary">
                    {h.created_at ?? h.createdAt ?? '-'}
                  </Typography>
                </Box>
                {h.diagnosis && (
                  <Typography variant="body1" sx={{ mb: 0.5 }}>
                    <strong>التشخيص:</strong> {h.diagnosis}
                  </Typography>
                )}
                {h.notes && (
                  <Typography variant="body2" color="text.secondary">
                    <strong>ملاحظات:</strong> {h.notes}
                  </Typography>
                )}
              </Paper>
            ))
          )}
        </Box>
      )}

      {isClinician && tab === 'medications' && (
        <Paper>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>الدواء</TableCell>
                  <TableCell>الجرعة</TableCell>
                  <TableCell>التكرار</TableCell>
                  <TableCell>المدة</TableCell>
                  <TableCell>الحالة</TableCell>
                  <TableCell>إجراءات</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {medications.length === 0 ? (
                  <TableRow><TableCell colSpan={6} sx={{ border: 0, p: 0 }}><EmptyState title="لا توجد أدوية" hint="لم تُصرف أي أدوية لهذا المريض بعد." /></TableCell></TableRow>
                ) : (
                  medications.map((m: any) => (
                    <TableRow key={m.id}>
                      <TableCell>{m.drugName}</TableCell>
                      <TableCell>{m.dosage ?? '-'}</TableCell>
                      <TableCell>{m.frequency ?? '-'}</TableCell>
                      <TableCell>{m.duration ?? '-'}</TableCell>
                      <TableCell>
                        <Chip size="small" label={m.status === 'Stopped' ? 'موقوف' : m.status === 'Inactive' ? 'غير نشط' : 'نشط'} color={m.status === 'Stopped' || m.status === 'Inactive' ? 'default' : 'success'} />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {m.status === 'Stopped' || m.status === 'Inactive' ? (
                            <Button size="small" variant="outlined" onClick={async () => {
                              try {
                                await api.put(`/api/medications/${m.id}`, { status: 'Active' });
                                load();
                              } catch (err: any) { setError(err.message || 'فشل إعادة التفعيل'); }
                            }}>إعادة تفعيل</Button>
                          ) : (
                            <Button size="small" variant="outlined" color="error" onClick={() => setStopTarget(m)}>إيقاف</Button>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      <Dialog open={!!completeTarget} onClose={() => {}} disableEscapeKeyDown maxWidth="sm" fullWidth>
        <DialogTitle>إتمام الموعد #{completeTarget?.id}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {completeTarget?.date} — {completeTarget?.timeZone ?? ''}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="التشخيص"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
            <TextField
              label="ملاحظات"
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
            {(completeTarget?.category ?? '') === EXAMINATION_CATEGORY && (
              <TextField
                label="مبلغ الموعد التالي (جنيه)"
                type="number"
                value={followUpAmount}
                onChange={(e) => setFollowUpAmount(e.target.value)}
                fullWidth
                helperText={`سيتم حجز موعد متابعة تلقائياً بعد ${FOLLOW_UP_OFFSET_DAYS} يوماً في الفترة الصباحية.`}
              />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCompleteTarget(null)} disabled={completing}>إلغاء</Button>
          <Button
            variant="contained"
            color="success"
            disabled={completing}
            onClick={async () => {
              if (!completeTarget) return;
              setCompleting(true);
              setError(null);
              setCompleteNotice(null);
              try {
                const result = await completeVisit({
                  appointmentId: completeTarget.id,
                  patientId,
                  category: completeTarget.category,
                  diagnosis,
                  notes: completionNotes,
                  followUpAmount,
                  today: todayISO(),
                });
                setCompleteTarget(null);
                setFollowUpAmount('');
                setCompletionNotes('');
                // The visit is closed regardless. A follow-up that could not be booked is
                // reported, not treated as a failure of the completion.
                if (result.followUp) {
                  setCompleteNotice(
                    `تم حجز موعد المتابعة تلقائياً في ${result.followUp.date} (${FOLLOW_UP_TIME_ZONE === 'MORNING' ? 'صباحاً' : result.followUp.timeZone}).`
                  );
                } else if (result.followUpError) {
                  setCompleteNotice(`تم إتمام الموعد، لكن تعذّر حجز المتابعة: ${result.followUpError}`);
                }
                await load();
              } catch (err: any) {
                setError(err.message || 'تعذّر إتمام الموعد');
              } finally {
                setCompleting(false);
              }
            }}
          >
            {completing ? <CircularProgress size={18} /> : 'حفظ الإتمام'}
          </Button>
        </DialogActions>
      </Dialog>

      {completeNotice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setCompleteNotice(null)}>
          {completeNotice}
        </Alert>
      )}

      <Dialog open={collectOpen} onClose={() => {}} disableEscapeKeyDown maxWidth="sm" fullWidth>
        <DialogTitle>
          {collectTarget ? 'تحصيل من دفعة مفتوحة' : 'تحصيل دفعة'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            {collectTarget ? (
              <>
                <Alert severity="info">
                  {`الدفعة #${collectTarget.id} — المتبقي ${remainingOf(collectTarget).toFixed(2)} ج.م. ` +
                    'سيُحدَّث نفس السجل، ولن يتم إنشاء دفعة جديدة.'}
                </Alert>
                <TextField
                  label="المبلغ المحصل (جنيه)"
                  type="number"
                  fullWidth
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  helperText={`الحد الأقصى ${remainingOf(collectTarget).toFixed(2)} ج.م`}
                />
                <FormControl fullWidth>
                  <InputLabel>طريقة الدفع</InputLabel>
                  <Select
                    label="طريقة الدفع"
                    value={payForm.paymentMethod}
                    onChange={(e) => setPayForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  >
                    <MenuItem value="CASH">نقدي</MenuItem>
                    <MenuItem value="CARD">بطاقة</MenuItem>
                    <MenuItem value="TRANSFER">تحويل</MenuItem>
                    <MenuItem value="OTHER">أخرى</MenuItem>
                  </Select>
                </FormControl>
              </>
            ) : (
              <>
                <TextField
                  label="المبلغ الإجمالي (جنيه)"
                  type="number"
                  fullWidth
                  value={payForm.totalAmount}
                  onChange={(e) => setPayForm((f) => ({ ...f, totalAmount: e.target.value }))}
                />
                <TextField
                  label="المبلغ المدفوع (جنيه)"
                  type="number"
                  fullWidth
                  value={payForm.paidAmount}
                  onChange={(e) => setPayForm((f) => ({ ...f, paidAmount: e.target.value }))}
                />
                <FormControl fullWidth>
                  <InputLabel>طريقة الدفع</InputLabel>
                  <Select
                    label="طريقة الدفع"
                    value={payForm.paymentMethod}
                    onChange={(e) => setPayForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  >
                    <MenuItem value="CASH">نقدي</MenuItem>
                    <MenuItem value="CARD">بطاقة</MenuItem>
                    <MenuItem value="TRANSFER">تحويل</MenuItem>
                    <MenuItem value="OTHER">أخرى</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  label="التاريخ"
                  type="date"
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  value={payForm.paymentDate}
                  onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))}
                />
                <TextField
                  label="ملاحظات"
                  fullWidth
                  multiline
                  minRows={2}
                  value={payForm.notes}
                  onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCollectOpen(false)}>إلغاء</Button>
          <Button variant="contained" onClick={submitCollect} disabled={saving}>
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!stopTarget}
        title="إيقاف الدواء"
        message={`هل تريد إيقاف الدواء "${stopTarget?.drugName ?? ''}"؟`}
        confirmLabel="إيقاف"
        cancelLabel="إلغاء"
        confirmColor="error"
        busy={stopping}
        onCancel={() => setStopTarget(null)}
        onConfirm={async () => {
          if (!stopTarget) return;
          setStopping(true);
          try {
            await api.put(`/api/medications/${stopTarget.id}`, { status: 'Stopped' });
            setStopTarget(null);
            load();
          } catch (err: any) {
            setError(err.message || 'فشل إيقاف الدواء');
          } finally {
            setStopping(false);
          }
        }}
      />
    </Box>
  );
};
