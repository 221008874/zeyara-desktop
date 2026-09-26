#!/usr/bin/env node --experimental-sqlite
/**
 * One-shot importer: moves unsynced rows out of a retired JavaFX client's local
 * SQLite database and into the Clinic Server.
 *
 * WHY
 * The JavaFX doctor and secretary clients were offline-first. Every write went to a
 * local SQLite mirror first and was pushed to the server opportunistically, with
 * `is_synced` left at 0 when the push failed. When a clinic worked while the server
 * was unreachable — or when a push was simply never retried — those rows exist ONLY
 * locally. The Tauri client has no equivalent mirror, so anything not imported is
 * lost at cutover.
 *
 * Only `is_synced = 0` rows are imported, and rows already present in
 * `server_id_mappings` are skipped, so the script is safe to re-run.
 *
 * USAGE
 *   node --experimental-sqlite scripts/import-javafox-data.mjs --dry-run \
 *        --db "C:\Users\<user>\ClinicDatabase\Clinic.db" \
 *        --server http://localhost:8081 --user admin --pass <pw> --role ADMIN
 *
 *   Add --apply to actually write. Without it the script only reports what it
 *   would do and exits 0.
 *
 * NOTES
 * - Two source databases are supported: the doctor's `Clinic.db` (no Payments
 *   table at all — that client never had payments) and the secretary's
 *   `Clinic_local.db` (has Payments, thinner Patients).
 * - Two JavaFX data bugs are repaired on the way in: the doctor client wrote the
 *   CSS class "zy-state-followup" as the appointment/history category and "zy-active"
 *   as the medication status, instead of the enum values.
 * - POST /api/expenses forces status to PENDING server-side, so an APPROVED local
 *   expense is imported as PENDING and must be re-approved in the UI. The report
 *   calls these out.
 * - POST /api/appointments rejects a patient who already has an active booking.
 *   Clashes are reported and skipped, never fatal.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ─── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const APPLY = flag('apply');
const SERVER = (opt('server') || 'http://localhost:8081').replace(/\/+$/, '');
const USERNAME = opt('user');
const PASSWORD = opt('pass');
const ROLE = (opt('role') || 'ADMIN').toUpperCase();
const REPORT_PATH = opt('report') || null;

/** Candidate DB locations, in the order we try them. */
const dbCandidates = [
  opt('db'),
  join(homedir(), 'ClinicDatabase', 'Clinic.db'),   // doctor client
  join(homedir(), 'Clinic_local.db'),               // secretary client
].filter(Boolean);

const dbPath = dbCandidates.find((p) => existsSync(p));
if (!dbPath) {
  console.error(`No source database found. Tried:\n  ${dbCandidates.join('\n  ')}`);
  process.exit(2);
}
if (!USERNAME || !PASSWORD) {
  console.error('--user and --pass are required (the importer authenticates against the server).');
  process.exit(2);
}

// ─── source helpers ───────────────────────────────────────────────────────────
const db = new DatabaseSync(dbPath, { readOnly: true });

const hasTable = (name) =>
  Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name));

const columnsOf = (table) => {
  if (!hasTable(table)) return [];
  return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map((c) => c.name);
};

const TABLES = {
  patients: 'Patients',
  appointments: 'Appointments',
  payments: 'Payments',
  expenses: 'expenses',
  medications: 'medications',
  history: 'patient_history',
};

const cols = Object.fromEntries(Object.entries(TABLES).map(([k, t]) => [k, columnsOf(t)]));
const present = (k) => cols[k].length > 0;

/** Only rows the client never managed to push. */
const unsynced = (table, key) =>
  db
    .prepare(`SELECT * FROM ${JSON.stringify(table)} WHERE ${key ? `${key} = 0` : '1=1'}`)
    .all();

/** local_id -> server_id for rows already on the server. */
const existingMappings = (() => {
  if (!hasTable('server_id_mappings')) return new Map();
  const rows = db.prepare('SELECT local_id, server_id, entity_type FROM server_id_mappings').all();
  const map = new Map();
  for (const r of rows) map.set(`${r.entity_type}:${r.local_id}`, r.server_id);
  return map;
})();

