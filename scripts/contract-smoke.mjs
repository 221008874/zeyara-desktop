/**
 * Desktop <-> Clinic Server runtime contract smoke test.
 *
 * Covers every module audited on the desktop side (dashboard, patients,
 * appointments, schedule, expenses, money safe, financial reports, history,
 * medications, notifications, backups, license, sync).
 *
 * Why this shape:
 *  - The server answers 503 for every gated API while the license gate is
 *    closed. That is correct behaviour, not a contract break, so this test
 *    verifies the LOCK contract in that state and exits 0. As soon as a valid
 *    license is active it runs the full authenticated suite.
 *  - Assertions are read-only by default so it is safe to point at a real
 *    clinic server. Pass --with-writes to additionally exercise a schedule
 *    create/delete round-trip.
 *  - Response SHAPE is asserted, not just the status code. Most defects found
 *    during the audit were invisible at runtime: an endpoint returning 200 with
 *    a field the page never reads (or vice versa), which renders a blank
 *    column instead of raising an error.
 *
 * Usage:
 *   BASE_URL=https://host:8443 ADMIN_PASSWORD=... node scripts/contract-smoke.mjs
 *   ... --with-writes
 */
const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:8081').replace(/\/$/, '');
const username = process.env.ADMIN_USERNAME ?? 'admin';
const password = process.env.ADMIN_PASSWORD;
const withWrites = process.argv.includes('--with-writes');

if (!password) throw new Error('ADMIN_PASSWORD is required for the contract smoke test');

const today = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = iso(today);
const YEAR_MONTH = TODAY.slice(0, 7);

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body };
}

const results = [];
function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message });
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}
/** Asserts every listed key is present on at least one element (skipped when empty). */
function expectFields(items, keys, label) {
  if (!Array.isArray(items) || items.length === 0) return 'empty (shape not asserted)';
  const sample = items[0];
  const missing = keys.filter((k) => !(k in sample));
  expect(missing.length === 0, `${label} items missing expected field(s): ${missing.join(', ')}`);
  return `${items.length} item(s), fields ok`;
}

// ── public contract ────────────────────────────────────────────────────────
const health = await request('/api/health');
check('GET /api/health', () => {
  expect(health.status === 200 && String(health.body).trim() === 'UP', `got ${health.status} ${health.body}`);
  return 'UP';
});

const bootstrap = await request('/api/admin/bootstrap/status');
check('GET /api/admin/bootstrap/status', () => {
  expect(bootstrap.status === 200 && typeof bootstrap.body?.completed === 'boolean', `got ${bootstrap.status} ${JSON.stringify(bootstrap.body)}`);
  return `completed=${bootstrap.body.completed}`;
});

const login = await request('/api/admin/login', {
  method: 'POST',
  body: JSON.stringify({ username, password }),
});
check('POST /api/admin/login', () => {
  expect(login.status === 200 && login.body?.token, `got ${login.status} ${JSON.stringify(login.body)}`);
  return 'token issued';
});

function finish(mode) {
  console.log(`\nDesktop contract smoke (${mode}) against ${baseUrl}`);
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
}

if (login.status !== 200 || !login.body?.token) {
  finish('ABORTED');
  process.exit(1);
}

const auth = { Authorization: `Bearer ${login.body.token}` };
const get = (path) => request(path, { headers: auth });

// ── license state ──────────────────────────────────────────────────────────
const license = await get('/api/license/status');
check('GET /api/license/status', () => {
  expect(license.status === 200, `got ${license.status}`);
  expect(typeof license.body?.locked === 'boolean', `locked should be boolean, got ${JSON.stringify(license.body)}`);
  return `locked=${license.body.locked}`;
});

const locked = license.body?.locked === true;

