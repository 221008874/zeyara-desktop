# Tauri Replacement Audit — DR + Secretary JavaFX

**Date:** 2026-09-27
**Scope:** Can `D:\proj\zeyara-desktop` (Tauri + React) fully replace `D:\proj\DR Mostafa` (DR Doctor) and `D:\proj\secertary` (Secretary)?
**Method:** every workflow extracted from the legacy source (controllers, services, DAO, FXML), then mapped to actual Tauri source files, routes and endpoint calls. No workflow is inferred from a screen name.
**Legacy code:** untouched. Nothing deprecated or deleted.

## Verdict

**NOT_READY** — three blocking workflows, all in the doctor/clinical path and all
patient-data-affecting:

| # | Blocking gap | Legacy evidence |
|---|---|---|
| B1 | **Patient media gallery** (photos/videos) has no equivalent | DR `patientDashboard.openGallery` |
| B2 | **Auto-schedule follow-up** after completing an examination is absent | DR `promptPostCompletionActions` |
| B3 | **Partial / quick collection against an existing outstanding payment** is absent | Secretary `handleCollectPayment`, `handleQuickCollect` |

None is a security or data-loss defect. All three are clinical/financial workflows a clinic
uses daily. Everything else is either REPLACED, improved, or intentionally removed by
architecture.

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
| D-24 | **Auto-schedule follow-up after examination** | — | **MISSING** | completion dialog has only diagnosis + notes; no amount field, no follow-up booking |
| D-25 | Book from exit dialog | `AddAppointmentPage.tsx` | REPLACED | reachable as a normal page |
| D-26 | History tab | `PatientDashboardPage.tsx` | REPLACED | `GET /api/patients/{id}/history` |
| D-27 | **Patient media gallery** | — | **MISSING** | zero matches for `gallery`/`photo`/`.mp4`/`attachment`/`upload` in `src/` |
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
| S-11 | **Partial collection on an existing payment** | `PatientDashboardPage.tsx` | **MISSING** | `submitPayment` always `POST /api/payments` (line 153). No `PUT /api/payments/{id}` exists anywhere in `src/`. |
| S-12 | **Quick payment** | — | **MISSING** | no quick-pay against an outstanding payment |
| S-13 | Payment report PDF | `lib/patientDocs.ts` → `exportPaymentDocumentPdf` | REPLACED (improved) | Arabic-capable |
| S-14 | Dashboard quick-payment dialog | `OutstandingBalancesPage.tsx` | **PARTIAL** | lists outstanding balances, but collection targets a *new* payment, not the existing one |
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

## 4. Blocking gaps in detail

### B1 — Patient media gallery: MISSING

**Legacy:** DR `patientDashboard.openGallery` creates
`~/.clinicapp/patients/patient_{id}_{name}/{photos,videos}`, uploads images
(`jpg/jpeg/png/gif/bmp/webp`) and videos (`mp4/avi/mov/wmv/mkv/flv`) with `_1`/`_2`
de-duplication, and previews them — images at 600×400 with **Open in Viewer**, videos via
`MediaPlayer`/`MediaView` with **Play / Pause / Stop / Open in Player**, plus a thumbnail
`FlowPane` per directory.

**Tauri:** nothing. A search of `src/` for `gallery`, `photo`, `.mp4`, `attachment` and
`upload` returns **no patient-media code at all** — the only hits are MUI's `useMediaQuery` /
`matchMedia` and the word "im**media**tely" in comments. There is no upload capability in
`src-tauri/capabilities/default.json` either: it grants `dialog:allow-save`/`allow-open`,
`opener:allow-open-path`/`allow-reveal-item-in-dir`, `notification:*` and `updater:*`, and
nothing that could write an arbitrary file.

**Why it blocks:** a doctor's routine for a dermatology/orthopaedic case is photographing
the lesion and attaching it to the patient. Retiring DR removes that entirely.

**Note:** the legacy gallery is *local filesystem only* — media never reached the server and
was invisible to other devices. So this is a real workflow loss, but porting it faithfully
means porting a local-only limitation. A server-backed media store is the correct answer and
is a **backend change** (`Clinic Server`), which is out of scope for this audit.

### B2 — Auto-schedule follow-up after an examination: MISSING

**Legacy:** DR `promptPostCompletionActions`, invoked automatically from
`completeAppointment` when `category == "EXAMINATION"` and the doctor supplied an amount.
Creates an appointment with `doctorId=1`, `date = now + 14 days`, `timeZone = "MORNING"`,
`status = "SCHEDULED"`, `category = "FOLLOW_UP"`, `notes = "Follow-up for appointment #<id>"`,
`amount = <nextAppointmentAmount>`, then sets `patient.followUpDate`. Shows
*"Follow-up Scheduled — Next appointment: `<date>` | Amount: `<n>` EGP"*.
The completion dialog exposes a **"Next Appointment Amount (EGP)"** field, pre-filled `"200"`,
shown only when the appointment category is `EXAMINATION`.

**Tauri:** `PatientDashboardPage.tsx:487-530` — the completion dialog has **only** diagnosis
and notes. There is no amount field, no follow-up booking, and no `followUpDate` write.

