# Tauri Replacement Audit — DR + Secretary JavaFX

**Date:** 2026-09-27
**Scope:** Can `D:\proj\zeyara-desktop` (Tauri + React) fully replace `D:\proj\DR Mostafa` (DR Doctor) and `D:\proj\secertary` (Secretary)?
**Method:** every workflow extracted from the legacy source (controllers, services, DAO, FXML), then mapped to actual Tauri source files, routes and endpoint calls. No workflow is inferred from a screen name.
**Legacy code:** untouched. Nothing deprecated or deleted.

## Verdict

**NOT_READY** — B1 is the only remaining blocker and is **DECISION_REQUIRED**, not a code gap.
B2 and B3 are closed and **REPLACED**.

| # | Gap | Status | Resolution |
|---|---|---|---|
| B1 | **Patient media gallery** (photos/videos) has no equivalent | **DECISION_REQUIRED** | Needs a scope decision — see the note immediately below. No Clinic Server change made. |
| B2 | **Auto-schedule follow-up** after completing an examination | **REPLACED** | `src/lib/clinicalActions.ts`; 25 tests, 8 mutations killed — §4a |
| B3 | **Partial / quick collection** against an existing outstanding payment | **REPLACED** | `src/lib/paymentCollection.ts`; 22 tests, 6 mutations killed — §4b |

B1 is a product decision rather than an implementation task, so overall status stays
`NOT_READY` until it is chosen. The JavaFX apps must be retained until then: they are the
only working home for patient media.

---

## B1 — Patient media gallery: decision required

Not implemented. `Clinic Server` was **not** modified. This section exists so the choice can
be made deliberately.

### What the legacy app does

DR `patientDashboard.openGallery` creates
`~/.clinicapp/patients/patient_{id}_{name}/{photos,videos}`, uploads images
(`jpg jpeg png gif bmp webp`) and videos (`mp4 avi mov wmv mkv flv`) with `_1`/`_2`
de-duplication, and previews them in a modal stage: images at 600×400 with **Open in
Viewer**, videos through `MediaPlayer`/`MediaView` with **Play / Pause / Stop / Open in
Player**, and a thumbnail pane per directory.

Critically: **media is never uploaded to the server.** It lives in one user's profile
directory. Another device, another user, and the server have no idea it exists. This was
true in production, not an oversight in a test environment.

### Option A — Local-only parity

Reproduce the legacy behaviour exactly.

- Patient media stays in the client profile directory; nothing is sent to the server.
- No server persistence, no cross-device visibility, no sharing between receptionist and doctor.
- Requires only client work: an upload capability in `src-tauri/capabilities/default.json`
  (currently nothing can write an arbitrary path), a gallery UI on
  `PatientDashboardPage`, and image/video preview.
- **Cost:** smallest. **Trade-off:** faithfully reproduces a limitation. Two machines in the
  same clinic see different galleries, and a reinstall or a profile reset loses the media.
  It is only defensible if the clinic runs a single front-desk PC.
- **Risk:** low. No server contract, no authorization question, nothing to migrate.

### Option B — Server-backed media

Media becomes clinic data that the server owns.

Needs `Clinic Server` support for:

| Concern | What is required |
|---|---|
| Upload | authenticated multipart endpoint, size and type limits, content validation |
| Metadata | filename, MIME type, byte size, checksum, capture date |
| Patient association | every record bound to a `patientId`, enforced server-side |
| Retrieval | list and fetch per patient, with pagination |
| Authorization | who may read and write — a doctor's clinical media is not necessarily a secretary's to read |
| Storage lifecycle | on-disk layout, backup inclusion, retention, delete |

- **Cost:** substantially larger. New endpoints, new authorization rules, storage and backup
  changes, plus client upload/preview work.
- **Benefit:** media is visible to the whole clinic, survives a reinstall, and can be backed
  up and audited.
- **Risk:** moderate. Patient clinical media is a privacy surface; the authorization matrix
  has to be decided before the endpoints exist, not after.
- **Note:** `BackupsPage` already performs a server-side Excel backup of patients,
  appointments and medications, so there is an existing precedent for clinic-owned export —
  but no precedent for binary attachments.

### Recommendation

**Option B**, on the condition the authorization matrix is settled first. The clinic already
treats diagnosis, vitals and prescriptions as shared server data, and photographs of a
patient's body are more sensitive still — not less. Option A would create a second, private
copy of clinical data that the server does not know exists, which is the kind of gap that is
cheap to avoid now and expensive to unpick later.

If the clinic genuinely runs a single front-desk PC and never needs the media elsewhere,
Option A is a legitimate, cheap choice — but it should be recorded as a deliberate
limitation, not inherited by default.

**No code has been written for either option, and `Clinic Server` is untouched.**

---

## 1. DR Doctor — workflow inventory (19 FXML → 28 workflows)

Legacy app: single hard-coded role `"doctor"`, no role selection, no admin mode. Local SQLite
is written first, then pushed to the server; `server_id_mappings` reconciles IDs. Token is
memory-only.

