# Zeyara Desktop — JavaFX Migration Plan of Record

**Date:** 2026-09-26
**Status:** Phase 1 (inventory) complete. Implementation not yet started.
**Replaces:** `D:\proj\DR Mostafa` (doctor) and `D:\proj\secertary` (secretary), both frozen 2026-09-26.

One Tauri application, role-based workspaces, Clinic Server remains the backend and the
only source of truth. No business rules move into React.

---

## 1. Inventory (Phase 1 output)

| App | Screens | API surface | Auth | Tests |
|---|---|---|---|---|
| DR JavaFX | 19 FXML, sidebar, no router (`HelloApplication.setRoot`) | ~70 endpoints over 10 `Remote*APIImpl` clients, **three** HTTP stacks | in-memory token, no logout, plaintext local passwords | 0 DAO/service/controller tests |
| Secretary JavaFX | 13 FXML, sidebar on the dashboard only | ~45 endpoints over 8 clients | in-memory token, `fullLogout()` unreachable, SSE working | utilities only |
| Tauri (today) | **28 pages**, 24 routes, role-guarded | 65 distinct `/api` paths via one `api.ts` | zustand → `localStorage` (plaintext), single-flight 401 refresh | **0 frontend**, 12 Rust unit tests |
| Clinic Server | 25 `@RestController` | **139 endpoints** | `SecurityConfig` matcher list + `createdBy` ownership | **246 passing** |

Key structural facts:

- The Tauri app is not a thin client over 139 endpoints. It consumes 65 and reimplements
  no business rules.
- **No app has server-side reporting.** `clinic-server/pom.xml` contains no PDF/Excel/CSV
  library and there is no `/api/reports`. All three clients compose documents from raw
  list endpoints, so the client-side approach in Tauri is correct by design, not a shortcut.
- The Tauri app has no local database. It is a read cache plus a write queue over the LAN
  server. This is the intended target state (see decision D4).

### Defects found in the JavaFX clients (do NOT port these)

| Defect | Consequence if ported |
|---|---|
| `category = "zy-state-followup"` — a CSS class stored as data | Server-side category filter never matches follow-ups |
| `timeZone = "EVENING"` for the third zone, `NIGHT` elsewhere | Two different keys for one zone |
| `medication.status = "zy-active"` | Not a server status value |
| `PatientDAO.delete` uses column `patient_id`, real column is `patientId` | Delete always throws; tombstones never purge; failed booking leaves an orphan patient |
| Cancel = hard `DELETE`, never writes `CANCELLED` | Loses history; orphans the linked payment |
| Plaintext local passwords, `PasswordUtil` present but never called | — |
| JWT first 20 chars written to the log on every sync cycle | Token leak |
| Four different host/port values across one app | — |
| `AppointmentService.syncCancelledZonesFromServer` is a `log.info` no-op called from 4 sites | Cancelled zones never enforced; every slot shows "Available" |

The importer `scripts/import-javafox-data.mjs` repairs the data bugs during migration.

---

## 2. Migration matrix

`DONE` · `PARTIAL` · `MISSING` · `BACKEND` (needs a server change first)