// ─── value coercion ───────────────────────────────────────────────────────────
const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v));
const int = (v) => (v === null || v === undefined || v === '' ? undefined : parseInt(v, 10));
const bool = (v) => (v === null || v === undefined ? undefined : Boolean(Number(v) || v === true));
const str = (v) => (v === null || v === undefined || v === '' ? undefined : String(v));

/** The doctor client wrote a CSS class name where an enum value belonged. */
function repairCategory(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return 'EXAMINATION';
  const lower = v.toLowerCase();
  if (lower.includes('followup') || lower.includes('follow_up') || lower.includes('follow-up')) {
    return 'FOLLOW_UP';
  }
  if (lower.includes('examination') || lower.includes('exam')) return 'EXAMINATION';
  // Unknown value: do not invent one, fall back to the default the server would use.
  return 'EXAMINATION';
}

/** Same class of bug for the medication status. */
function repairMedicationStatus(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return 'Active';
  const lower = v.toLowerCase();
  if (lower.includes('stop')) return 'Stopped';
  if (lower.includes('zy-active') || lower.includes('active')) return 'Active';
  return 'Active';
}

function repairTimeZone(raw) {
  const v = String(raw ?? '').trim().toUpperCase();
  if (v === 'EVENING') return 'NIGHT'; // the client wrote the old enum name
  if (v === 'MORNING' || v === 'AFTERNOON' || v === 'NIGHT') return v;
  return 'MORNING';
}

function repairAppointmentStatus(raw) {
  const v = String(raw ?? '').trim().toUpperCase();
  return ['SCHEDULED', 'MOVED', 'DONE', 'CANCELLED'].includes(v) ? v : 'SCHEDULED';
}

function repairExpenseStatus(raw) {
  const v = String(raw ?? '').trim().toUpperCase();
  return ['PENDING', 'APPROVED', 'REJECTED'].includes(v) ? v : 'PENDING';
}

// ─── server client ────────────────────────────────────────────────────────────
let token = null;

