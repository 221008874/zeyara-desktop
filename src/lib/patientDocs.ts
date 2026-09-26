import {
  PdfBlock,
  clinicHeaderBlock,
  docStamp,
  docTimestamp,
  exportArabicDocumentPdf,
  footerBlock,
} from './arabicPdf';
import { getClinicProfile } from './clinicProfile';
import { appointmentStatusLabel, timeZoneLabel } from './format';

const genderLabel = (g?: string | null): string => {
  if (!g) return '—';
  if (g.toLowerCase() === 'male' || g.toLowerCase() === 'ذكر') return 'ذكر';
  if (g.toLowerCase() === 'female' || g.toLowerCase() === 'أنثى') return 'أنثى';
  return g;
};

const paymentMethodLabel = (m?: string | null): string => {
  const map: Record<string, string> = { CASH: 'نقدي', CARD: 'بطاقة', TRANSFER: 'تحويل', OTHER: 'أخرى' };
  return map[m ?? ''] ?? (m || '—');
};

const categoryLabel = (c?: string | null): string => {
  const map: Record<string, string> = { EXAMINATION: 'فحص', FOLLOW_UP: 'متابعة' };
  return map[c ?? ''] ?? (c || '—');
};

const fmtNum = (v: any): string => (v == null || isNaN(Number(v)) ? '0.00' : Number(v).toFixed(2));

export const exportPaymentDocumentPdf = async (opts: {
  patient: any;
  payments: any[];
  summary: any;
  filename: string;
}): Promise<void> => {
  const { patient, payments, summary, filename } = opts;
  const profile = await getClinicProfile();
  const totalBilled = Number(summary?.totalBilled ?? 0);
  const totalPaid = Number(summary?.totalPaid ?? 0);
  const totalRemaining = Number(summary?.totalRemaining ?? 0);
  const docId = `PAY-${patient?.id ?? ''}-${docStamp()}`;
  const blocks: PdfBlock[] = [
    ...clinicHeaderBlock(profile),
    { kind: 'docTitle', text: 'سجل مدفوعات المريض' },
    { kind: 'docId', text: docId },
    { kind: 'section', text: 'بيانات المريض' },
    { kind: 'kv', label: 'الاسم', value: patient?.name ?? '—' },
    { kind: 'kv', label: 'الهاتف', value: patient?.phone ?? '—' },
    { kind: 'kv', label: 'العمر / الجنس', value: `${patient?.age ?? '—'} / ${genderLabel(patient?.gender)}` },
    { kind: 'section', text: 'ملخص الحساب' },
    { kind: 'kv', label: 'إجمالي المطلوب', value: `${fmtNum(totalBilled)} ج.م` },
    { kind: 'kv', label: 'المدفوع', value: `${fmtNum(totalPaid)} ج.م` },
    { kind: 'kv', label: 'المتبقي', value: `${fmtNum(totalRemaining)} ج.م` },
    { kind: 'section', text: 'تفاصيل الدفعات' },
    {
      kind: 'table',
      headers: ['التاريخ', 'الإجمالي', 'المدفوع', 'المتبقي', 'طريقة الدفع', 'الحالة'],
      rows: payments.map((p: any) => [
        p.paymentDate ?? '—',
        fmtNum(p.totalAmount),
        fmtNum(p.paidAmount),
        fmtNum(p.remainingAmount),
        paymentMethodLabel(p.paymentMethod),
        Number(p.remainingAmount ?? 0) > 0 ? 'جزئي' : 'مدفوع',
      ]),
    },
    ...footerBlock(docId),
    { kind: 'signature', text: 'المحاسب / السكرتير' },
  ];
  exportArabicDocumentPdf({ filename, blocks });
};