| # | Workflow | FXML / controller | Endpoints |
|---|---|---|---|
| D-01 | Splash → license gate → first-use/returning branch | `hello-view.fxml` / `SplashController` | `GET /api/license/status`, `GET /api/health` |
| D-02 | UDP heartbeat server discovery (port 8888) | `HeartbeatMonitor.java` | UDP + `GET /api/health` |
| D-03 | Manual server configuration | `Login`, `LicenseScreen`, `AdminDoctorReg` | — (writes `~/.clinicapp/config.properties`) |
| D-04 | Register first (owner) doctor | `InitializeFirstUse/AdminDoctorReg.fxml` | `GET /api/doctors/check-username`, `POST /api/doctors`, `POST /api/doctors/login` |
| D-05 | Register secretary | `InitializeFirstUse/secertaryReg.fxml` | `GET /api/secretaries/check-username`, `POST /api/secretaries` |
| D-06 | License-locked hard block (60 s poll) | `InitializeFirstUse/LicenseScreen.fxml` | `GET /api/license/status` |
| D-07 | Log in (local plaintext → server JWT, auto-repair) | `Login/Login.fxml` | `POST /api/doctors/login`, `POST /api/doctors` |
| D-08 | Forced password change | `UpdateUserData.fxml` | `PUT /api/doctors/{id}` |
| D-09 | App update check / install (PowerShell script) | `updater/UpdateChecker.java` | `GET /api/update/check?app=dr` |
| D-10 | Excel backup prompt on close (3 sheets + diff) | `HelloApplication` + `ExcelBackupService` | local SQLite |
| D-11 | Language toggle EN⇄AR (+RTL) | every screen | — |
| D-12 | Fullscreen toggle | every screen | — |
| D-13 | Admin dashboard: patient count, search, DIAGNOSED filter, unsaved banner | `Admin/AdminMainBage.fxml` | `GET /api/patients`, `GET /api/patients/search?q=` |
| D-14 | Add patient (age 1–150, phone regex, gender, duplicate-by-phone) | `addNewPatient.fxml` | `POST /api/patients`, `GET /api/patients/search?q=` |
| D-15 | Patient dashboard shell + folder creation | `patientDashpoard.fxml` / `patientDashboard.java` (2802 lines) | — |
| D-16 | Info tab: diagnosis, vitals, BMI, pregnancy, allergies, conditions, notes (2 s debounced auto-save) | same | `PUT /api/patients/{serverId}` |
| D-17 | Save Diagnosis PDF | same | — |
| D-18 | Medications tab: list + active/stopped/total counters | same | — (local) |
| D-19 | Prescribe medication (**diagnosis mandatory**, crude duration parser) | same | `POST /api/medications` |
| D-20 | Stop medication | same | `PUT /api/medications/{serverId}` |
| D-21 | Reactivate medication | same | `PUT /api/medications/{serverId}` |
| D-22 | Print/save Prescription PDF (**sets follow-up date**, date ≥ tomorrow enforced) | same | `PUT /api/patients/{serverId}` |
| D-23 | Appointments tab + mark one DONE | same | `POST /api/appointments/{id}/complete` |
| D-24 | **Auto-schedule follow-up** (14 days, MORNING, FOLLOW_UP, with amount) | `promptPostCompletionActions` | — (local only) |
| D-25 | Book appointment from exit dialog | `showAppointmentBookingForm` | — (local only) |
| D-26 | History tab | same | `GET /api/patients/{id}/history` |
| D-27 | **Patient media gallery** (upload/preview/play photos + videos) | `openGallery` | — (local filesystem only) |
| D-28 | 3-way unsaved-changes exit + session rollback | `handleReturnAction` | `PUT /api/patients/{id}` |
| D-29 | View appointments (day strip today−7…+30, stats) | `ViewAppointaments.fxml` | `GET /api/patients`, `GET /api/appointments` |
| D-30 | Cancel a time zone (bulk server-side reschedule) | `schaduleManagment.fxml` | `PUT /api/schedule/cancel?date=&timeZone=` |
| D-31 | Reactivate a cancelled zone | same | `GET /api/schedule`, `PUT /api/schedule/{id}` |
| D-32 | Set per-date zone time range (≥30 min enforced) | same | `GET /api/schedule`, `POST/PUT /api/schedule` |
| D-33 | Reset zones to defaults (**client-only, not persisted**) | same | — |
| D-34–37 | Date-range schedule rules: base / override / delete / list | same | — (local only, never synced) |
| D-38 | Orphan screen `addNewAppointment.fxml` — fully functional, **nothing navigates to it** | — | `POST /api/appointments` |
| D-39 | Financial dashboard (balance, today, month, pending alert) | `financialDashboard.fxml` | `GET /api/money-safe/balance`, `/report/daily`, `/report/monthly`, `/api/expenses/pending` |
| D-40 | Submit expense (`createdBy` hard-coded `"DOCTOR"`) | `addExpense.fxml` | `POST /api/expenses` |
| D-41 | Browse/filter expenses (ALL/PENDING/APPROVED; **no REJECTED tab**) | `ExpenseManagementView.fxml` | `GET /api/expenses` (fallback only) |
| D-42–44 | Approve / reject / unapprove expense (**no role gate**) | same | `PUT /api/expenses/{id}/approve|reject|unapprove` |
| D-45 | Money-safe ledger (client-side running balance, filters) | `moneySafeTransactions.fxml` | `GET /api/money-safe/transactions?from=&to=` |
| D-46 | Money-safe export button | same | — (**stub, does nothing**) |
| D-47 | Reports Center: 7 categories, 21 report types (**6 produce empty output**) | `reportSysView.fxml` | aggregates the above |
| D-48 | Report CSV export (UTF-8 BOM) | same | — |
| D-49 | Report PDF export (greyscale, **no Arabic font**) | same | — |
| D-50 | Report history (50 entries, 5 s cooldown, re-export from snapshot) | same | — |
| D-51 | Settings: language, theme, save & restart | `Settings.fxml` | — |
| D-52 | Restore clinic data from Excel backup into an **empty** server | same | `GET /api/patients`, `GET /api/appointments`, then `POST` patients/appointments/medications |
| D-53 | Update own user data (plaintext current-password compare) | `UpdateUserData.fxml` | `PUT /api/doctors/{id}` |
| D-54 | Notifications (list, search, type filter, mark seen, mark all seen) | `NotificationsView.fxml` | **local only** — `RemoteNotificationAPIImpl` never called; `SseNotificationClient` never instantiated |
| D-55 | 5-minute auto-sync (push/pull, circuit breaker, watermarks) | `AutoSyncService.java` | `updated-since` / `deleted-since` family |