if (locked) {
  // Verify the gate actually rejects every gated API, not just one probe.
  const gated = [
    '/api/dashboard/summary',
    '/api/patients',
    '/api/appointments',
    '/api/expenses',
    '/api/history',
    '/api/medications',
    '/api/notifications',
    '/api/money-safe/balance',
    '/api/money-safe/transactions',
    '/api/schedule',
  ];
  let rejected = 0;
  const leaks = [];
  const gatedProbeResults = [];
  for (const path of gated) {
    const r = await get(path);
    gatedProbeResults.push(r);
    if (r.status === 503) rejected += 1;
    else leaks.push(`${path} -> ${r.status}`);
  }
  check('license gate rejects every gated API', () => {
    expect(leaks.length === 0, `these answered while locked: ${leaks.join(', ')}`);
    return `${rejected}/${gated.length} gated endpoints returned 503`;
  });

  const lockedProbe = gatedProbeResults[0];
  check('locked reason is reported', () => {
    const text = `${lockedProbe?.body?.error ?? ''} ${lockedProbe?.body?.reason ?? ''}`.toLowerCase();
    expect(text.includes('lock') || text.includes('license'), `unexpected reason: ${JSON.stringify(lockedProbe?.body)}`);
    return lockedProbe?.body?.reason ?? lockedProbe?.body?.error;
  });

  finish('LICENSE-LOCKED');
  console.log('\nPASS: public contract + license lock verified.');
  console.log('Activate a valid license to exercise the authenticated suite.');
  process.exit(0);
}

// ── authenticated contract ─────────────────────────────────────────────────
const dashboard = await get('/api/dashboard/summary');
check('GET /api/dashboard/summary', () => {
  expect(dashboard.status === 200, `got ${dashboard.status} ${JSON.stringify(dashboard.body)}`);
  expect(dashboard.body?.kpis && typeof dashboard.body.kpis === 'object', 'missing kpis object');
  return `kpis=${Object.keys(dashboard.body.kpis).length}`;
});

const patients = await get('/api/patients');
check('GET /api/patients', () => {
  expect(patients.status === 200 && Array.isArray(patients.body), `got ${patients.status}`);
  return expectFields(patients.body, ['id', 'name', 'phone', 'age', 'gender', 'bmiCategory'], 'patients');
});

const appointments = await get('/api/appointments');
check('GET /api/appointments', () => {
  expect(appointments.status === 200 && Array.isArray(appointments.body), `got ${appointments.status}`);
  return expectFields(appointments.body, ['id', 'date', 'timeZone', 'status'], 'appointments');
});

const history = await get('/api/history');
check('GET /api/history', () => {
  expect(history.status === 200 && Array.isArray(history.body), `got ${history.status}`);
  return expectFields(history.body, ['id', 'patientId', 'category', 'diagnosis', 'createdAt'], 'history');
});

const medications = await get('/api/medications');
check('GET /api/medications', () => {
  expect(medications.status === 200 && Array.isArray(medications.body), `got ${medications.status}`);
  // Medication exposes startDate/endDate, NOT prescribedAt/createdAt.
  return expectFields(medications.body, ['id', 'drugName', 'dosage', 'startDate'], 'medications');
});

const expenses = await get('/api/expenses');
check('GET /api/expenses', () => {
  expect(expenses.status === 200 && Array.isArray(expenses.body), `got ${expenses.status}`);
  return expectFields(expenses.body, ['id', 'title', 'amount', 'status', 'category', 'expenseDate'], 'expenses');
});

const notifications = await get('/api/notifications');
check('GET /api/notifications', () => {
  expect(notifications.status === 200 && Array.isArray(notifications.body), `got ${notifications.status}`);
  // ScheduleNotification exposes type/message, NOT title/body.
  return expectFields(notifications.body, ['id', 'type', 'message', 'seen', 'createdAt'], 'notifications');
});