export const exportDiagnosisDocumentPdf = async (opts: {
  patient: any;
  history: any[];
  filename: string;
}): Promise<void> => {
  const { patient, history, filename } = opts;
  const profile = await getClinicProfile();
  const docId = `DGN-${patient?.id ?? ''}-${docStamp()}`;
  const blocks: PdfBlock[] = [
    ...clinicHeaderBlock(profile),
    { kind: 'docTitle', text: 'تقرير التشخيص الطبي' },
    { kind: 'docId', text: docId },
    { kind: 'section', text: 'بيانات المريض' },
    { kind: 'kv', label: 'الاسم', value: patient?.name ?? '—' },
    { kind: 'kv', label: 'العمر', value: patient?.age != null ? `${patient.age} سنة` : '—' },
    { kind: 'kv', label: 'الجنس', value: genderLabel(patient?.gender) },
    { kind: 'kv', label: 'الهاتف', value: patient?.phone ?? '—' },
    { kind: 'kv', label: 'تاريخ التقرير', value: docTimestamp() },
    { kind: 'section', text: 'العلامات الحيوية' },
    { kind: 'kv', label: 'الطول', value: patient?.heightCm ? `${fmtNum(patient.heightCm)} سم` : '—' },
    { kind: 'kv', label: 'الوزن', value: patient?.weightKg ? `${fmtNum(patient.weightKg)} كجم` : '—' },
    { kind: 'kv', label: 'مؤشر الكتلة', value: patient?.bmi ? `${fmtNum(patient.bmi)} (${patient?.bmiCategory ?? ''})` : '—' },
    { kind: 'kv', label: 'الحرارة', value: patient?.bodyTemperature ? `${fmtNum(patient.bodyTemperature)}°م` : '—' },
    { kind: 'kv', label: 'النبض', value: patient?.heartRate ? `${patient.heartRate} نبضة/د` : '—' },
    {
      kind: 'kv',
      label: 'ضغط الدم',
      value: patient?.bloodPressureSystolic || patient?.bloodPressureDiastolic
        ? `${patient?.bloodPressureSystolic ?? '-'}/${patient?.bloodPressureDiastolic ?? '-'} مم زئبقي`
        : '—',
    },
    ...(patient?.isPregnant != null ? [{ kind: 'kv' as const, label: 'الحمل', value: patient.isPregnant ? 'نعم' : 'لا' }] : []),
    { kind: 'section', text: 'الحالة الصحية' },
    { kind: 'kv', label: 'أمراض مزمنة', value: patient?.chronicConditions || '—' },
    { kind: 'kv', label: 'الحساسية', value: patient?.allergies || '—' },
    { kind: 'kv', label: 'ملاحظات', value: patient?.notes || '—' },
    { kind: 'section', text: 'السجل الطبي' },
    ...(history.length
      ? [{
          kind: 'table' as const,
          headers: ['التاريخ', 'التصنيف', 'التشخيص / الملاحظات'],
          rows: history.map((h: any) => {
            const date = h.created_at ?? h.createdAt ?? '';
            const notes = h.notes ? ` — ${h.notes}` : '';
            return [date, categoryLabel(h.category), `${h.diagnosis ?? ''}${notes}`];
          }),
        }]
      : [{ kind: 'paragraph' as const, text: 'لا يوجد سجل طبي مسجل' }]),
    ...footerBlock(docId),
    { kind: 'signature', text: 'الطبيب المعالج' },
  ];
  exportArabicDocumentPdf({ filename, blocks });
};