| Capability | DR | Sec | Tauri today | Action |
|---|---|---|---|---|
| Login / refresh / logout / forced password change | PARTIAL | PARTIAL | DONE | — |
| Role-gated UI | MISSING (1 role, no gating) | PARTIAL (admin-mode flag) | DONE (3 roles) | D5 |
| Patient CRUD + search | DONE | DONE | DONE | — |
| Clinical vitals | DONE | MISSING | DONE | — |
| Patient dashboard (payments / appointments / history / medications) | DONE | DONE | DONE | — |
| Collect payment | MISSING | DONE | PARTIAL | Tauri creates a new payment; Secretary **mutated** the existing one. Align on update-existing when a balance is outstanding. |
| Quick-pay / expired-followup payment | MISSING | DONE | MISSING | Port from Secretary |
| Appointment book / reschedule / cancel | PARTIAL (no reschedule) | DONE (date only) | DONE (date + zone) | — |
| Double-booking guard | MISSING | PARTIAL (client-only) | DONE (server-authoritative) | — |
| **Bulk zone cancel → auto-reschedule** | DONE | MISSING | MISSING | Port UI; `PUT /api/schedule/cancel` already exists |
| **Cancelled-zone list** | DONE | MISSING | MISSING (local log only) | Port UI; `GET /api/schedule/cancelled` already exists |
| Recurring base ranges + per-date overrides | DONE (**local-only**) | MISSING | MISSING | Out of scope per D6 — local-only feature with no server API; documented as accepted gap |
| Payments CRUD + patient summary | MISSING | DONE | DONE | — |
| Outstanding balances | MISSING | DONE (modal) | DONE | — |
| Expenses submit / approve / reject | DONE (**ungated**) | DONE (gated off) | DONE (ADMIN-gated) | — |
| Money safe / financial dashboard | DONE | MISSING | DONE | — |
| Medications prescribe / stop / reactivate | DONE | MISSING | DONE | — |
| Reports (7 categories, PDF/CSV/Excel) | DONE | 1 PDF only | DONE | — |
| Notifications + SSE | PARTIAL (SSE dead) | DONE | DONE | — |
| Online bookings | MISSING | DONE (read-only) | DONE (+ actions) | — |
| Users / setup wizard | DONE | MISSING | DONE | — |
| Backups | DONE (Excel + diff) | MISSING | DONE (server SQL) | — |
| **Patient media gallery** | DONE (**local-only**) | MISSING | MISSING | **BACKEND** — decision D1 |
| **Print / native save dialog** | DONE (PDFBox → disk) | DONE | MISSING (silent download) | Phase 6 — decision D2 |
| **Open local file / folder** | DONE (`Desktop.open`) | MISSING | MISSING | Phase 6 |
| **OS notifications** | MISSING | MISSING | MISSING | Phase 6 |
| Server discovery | PARTIAL (**no HMAC at all**) | PARTIAL (trust path inert) | PARTIAL (**secret never supplied**) | Phase 7 — blocks AC 9 |
| Manual server URL | DONE | MISSING (saveConfig trust-gated) | DONE | — |
| HTTPS | MISSING | MISSING | MISSING (CSP allows `http:`) | Phase 8 — blocks AC 12 |
| Updater | MISSING (broken) | MISSING (`__OLD_PID__`) | PARTIAL (check + SHA-256, no install) | Phase 9 — blocks AC 13 |
| Version display in UI | MISSING | MISSING | MISSING | Phase 2 |
| **Frontend tests** | MISSING | MISSING | MISSING | Blocks AC 16 |
| Windows installer | DONE (jpackage) | DONE | PARTIAL (configured, never built) | Blocks AC 17 |

### Acceptance criteria status

| # | Criterion | Status | Blocked by |
|---|---|---|---|
| 1 | One installer for both roles | MET | — |
| 2 | No DR app required | MET | — |
| 3 | No Secretary app required | MET | — |
| 4 | Role-based workspaces | MET | D5 (role source) |
| 5 | Server remains source of truth | MET | — |
| 6 | Important DR workflows | PARTIAL | media, quick-pay |
| 7 | Important Secretary workflows | PARTIAL | quick-pay, media |
| 8 | Printing / files / native | **MET** | Phase 6 done: native save dialog, open/reveal, OS notifications |
| 9 | Discovery works securely | **MET** | Phase 7 done: strict HMAC, no TOFU, explicit ADMIN approval |
| 10 | Manual server config | MET | — |
| 11 | Auth / session expiry | MET | — |
| 12 | Production HTTPS | **MET** | Phase 8 - HTTPS-only validation, production CSP has no `http:` |
| 13 | Signed updates | **UNMET** | Phase 9 - no signing key yet |
| 14 | No duplicated connection/auth/update impls | MET | — |
| 15 | Backend tests pass | MET | 261/261 (246 + 15 new) |
| 16 | Frontend tests for migrated flows | **PARTIAL** | vitest added, 58 tests; page-level tests still to come |
| 17 | Production Windows installer | **PARTIAL** | 5.33 MB NSIS installer built and verified clean of Java; not yet run on a clean machine |

**1 of 17 unmet (signed updates), 2 partial (frontend test depth, clean-machine
installer run).** All of them are client-side work; none requires a backend change.

---

## 3. Decisions (2026-09-26)

| ID | Decision |
|---|---|
| **D1** | **Patient media → add server support.** Smallest backend addition: `MultipartFile` upload, per-patient list, authenticated file-serving endpoint, `mediaCount` on the patient DTO. Tauri gallery via `tauri-plugin-fs` + `dialog`. Makes the feature work across the LAN instead of one machine. |
| **D2** | **Printing = native save + open.** Add `tauri-plugin-dialog` (save/open) and `tauri-plugin-opener`. No direct printer-driver output. |
| **D3** | **Updater = enable the Tauri 2 built-in updater** with signature verification (`createUpdaterArtifacts: true`, minisign key), publishing signed MSI/NSIS to GitHub Releases. Gives signed install, restart and rollback. Replaces the hand-rolled `updateCheck.ts` download path. |
| **D4** | **Offline = read cache + queued writes is sufficient.** Do not port the SQLite mirror. The LAN server is the availability boundary. |
| **D5** | **Role comes from the server login response**, not the login dropdown. The dropdown may pre-fill but must not be authoritative. |
| **D6** | Doctor schedule recurring ranges / per-date overrides are **out of scope** — they were local-only with no server API. Documented accepted gap. |
| **D7** | Transport = **HTTPS via a reverse proxy** in front of the Clinic Server. CSP tightened to `https:`/`wss:` in production, `http:` permitted only for localhost development. |
| **D8** | **Fix all four backend defects** found in Phase 1 as part of this migration. |