const balance = await get('/api/money-safe/balance');
check('GET /api/money-safe/balance', () => {
  expect(balance.status === 200, `got ${balance.status}`);
  // The endpoint returns a raw BigDecimal (a bare JSON number). The desktop
  // reads it with `typeof x === 'number'`; wrapping it in an object would
  // silently render every balance as 0.
  expect(typeof balance.body === 'number', `expected a bare number, got ${JSON.stringify(balance.body)}`);
  return `balance=${balance.body}`;
});

const transactions = await get('/api/money-safe/transactions');
check('GET /api/money-safe/transactions', () => {
  expect(transactions.status === 200 && Array.isArray(transactions.body), `got ${transactions.status}`);
  return expectFields(transactions.body, ['id', 'type', 'amount', 'sourceType', 'createdAt'], 'transactions');
});

for (const [label, path, keys] of [
  ['daily', `/api/money-safe/report/daily?date=${TODAY}`, ['totalIncome', 'totalExpenses', 'net']],
  ['monthly', `/api/money-safe/report/monthly?yearMonth=${YEAR_MONTH}`, ['totalIncome', 'totalExpenses', 'net']],
]) {
  const r = await get(path);
  check(`GET /api/money-safe/report/${label}`, () => {
    expect(r.status === 200, `got ${r.status} ${JSON.stringify(r.body)}`);
    for (const k of keys) expect(k in (r.body ?? {}), `missing "${k}" in ${label} report`);
    return `net=${r.body.net}`;
  });
}

const schedule = await get(`/api/schedule?date=${TODAY}`);
check('GET /api/schedule', () => {
  expect(schedule.status === 200 && Array.isArray(schedule.body), `got ${schedule.status}`);
  return expectFields(schedule.body, ['id', 'date', 'timeZone', 'startTime', 'endTime', 'cancelled'], 'schedule');
});

const backups = await get('/api/admin/backups');
check('GET /api/admin/backups', () => {
  expect(backups.status === 200 && Array.isArray(backups.body), `got ${backups.status}`);
  // BackupInfo is (filename, path, sizeKb, createdAt) — no lastBackupTime.
  return expectFields(backups.body, ['filename', 'sizeKb', 'createdAt'], 'backups');
});

const syncStatus = await get('/api/sync/status');
check('GET /api/sync/status', () => {
  expect(syncStatus.status === 200, `got ${syncStatus.status} ${JSON.stringify(syncStatus.body)}`);
  expect(typeof syncStatus.body?.online === 'boolean', 'missing boolean "online"');
  expect('pendingCount' in (syncStatus.body ?? {}), 'missing "pendingCount"');
  return `online=${syncStatus.body.online} pending=${syncStatus.body.pendingCount}`;
});

const profile = await get('/api/doctors/me');
check('GET /api/doctors/me', () => {
  expect(
    profile.status === 404 || (profile.status === 200 && profile.body?.password === null),
    `got ${profile.status} ${JSON.stringify(profile.body)}`,
  );
  return profile.status === 404 ? '404 for admin (expected)' : 'password redacted';
});

// ── optional write round-trip (off by default) ─────────────────────────────
if (withWrites) {
  const created = await request('/api/schedule', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ date: TODAY, timeZone: 'NIGHT', startTime: '22:00', endTime: '23:00', cancelled: false }),
  });
  check('POST /api/schedule (write round-trip)', () => {
    expect(created.status === 200 && created.body?.id, `got ${created.status} ${JSON.stringify(created.body)}`);
    return `created id=${created.body.id}`;
  });
  if (created.body?.id) {
    const removed = await request(`/api/schedule/${created.body.id}`, { method: 'DELETE', headers: auth });
    check('DELETE /api/schedule (cleanup)', () => {
      expect(removed.status === 204 || removed.status === 200, `got ${removed.status}`);
      return 'cleaned up';
    });
  }
}

// ── report ─────────────────────────────────────────────────────────────────
finish('UNLOCKED');
console.log(`\nPASS: ${results.length} contract checks succeeded.`);
if (!withWrites) console.log('(write round-trip skipped; pass --with-writes to include it)');