export const exportPrescriptionDocumentPdf = async (opts: {
  patient: any;
  medications: any[];
  doctorName?: string;
  filename: string;
}): Promise<void> => {
  const { patient, medications, doctorName, filename } = opts;
  const profile = await getClinicProfile();
  const docId = `RX-${patient?.id ?? ''}-${docStamp()}`;
  const doctor = doctorName?.trim() || profile?.doctorName?.trim() || '';
  const subParts = [
    profile?.doctorTitle?.trim() ?? '',
    profile?.license?.trim() ? `طبيب مرخص — ${profile.license.trim()}` : '',
  ].filter(Boolean);
  const blocks: PdfBlock[] = [
    ...clinicHeaderBlock(profile),
    { kind: 'docTitle', text: 'وصفة طبية' },
    { kind: 'docId', text: docId },
    { kind: 'section', text: 'بيانات المريض' },
    { kind: 'kv', label: 'الاسم', value: patient?.name ?? '—' },
    { kind: 'kv', label: 'العمر', value: patient?.age != null ? `${patient.age} سنة` : '—' },
    { kind: 'kv', label: 'الجنس', value: genderLabel(patient?.gender) },
    { kind: 'kv', label: 'الهاتف', value: patient?.phone ?? '—' },
    { kind: 'kv', label: 'التشخيص', value: patient?.diagnosis || '—' },
    { kind: 'kv', label: 'التاريخ', value: docTimestamp() },
    { kind: 'section', text: 'الأدوية الموصوفة' },
    ...(medications.length
      ? [{
          kind: 'table' as const,
          headers: ['الدواء', 'الجرعة', 'التكرار', 'المدة', 'الحالة'],
          rows: medications.map((m: any) => [
            m.drugName ?? '',
            m.dosage ?? '—',
            m.frequency ?? '—',
            m.duration ?? '—',
            m.status === 'Active' ? 'نشط' : m.status === 'Stopped' ? 'موقوف' : m.status === 'Inactive' ? 'غير نشط' : m.status ?? '—',
          ]),
        }]
      : [{ kind: 'paragraph' as const, text: 'لا توجد أدوية موصوفة' }]),
    ...(medications.some((m: any) => m.instructions)
      ? [
          { kind: 'section' as const, text: 'تعليمات' },
          ...medications.filter((m: any) => m.instructions).map((m: any) => ({
            kind: 'paragraph' as const,
            text: `${m.drugName}: ${m.instructions}`,
          })),
        ]
      : []),
    ...footerBlock(docId),
    {
      kind: 'signature',
      text: doctor ? `د. ${doctor}` : 'الطبيب المعالج',
      sub: subParts.length ? subParts.join(' — ') : undefined,
    },
  ];
  exportArabicDocumentPdf({ filename, blocks });
};