### Legacy defects found (must NOT be carried into the replacement)

| Defect | Consequence if ported |
|---|---|
| Passwords stored and compared in **plaintext**; `PasswordUtil` (SHA-256) never called | Local auth trivially bypassable |
| `updateToken` reads JSON key `token`; sibling code path expects `accessToken` | Refresh silently fails → forced logout |
| Night zone saved as `EVENING` in the schedule screen, `NIGHT` everywhere else | Two keys for one zone |
| `category = "zy-state-followup"` — a CSS class stored as data | Server-side category filter never matches |
| `medication.status = "zy-active"` — not a server status | Status filter breaks |
| `AppointmentService.syncCancelledZonesFromServer` is a `log.info` no-op called from 4 sites | Cancelled zones never applied |
| `Login` navigates to `InitializeFirstUse/LicenseLockedController` — **FXML does not exist** | Dead end: user stuck on login when locked |
| `ViewAppointments` nav target is lowercase `viewAppointaments` | Breaks on case-sensitive filesystems |
| `todayBtn` in `ViewAppointments.fxml` has no `onAction` and no handler | Dead button |
| `addNewAppointment.fxml` fully built but nothing navigates to it | Orphan screen |
| 6 of 21 report types hit `default:` → empty report | Silent empty output |
| `handleClearSearch` clears the money-safe search field but never filters by it | Dead input |
| `btnExport` on money-safe is a stub | Dead button |
| `HistorySyncService.start()` never called | **Offline-completed appointments are never pushed** unless the doctor completes another appointment |
| Auto-registration on login failure re-POSTs the local doctor | Re-registers users on transient 401 |
| Language toggle writes to the **classpath** `settings.properties` | Language lost on restart in packaged builds |
| `headerTodayCount` hard-coded `0`; 5 stat labels injected but never assigned; `chartsContainer` never populated | Dashboard shows blanks |
| `notificationDot` never updated | Unseen notifications invisible |
| Server config falls back to hard-coded `192.168.1.8:8081` | Wrong-server risk |
| `NotificationsView` errors go to `System.err`, bypassing SLF4J | No error log |

---

## 2. Secretary JavaFX — workflow inventory (13 FXML → 20 workflows)

Legacy app: single-role, logs in via `POST /api/secretaries/login`. **All 13 FXML are
navigated to — no orphans.** Three-stage auth ladder: online login → auto-registration →
offline BCrypt login against local SQLite.

| # | Workflow | FXML / controller | Endpoints |
|---|---|---|---|
| S-01 | Splash → license gate (15 min poll, 24 h offline grace) → update check | `hello-view.fxml` / `SplashController` | `GET /api/license/validate`, `GET /api/update/check?app=sec` |
| S-02 | UDP discovery + mandatory `GET /api/health` 200 before ONLINE | `ConnectionManager` | UDP 8888 + health |
| S-03 | Log in (online → auto-register → offline) | `Login/Login.fxml` | `POST /api/secretaries/login`, `POST /api/secretaries` |
| S-04 | Forced password change / update user data (BCrypt verify, min 4 chars) | `UpdateUserData.fxml` | `PUT /api/secretaries/{id}` (best-effort) |
| S-05 | Dashboard: today patients/appointments, unread count, daily collection, outstanding alert, 7 charts | `secertaryMainBage.fxml` | `GET /api/patients` (status only) |
| S-06 | Patient search (cache-backed, `contains` on name or phone) | same | `GET /api/patients/search?q=` (effectively dead) |
| S-07 | Add patient (same validation as DR; 3 duplicate guards; auto-chains to booking) | `addNewPatient.fxml` | `GET /api/patients/search?q=`, `POST /api/patients` |
| S-08 | Book for NEW patient + inline payment + **rollback of the just-created patient** | `addNewAppointament.fxml` | `POST /api/appointments`, `POST /api/payments`, `DELETE` on failure |
| S-09 | Book for EXISTING patient (no payment, no rollback) | `AddAppointmentExistingPatient.fxml` | `POST /api/appointments` |
| S-10 | Patient dashboard: header, payment banner, history table, summary cards | `secPatientDashboard.fxml` | — (local) |
| S-11 | Payment collection — 4 dynamic modes (expired follow-up / examination-required / partial / hidden) | same | `POST /api/payments` (new), `PUT /api/payments/{id}` (partial) |
| S-12 | Quick payment box (always targets `unpaid.get(0)`) | same | `PUT /api/payments/{id}` |
| S-13 | Generate patient payment report PDF | same | — |
| S-14 | Dashboard quick-payment dialog (search → select → collect) | in-code `StyledDialog` | `PUT /api/payments/{id}` |
| S-15 | Outstanding-balance list (100 % local, no export) | in-code dialog | — |
| S-16 | View appointments (filters apply only on button click; default window ±30 days) | `ViewPatientAppointments.fxml` | `PUT /api/appointments/{id}` (reschedule), `DELETE /api/appointments/{id}` (cancel) |
| S-17 | Reschedule (date text field `YYYY-MM-DD`, past rejected) | same | `PUT /api/appointments/{id}` |
| S-18 | Cancel appointment (**hard `DELETE`** — never writes `CANCELLED`) | same | `DELETE /api/appointments/{id}` |
| S-19 | Expenses: add (7 categories) + approve/reject/unapprove gated by `setAdminMode` | `expense_screen.fxml` | `POST /api/expenses`, `PUT /api/expenses/{id}/approve|reject` |
| S-20 | Online bookings (list only) | `OnlineBookings.fxml` | — |
| S-21 | Notifications via **SSE** (`SseNotificationClient`, live) | `NotificationsView.fxml` | `GET /api/events/stream`, `PUT /api/notifications/{id}/seen`, `/seen/all` |
| S-22 | Settings (language, theme) | `Settings.fxml` | — |
| S-23 | Server setup dialog (relaunches `run.bat`) | `Login` | — |

