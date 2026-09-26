import { Workbook } from 'exceljs';
import { api } from './api';

const normalize = (data: any): any[] => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.results)) return data.results;
    return [data];
  }
  return [];
};

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

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
};

/**
 * Local Excel backup mirroring the JavaFX ExcelBackupService: exports patients,
 * appointments, and medications to a single .xlsx workbook that is downloaded.
 * Called on window close when a user is logged in.
 *
 * @returns the confirm prompt result (true = the user opted to back up / close).
 */
export async function promptAndBackup(): Promise<boolean> {
  // Native confirm is the only synchronous barrier before window unload; the
  // actual data fetch + file generation happen after the user opts in, then a
  // download is triggered.
  if (!window.confirm('هل تريد حفظ نسخة احتياطية من بيانات العيادة قبل الإغلاق؟\n\n(المرضى، المواعيد، والأدوية)')) {
    return false;
  }

  try {
    const [patRes, appRes, medRes] = await Promise.all([
      api.get('/api/patients'),
      api.get('/api/appointments'),
      api.get('/api/medications'),
    ]);

    const patients = normalize(patRes.data);
    const appointments = normalize(appRes.data);
    const medications = normalize(medRes.data);

    const workbook = new Workbook();
    workbook.creator = 'Zeyara';
    workbook.created = new Date();

    const style = (ws: any, topRow: any) => {
      topRow.font = { bold: true, color: { argb: 'FF1D4ED8' } };
      ws.columns.forEach((c: any) => { c.width = 20; });
    };

    const patSheet = workbook.addWorksheet('Patients');
    patSheet.addRow(['ID', 'Name', 'Age', 'Gender', 'Phone', 'Diagnosis', 'Height(cm)', 'Weight(kg)', 'BMI']);
    patients.forEach((p: any) => patSheet.addRow([
      p.id, p.name, p.age, p.gender, p.phone, p.diagnosis,
      p.heightCm ?? p.height, p.weightKg ?? p.weight, p.bmi,
    ]));
    style(patSheet, patSheet.getRow(1));

    const appSheet = workbook.addWorksheet('Appointments');
    appSheet.addRow(['ID', 'Patient ID', 'Date', 'Time Zone', 'Status', 'Notes']);
    appointments.forEach((a: any) => appSheet.addRow([
      a.id, a.patientId ?? a.patient?.id, a.date, a.timeZone, a.status, a.notes,
    ]));
    style(appSheet, appSheet.getRow(1));

    const medSheet = workbook.addWorksheet('Medications');
    medSheet.addRow(['ID', 'Patient ID', 'Drug Name', 'Dosage', 'Frequency', 'Duration', 'Instructions', 'Status']);
    medications.forEach((m: any) => medSheet.addRow([
      m.id, m.patientId, m.drugName ?? m.name ?? m.medicationName,
      m.dosage ?? m.dose, m.frequency, m.duration, m.instructions, m.status,
    ]));
    style(medSheet, medSheet.getRow(1));

    const buffer = await workbook.xlsx.writeBuffer();
    downloadBlob(new Blob([buffer]), `backup-${stamp()}.xlsx`);
  } catch {
    // Backups are best-effort; if the server is unreachable or the export
    // fails, don't block the user from closing the window.
  }
  return true;
}