export const exportPatientHistoryDocumentPdf = async (opts: {
  patient: any;
  appointments: any[];
  history: any[];
  medications: any[];
  payments: any[];
  summary: any;
  filename: string;
}): Promise<void> => {
  const { patient, appointments, history, medications, payments, summary, filename } = opts;
  const profile = await getClinicProfile();
  const docId = `RCD-${patient?.id ?? ''}-${docStamp()}`;
  const totalBilled = Number(summary?.totalBilled ?? 0);
  const totalPaid = Number(summary?.totalPaid ?? 0);
  const totalRemaining = Number(summary?.totalRemaining ?? 0);
  const blocks: PdfBlock[] = [
    ...clinicHeaderBlock(profile),
    { kind: 'docTitle', text: 'الملف الطبي الشامل للمريض' },
    { kind: 'docId', text: docId },
    { kind: 'section', text: 'بيانات المريض' },
    { kind: 'kv', label: 'الاسم', value: patient?.name ?? '—' },
    { kind: 'kv', label: 'الهاتف', value: patient?.phone ?? '—' },
    { kind: 'kv', label: 'العمر / الجنس', value: `${patient?.age ?? '—'} / ${genderLabel(patient?.gender)}` },
    ...(patient?.address ? [{ kind: 'kv' as const, label: 'العنوان', value: patient.address }] : []),
    { kind: 'kv', label: 'تاريخ إعداد التقرير', value: docTimestamp() },
    { kind: 'section', text: 'العلامات الحيوية' },
    ...(patient?.heightCm ? [{ kind: 'kv' as const, label: 'الطول', value: `${fmtNum(patient.heightCm)} سم` }] : []),
    ...(patient?.weightKg ? [{ kind: 'kv' as const, label: 'الوزن', value: `${fmtNum(patient.weightKg)} كجم` }] : []),
    ...(patient?.bmi ? [{ kind: 'kv' as const, label: 'مؤشر الكتلة', value: `${fmtNum(patient.bmi)} (${patient?.bmiCategory ?? ''})` }] : []),
    ...(patient?.bodyTemperature ? [{ kind: 'kv' as const, label: 'الحرارة', value: `${fmtNum(patient.bodyTemperature)}°م` }] : []),
    ...(patient?.heartRate ? [{ kind: 'kv' as const, label: 'النبض', value: `${patient.heartRate} نبضة/د` }] : []),
    ...(patient?.bloodPressureSystolic || patient?.bloodPressureDiastolic
      ? [{ kind: 'kv' as const, label: 'ضغط الدم', value: `${patient?.bloodPressureSystolic ?? '-'}/${patient?.bloodPressureDiastolic ?? '-'} مم زئبقي` }]
      : []),
    ...(patient?.isPregnant != null ? [{ kind: 'kv' as const, label: 'الحمل', value: patient.isPregnant ? 'نعم' : 'لا' }] : []),
    { kind: 'section', text: 'الحالة الصحية' },
    { kind: 'kv', label: 'أمراض مزمنة', value: patient?.chronicConditions || '—' },
    { kind: 'kv', label: 'الحساسية', value: patient?.allergies || '—' },
    { kind: 'kv', label: 'ملاحظات', value: patient?.notes || '—' },
    { kind: 'section', text: 'المواعيد' },
    ...(appointments.length
      ? [{
          kind: 'table' as const,
          headers: ['التاريخ', 'الفترة', 'الفئة', 'الحالة', 'المبلغ'],
          rows: appointments.map((a: any) => [
            a.date ?? '—',
            timeZoneLabel(a.timeZone),
            a.category ?? '—',
            appointmentStatusLabel(a.status),
            a.requiredAmount ? `${fmtNum(a.requiredAmount)} ج.م` : '—',
          ]),
        }]
      : [{ kind: 'paragraph' as const, text: 'لا توجد مواعيد مسجلة' }]),
    { kind: 'section', text: 'التشخيصات والسجل الطبي' },
    ...(history.length
      ? [{
          kind: 'table' as const,
          headers: ['التاريخ', 'التصنيف', 'التشخيص / الملاحظات'],
          rows: history.map((h: any) => {
            const date = h.created_at ?? h.createdAt ?? '';
            const notes = h.notes ? ` — ${h.notes}` : '';
            return [date, categoryLabel(h.category), `${h.diagnosis ?? ''}${notes}`];
          }),
        }]
      : [{ kind: 'paragraph' as const, text: 'لا يوجد سجل طبي مسجل' }]),
    { kind: 'section', text: 'الأدوية' },
    ...(medications.length
      ? [{
          kind: 'table' as const,
          headers: ['الدواء', 'الجرعة', 'التكرار', 'المدة', 'الحالة'],
          rows: medications.map((m: any) => [
            m.drugName ?? '—',
            m.dosage ?? '—',
            m.frequency ?? '—',
            m.duration ?? '—',
            m.status === 'Active' ? 'نشط' : m.status === 'Stopped' ? 'موقوف' : m.status === 'Inactive' ? 'غير نشط' : m.status ?? '—',
          ]),
        }]
      : [{ kind: 'paragraph' as const, text: 'لا توجد أدوية مسجلة' }]),
    { kind: 'section', text: 'الملخص المالي' },
    { kind: 'kv', label: 'إجمالي المطلوب', value: `${fmtNum(totalBilled)} ج.م` },
    { kind: 'kv', label: 'المدفوع', value: `${fmtNum(totalPaid)} ج.م` },
    { kind: 'kv', label: 'المتبقي', value: `${fmtNum(totalRemaining)} ج.م` },
    ...(payments.length
      ? [{
          kind: 'table' as const,
          headers: ['التاريخ', 'الإجمالي', 'المدفوع', 'المتبقي', 'طريقة الدفع', 'الحالة'],
          rows: payments.map((p: any) => [
            p.paymentDate ?? '—',
            fmtNum(p.totalAmount),
            fmtNum(p.paidAmount),
            fmtNum(p.remainingAmount),
            paymentMethodLabel(p.paymentMethod),
            Number(p.remainingAmount ?? 0) > 0 ? 'جزئي' : 'مدفوع',
          ]),
        }]
      : []),
    ...footerBlock(docId),
    { kind: 'signature', text: 'الطبيب المعالج' },
  ];
  exportArabicDocumentPdf({ filename, blocks });
};