### Legacy defects found (must NOT be carried into the replacement)

| Defect | Consequence if ported |
|---|---|
| Offline login produces **no token** → every later API call is unauthenticated → 401 | App silently degrades to local-only |
| `PatientDAO.create(serverRow)` inserts a **server id** into a local autoincrement column | ID-space corruption |
| Cancel = hard `DELETE`, never writes `CANCELLED` | Loses history; orphans the linked payment |
| `openPatientDashboard` silently creates the patient if the local row is missing | Masks sync failures |
| `currentPassword` verified against **local SQLite only** — never re-authenticated with the server | Password change is theatre when offline |
| `doctorId` hard-coded to `1` (`CurrentDoctor`) | Wrong doctor attribution |
| `AdminMainBage` sidebar shows **static** name/role strings, not the logged-in user | Misleading |
| Leaving the new-patient booking screen without booking **deletes the patient** | Data loss by navigation |
| Filters apply only when the button is clicked; table initially shows every appointment ever | Misleading default |
| `DateTimeParseException` on reschedule uncaught inside `Task.call()` | Generic failure message |
| "Call" button is informational only — no `tel:` URI, no dialer | Dead affordance |
| `CurrentDoctor.getDoctorId()` has no setter and is never set | Structural |
| Payment-report PDF uses Helvetica only (Latin-1) | Arabic renders as blanks |
| `paymentAlertLabel` hard-codes English `"Loading payment alerts..."` | Un-localized string in Arabic UI |
| `syncCancelledZonesFromServer` is a log-only stub | Cancelled zones never applied |

---

## 3. Tauri parity matrix

Status key: **REPLACED** = equivalent business workflow exists and is usable · **PARTIAL** = meaningful behaviour missing · **MISSING** = no equivalent · **NOT_APPLICABLE** = intentionally removed by architecture, with evidence.

### 3.1 DR Doctor