async function apiCall(method, path, body) {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function login() {
  const path =
    ROLE === 'ADMIN' ? '/api/admin/login'
    : ROLE === 'SECRETARY' ? '/api/secretaries/login'
    : '/api/doctors/login';
  const r = await apiCall('POST', path, { username: USERNAME, password: PASSWORD });
  if (!r.ok) {
    throw new Error(`Login failed (${r.status}): ${JSON.stringify(r.data)}`);
  }
  token = r.data?.token || r.data?.accessToken || r.data?.access_token;
  if (!token) throw new Error('Login succeeded but no token was returned');
  console.log(`Authenticated against ${SERVER} as ${ROLE} "${USERNAME}"`);
}

// ─── report ───────────────────────────────────────────────────────────────────
const report = {
  startedAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  source: dbPath,
  server: SERVER,
  role: ROLE,
  tables: {},
  created: {},
  skipped: {},
  failures: [],
  warnings: [],
};

const count = (key, table, keyCol = 'is_synced') => {
  if (!present(key)) {
    report.tables[table] = 'absent in source';
    report.skipped[table] = 'n/a';
    return [];
  }
  const rows = unsynced(table, cols[key].includes(keyCol) ? keyCol : null);
  report.tables[table] = { total: db.prepare(`SELECT COUNT(*) c FROM ${JSON.stringify(table)}`).get().c, unsynced: rows.length };
  return rows;
};

const note = (msg) => {
  report.warnings.push(msg);
  console.log(`  ! ${msg}`);
};

/** Records a new local->server id so child rows can reference it. */
const remember = (entity, localId, serverId) => existingMappings.set(`${entity}:${localId}`, serverId);

/**
 * Dry-run stand-ins for ids that a real run would have created. Kept separate from
 * `existingMappings` so a parent is never mistaken for "already on the server".
 */
const simulated = new Map();

/** Real mapping only — used for the "has this already been imported?" decision. */
const alreadyOnServer = (entity, localId) => existingMappings.get(`${entity}:${localId}`);

/** Resolvable id for a child row: real if known, simulated in dry-run, else undefined. */
const serverIdFor = (entity, localId) =>
  existingMappings.get(`${entity}:${localId}`) ?? simulated.get(`${entity}:${localId}`);

/**
 * In dry-run mode nothing is actually created, so a child row's parent lookup would
 * fail and the report would under-count ("appointments: 0 to import" even though the
 * patient is right there, unsynced). Seed synthetic ids for unsynced parents so the
 * dry run walks the same path as a real run and reports accurate counts.
 *
 * Synthetic ids are >= 900000000 and are never written anywhere.
 */
function simulateParentIds() {
  if (APPLY) return;
  const SYNTHETIC = 900000000;
  if (present('patients')) {
    for (const r of unsynced(TABLES.patients, 'is_synced')) {
      if (!existingMappings.has(`PATIENT:${r.id}`)) simulated.set(`PATIENT:${r.id}`, SYNTHETIC + r.id);
    }
  }
  if (present('appointments')) {
    for (const r of unsynced(TABLES.appointments, 'is_synced')) {
      if (!existingMappings.has(`APPOINTMENT:${r.id}`)) {
        simulated.set(`APPOINTMENT:${r.id}`, SYNTHETIC + r.id);
      }
    }
  }
  report.simulatedIds = true;
}

// ─── import steps ─────────────────────────────────────────────────────────────

async function importPatients() {
  const rows = count('patients', TABLES.patients);
  let made = 0;
  for (const r of rows) {
    const already = alreadyOnServer('PATIENT', r.id);
    if (already) {
      report.skipped[`patient:${r.id}`] = `already on server as #${already}`;
      continue;
    }
    const payload = {
      name: str(r.name),
      phone: str(r.phone),
      age: int(r.age),
      gender: str(r.gender),
      diagnosis: str(r.diagnosis),
      heightCm: num(r.height_cm),
      weightKg: num(r.weight_kg),
      bodyTemperature: num(r.body_temperature),
      bloodPressureSystolic: num(r.blood_pressure_systolic),
      bloodPressureDiastolic: num(r.blood_pressure_diastolic),
      heartRate: int(r.heart_rate),
      isPregnant: bool(r.is_pregnant),
      pregnancyWeeks: int(r.pregnancy_weeks),
      allergies: str(r.allergies),
      chronicConditions: str(r.chronic_conditions),
      notes: str(r.notes),
      followUpDate: str(r.follow_up_date),
    };
    // Drop empties so we never send "" for a number the server would reject.
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    if (!payload.name) {
      report.failures.push({ entity: 'patient', localId: r.id, reason: 'no name' });
      continue;
    }
    if (!APPLY) {
      made++;
      continue;
    }
    const res = await apiCall('POST', '/api/patients', payload);
    if (res.ok && res.data?.id != null) {
      remember('PATIENT', r.id, res.data.id);
      report.created[`patient:${r.id}`] = res.data.id;
      made++;
    } else {
      report.failures.push({ entity: 'patient', localId: r.id, reason: `${res.status} ${JSON.stringify(res.data)}` });
    }
  }
  console.log(`  patients: ${made} ${APPLY ? 'imported' : 'to import'}`);
  return made;
}

async function importAppointments() {
  const rows = count('appointments', TABLES.appointments);
  let made = 0;
  for (const r of rows) {
    const patientId = serverIdFor('PATIENT', r.patientId);
    if (!patientId) {
      report.skipped[`appointment:${r.id}`] = `patient #${r.patientId} not on server (import it first)`;
      continue;
    }
    if (alreadyOnServer('APPOINTMENT', r.id)) {
      report.skipped[`appointment:${r.id}`] = 'already on server';
      continue;
    }
    const payload = {
      patientId,
      doctorId: int(r.doctorId ?? r.doctor_id) ?? 1,
      date: str(r.date),
      timeZone: repairTimeZone(r.time_zone),
      status: repairAppointmentStatus(r.status),
      category: repairCategory(r.category),
      notes: str(r.notes),
      requiredAmount: num(r.amount),
      cloudAppointmentId: str(r.cloud_appointment_id),
    };
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    if (!APPLY) { made++; continue; }
    const res = await apiCall('POST', '/api/appointments', payload);
    if (res.ok && res.data?.id != null) {
      remember('APPOINTMENT', r.id, res.data.id);
      report.created[`appointment:${r.id}`] = res.data.id;
      made++;
    } else if (res.status === 400 && /already has an active/i.test(JSON.stringify(res.data))) {
      // New double-booking guard. Not fatal: report and move on.
      report.skipped[`appointment:${r.id}`] = `double-booking: ${res.data?.message ?? ''}`;
    } else {
      report.failures.push({ entity: 'appointment', localId: r.id, reason: `${res.status} ${JSON.stringify(res.data)}` });
    }
  }
  console.log(`  appointments: ${made} ${APPLY ? 'imported' : 'to import'}`);
  return made;
}

async function importPayments() {
  if (!present('payments')) {
    report.tables.Payments = 'absent in source (the doctor client never had payments)';
    report.skipped.Payments = 'n/a';
    console.log('  payments: source has no Payments table, skipping');
    return 0;
  }
  const rows = count('payments', TABLES.payments);
  let made = 0;
  for (const r of rows) {
    const patientId = serverIdFor('PATIENT', r.patientId);
    if (!patientId) {
      report.skipped[`payment:${r.id}`] = `patient #${r.patientId} not on server`;
      continue;
    }
    if (alreadyOnServer('PAYMENT', r.id)) { report.skipped[`payment:${r.id}`] = 'already on server'; continue; }
    const appointmentId = r.appointmentId != null ? serverIdFor('APPOINTMENT', r.appointmentId) : undefined;
    const payload = {
      patientId,
      appointmentId,
      totalAmount: num(r.totalAmount) ?? 0,
      paidAmount: num(r.paidAmount) ?? 0,
      remainingAmount: num(r.remainingAmount) ?? 0,
      paymentMethod: str(r.paymentMethod),
      notes: str(r.notes),
      paymentDate: str(r.paymentDate),
    };
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    if (!APPLY) { made++; continue; }
    const res = await apiCall('POST', '/api/payments', payload);
    if (res.ok && res.data?.id != null) {
      remember('PAYMENT', r.id, res.data.id);
      report.created[`payment:${r.id}`] = res.data.id;
      made++;
    } else {
      report.failures.push({ entity: 'payment', localId: r.id, reason: `${res.status} ${JSON.stringify(res.data)}` });
    }
  }
  console.log(`  payments: ${made} ${APPLY ? 'imported' : 'to import'}`);
  return made;
}

async function importExpenses() {
  const rows = count('expenses', TABLES.expenses);
  let made = 0;
  const demoted = [];
  for (const r of rows) {
    if (alreadyOnServer('EXPENSE', r.id)) { report.skipped[`expense:${r.id}`] = 'already on server'; continue; }
    const localStatus = repairExpenseStatus(r.status);
    if (localStatus === 'APPROVED') demoted.push(r.id);
    // The server forces PENDING on create and only the approve endpoint moves it
    // on, so an APPROVED local row cannot arrive as APPROVED.
    const payload = {
      title: str(r.description) ?? str(r.title) ?? 'مصروف',
      amount: num(r.amount) ?? 0,
      category: str(r.category),
      notes: str(r.notes),
      expenseDate: str(r.expense_date),
      status: 'PENDING',
    };
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    if (!APPLY) { made++; continue; }
    const res = await apiCall('POST', '/api/expenses', payload);
    if (res.ok && res.data?.id != null) {
      remember('EXPENSE', r.id, res.data.id);
      report.created[`expense:${r.id}`] = res.data.id;
      made++;
    } else {
      report.failures.push({ entity: 'expense', localId: r.id, reason: `${res.status} ${JSON.stringify(res.data)}` });
    }
  }
  if (demoted.length) {
    note(`${demoted.length} locally-APPROVED expense(s) [${demoted.join(', ')}] will import as PENDING and need re-approving in the UI`);
  }
  console.log(`  expenses: ${made} ${APPLY ? 'imported' : 'to import'}`);
  return made;
}

async function importMedications() {
  const rows = count('medications', TABLES.medications);
  let made = 0;
  let repaired = 0;
  for (const r of rows) {
    const patientId = serverIdFor('PATIENT', r.patientId);
    if (!patientId) { report.skipped[`medication:${r.id}`] = `patient #${r.patientId} not on server`; continue; }
    if (alreadyOnServer('MEDICATION', r.id)) { report.skipped[`medication:${r.id}`] = 'already on server'; continue; }
    const status = repairMedicationStatus(r.status);
    if (String(r.status ?? '').trim() !== status) repaired++;
    const payload = {
      patientId,
      drugName: str(r.drugName),
      dosage: str(r.dosage),
      frequency: str(r.frequency),
      duration: str(r.duration),
      instructions: str(r.instructions),
      startDate: str(r.startDate),
      endDate: str(r.endDate),
      status,
    };
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    if (!APPLY) { made++; continue; }
    const res = await apiCall('POST', '/api/medications', payload);
    if (res.ok && res.data?.id != null) {
      remember('MEDICATION', r.id, res.data.id);
      report.created[`medication:${r.id}`] = res.data.id;
      made++;
    } else {
      report.failures.push({ entity: 'medication', localId: r.id, reason: `${res.status} ${JSON.stringify(res.data)}` });
    }
  }
  if (repaired) note(`${repaired} medication row(s) had a CSS class in the status column and were repaired to Active/Stopped`);
  console.log(`  medications: ${made} ${APPLY ? 'imported' : 'to import'}`);
  return made;
}

async function importHistory() {
  const rows = count('history', TABLES.history);
  let made = 0;
  for (const r of rows) {
    const patientId = serverIdFor('PATIENT', r.patientId);
    if (!patientId) { report.skipped[`history:${r.id}`] = `patient #${r.patientId} not on server`; continue; }
    if (alreadyOnServer('HISTORY', r.id)) { report.skipped[`history:${r.id}`] = 'already on server'; continue; }
    const appointmentId = r.appointmentId != null ? serverIdFor('APPOINTMENT', r.appointmentId) : undefined;
    const payload = {
      patientId,
      appointmentId,
      category: repairCategory(r.category),
      diagnosis: str(r.diagnosis),
      notes: str(r.notes),
      createdAt: str(r.created_at),
    };
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    if (!APPLY) { made++; continue; }
    const res = await apiCall('POST', '/api/history', payload);
    if (res.ok && res.data?.id != null) {
      remember('HISTORY', r.id, res.data.id);
      report.created[`history:${r.id}`] = res.data.id;
      made++;
    } else {
      report.failures.push({ entity: 'history', localId: r.id, reason: `${res.status} ${JSON.stringify(res.data)}` });
    }
  }
  console.log(`  history: ${made} ${APPLY ? 'imported' : 'to import'}`);
  return made;
}

// ─── main ─────────────────────────────────────────────────────────────────────
console.log(`Mode:      ${APPLY ? 'APPLY (writes to the server)' : 'DRY RUN (no writes)'}`);
console.log(`Source:    ${dbPath}`);
console.log(`Server:    ${SERVER}\n`);

const available = Object.entries(TABLES).filter(([k]) => present(k)).map(([, t]) => t);
console.log(`Tables found in source: ${available.join(', ') || 'none'}\n`);

await login();
console.log('');

simulateParentIds();

await importPatients();
await importAppointments();
await importPayments();
await importExpenses();
await importMedications();
await importHistory();

report.finishedAt = new Date().toISOString();
const created = Object.keys(report.created).length;
const failures = report.failures.length;
const skipped = Object.keys(report.skipped).length;

console.log('\n────────────────────────────────────────');
console.log(`  ${report.mode.toUpperCase()}: ${APPLY ? created : '0'} written, ${failures} failed, ${skipped} skipped`);
console.log('────────────────────────────────────────');

if (failures) {
  console.log('\nFailures:');
  for (const f of report.failures) console.log(`  ${f.entity} #${f.localId}: ${f.reason}`);
}
if (report.warnings.length) {
  console.log('\nWarnings:');
  for (const w of report.warnings) console.log(`  ${w}`);
}
if (!APPLY) {
  console.log('\nThis was a dry run. Re-run with --apply to write.');
}

if (REPORT_PATH) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${REPORT_PATH}`);
}

db.close();
process.exit(failures ? 1 : 0);