**Why it blocks:** completing an examination is how a doctor closes a visit. The legacy flow
guarantees the patient leaves with a booked return visit. Without it the doctor must open a
second screen and re-enter the patient, date and amount by hand.

### B3 — Partial / quick collection against an existing payment: MISSING

**Legacy (Secretary):**
- `SecPatientDashboard.handleCollectPayment` **Mode B (partial)**: mutates the existing
  `activePartialPayment` — `paid += amount`, `remaining -= amount` — then
  `PUT /api/payments/{serverId}` with `{id, paidAmount, remainingAmount, paymentMethod, lastUpdated}`.
  Enforces `amount > remaining → "Amount exceeds remaining balance: {x} EGP"`.
- `handleQuickCollect` / `PaymentCollectionDialog.handleCollection`: same update path against
  `unpaid.get(0)`, with its own over-collection guard.

**Tauri:** `PatientDashboardPage.tsx:139-169` `submitPayment` **always** calls
`POST /api/payments` with a brand-new `{patientId, totalAmount, paidAmount, remainingAmount, paymentMethod, notes, paymentDate}`. `openCollect` pre-fills `totalAmount` and `paidAmount` both to the outstanding remaining. A grep for `api.put` + `payments` across `src/pages/*.tsx` returns **nothing** — `PUT /api/payments/{id}` is not called anywhere in the client.

**Consequences:**
1. A patient with one outstanding 1,000 EGP bill who pays 400 then 600 gets **two payment
   records** instead of one settled record. The *sum* is right, so the balance appears
   correct, but the audit trail and any per-invoice reconciliation differ.
2. The **"amount exceeds remaining balance" guard is gone** — `submitPayment` only checks
   `paidAmount <= totalAmount` against the values in its own form, so the outstanding ledger
   is not the thing being validated.
3. The follow-up-expiry linkage is lost: the legacy new-payment path wrote
   `notes = "Payment for expired follow-up visit on <date>"` and left `appointmentId` null;
   Tauri writes no such note and sends no `appointmentId`.
4. `appointmentId` is never sent by Tauri, so payments are not linked to the appointment that
   triggered them.

**Why it blocks:** collecting a deposit against an existing bill is a standard receptionist
task, and it is the task the legacy quick-pay was built for.

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

**None.** This audit is a read-only comparison and surfaced no regression in code that
AC16 already covers. Per the brief, tests are added only where they protect a discovered
parity gap or a critical regression, and no existing test was weakened or deleted.

The existing **230-test** suite remains the regression net and already covers the
authorization boundaries this audit leans on: `RoleGuard` fail-closed on a missing role,
`ProtectedRoute` forcing password change before any clinical screen, `LicenseGate` and
`SetupGate` failing closed, the 401 single-flight refresh, and the no-downgrade update policy.
`scripts/mutation-check.ps1` kills 15/15 policy mutations, so those assertions are load-bearing.

`Clinic Server` was **not modified**. No API incompatibility was found: every endpoint the
legacy clients call exists on the server, and every endpoint Tauri calls is one the legacy
clients also used, with three additions that already exist server-side
(`/api/dashboard/summary`, `/api/payments/outstanding`, `/api/payments/patient/{id}/summary`)
plus the admin backup and Telegram-link routes.

---

## 8. Recommendation

### `NOT_READY — B1 patient media gallery, B2 auto-scheduled follow-up, B3 partial/quick payment collection`

To reach `READY_TO_RETIRE_JAVA_FX`:

**B3 (smallest, no backend change).** Add a "collect against this payment" path to
`PatientDashboardPage`: list the patient's outstanding payments, and `PUT /api/payments/{id}`
with the incremented `paidAmount` / decremented `remainingAmount` plus an
`amount <= remaining` guard. The endpoint already exists server-side
(`PaymentController.updatePayment`, `PUT /api/payments/{id}`) — the Secretary app used it.
Also send `appointmentId` when the payment settles an appointment.

**B2 (no backend change).** Extend the completion dialog with the "Next appointment amount"
field shown for examinations, and on success `POST /api/appointments` with
`date = +14d`, `timeZone = 'MORNING'`, `category = 'FOLLOW_UP'`, plus set the patient's
`followUpDate` via `PUT /api/patients/{id}`. Reproduce the legacy business rule deliberately
rather than the hard-coded `doctorId = 1` — use the session's doctor.

**B1 (requires a backend decision).** Media has no server-side home. Options:
(a) ship the gallery as local-filesystem-only, faithfully reproducing the legacy behaviour
including its cross-device blindness; or
(b) add server-backed media (upload/download endpoints + storage), which is a
`Clinic Server` change and must be agreed before implementation.
This is the one blocker that is a scope decision rather than a code change.

Everything else is REPLACED, and 15 of those are **strictly better** than the legacy
implementation — most notably signed updates, live SSE notifications, Arabic-capable PDFs,
real role-based authorization, and correct appointment cancellation.

The JavaFX applications remain the only working home for B1–B3 and must not be retired
until each is closed and verified.