| Legacy | Workflow | Tauri equivalent | Status | Evidence |
|---|---|---|---|---|
| D-01 | Splash → license gate | `App.tsx` → `SetupGate` → `LicenseGate` | REPLACED | `app-shell/accessControl.tsx` |
| D-02 | UDP discovery 8888 | `lib/heartbeat.ts` + `stores/heartbeat.ts` | REPLACED (improved) | HMAC-verified candidates, explicit ADMIN adoption |
| D-03 | Manual server config | `ServerManagerPage.tsx`, `SettingsPage.tsx` | REPLACED | `setServerBaseUrl` in `lib/api.ts` |
| D-04 | Register first doctor | `SetupWizardPage.tsx` | REPLACED | `POST /api/admin/bootstrap` |
| D-05 | Register secretary | `SetupWizardPage.tsx`, `UsersPage.tsx` | REPLACED (improved) | `POST /api/secretaries`; users manageable later, not first-use-only |
| D-06 | License hard block | `LicenseGate` + `LicenseScreen.tsx` | REPLACED (improved) | fails closed on unknown status |
| D-07 | Log in | `LoginPage.tsx`, `stores/auth.tsx` | REPLACED (improved) | server-returned role wins; no plaintext local compare; no auto-re-register |
| D-08 | Forced password change | `ProtectedRoute` → `ChangePasswordPage.tsx` | REPLACED (improved) | real `POST /api/auth/complete-password-change`; back button cannot bypass |
| D-09 | App update | `DashboardPage` + `lib/updateCheck.ts` | REPLACED (improved) | signed NSIS updater; AC13 E2E verified 1.0.3 → 1.0.4 |
| D-10 | Excel backup on close | `lib/backupOnClose.ts` + `lib/closeBackup.tsx` | REPLACED (improved) | exceljs, 3 sheets, source = server not stale local DB |
| D-11 | Language EN⇄AR + RTL | `stores/settings.ts`, `design-system/theme/rtl.ts` | REPLACED (improved) | persists correctly (legacy wrote to classpath) |
| D-12 | Fullscreen | window chrome | NOT_APPLICABLE | resizable window supersedes a fullscreen toggle |
| D-13 | Dashboard + search + DIAGNOSED filter | `DashboardPage.tsx`, `PatientsPage.tsx` | **PARTIAL** | search is **client-side only** — no `/api/patients/search?q=`; no DIAGNOSED filter |
| D-14 | Add patient | `AddPatientPage.tsx` | REPLACED | `POST /api/patients`, `PUT /api/patients/{id}`, duplicate-by-phone |
| D-15 | Patient dashboard shell | `PatientDashboardPage.tsx` | REPLACED | no local folder side-effects |
| D-16 | Info tab: diagnosis, vitals, BMI, pregnancy, allergies, conditions, notes | `PatientDashboardPage.tsx` | REPLACED | all fields present; saves via `PUT /api/patients/{id}` |
| D-17 | Diagnosis PDF | `lib/patientDocs.ts` → `exportDiagnosisDocumentPdf` | REPLACED (improved) | jsPDF + embedded Cairo; **Arabic shapes correctly**, legacy report PDFs did not |
| D-18 | Medications tab + counters | `PatientDashboardPage.tsx` | REPLACED | `GET /api/medications/patient/{id}` |
| D-19 | Prescribe medication | `PatientDashboardPage.tsx` | **PARTIAL** | medication CRUD present; the **"diagnosis mandatory" gate is not enforced** |
| D-20 | Stop medication | `PatientDashboardPage.tsx` | REPLACED | `PUT /api/medications/{id}` |
| D-21 | Reactivate medication | `PatientDashboardPage.tsx` | REPLACED | `PUT /api/medications/{id}` |
| D-22 | Prescription PDF + follow-up date | `lib/patientDocs.ts` → `exportPrescriptionDocumentPdf` | **PARTIAL** | PDF present; **follow-up date is not set from the prescription flow** |
| D-23 | Appointments tab + mark DONE | `PatientDashboardPage.tsx` | REPLACED | `POST /api/appointments/{id}/complete` |
| D-24 | **Auto-schedule follow-up after examination** | `lib/clinicalActions.ts` → `completeVisit` | **REPLACED** | +14 days, MORNING, FOLLOW_UP, amount preserved, `followUpDate` stamped. 25 tests. |
| D-25 | Book from exit dialog | `AddAppointmentPage.tsx` | REPLACED | reachable as a normal page |
| D-26 | History tab | `PatientDashboardPage.tsx` | REPLACED | `GET /api/patients/{id}/history` |
| D-27 | **Patient media gallery** | — | **DECISION_REQUIRED** | no patient-media code and no upload capability; see the B1 decision note at the top |
| D-28 | Unsaved-changes exit + rollback | `PatientsPage.tsx` | PARTIAL | unsaved banner exists; **no session rollback / no 3-way discard** |
| D-29 | View appointments (day strip + stats) | `AppointmentsPage.tsx` | REPLACED (improved) | server-authoritative, adds reschedule + cancel the legacy app lacked |
| D-30 | Cancel a time zone | `SchedulePage.tsx` | REPLACED | `PUT /api/schedule/{id}` cancelled flag |
| D-31 | Reactivate a cancelled zone | `SchedulePage.tsx` | REPLACED | toggle |
| D-32 | Per-date zone time range (≥30 min) | `SchedulePage.tsx` | REPLACED | `GET/POST/PUT /api/schedule` |
| D-33 | Reset zones to defaults | `SchedulePage.tsx` | REPLACED (improved) | actually persists; legacy was client-only |
| D-34–37 | Date-range base/override rules | — | **NOT_APPLICABLE** | legacy rules were local-only, never synced, and never read back when deciding availability. Porting them would reproduce dead data. |
| D-38 | Orphan add-appointment screen | `AddAppointmentPage.tsx` | NOT_APPLICABLE | the orphan is *resolved*: Tauri has one reachable booking page |
| D-39 | Financial dashboard | `FinancialPage.tsx` | REPLACED | all 4 endpoints, correct raw-number balance handling |
| D-40 | Submit expense | `ExpensesPage.tsx` | REPLACED (improved) | `createdBy` from session, not hard-coded `"DOCTOR"` |
| D-41 | Browse/filter expenses | `ExpensesPage.tsx` | REPLACED (improved) | adds a REJECTED chip the legacy app lacked |
| D-42–44 | Approve/reject/unapprove | `ExpensesPage.tsx` | REPLACED (intentionally stricter) | `canApprove = role === 'ADMIN'`. Legacy DR had **no gate**; legacy Secretary used `setAdminMode(false)`. Tauri has real roles, so the owner is ADMIN and approve is properly separated. |
| D-45 | Money-safe ledger | `MoneySafePage.tsx` | REPLACED | running balance, filters, all wired |
| D-46 | Money-safe export (stub) | `MoneySafePage.tsx` | REPLACED (improved) | real CSV export with BOM; legacy button was a no-op |
| D-47 | Reports Center (21 types, 6 empty) | `ReportsPage.tsx` | REPLACED (improved) | 7 categories, all populated; no empty `default:` branches |
| D-48 | Report CSV | `ReportsPage.tsx` | REPLACED | UTF-8 BOM |
| D-49 | Report PDF | `ReportsPage.tsx` → `lib/arabicPdf.ts` | REPLACED (improved) | Arabic renders; legacy report PDF was greyscale Helvetica with no Arabic |
| D-50 | Report history + cooldown | `ReportsPage.tsx` | PARTIAL | in-session history; no 50-entry persisted store, no cross-session re-export |
| D-51 | Settings | `SettingsPage.tsx` | REPLACED (improved) | no restart required |
| D-52 | Restore Excel backup into empty server | `BackupsPage.tsx` | REPLACED | `POST /api/admin/backups/restore` multipart; server-side, no duplicate-push bug |
| D-53 | Update own user data | `ProfilePage.tsx` | REPLACED (improved) | current password verified server-side; ≥8 chars |
| D-54 | Notifications (list, mark seen) | `NotificationsPage.tsx` | REPLACED (improved) | **live SSE** + real `PUT /api/notifications/{id}/seen` and `/seen/all`; legacy never called its own notification API and never instantiated its SSE client |
| D-55 | 5-minute auto-sync | `lib/offlineDb.ts`, `lib/sse.ts` | REPLACED (improved) | read cache + queued writes + `startSyncService`; no watermark/`Preferences` fragility, no `HistorySyncService.start()` never-called bug |