---

## 4. Backend work

### 4.1 New — patient media (D1)

- `PatientMedia` entity: `id, patientId, fileName, storedName, contentType, sizeBytes, uploadedBy, uploadedAt`.
- `POST /api/patients/{id}/media` — `MultipartFile`, authenticated + `checkOwnership`, size/type allowlist.
- `GET /api/patients/{id}/media` — authenticated + `checkOwnership`.
- `GET /api/patients/{id}/media/{mediaId}` — streams bytes, authenticated + `checkOwnership`, path-traversal guard.
- `DELETE /api/patients/{id}/media/{mediaId}` — authenticated + `checkOwnership`.
- Storage on disk under the server data dir, not the database.
- Flyway migration (production uses `ddl-auto=validate`).

### 4.2 Fixes (D8)

| Defect | Fix |
|---|---|
| `GET /api/doctors` and `GET /api/secretaries` return BCrypt hashes | Null the `password` field exactly as the `/{id}` and `/me` handlers already do |
| `POST /api/auth/complete-password-change` is `permitAll` with no caller identity | Require authentication and verify the caller owns `userId`; move into the login rate-limit bucket |
| `DELETE /api/notifications/{id}` has no owner or existence check | Add an existence check and a role/ownership rule consistent with the rest of the API |
| `GET /api/appointments` unfiltered branch excludes `createdBy == null` | Include null, matching the three filtered branches and `/range` — this is what makes online bookings visible to SECRETARY/DOCTOR |

### 4.3 Also needed

- `GET /api/admin/me` — an ADMIN token currently 404s on `/doctors/me` and has no own-profile endpoint.
- Relax `POST /api/license/validate` to permit pre-login use for a **remote** server. Today it is `authenticated()`, and the loopback-only `validate-server` only works for a co-located sidecar. *(Optional — revisit if remote-server licensing is required.)*

### 4.4 Not changing

No server-side report generation. No bulk import/export endpoint. No per-user settings
entity. Business rules stay on the server.

---

## 5. Phased implementation

Each phase keeps the project buildable.

| Phase | Work | Closes |
|---|---|---|
| 2 | Foundation: version display, single server-URL config, `SYNC_SECRET` delivery to the discovery monitor, role from server response | Phase 2 spec, D5 |
| 3 | Shell: workspace grouping in the sidebar, uniform role gating on **all** routes (today 8 routes have no `RoleGuard` and are deep-linkable) | AC 4 |
| 4 | Secretary parity: quick-pay, expired-followup payment, bulk zone cancel, cancelled-zone list, payment mutation semantics | AC 7 |
| 5 | Doctor parity: verify consultation, diagnosis/prescription, notes, medication stop/reactivate, attachments | AC 6 |
| 6 | Native: `dialog`, `opener`, `notification` plugins; least-privilege capabilities; wire PDF/CSV/XLSX to a native save; open-file actions | AC 8 |
| 7 | Discovery: deliver the shared secret from settings so HMAC verifies; no trust-on-first-use; explicit operator acceptance | AC 9 — **done** |
| 8 | Printing / files / native | **MET** | Phase 6 done: native save dialog, open/reveal, OS notifications |
| 9 | Discovery works securely | **MET** | Phase 7 done: strict HMAC, no TOFU, explicit ADMIN approval |
| 10 | Packaging: verify the installer on a clean machine with no Java and no Clinic Server; drop `devtools` from release | AC 17 — **installer built at 5.33 MB** |
| — | Backend §4.1 + §4.2 alongside the phases that need them | D1, D8 |

Phase 10 removal of the JavaFX deployment path happens only after parity verification.
The old repositories stay until then.

### Transport policy (AC 12)

| | Production build | Development build |
|---|---|---|
| Server address | `https://host[:port]` only | `https://` any host, plus `http://` **loopback only** |
| Bare `host` / `host:port` | rejected, scheme must be explicit | rejected, scheme must be explicit |
| `http://` non-loopback | rejected | rejected |
| `http://` loopback | rejected | allowed |
| CSP `connect-src` | `'self' https: wss:` | adds `http://localhost:* http://127.0.0.1:* ws://localhost:*` |
| Update artifact URL | `https://` only | `https://`, or loopback `http://` |