### 3.2 Secretary

| Legacy | Workflow | Tauri equivalent | Status | Evidence |
|---|---|---|---|---|
| S-01 | Splash → license → update | `App.tsx` gate chain | REPLACED (improved) | signed updater; fails closed |
| S-02 | Discovery + health gate | `lib/heartbeat.ts` | REPLACED (improved) | HMAC + explicit adoption |
| S-03 | Log in | `LoginPage.tsx`, `stores/auth.tsx` | REPLACED (improved) | `POST /api/secretaries/login`; **offline login no longer yields a token-less "logged in" state** |
| S-04 | Forced password change / profile | `ChangePasswordPage.tsx`, `ProfilePage.tsx` | REPLACED (improved) | real forced flow; server-verified current password |
| S-05 | Dashboard KPIs + 7 charts | `DashboardPage.tsx`, `DashboardCharts.tsx` | REPLACED (improved) | `GET /api/dashboard/summary` server-authoritative; charts are populated (legacy `chartsContainer` never was) |
| S-06 | Patient search | `PatientsPage.tsx` | **PARTIAL** | client-side filter over the loaded list; no server `search?q=` |
| S-07 | Add patient + chain to booking | `AddPatientPage.tsx`, `AddAppointmentPage.tsx` | REPLACED (improved) | no delete-on-navigate rollback |
| S-08 | Book for NEW patient + inline payment | `AddAppointmentPage.tsx` | PARTIAL | booking present; **inline payment capture at booking time is not combined into the booking form** |
| S-09 | Book for EXISTING patient | `AddAppointmentPage.tsx` | REPLACED | one screen replaces both legacy variants |
| S-10 | Patient dashboard + payment banner | `PatientDashboardPage.tsx` | REPLACED | `GET /api/payments/patient/{id}/summary` |
| S-11 | **Partial collection on an existing payment** | `lib/paymentCollection.ts` → `collectAgainstPayment` | **REPLACED** | `PUT /api/payments/{id}`, remaining semantics, over-collection refused, no second record. 22 tests. |
| S-12 | **Quick payment** | `PatientDashboardPage.tsx` → `openCollectExisting` | **REPLACED** | per-row **تحصيل** button plus a "collect from oldest" shortcut |
| S-13 | Payment report PDF | `lib/patientDocs.ts` → `exportPaymentDocumentPdf` | REPLACED (improved) | Arabic-capable |
| S-14 | Dashboard quick-payment dialog | `OutstandingBalancesPage.tsx`, `PatientDashboardPage.tsx` | **REPLACED** | outstanding list links into the same per-payment collection |
| S-15 | Outstanding-balance list | `OutstandingBalancesPage.tsx` | REPLACED (improved) | `GET /api/payments/outstanding`; CSV export added |
| S-16 | View appointments + filters | `AppointmentsPage.tsx` | REPLACED (improved) | filters apply immediately |
| S-17 | Reschedule | `AppointmentsPage.tsx` | REPLACED (improved) | date picker instead of a `YYYY-MM-DD` text field |
| S-18 | Cancel appointment | `AppointmentsPage.tsx` | REPLACED (improved) | writes `CANCELLED`; legacy hard-`DELETE`d |
| S-19 | Expenses + `setAdminMode` gating | `ExpensesPage.tsx` | REPLACED (intentionally stricter) | `role === 'ADMIN'`; SECRETARY can never approve, matching legacy `setAdminMode(false)` |
| S-20 | Online bookings list | `OnlineBookingsPage.tsx` | REPLACED (improved) | reschedule/cancel/reactivate added; legacy was read-only |
| S-21 | Notifications via SSE | `NotificationsPage.tsx`, `lib/notificationBus.ts` | REPLACED | live `SSEClient` on `/api/events/stream` |
| S-22 | Settings | `SettingsPage.tsx` | REPLACED | no restart |
| S-23 | Server setup dialog | `ServerManagerPage.tsx` | REPLACED (improved) | no `run.bat` relaunch |

---

## 4. Blocking gaps

Originally three. **B2 and B3 are closed** and documented in §4a and §4b. **B1 is a scope
decision**, documented in the note at the top of this document and referenced from §4c.
None of the three was a security or data-loss defect; all were clinical or financial
workflows a clinic uses daily.

---

---

## 4a. B2 — RESOLVED: auto-scheduled follow-up

**Was:** the completion dialog had only diagnosis and notes. No amount field, no follow-up
booking, no `followUpDate` write. A doctor had to open a second screen and re-enter the
patient, date and amount by hand.

**Now:** `src/lib/clinicalActions.ts`.

- `followUpPlan` is a **pure** function producing the booking payload — date `+14`
  (`FOLLOW_UP_OFFSET_DAYS`), `MORNING`, `FOLLOW_UP`, `SCHEDULED`, notes referencing the
  completed appointment, and `requiredAmount` when the doctor charged something. Only an
  `EXAMINATION` produces a plan; a follow-up visit, a missing category or a missing patient
  produce `null`.
- `completeVisit` closes the visit first, then books the follow-up, then stamps
  `followUpDate` via `PUT /api/patients/{id}`.
- The amount field appears in the dialog only for examinations, matching the legacy screen.

Two deliberate design points:

- **The visit is never rolled back.** A doctor who has finished with a patient is not blocked
  because the *next* visit could not be booked. Follow-up failures are reported in a success
  notice, not thrown. The server also refuses a second active appointment, so "could not book"
  is a normal outcome, not an error to resolve. Only a failed *completion* throws.
- **One appointment-creation call site.** `createAppointment` is the only function that POSTs
  to `/api/appointments`; `AddAppointmentPage` and the follow-up both use it, so the manual
  and automatic paths cannot drift into different contracts.

**Tests:** `src/test/followUpBooking.test.ts` — 25 tests covering the +14 date (including
month, year and leap-year boundaries), MORNING, FOLLOW_UP, SCHEDULED, amount preserved /
omitted when blank, no booking for a non-examination, call ordering, `followUpDate`
stamping, follow-up booking failure, `followUpDate` failure, and completion failure.
**8/8 policy mutations killed**, including a wrong offset, a wrong zone, a wrong category, a
dropped amount, a missing `followUpDate`, and rethrowing on follow-up failure.

## 4b. B3 — RESOLVED: partial and quick collection

**Was:** `submitPayment` always `POST /api/payments`. Someone paying 400 then 600 against a
1,000 bill got **two payment records**. The sum balanced, which is why it went unnoticed,
but the audit trail no longer matched the bill and the "amount exceeds remaining" guard was
gone — the form only ever validated against its own fields.

**Now:** `src/lib/paymentCollection.ts`.

- `planCollection` is pure: computes `paidAmount` and `remainingAmount`, and refuses
  `no-payment`, `not-outstanding`, `invalid-amount` and `exceeds-remaining`.
- `collectAgainstPayment` sends `PUT /api/payments/{id}` with **only** the mutable pair and
  an optional `paymentMethod`. The server keeps what it is not given, which is how
  `appointmentId` is preserved — sending a full body built from a partial read is exactly
  how that link would be lost.
- The over-collection guard compares with a 0.005 tolerance so accumulated decimal error
  does not refuse an exact settlement, and the written `remainingAmount` is clamped at zero
  so a tolerated few-mills over-collection cannot persist a negative balance.
- UI: each payment row with an outstanding balance gets a **تحصيل** button, and a
  "collect from the oldest (N open)" shortcut sits next to "record a new payment" — the
  latter still creates a new charge, which is correct for a genuinely new bill.

The endpoint already existed server-side (`PaymentController.updatePayment`) and the legacy
secretary client used it, so **no backend change was needed**.

**Tests:** `src/test/paymentCollection.test.ts` — 22 tests covering the partial update, the
full settlement, accumulation across two collections (`400 + 600` landing on the same totals
as `1000` once), anchoring to the payment rather than the form, `appointmentId` preservation,
over-collection refusal with the balance reported, non-positive and non-numeric amounts,
settled payments, negative-balance clamping, and the assertion that **`api.post` is never
called** — the regression this closes. **6/6 policy mutations killed**, including swapping
PUT for POST, dropping the guard, and skipping the plan.

## 4c. B1 — DECISION_REQUIRED

See §9. Not implemented; `Clinic Server` untouched.

---

## 5. `NOT_APPLICABLE` items with architectural justification

| Item | Justification |
|---|---|
| D-12 Fullscreen toggle | Tauri uses a resizable, maximised window (`minWidth 1024`, `resizable: true`). A fullscreen toggle is redundant, and the legacy toggle fought the OS on some setups. |
| D-34–37 Date-range schedule rules (base/override/delete) | Legacy `TimeSlotRangeDAO` wrote these to local SQLite only. `getUnsyncedRanges`, `markSynced`, `getOverridesForParent`, `resolveEffectiveRange` and `updateRange` were **never called from any controller** — the rules never reached the server and were never read back when deciding availability. Reproducing them would create data that appears to configure scheduling but does not. `SchedulePage` covers real per-date ranges against the server. |
| D-38 Orphan `addNewAppointment.fxml` | The legacy screen was fully built but unreachable. Tauri has a single reachable `AddAppointmentPage`, so the orphan is resolved rather than ported. |
| D-09 PowerShell-script updater → signed NSIS updater | Replaced by a minisign-signed Tauri updater with a fail-closed policy. AC13 verified the real 1.0.3 → 1.0.4 cycle end to end. Deliberately not comparable feature-for-feature: the legacy path executed a downloaded PowerShell template with `-ExecutionPolicy Bypass`, read `checksum`/`minVersion`/`buildNumber` and never verified any of them. |
| Offline login producing no token (S-03) | The legacy offline path "succeeded" without a token, so every subsequent call 401'd and the app silently ran on stale local data. Tauri does not model this: an unauthenticated session is signed out, and the read cache is explicit. |
| Patient folder side-effects (D-15) | `createPatientFolders` + `Patient_Info.txt` wrote a per-patient tree on every dashboard open. Tauri keeps documents in explicit export/save flows instead of creating directories as a side effect of navigation. |