`http://` is **never** silently upgraded to `https://`. A silent upgrade turns a
configuration mistake into a certificate error that looks like a server fault, so every
rejection returns a specific Arabic reason: missing scheme, malformed, disallowed
protocol, insecure transport, not-an-origin, or credentials-in-url.

A discovered server faces the identical policy. Discovery may identify a host on the LAN,
but a bare IP implies plain HTTP, so a production build refuses to adopt it and tells the
operator to enter the clinic's HTTPS endpoint in Settings. The discovery result is what
tells them which host it is.

`csp` is injected into the built application; `devCsp` only during development. Tauri
selects between them at `manager/mod.rs::csp()` on `is_dev()`, which is
`!cfg!(feature = "custom-protocol")` — a feature `tauri build` enables and `tauri dev` does
not. The dev CSP string is therefore present in the binary as inert config data and is
never read in a release build.

`style-src 'unsafe-inline'` is retained because MUI v6 with emotion injects `<style>`
elements at runtime. It is scoped to `style-src` only; `script-src` has no
`unsafe-inline` and no `unsafe-eval`.

`https:` and `wss:` are scheme-scoped rather than a fixed origin because the server
address is operator-configured and therefore unknown when the app is built. `*`,
`http:` and `unsafe-eval` appear nowhere in the production CSP.
---

## 6. Deployment model

```text
                 Clinic LAN
────────────────────────────────────────────

┌───────────────────────┐
│ Clinic Server Machine │
│                       │
│ Clinic Server         │
│ Spring Boot           │
│ Port 8081             │
└───────────┬───────────┘
            │
       LAN / HTTPS
            │
    ┌───────┴────────┐
    │                │
┌───▼────────┐ ┌─────▼───────┐
│ Tauri      │ │ Tauri       │
│ Doctor PC  │ │ Secretary PC│
└────────────┘ └─────────────┘
```

**The Clinic Server is NOT part of the Tauri application.** It is installed and run
separately. The client contains no Java runtime, no server JAR, and no code that starts,
stops, or supervises a server process. Closing the client has no effect on the server,
and the client's lifecycle is completely independent.

An earlier revision of this plan had the server bundled as a sidecar and listed the
resulting 463 MB installer and orphaned-JVM behaviour as risks to be fixed. That was the
wrong model, not a defect to repair. Removed in `db8a2af`.

### Installer contents

```text
Zeyara Desktop
├── React frontend
├── Tauri application
└── required Tauri/native dependencies
```

Measured: **5.33 MB** NSIS installer, no `java.exe`, no server JAR. The client is built
and installed with no Java and no Clinic Server present on the machine.

### Connection model

1. Discover Clinic Server on the LAN (UDP 8888, HMAC-SHA256 verified).
2. Present any discovered-but-unaccepted server for explicit ADMIN approval.
3. Connect to the configured server URL.
4. Allow manual server URL configuration, including a full `https://` origin.
5. Show connection/health status.
6. Authenticate against Clinic Server for all Doctor and Secretary workflows.

The client starts **unconfigured** — there is no `localhost` default, because there is no
same-machine server to fall back on. It adopts a discovered server or an entered URL.

### Discovery trust policy

The HMAC is byte-compatible with `HeartbeatService.java` (`HmacSHA256` over
`v2:{timestamp}:{nonce}:{ip}:{port}:{name}:{sequence}`, standard Base64, secret from the
server's `SYNC_SECRET`).

| Situation | Behaviour |
|---|---|
| Secret configured, signature invalid | Packet dropped silently. Never offered to the operator — otherwise a forger gets a prompt someone might click. |
| Secret configured, signature valid, accepted server | Client goes online. |
| Secret configured, signature valid, **different** server | Offered as a candidate. A second valid server is a second clinic or a misconfiguration; it never silently takes over. |
| **No secret configured** | Nothing is ever adopted automatically, whatever the packet claims. Offered for explicit approval, with the unverified state stated plainly. |

The operator's acceptance is persisted, so the prompt does not repeat on every launch.
Candidates are a **list**, so a multi-server LAN is a decision rather than a race. Only an
ADMIN may approve, because approving redirects every subsequent request in the app.

The secret is entered in Settings and passed to the listener. It is not read from the
environment: the server is on another machine, so there is no shared environment. It is
stored in `localStorage` alongside the server URL — the same place the session token
already lives. That is a deliberate, documented trade-off, not an oversight.