---

## 6. Deliberately NOT ported (legacy defects)

Each of these is a legacy bug. Porting it would be a regression, so the replacement
deliberately differs:

`plaintext local password compare` · `accessToken` vs `token` refresh-key mismatch ·
`EVENING` vs `NIGHT` zone key · `zy-state-followup` as a category value · `zy-active` as a
medication status · `log.info` cancelled-zone stub · non-existent `LicenseLockedController`
FXML · lowercase `viewAppointaments` nav target · `todayBtn` with no handler · 6 empty report
types · money-safe `handleClearSearch` that never filters · money-safe `btnExport` stub ·
`HistorySyncService.start()` never called · auto-register-on-401 · classpath `settings.properties`
writes · hard-coded `192.168.1.8:8081` · `headerTodayCount = 0` and five unassigned stat labels
· `notificationDot` never updated · `System.err` bypassing SLF4J · secretary ID-space
corruption (`PatientDAO.create(serverRow)`) · cancel-by-`DELETE` · delete-patient-on-navigate ·
`CurrentDoctor` hard-coded to 1 · static sidebar identity · local-only current-password verify ·
unapplied appointment filters · Helvetica-only payment PDF.

---

## 7. Tests added

The audit itself added none — it was a read-only comparison and surfaced no regression in
code AC16 already covers. Closing B2 and B3 added **47 tests**, because those two gaps are
exactly the case the brief describes: tests that protect a discovered parity gap.

| File | Tests | Covers |
|---|---|---|
| `src/test/followUpBooking.test.ts` | 25 | B2: +14 date (incl. month/year/leap boundaries), MORNING, FOLLOW_UP, SCHEDULED, amount preserved/omitted, no booking for a non-examination, call ordering, `followUpDate` stamp, follow-up booking failure, `followUpDate` failure, completion failure |
| `src/test/paymentCollection.test.ts` | 22 | B3: partial update, full settlement, accumulation (`400 + 600` ≡ `1000`), anchoring to the payment not the form, `appointmentId` preservation, over-collection refusal, invalid amounts, settled payments, negative-balance clamp, and that `api.post` is **never** called |

Both are mutation-checked, so the assertions are load-bearing rather than decorative:

- **B2 — 8/8 killed:** wrong offset, wrong zone, wrong category, dropped amount, booking for
  any category, no `followUpDate`, and rethrowing on follow-up failure.
- **B3 — 6/6 killed:** PUT swapped for POST, over-collection guard dropped, non-positive
  amount allowed, negative remaining written, plan skipped, and sending the whole payment
  body (which would risk losing `appointmentId`).

One mutation initially survived — removing the `Math.max(0, …)` clamp — because the test
did not actually produce a negative. It only does so through the 0.005 over-collection
tolerance, so the test was corrected to exercise that path rather than the clamp being
declared unnecessary.

Suite: **230 → 278 tests across 17 files**, all passing. Typecheck, production build and
`cargo check` clean. No existing test was weakened or deleted; the pre-existing 230 are
untouched.

`Clinic Server` was **not modified**. B3 needed no backend change — `PUT /api/payments/{id}`
already existed. No API incompatibility was found anywhere: every endpoint the legacy clients
call exists on the server, and every endpoint Tauri calls is one the legacy clients also
used, with three additions that already exist server-side (`/api/dashboard/summary`,
`/api/payments/outstanding`, `/api/payments/patient/{id}/summary`) plus the admin backup
and Telegram-link routes.

---

## 8. Recommendation

### `NOT_READY — B1 patient media gallery (DECISION_REQUIRED)`

B2 and B3 are closed. One decision stands between this and `READY_TO_RETIRE_JAVA_FX`.

**Choose Option A or Option B for patient media** — both are specified in the decision note
at the top of this document. The recommendation there is **Option B**, conditional on the
authorization matrix being settled first, because photographs of a patient's body are more
sensitive than the diagnosis text already on the server, and a local-only gallery creates a
second private copy of clinical data the server does not know exists.

**Option A** is a legitimate, cheap choice if the clinic genuinely runs a single front-desk PC
— but it should be recorded as a deliberate limitation rather than inherited by default.

Nothing else blocks retirement. Every other workflow is REPLACED, and 15 of those are
**strictly better** than the legacy implementation — most notably signed updates, live SSE
notifications, Arabic-capable PDFs, real role-based authorization, and correct appointment
cancellation.

**The JavaFX applications must not be retired until B1 is chosen and, if Option B, shipped
and verified.** They remain the only working home for patient media today.
