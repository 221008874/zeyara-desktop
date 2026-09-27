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

## B1 — Patient media: requirements and authorization analysis

**Status: `DECISION_REQUIRED`.** No code written, no endpoint, schema or storage change
made, `Clinic Server` untouched, frontend behaviour unchanged.

This section exists so the product owner can choose between Option A and Option B with the
costs known. It deliberately stops short of proposing authorization rules the existing system
does not support — those are listed in §B3.2 as decisions, not requirements.

---

## B1.1 Current JavaFX media behaviour

All findings below are read from the DR app source. `openGallery` and its helpers occupy
lines **1578–2083** of
`src/main/java/org/boda/drmostafa/Admin/AdminMainBageOP/patientDashboard/patientDashboard.java`.

### Where media lives

`patientDashboard.java:1674-1688`:

```java
private void ensurePatientMediaFolders() {
    String baseDir = System.getProperty("user.home") + File.separator + ".clinicapp" + File.separator + "patients";
    patientFolder = new File(baseDir, "patient_" + patient.getId() + "_" + sanitizeFileName(patient.getName()));
    File photosFolder = new File(patientFolder, "photos");
    File videosFolder = new File(patientFolder, "videos");
```

So the path is
`%USERPROFILE%\.clinicapp\patients\patient_{id}_{sanitizedName}\{photos,videos}\`.

**This is a different tree from the other per-patient folders.** `createPatientFolders`
(`:2655-2666`) uses `PathConstants.getPatientFolder` → `~/patient/{id}_{safeName}/` with
subfolders `Prescriptions, Diagnoses, Lab_Results, Images, Videos, Reports`, a different
sanitizer (`[^a-zA-Z0-9_\-]` → `_`, truncated to 30 chars, vs `sanitizeFileName`'s
`[^a-zA-Z0-9\s-]` stripped entirely), and different subfolder casing. `PathConstants`
never mentions `.clinicapp`.

Two consequences that matter for any migration:

- **`~/patient/{id}_{name}/Images` and `/Videos` are dead directories.**
  `PathConstants.getPatientImagesFolder` / `getPatientVideosFolder` have **zero callers**.
  The PDF generators write to `~/dp/prescriptions` and `~/dp/diagnoses` instead. So
  `createPatientFolders()` creates six empty folders per patient and media lives somewhere
  else entirely, undeclared.
- **The media folder is keyed on a machine-local SQLite id.** `ensurePatientIsSavedLocally()`
  (`:2644`) overwrites `patient.id` with the **local** autoincrement id from
  `~/ClinicDatabase/Clinic.db` before the gallery runs. A DB rebuild, a restore from Excel,
  or a lost `server_id_mappings` row re-keys the folder and orphans every file. Any migration
  must re-key by the **server** id, not by folder name.

Also note `sanitizeFileName` (`:1690-1692`) strips all non-`[a-zA-Z0-9\s-]`, so an Arabic
patient name reduces to an empty string and the folder becomes `patient_7_`. There is no
`null` guard (NPE risk) and no length cap.

### Upload mechanics

`uploadFiles` (`:1986-2038`) is reached from two toolbar buttons (`:1640-1644`) — "Upload
Photos" and "Upload Videos". Both call the same method with a `type` string.

- **Selection:** `FileChooser.showOpenMultipleDialog`, native, multi-select.
- **Filters:** photos `*.jpg *.jpeg *.png *.gif *.bmp *.webp`; videos
  `*.mp4 *.avi *.mov *.wmv *.mkv *.flv` — **each immediately followed by
  `new FileChooser.ExtensionFilter("All Files", "*.*")`** (`:1993`, `:1998`). The filter is
  the *only* type control; there is no programmatic validation afterwards, so any file —
  including an executable — can be copied into `photos/`.
- **Collision handling:** `_1`, `_2`, … inserted before the extension, unbounded loop
  (`:2017-2021`). Original filename preserved verbatim.
- **No size cap, no quota, no per-patient count limit, no disk-space check.**
- **No content validation** — no magic-byte check, no decodability check. A file that copies
  but cannot be decoded is reported as a success and then fails to preview.
- **Runs on the JavaFX Application Thread** (`:2009-2029`). The class has a
  `dashboard-async` executor at `:214-218` that this method does not use, so a multi-GB
  video freezes the UI with no progress and no cancel.
- **"Upload" is a misnomer.** The operation is `Files.copy(source, dest, REPLACE_EXISTING)`.
  There is no HTTP client, no API call, no `ApiManager`. Nothing leaves the machine.

### Does media ever reach Clinic Server?

**No — definitively, in every code path.**

- `HttpHelper` is hardcoded to JSON with a `String` body parameter
  (`HttpHelper.java:82-97`). There is **no overload** taking `byte[]`, `File`, `Path` or
  `InputStream`.
- Grep for `BodyPublishers.` returns only `ofString(json)` and `noBody()` — never
  `ofByteArray` or `ofInputStream`.
- Grep for `multipart|MultipartFile|@RequestPart|application/octet-stream|image/jpeg|video/mp4`
  across `src` returns **zero hits**.
- `Base64` appears only in `ClientLicenseManager` (license obfuscation) and
  `DeviceFingerprint`. There is no `data:image/...` or `data:video/...` anywhere.
- No `/api/patients/{id}/media`, `/api/upload` or `/api/files` endpoint exists in any client.

The complete endpoint set the app can call is JSON-only: patients, appointments, medications,
payments, expenses, money-safe, schedule, history, notifications, SSE, health, license,
update, auth, doctors, secretaries. The only binary download in the app is the app updater
fetching an installer, which is not patient data.

### Who can access it

**There is no access control of any kind.** Not a role check, not a permission check, not an
ownership check.

- `openGallery` (`:1581`) has exactly one guard: `if (patient == null)`.
- Grep for `role|Role|ADMIN|SECRETARY|isOwner|hasPermission|checkOwnership|currentUser`
  **inside `patientDashboard.java` returns zero matches.**
- `galleryBtn` appears three times — declaration, FXML, and label text. It is never disabled
  or hidden.
- The DR app has no client-side authorization model at all: `Login.java:356-358` hardcodes
  `setCurrentUser("doctor", …)` and navigates straight to the dashboard.

Practical consequences: two doctors sharing one Windows account have full read **and write**
access to every patient's media with no ownership trail; a second machine sees nothing; a
second OS account on the same PC sees nothing (its own `user.home`, its own
`ClinicDatabase/Clinic.db`); and because the folder lives under the user's home directory it
is exposed to home-directory backup tools, folder sync and malware. There is no
encryption at rest, in contrast to the server's AES-256 H2 file.

### Lifecycle and deletion

**There is no deletion, retention, purge or expiry of media anywhere.**

- The gallery toolbar has exactly three buttons — Upload Photos, Upload Videos, Open Folder
  (`:1637-1655`). No delete. No `TreeView` context menu. No Delete key handler.
  "Open Folder" (`Desktop.getDesktop().open`) is the only practical escape hatch.
- **Patient deletion does not clean up media — it orphans it.** `PatientDAO.delete`
  (`:494-518`) issues only `DELETE FROM Appointments`, `patient_history`, `Patients`. There
  is **no filesystem call**. The folder survives with all media, permanently unreachable from
  the UI and undeletable from within the app.
- **Not in the Excel backup.** `ExcelBackupService` writes exactly three sheets — Patients,
  Appointments, Medications. `LastBackupData` snapshots three JSON files.
- **Not in server backup/restore.** `BackupRestoreService.readBackup` returns patients,
  appointments, medications only.
- **Not synced.** `AutoSyncService` touches SQLite rows only; no file is ever read or written.
  Its "purge local rows for deleted patients" step purges DB rows, not the media folder.
- **Not removed on uninstall** — nothing in `installer/`, `tools/` or any `.bat` references
  `.clinicapp`.
- **No per-media metadata exists.** The only metadata is the filesystem `lastModified`
  shown in the preview pane. No capture date, no uploader, no device, no EXIF, no
  checksum, no audit of access.

### Preview

Images: `ImageView` in a fixed 600×400 box, `preserveRatio`, no zoom or rotation, plus
"Open in Viewer" via `Desktop` (`:1796-1831`). **No EXIF orientation handling**, so portrait
phone photos display sideways. Videos: `MediaPlayer`/`MediaView` 600×350 with
Play / Pause / Stop-to-zero and "Open in Player" (`:1832-1889`) — **no seek bar, no volume,
no full-screen, and `MediaPlayer` is never disposed**, leaking a decoder per selection.
The folder grid renders videos as a static `▶` glyph with **no thumbnail** (`:1943-1945`).

There is no `WebView`/`WebEngine` anywhere, so no remote or streaming media, and no
`http(s)` URL is ever passed to `Image` or `Media` — everything is a local `file:` URI.

### Defects that must not be carried into a replacement

| | Defect | Consequence |
|---|---|---|
| M1 | Folder keyed on a machine-local SQLite id | DB rebuild / Excel restore / lost mapping orphans all media |
| M2 | Folder name embeds the patient name | Renaming a patient creates a new empty folder; the old one is orphaned |
| M3 | `sanitizeFileName` strips non-Latin characters | Arabic names yield `patient_7_`; also no `null` guard (NPE) |
| M4 | `mkdirs()` return values ignored | Unwritable home → empty gallery, all uploads fail, only a `log.error` |
| M5 | "All Files (\*.\*)" filter defeats all validation | Any file type accepted; non-media files land in `photos/` and are invisible in the UI |
| M6 | No size cap, no quota, no count limit | Unbounded disk growth |
| M7 | Extension whitelist narrower than reality | No `.heic`/`.heif` (iPhone default), `.tiff`, `.m4v`, `.mpeg`; such files are simply not listed |
| M8 | Copy on the FX thread, no progress, no cancel | UI freeze on large video |
| M9 | Result dialog always styled as success | All-failed uploads still show a green "Upload Complete"; failed filenames never surfaced |
| M10 | `MediaPlayer` never disposed | Native decoder leak; audio device can be held |
| M11 | Non-transitive, overflow-prone comparator (`:1740-1744`) | Can throw inside a `TreeView` cell factory during sort |
| M12 | Synchronous directory scan per cell per repaint (`:1719-1722`) | Unbounded cost as folders grow |
| M13 | No EXIF orientation | Portrait photos display rotated |
| M14 | No video thumbnails | Folder grid unusable for video triage |

Defensively, the one thing the file handling gets **right**: the destination is built from
`source.getName()` only (`:2011`), so a hostile source filename cannot escape the target
directory, and the sanitized patient name cannot introduce a separator. There is no
server-side component, so classic path traversal does not apply.

---

## B1.2 Server-backed (Option B) requirements

Each requirement below is grounded in the Clinic Server's **verified** current state. Where the
server has no precedent, that is stated rather than papered over.

### R1 — Upload

**Current state: the server has no media upload path at all.** The only `MultipartFile` usage
in the entire codebase is `BackupRestoreController` — lines 10, 68, 105 — two ADMIN-only
`.sql` restore/validate endpoints. There is no `@RequestPart` anywhere and no `consumes =` on
any mapping.

**Blocking constraint, verified:** there is **no** `spring.servlet.multipart.*` configuration
anywhere in `application.properties`, `application-postgres.properties` or `pom.xml`
(0 matches). The operative limits are therefore Spring Boot's framework defaults:

- `spring.servlet.multipart.max-file-size` = **1 MB**
- `spring.servlet.multipart.max-request-size` = **10 MB**

**A single patient photo will fail at the servlet container before any controller runs.**
Any media endpoint requires explicit multipart settings, and the existing
`MAX_BACKUP_BYTES = 50 MB` (`BackupRestoreController:23`) is a misleading precedent — it is a
controller-level check that can never be reached for anything above 1 MB.

The validation idiom to follow already exists (`BackupRestoreController:70-85`) and is the
correct pattern: non-empty → size cap → extension allowlist → **server-generated** filename on
a relative path → temp delete in `finally`. The client filename is used only for the
extension check, never for the path. The download side has a traversal guard at `:136-138`
(`f.startsWith(dir)`) and a filename allowlist at `:152`.

Requirements:
- explicit `spring.servlet.multipart.max-file-size` / `max-request-size`, sized for video
- streamed to disk — **never** `file.getBytes()` into memory as `:85` does; that is acceptable
  for a 50 MB SQL file and unacceptable for video
- server-generated storage names; client filename retained as display metadata only
- content validation by magic bytes / decoded probe, not by extension
- an explicit allowed-type and max-bytes policy per media kind (image vs video)

### R2 — Patient association

- Media binds to `patients.id`, the server-side id. The legacy folder keyed on a **local**
  SQLite id (M1), so there is nothing to migrate *by name* — any import must resolve through
  `server_id_mappings`.
- **The association is where the ownership question bites.** `Patient` has no `role` field and
  no media field. Whether media inherits `patient.createdBy`, carries its own uploader, or is
  clinic-wide is **undecided** — see §B3.2.
- A new `@ManyToOne` to `patients` will get **no** cascade behaviour. There is no JPA cascade
  anywhere in the server (0 matches for `CascadeType`); `PatientService.deletePatient`
  (`:162-177`) is a hard delete with a hand-written five-item cascade —
  appointments, histories, payments, medications, notification preferences — plus an
  ID-only tombstone. Media must be added to that list explicitly. The method **is**
  transactional via the class-level `@Transactional` on `PatientService` (`:26`), so an added
  cascade line commits atomically with the rest.

### R3 — Metadata

- No existing per-resource metadata convention. `AuditEvent` has nine fields
  (`SecurityAuditLogger:72-80`) and **no resource/target identifier** — a media access event
  would have to be smuggled into the free-text `details` string, which is not queryable or
  joinable.
- Minimum metadata required by the legacy behaviour: original filename, media kind, byte size,
  and an upload timestamp. Everything else — uploader, device, capture date, EXIF, checksum —
  does not exist today and would be new.
- Audit persistence is best-effort and silently drops: `SecurityAuditLogger.persist` catches
  and logs on failure without failing the request (`:54-65`).

### R4 — Retrieval

- Precedent for binary download is `BackupRestoreController:142` (octet-stream) with the
  `:136-138` traversal guard.
- **Retrieval access is the authorization question.** There is no existing read-authorization
  helper for non-ownership data.
- Note the SSE precedent and its stated rationale: `/api/events/**` is `authenticated()`
  specifically because it carries PHI in the payload (`SecurityConfig`, with an inline
  comment saying so). Media is strictly more sensitive, and the codebase has no rule for it.
- No media field exists on any entity and `V1__initial_schema.sql` has no media table.

### R5 — Authorization

See §B3. In summary: the role vocabulary and the row-level mechanism both exist and are
reusable, but **the mapping of media to a role is not derivable** from anything in the
codebase, and the existing `checkOwnership` fails **open** for `createdBy == null`, which is
precisely the community-booking case.

### R6 — Deletion and retention

- Patient deletion is a **hard delete** with a manual cascade (§R2). Media must be added to
  that list or it is orphaned — and once the patient row is gone, **no ownership check
  remains to protect the orphan**, while the backup dump still carries it.
- **Do not store media bytes in the database.** `BackupRestoreService.createBackup` runs
  `jdbcTemplate.execute("SCRIPT TO '...'")` (`:41`) over the whole H2 database with **no table
  filtering whatsoever**. A `BLOB`/`VARBINARY` column would be inlined as a hex or base64
  literal into plaintext `.sql` files that are already full-clinic PHI dumps on disk.
- Backups live at `BACKUP_DIR = "backups"` **relative to the process CWD** (`:29`) with 30-day
  retention (`:30`). Media stored outside the database would **not** be included in a backup
  unless explicitly added, and the restore path (`RUNSCRIPT FROM`, `:154`) would not bring it
  back.
- **No retention policy for clinical data exists anywhere in the server.** The only retention
  constant is the 30-day backup pruning. There is no legal or clinical retention requirement
  encoded, so the media retention period is a product decision, not a derivable default.

### R7 — Failure and partial-upload behaviour

- There is no precedent for resumable, chunked or retried upload. `BackupRestoreController`
  buffers the whole file and either succeeds or throws.
- Required decisions with no precedent: behaviour on a mid-transfer network drop; whether a
  partially written file is visible; whether a failed multi-file batch is all-or-nothing; and
  whether a client-side retry can create duplicates.
- The existing backup path is gated on maintenance mode (`BackupRestoreController:49-53`,
  `78-82`) — a deliberate safety interlock, but not transferable to routine uploads.

### R8 — Storage ownership and lifecycle

- **No storage abstraction exists.** Grep for `Storage|Blob|Bucket|GridFS|S3|GCS` across
  `src/main` returns 2 matches, both false positives (a license HMAC string and a rate-limit
  comment). A media feature would introduce the first one, so its design is unconstrained by
  precedent.
- The server already writes to CWD-relative paths in six places — `logs/`, `backups/`,
  `jwt-secret.key`, `clinic-admin.enc`, `license-warnings.json`, `clinic_server_license.json`.
  Any media directory inherits that CWD coupling.
- **Transport is plaintext by default.** `server.address=0.0.0.0` and
  `server.ssl.enabled=${SSL_ENABLED:false}` (`application.properties:25`, `:45`). Uploading
  patient imagery over cleartext HTTP to all interfaces is the single largest risk in Option
  B, and it is a deployment property, not a code one.
- Rate limiting is per-IP only (`RateLimitingFilter.getRateLimitKey`), so a clinic behind one
  NAT shares a bucket, and a new media path would fall into the catch-all 300 req/min bucket.
  The substring matcher is also fragile: any path containing `/login` silently gets the
  20/min credential bucket.

---

## B1.3 Authorization matrix

### B3.1 What the existing system already determines

These are read from code and can be relied on:

| Fact | Evidence |
|---|---|
| Exactly three roles: `ADMIN`, `DOCTOR`, `SECRETARY` | the only three literals in `src/main`, minted at `AdminController:139`, `DoctorController:185`, `SecretaryController:188` |
| Role is fixed by which login endpoint was called; no elevation path | same three sites; no `role` field on `Doctor` or `Secretary` |
| Role travels as the `role` JWT claim → `ROLE_` authority | `JwtUtil:74-82`, `JwtAuthFilter:54-61` |
| Role is never re-read from the database | filter populates `SecurityContext` from the token only |
| `checkOwnership(createdBy)` is the **only** row-level mechanism | `SecurityUtil.java`, 26 lines, quoted in full below |
| `createdBy == null` → the check is a **complete no-op** | `if (createdBy == null) return null;` |
| `createdBy == ""` → 403 for non-ADMIN | falls to the `equals` branch, which no real username matches |
| ADMIN passes everything; the owner passes; others get 403 | the `!isAdmin()` conjunct |
| `null` owner is **deliberate**, not a bug | `SecurityDefectFixesTest:311-324` documents that `findByCreatedByOrCreatedByIsNull` is required or community bookings vanish for SECRETARY and DOCTOR |
| The mechanism is opt-in per call site — no interceptor, no annotation | every controller must perform the two-line `if (forbidden != null) return forbidden;` dance |
| Path-level precedents | expenses approve/reject/unapprove = `hasRole("ADMIN")`; medications and money-safe = `hasAnyRole("ADMIN","DOCTOR")`; payments, patients, appointments, history, notifications = `authenticated()`; `DELETE /api/notifications/**` = `hasRole("ADMIN")` |

The full `checkOwnership`:

```java
public static <T> ResponseEntity<T> checkOwnership(String createdBy) {
    if (createdBy == null) {
        return null;                                    // <-- no check at all
    } else if (!createdBy.equals(getCurrentUsername()) && !isAdmin()) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
    }
    return null;
}
```

**A defensible default matrix can be derived** from the precedents above, by analogy:

| Data class | Nearest precedent | Inferred rule | Confidence |
|---|---|---|---|
| Clinical prescribing data | `/api/medications/**` | ADMIN + DOCTOR | High |
| Financial records | `/api/payments/**` | any authenticated user | High |
| Expense approval (destructive, financial) | `PUT /api/expenses/*/approve` | ADMIN only | High |
| Patient demographics | `/api/patients/**` | any authenticated, filtered by ownership | High |
| **Patient media** | *none* | **cannot be derived** | **None** |

### B3.2 What cannot be safely inferred — product decisions required

These have **no** supporting precedent in the codebase. Presenting any of them as a
requirement would be inventing policy.

| # | Undecidable question | Why it cannot be inferred |
|---|---|---|
| **U1** | Is patient media **clinical** (like medications → ADMIN + DOCTOR) or **administrative** (like payments → any authenticated user)? | The server has no imaging/attachment category. Photographs of a patient's body are arguably more sensitive than a medication list, but nothing in the code says so, and the two nearest precedents point opposite ways. **This single choice determines the entire matrix.** |
| **U2** | May a **SECRETARY** view media attached to a **DOCTOR's** patient? | Patient demographics are already reachable by any authenticated user, so "no" would be a *new* restriction rather than a preserved one. Nothing states the intent either way. |
| **U3** | Does media inherit the **patient's** ownership, or carry its own **uploader**? | If it inherits `patient.createdBy`, media on a community-booked (`createdBy == null`) patient becomes readable and writable by every authenticated user — `checkOwnership` fails open. If it carries the uploader, the "whole clinic sees this patient's file" expectation breaks. Both behaviours are defensible; they are incompatible. |
| **U4** | Who may **delete** media? | No precedent for a destructive action on clinical content by a non-ADMIN. `DELETE /api/notifications/**` is ADMIN-only *because* that table has no owner column — media would have the same problem unless it is given an owner. |
| **U5** | What is the **retention period**, and does deleting a patient delete their media? | No clinical-retention policy exists anywhere in the server. The only retention constant is 30-day backup pruning. |
| **U6** | May media attach to an **appointment**, inheriting appointment visibility, or only to a patient? | The legacy gallery is patient-scoped only. There is no appointment-scoped media concept to inherit. |
| **U7** | Is a media **tombstone** required, mirroring `DeletedPatient`? | `DeletedPatient` exists so desktop clients can purge local rows after a hard delete. A media row that disappears silently would leave clients inconsistent — but no requirement states that clients cache media at all. |
| **U8** | Should media access be **audit-logged**, and at what granularity? | The audit schema has no resource identifier, so a media event is not queryable. `PatientController` currently emits no audit events at all. |

Two further observations that are **not** decisions but must not be overlooked:

- **`checkOwnership` fails open on `createdBy == null`.** Because `null` is exactly what the
  cloud booking relay writes, reusing `checkOwnership` unchanged would make media on
  community-booked patients world-readable and world-writable. Any reuse must handle `null`
  deliberately, and that handling is a decision, not a default.
- **List and single-item endpoints already disagree.** `PatientController`'s list filters are
  `createdBy == null || own` (`:86`, `:108`, `:122`, `:141`, `:177`), but
  `MedicationController.getByPatient` (`:51`) uses a strict `.equals` with no null allowance,
  so the same record is visible on one endpoint and invisible on another. Any media
  implementation that copies the inline-filter pattern will inherit this inconsistency unless
  the filter is centralised.
- **Pre-existing, unrelated:** `GET /api/patients/deleted-since` (`PatientController:192-203`)
  has no ownership or role check and returns every tombstone since a client-supplied
  timestamp. A media tombstone would have the same shape. Worth flagging, out of scope here.

---

## B1.4 Option A vs Option B

| Dimension | Option A — local-only parity | Option B — server-backed media |
|---|---|---|
| Client work | Upload capability in `src-tauri/capabilities/default.json` (nothing can currently write an arbitrary path), gallery UI, image/video preview | Same, plus API client, sync/queue integration, conflict handling |
| Server work | **None** | New endpoints, new table, storage layer (the first in the codebase), authorization rules, backup integration |
| Cross-device visibility | **None** — a second machine sees nothing | Clinic-wide |
| Survives reinstall / profile loss | **No** — folder lives under `user.home` | Yes, if backed up |
| Audit trail | **None** — no uploader, no access log, no timestamp beyond `lastModified` | Available via the existing `SecurityAuditLogger`, though not queryable by resource without a schema change |
| Deletion on patient removal | Orphans, as today | Requires adding to `PatientService.deletePatient`'s manual cascade or it orphans |
| Backup | Excluded today | Excluded unless explicitly added; **and must not** go in the H2 dump as a BLOB |
| Transport risk | None — never leaves the machine | **Plaintext by default**: `server.ssl.enabled=false`, `server.address=0.0.0.0` |
| Authorization risk | None in-app; **all access governed by OS filesystem permissions only** | Depends entirely on U1–U4, which are undecided |
| Blocking technical prerequisite | None | `spring.servlet.multipart.*` must be set — the 1 MB default rejects any photo |
| Cost | Low | Substantially higher |
| Fixes the inherited defects M1–M14 | Must be fixed deliberately (M1 and M5 matter most) | Naturally resolved by not keying on a local id |

Neither option is a free win, and they are not symmetric:

- Option A **reproduces every media defect in §B1.1** unless each is addressed on purpose. The
  two that matter most are **M1** (folder keyed on a machine-local SQLite id, so media is
  orphaned by a DB rebuild or an Excel restore) and **M5** (the `*.*` filter means any file
  can be stored and non-media files are then invisible in the UI).
- Option A's "no authorization risk" is misleading. It means *no in-app authorization at all* —
  access is whatever the OS grants to whoever is logged into that machine.
- Option B's largest risk is not technical but **policy**: it requires U1–U4 to be answered
  correctly, and a wrong answer here is a PHI exposure rather than a bug.

**Recommendation: Option B, conditional on U1–U4 being answered first** — because the clinic
already treats diagnosis, vitals and prescriptions as shared server data, and patient
photography is more sensitive than those, not less. Option A should only be chosen if the
clinic genuinely runs a single front-desk PC and never needs the media elsewhere, and that
should be recorded as a deliberate limitation rather than inherited by default.

---

## B1.5 Decision register and `BLOCKED` gate

### B1.5.1 Status summary

| | Count |
|---|---|
| Decisions **answered** | **0 of 11** |
| Decisions **outstanding** | **11 of 11** (D1–D11) |
| Technical constraints **settled** | 6 (C1–C6, below) |
| Gate | **`B1 = BLOCKED — DECISION_REQUIRED`** |
| Overall | **`NOT_READY`** |

No decision below has been answered. Nothing in this register may be treated as approved
until the product owner supplies a value, and no value has been assumed, inferred or
defaulted on their behalf.

---

### B1.5.2 Settled technical constraints

These are **verified facts about the current system, not choices**. They are recorded here
because they bound every answer to D1–D11, and because several of them invalidate an approach
that would otherwise look reasonable.

| ID | Constraint | Evidence | Bounds |
|---|---|---|---|
| **C1** | **Media bytes must not be stored in the database.** A `BLOB` column would be inlined as a hex/base64 literal into the plaintext `.sql` backup dumps. | `BackupRestoreService:41` runs `SCRIPT TO` over the whole H2 database with no table filtering; `backups/` already holds full-clinic PHI dumps in plaintext | D6, D7 — forces filesystem/object storage |
| **C2** | **Spring's multipart defaults apply: 1 MB per file, 10 MB per request.** No `spring.servlet.multipart.*` setting exists anywhere in the project. A single photo is rejected by the container before any controller runs. | 0 matches for `multipart` / `max-file-size` / `max-request-size` across `application.properties`, `application-postgres.properties`, `pom.xml` | Any upload design; must be changed deliberately |
| **C3** | **`MAX_BACKUP_BYTES = 50 MB` is not a valid precedent** for media upload — it is a controller-level check that can never be reached above the 1 MB container default. | `BackupRestoreController:23`, versus C2 | Any "reuse the backup upload pattern" argument |
| **C4** | **`checkOwnership` fails open for `createdBy == null`.** `if (createdBy == null) return null;` — the check is a complete no-op. `null` is exactly what the cloud booking relay writes. | `SecurityUtil.java`, quoted in آ§B1.3; `SecurityDefectFixesTest:311-324` documents that null-inclusive queries are required or community bookings vanish | **D4** — this behaviour must not be reused for media without an explicit decision |
| **C5** | **Server SSL is disabled by default and the server binds all interfaces.** No upload may be enabled over an unprotected transport. | `server.address=0.0.0.0`, `server.ssl.enabled=${SSL_ENABLED:false}` (`application.properties:25`, `:45`) | **D10** — a hard precondition, not a preference |
| **C6** | **`PatientService` is class-level `@Transactional`.** Patient deletion is a hard delete with a hand-written five-item cascade. | `PatientService:26`; `deletePatient` at `:162-177` cascades appointments, histories, payments, medications, notification preferences, then writes an ID-only tombstone | **D6** — any media cascade line added there commits atomically; the fact must be preserved |

---

### B1.5.3 Outstanding decisions

Every row is **UNANSWERED**. "Options" lists the choices that exist; it does not recommend
one, and no default is implied.

#### D1 — Storage model آ· **UNANSWERED**

| Option | Meaning | Consequence if chosen |
|---|---|---|
| **Option A** | Local-only media, exactly as the JavaFX app behaves today | No server work. D2–D10 become moot. D11 applies. Media stays invisible to other machines, is lost on reinstall, and is governed only by OS filesystem permissions. |
| **Option B** | Server-backed media | Requires D2–D10 before any server work can begin. |

**Blocks:** everything.

#### D2 — Media classification: clinical or administrative آ· **UNANSWERED** *(Option B only)*

| Option | Resulting rule (if Option B) |
|---|---|
| **Clinical** | `hasAnyRole("ADMIN", "DOCTOR")` — by analogy with `/api/medications/**` |
| **Administrative** | `authenticated()` — by analogy with `/api/payments/**` |

**Blocks:** the entire authorization matrix. The two nearest precedents in the codebase point
in opposite directions, and the server has no imaging/attachment category to break the tie.
Not derivable — see **U1**.

#### D3 — May a SECRETARY view media belonging to a doctor's patient? آ· **UNANSWERED** *(Option B only)*

| Option | Result |
|---|---|
| **Yes** | Matches the existing de-facto posture: patient demographics are already reachable by any authenticated user |
| **No** | A **new** restriction relative to current behaviour, not a preserved one |

**Blocks:** read rules. Not derivable — see **U2**.

#### D4 — Ownership model آ· **UNANSWERED** *(Option B only)*

Two sub-questions, both required:

1. **Scope:** patient-scoped (media inherits the patient), uploader-scoped (media belongs to
   whoever added it), or both (patient-visible *and* uploader-attributed)?
2. **`createdBy == null` handling:** per **C4**, `checkOwnership` is a no-op for these records.
   Options: deny, allow, allow-read-only, or a dedicated rule.

**Blocks:** read *and* write rules, and the schema. Note the two options are mutually
exclusive in effect — patient-scoped makes community-booked patients' media world-readable
under an unmodified `checkOwnership`; uploader-scoped breaks the expectation that the whole
clinic sees a patient's file. Not derivable — see **U3**.

#### D5 — Who may delete media? آ· **UNANSWERED** *(Option B only)*

| Option | Precedent |
|---|---|
| **ADMIN only** | `DELETE /api/notifications/**` is ADMIN-only, justified because that table has no owner column — media has the same problem unless D4 gives it one |
| **Uploader** | No precedent for a destructive clinical action by a non-ADMIN |
| **Patient owner + ADMIN** | Consistent with `checkOwnership` semantics |

**Blocks:** the delete path. Not derivable — see **U4**.

#### D6 — Retention, and whether patient deletion removes media آ· **UNANSWERED** *(Option B only)*

Two sub-questions:

1. **Retention period** — no clinical-retention policy exists anywhere in the server; the only
   retention constant is 30-day backup pruning. This cannot be guessed, and no legal or
   clinical requirement is encoded in the system.
2. **Cascade** — does deleting a patient delete their media? Per **C6** this is a hand-written
   list; media must be added explicitly or it is orphaned, and once the patient row is gone no
   ownership check remains to protect the orphan while the backup dump still carries it.

**Blocks:** lifecycle, the cascade, and backup integration. Constrained by **C1** (not in the
database) and **C6** (transactional cascade available).

#### D7 — Association scope آ· **UNANSWERED** *(Option B only)*

| Option | Consequence |
|---|---|
| **Patient-scoped only** | Matches the legacy gallery exactly; simplest |
| **Also appointment-scoped** | Media inherits appointment visibility semantics, which are a further unresolved question |

**Blocks:** schema and authorization. Not derivable — see **U6**.

#### D8 — Media tombstones آ· **UNANSWERED** *(Option B only)*

`DeletedPatient` exists so desktop clients can purge local rows after a hard delete. If clients
cache media, a silent row deletion leaves them inconsistent.

| Option | Consequence |
|---|---|
| **Yes** | A tombstone table mirroring `DeletedPatient`, and a sync contract for it |
| **No** | Clients must re-list; no purge contract needed |

**Blocks:** the sync contract. Not derivable — see **U7**.

#### D9 — Audit logging of media access آ· **UNANSWERED** *(Option B only)*

Two sub-questions:

1. **Must access be logged?** `PatientController` currently emits no audit events at all.
2. **Can the schema identify the media resource?** `AuditEvent` has nine fields and **no**
   resource/target identifier, so a media event can only go into the free-text `details` string
   and would not be queryable or joinable.

| Option | Consequence |
|---|---|
| **No logging** | No compliance evidence that media was viewed |
| **Log, free-text details** | Reuses `SecurityAuditLogger` with no schema change; not queryable by patient |
| **Log + schema change** | Adds a resource identifier; a `Clinic Server` migration, which is in scope only after this decision |

**Blocks:** compliance posture. Not derivable — see **U8**.

#### D10 — TLS precondition آ· **UNANSWERED** *(Option B only)*

| Option | Consequence |
|---|---|
| **Guaranteed before any upload is enabled** | Honours **C5**; the upload path refuses to run unless TLS is active |
| **Deferred** | Would enable patient imagery over cleartext HTTP to `0.0.0.0` — contrary to **C5** |

**Blocks:** whether upload may be enabled at all. **C5 already forbids the unprotected
option**, so the realistic choice is *how* TLS is guaranteed, not *whether*.

#### D11 — Which legacy defects are fixed vs accepted آ· **UNANSWERED** *(Option A only)*

Fourteen inherited defects are listed in آ§B1.1. Each must be explicitly marked **fixed** or
**accepted with a recorded reason**. Two are load-bearing and should not be accepted without
a deliberate decision:

| ID | Defect | Why it matters |
|---|---|---|
| **M1** | Folder keyed on a machine-local SQLite id | A DB rebuild, an Excel restore or a lost `server_id_mappings` row orphans every media file |
| **M5** | `*.*` file filter defeats the extension list | Any file type can be stored, and non-media files are then invisible in the UI — silent data loss from the user's view |

**Blocks:** client implementation for Option A.

---

### B1.5.4 Exact remaining unanswered questions

**Decisions:** D1, D2, D3, D4 (both sub-questions), D5, D6 (both sub-questions), D7, D8, D9
(both sub-questions), D10, D11 — **11 of 11 outstanding.**

**Information that must be supplied alongside them**, because several decisions are cheaper or
different if it is known:

| # | Missing information | Affects |
|---|---|---|
| I1 | **Does any clinic data actually need to be shared across machines today?** If the answer is "no, a single front desk", Option A becomes materially more attractive. | D1 |
| I2 | **Expected volume and media mix** — images only, or video as well? Video dominates every cost, size and risk in R1 and R7. | C2 sizing, D6 storage sizing, R7 |
| I3 | **Any legal or clinical retention obligation.** None is encoded in the system and it cannot be guessed. | D6 |
| I4 | **Must the audit trail be queryable by patient?** Decides whether D9 needs a schema change. | D9 |
| I5 | **The deployment's TLS posture** — is a reverse proxy or `SSL_ENABLED=true` planned? | D10 |
| I6 | **Does the clinic want existing local media migrated**, or is it acceptable to start empty? | D1, and any future migration work |

**Explicitly not to be invented:** no product owner has stated a retention period, a legal
basis, a clinical-sensitivity classification, or an authorization rule for media. None is
assumed anywhere in this document.

---

### B1.5.5 Implementation prerequisites

Once **all** applicable decisions are answered, the following become the entry conditions for
B1 implementation. None may start before that point.

**If D1 = Option A** — requires D11 only:

1. A D11 disposition for each of M1–M14, with reasons for anything accepted.
2. An explicit upload capability grant in `src-tauri/capabilities/default.json` — nothing
   currently permits writing an arbitrary path, so this is a deliberate privilege decision,
   scoped as narrowly as the feature allows.
3. A decided local layout keyed on the **server** patient id, if M1 is to be fixed rather than
   accepted.
4. A decided type policy and size policy, if M5/M6 are fixed.

**If D1 = Option B** — requires D2–D10, plus I2–I6:

1. **Authorization rules derived from D2–D5**, written explicitly rather than inherited from
   `checkOwnership`, honouring **C4** for the `createdBy == null` case.
2. **A decided association model** from D7, and a storage layout that keeps bytes **out of the
   database** per **C1**.
3. **An explicit `spring.servlet.multipart.*` policy** sized from I2, per **C2** — and not
   copied from `MAX_BACKUP_BYTES`, per **C3**.
4. **A TLS precondition enforced in code**, per **C5** and D10, so upload cannot be reached
   over cleartext.
5. **A lifecycle decision wired into `deletePatient`**, per D6 and **C6**, plus an explicit
   answer on whether media is included in the existing backup/restore flow.
6. **A size and type policy validated by content**, not by extension — the legacy `*.*` filter
   defect must not be reproduced on the server side.
7. **A failure and partial-upload contract** (R7): mid-transfer failure, visibility of partial
   files, batch atomicity, retry idempotency. No precedent exists in the server.
8. **An audit approach** from D9, including whether a schema change is authorized.

**Applies to both options:** implementation must begin only from the resulting **approved
specification**, not from this register. This document records what must be decided; it is
not that specification.

---

### B1.5.6 Gate

```text
B1      = BLOCKED — DECISION_REQUIRED
Overall = NOT_READY
```

**Decisions answered: 0 of 11.** No endpoint, table, entity, migration, multipart setting,
storage layer, authorization rule, client change, or media migration has been created, and
none may be until D1 is answered and, if Option B, D2–D10 are too.

**Safe to start now, if desired:** a read-only inventory of any existing
`~/.clinicapp/patients/` media on the clinic's machines, to inform I1 and I2. That touches no
code, changes no behaviour, and commits to nothing.

## B1.6 Inventory evidence — measured facts only

A read-only metadata inventory of the legacy patient-media locations on the development
machine. **This section records measurements only. It answers none of D1–D11, and no
business requirement is inferred from it.** File contents were never opened, rendered or
copied; only names, extensions, lengths and timestamps were read.

### Method and safety

| | |
|---|---|
| Mode | Read-only. Directory listings and file metadata only |
| Not done | No file opened, rendered, decoded, copied, moved, renamed, deleted or uploaded; no permission or attribute changed |
| Tools | PowerShell `Get-ChildItem`, `Test-Path`, `Measure-Object` on metadata; no media file was read |
| Scope | `%USERPROFILE%\.clinicapp\patients\` (the gallery tree) plus the sibling legacy trees documented in آ§B1.1, to establish whether media exists anywhere |

**One measurement error was caught and corrected.** The first media scan used
`Get-ChildItem -LiteralPath … -Include '*.jpg',…`, where `-Include` is silently ignored when
combined with `-LiteralPath`. It reported 49 "media files" which were in fact `.txt`, `.json`,
`.pdf` and `.xlsx`. The scan was redone with an explicit `.Extension` test; the corrected result
is **0**. The erroneous count is recorded here rather than quietly discarded, because the
figures below depend on it being right.

### 1–2. Inventory target: the gallery tree

| Measure | Value |
|---|---|
| Path | `%USERPROFILE%\.clinicapp\patients\` |
| Exists | **No** |
| Patient directories | **0** |
| Media files | **0** |
| Total bytes | **0** |

The parent `%USERPROFILE%\.clinicapp\` **does** exist and contains exactly one file:
`config.properties` (152 bytes). `~/ClinicDatabase/Clinic.db` (81,920 bytes) is also present,
so the legacy application has been run on this machine.

The gallery tree is created lazily by `ensurePatientMediaFolders()`
(`patientDashboard.java:1674`), which is reached only from `openGallery()`. Its absence is
therefore **consistent with the gallery never having been opened here**. It is *not* evidence
that patient media does not exist on the clinic's production machines.

### 3–9. Adjacent legacy locations

Because the primary target is absent, the sibling trees were measured to establish whether
media exists anywhere in the legacy footprint.

| Location | Exists | Files | Bytes | Notes |
|---|---|---|---|---|
| `~/.clinicapp/patients/` (gallery) | No | 0 | 0 | media tree |
| `~/patient/` | Yes | 17 | 1,208 | 17 patient dirs, 119 dirs total, **0 media files** |
| `~/dp/prescriptions/` | Yes | 0 | 0 | empty |
| `~/dp/diagnoses/` | Yes | 0 | 0 | empty |
| `~/dp/exports/` | Yes | 4 | 5,559 | 3 أ— `.pdf`, 1 أ— `.json` |
| `~/backup/` | Yes | 27 | 112,501 | 24 أ— `.xlsx`, 3 أ— `.json` |
| `~/ClinicDatabase/` | Yes | 1 | 81,920 | `Clinic.db` |

**Extension breakdown across all legacy locations:** `.xlsx` أ— 24, `.txt` أ— 17, `.json` أ— 4,
`.pdf` أ— 3, `.db` أ— 1, `.properties` أ— 1. **Image extensions: 0. Video extensions: 0.**

**This directly confirms the آ§B1.1 finding about the dead tree.** `~/patient/` contains 17
patient directories (`1_a`, `1_abdo`, `2_Ahmed_`, `3_Abdalrhman_Ahmed_Abdalmonem`,
`11_abdoooo`, …) and exactly 6 subdirectories each — `Diagnoses`, `Images`, `Lab_Results`,
`Prescriptions`, `Reports`, `Videos` — for 119 directories in total. **All 102 subdirectories
contain zero files.** The only file in each patient directory is `Patient_Info.txt`. So
`PathConstants.getPatientImagesFolder` / `getPatientVideosFolder` having no callers is not a
theoretical observation: the directories exist, are created for every patient, and are empty.

**Legacy activity window** (from `LastWriteTime` metadata): earliest artifact
**2026-03-25 13:35**, latest **2026-07-18 15:31** — roughly four months of use, with 17
patients and 24 Excel backups produced.

### 10. Size distribution, image/video split, naming, duplicates

**Not measurable — there are no media files.** Every distribution statistic (smallest,
largest, median, percentiles), the image-versus-video count and byte split, the count of
empty patient media directories, the count of unparseable `patient_{id}_{name}` directories,
and the duplicate-filename count are all **undefined at 0 files**. No value is estimated or
extrapolated. (For completeness: the 17 `~/patient` directories do all parse against a
`{id}_{name}` shape, but that is the dead tree, not the gallery tree the question asked about.)

### What this inventory does and does not tell us

| Question | Informed? | Basis |
|---|---|---|
| **I1** — does existing media require cross-machine sharing? | **No** | There is no media to share. The filesystem cannot indicate a sharing requirement, and none is inferred. |
| **I2** — expected volume and image/video mix | **No** | Zero files means no measured mix. The clinic's real mix is unknown and must be supplied. |
| **I6** — should existing media be migrated? | **No** | Nothing exists here to migrate. Whether the clinic's machines hold media is still unanswered; this machine is a development machine. |

**One measured fact is worth carrying forward**, stated without inference: on this machine
the legacy application's *other* patient features were exercised — 17 patients, report PDFs,
24 Excel backups over four months — while **the media gallery was never opened even once**.
That is a fact about this machine only. It does not establish that the clinic does not use the
gallery, and it must not be read as evidence that media is unnecessary.

### Gate unchanged

```text
B1      = BLOCKED — DECISION_REQUIRED
Overall = NOT_READY
```

**Decisions answered: 0 of 11.** The read-only inventory that was identified as safe to run
has now been run; it produced no measurement that bears on D1–D11.

## B1.7 Investigation closure

The B1 technical investigation is **closed**. This section records what was examined, what the
evidence can and cannot establish, and what remains outstanding. It states no decision and
answers none of D1–D11.

### What is complete

| | Investigation | Extent | Recorded in |
|---|---|---|---|
| 1 | **Repository / code investigation** | Complete. JavaFX media behaviour traced to file and line (`patientDashboard.java:1578-2083`, `HttpHelper.java:82-97`, `PathConstants`, `ExcelBackupService`, `BackupRestoreService`, `AutoSyncService`). Clinic Server read for its existing authorization model (`SecurityUtil`, `SecurityConfig`, `JwtAuthFilter`, `SecurityAuditLogger`, `BackupRestoreController`, `PatientService`) and its storage, backup, deletion and transport posture. | آ§B1.1, آ§B1.2, آ§B1.3 |
| 2 | **Read-only filesystem inventory** | Complete. Directory listings and file metadata only; no media file opened, rendered or copied. | آ§B1.6 |

### Further evidence cannot resolve the outstanding decisions

**No further repository investigation and no further local-filesystem inspection can answer the
outstanding B1 questions.** They are not questions of fact about the code or the disk. They are
product, clinical and operational judgements that only the clinic can make:

- Whether patient media must be shared across machines (**I1**)
- The production media volume and image/video mix (**I2**)
- Any legal or clinical retention obligation (**I3**)
- Whether the audit trail must be queryable by patient (**I4**)
- The deployment's TLS posture (**I5**)
- Whether existing production media must be migrated (**I6**)

Inspecting more code would only re-state the same verified constraints. Inspecting more disks
would only re-state the same absence. **The remaining input is a decision, not evidence.**

### What the local inventory does not establish

The inventory found **zero patient media on this machine**: the gallery tree
`%USERPROFILE%\.clinicapp\patients\` does not exist, and there are no image or video files in
any legacy location. Therefore the inventory establishes **nothing** about:

- **Whether cross-machine sharing is required.** There is no media here to share, and a
  filesystem cannot express a sharing requirement.
- **Expected production media volume or image/video mix.** Zero files means no measured mix.
  The production mix is unknown.
- **Whether existing production media must be migrated.** Nothing exists here to migrate. This
  is a development machine; the clinic's machines were not examined and their state is unknown.

The one related observation is a fact about **this machine only**: the legacy application's
other patient features were exercised over roughly four months — 17 patients, report PDFs and
24 Excel backups — while the media gallery was never opened. **That is not evidence that the
clinic does not need patient media**, and it is not used as such anywhere in this document.

### Absence of evidence is not a requirement

**No authorization, retention, ownership, audit, TLS or clinical-classification requirement is
inferred from the absence of media.** Specifically, the zero-file result does **not** imply:

- that media is unnecessary, low-volume, or optional;
- that any role may or may not upload, view or delete it;
- that no retention period applies, or that any period is acceptable;
- that patient-scoped, uploader-scoped or clinic-wide ownership is sufficient;
- that access need not be audit-logged, or that free-text logging suffices;
- that TLS is unnecessary, or that the transport constraint in **C5** may be relaxed;
- that media is administrative rather than clinical (**D2**).

Each of D1–D11 remains exactly as open as it was. The six settled constraints **C1–C6** remain
settled, and the missing operational information **I2–I6** remains missing. The distinction
between the three is preserved deliberately:

| Layer | State | Meaning |
|---|---|---|
| **C1–C6** | **Settled** | Verified facts about the current system. They bound any answer; they are not themselves choices. |
| **D1–D11** | **Unanswered — 0 of 11** | Product, clinical and operational decisions. No value assumed, inferred or defaulted. |
| **I2–I6** | **Missing** | Operational information that must be supplied alongside the decisions. Cannot be derived from code or disk. |

### Entry condition for implementation

**Implementation may begin only after the required decisions and operational information are
supplied by the product owner and converted into an approved B1 specification.**

That specification must state, at minimum:

- **D1** — the chosen storage model; and if Option B, **D2** classification, **D3** secretary
  read access, **D4** ownership including the `createdBy == null` case, **D5** delete rights,
  **D6** retention and cascade, **D7** association scope, **D8** tombstones, **D9** audit
  approach, **D10** TLS enforcement; if Option A, **D11** a disposition for each of M1–M14.
- **I2** volume and media mix, **I3** any retention obligation, **I4** audit queryability,
  **I5** TLS posture, **I6** migration intent.
- How the specification honours **C1–C6**; in particular **C4** (no reuse of the
  fail-open `checkOwnership` behaviour without an explicit rule) and **C5** (no upload over an
  unprotected transport).

Until that approved specification exists, no endpoint, table, entity, migration, multipart
setting, storage layer, authorization rule, client change or media migration may be created.
This document and the decision register in آ§B1.5 record what must be decided; **they are not
that specification.**

### Final status

```text
B1      = BLOCKED — DECISION_REQUIRED
Overall = NOT_READY
```

**Decisions answered: 0 of 11.** Technical investigation is exhausted; what remains is a
decision that only the clinic can make.

## B1.8 Specification input questionnaire

**This is an input form, not a specification.** It exists so the outstanding B1 items can be
answered explicitly by the stakeholder who owns them.

Rules that govern this section:

- **No answer is pre-filled.** Every answer field below is deliberately blank.
- **No default, no recommendation, no inferred value.** Where earlier sections of this
  document record analysis or a recommendation, that analysis is **not** an answer and does
  not populate any field here.
- **C1–C6 are not questions.** They are verified technical constraints on the existing system
  (§B1.5.2). They are not converted into stakeholder choices and must not be answered here.
  They constrain the answers.
- **No implementation task is created by this section.** Prerequisites and task planning
  begin only after an approved specification exists.

Each item states the question, what the answer controls, and a blank field.

---

### D1 — Storage model

**Question.** Should patient media be **local-only to the client** (Option A) or
**server-backed** (Option B)?

| | |
|---|---|
| Option A | Local-only. No media leaves the client machine. |
| Option B | Server-backed. The Clinic Server owns the media. |

**Decision impact.** Controls whether any Clinic Server endpoint, table, storage layer or
multipart configuration exists at all. Determines whether **D2–D10** (Option B) or **D11**
(Option A) are the live questions; the remainder become not-applicable.

**Stakeholder answer:**

> _______________________________________________

---

### D2 — Media classification *(asked only if D1 = Option B)*

**Question.** Is patient media **clinical** or **administrative**?

| | |
|---|---|
| Clinical | Governed like prescribing data. |
| Administrative | Governed like financial/administrative records. |

**Decision impact.** Controls the read **and** write authorization rule applied to every media
endpoint, and therefore the entire authorization matrix. The two nearest existing precedents
in the server point in opposite directions, so the codebase does not determine this.

**Stakeholder answer:**

> _______________________________________________

---

### D3 — SECRETARY read access *(asked only if D1 = Option B)*

**Question.** May a **SECRETARY** view media belonging to a **doctor's** patient?

| | |
|---|---|
| Yes | — |
| No | — |

**Decision impact.** Controls the SECRETARY branch of the read rule, and whether the media
rule matches the existing posture of `/api/patients/**` (`authenticated()`, filtered by
ownership) or of `/api/medications/**` (`hasAnyRole("ADMIN","DOCTOR")`). "No" would be a new
restriction relative to current patient-data behaviour, not a preserved one.

**Stakeholder answer:**

> _______________________________________________

---

### D4 — Ownership model and `createdBy == null` *(asked only if D1 = Option B)*

**Question, part 1 — ownership scope.** Is media scoped to the **patient**, to the **uploader**,
or to **both** (patient-visible, uploader-attributed)?

**Question, part 2 — ownerless records.** What is the behaviour for media on a patient whose
`createdBy` is `null` — that is, a community/online booking?

| | |
|---|---|
| Part 1 | patient / uploader / both |
| Part 2 | deny / allow / allow-read-only / dedicated rule |

**Decision impact.** Controls the owner column in any media table, every ownership check on
media, and the visibility of media attached to community-booked patients. Per **C4**,
`SecurityUtil.checkOwnership` returns no-op for a `null` `createdBy`, so an unmodified reuse
would leave that media readable and writable by every authenticated user. The two scoping
options have incompatible effects and both are defensible; the codebase does not choose
between them.

**Stakeholder answer, part 1:**

> _______________________________________________

**Stakeholder answer, part 2:**

> _______________________________________________

---

### D5 — Deletion rights *(asked only if D1 = Option B)*

**Question.** Who may delete media?

| | |
|---|---|
| ADMIN only | — |
| Uploader | — |
| Patient owner + ADMIN | — |
| Other | — |

**Decision impact.** Controls the delete endpoint's authorization rule, and whether a delete
path is created at all. The only existing precedent for destroying shared records by role is
`DELETE /api/notifications/**`, restricted to ADMIN because that table has no owner column —
media has the same property unless D4 gives it one.

**Stakeholder answer:**

> _______________________________________________

---

### D6 — Retention and patient deletion *(asked only if D1 = Option B)*

**Question, part 1 — retention period.** How long is media retained? Is there a legal or
clinical obligation driving it?

**Question, part 2 — cascade.** Does deleting a patient delete their media?

| | |
|---|---|
| Part 1 | ____________ (state the period, or "indefinite") |
| Part 2 | yes / no / retain as orphan deliberately |

**Decision impact.** Controls the entry added to the hand-written cascade in
`PatientService.deletePatient` (§ **C6** — the method is class-level `@Transactional`, so an
added line commits atomically, but there is no JPA cascade so it must be added explicitly),
whether any expiry job exists, and whether media is included in the existing backup/restore
flow. Per **C1** the media bytes live outside the database, so backup inclusion is a separate
decision from the retention period.

**Stakeholder answer, part 1:**

> _______________________________________________

**Stakeholder answer, part 2:**

> _______________________________________________

---

### D7 — Association scope *(asked only if D1 = Option B)*

**Question.** Is media **patient-scoped only**, or **patient- and appointment-scoped**?

| | |
|---|---|
| Patient only | — |
| Patient + appointment | — |

**Decision impact.** Controls the association column or columns, and whether media inherits
appointment visibility semantics. The legacy gallery is patient-scoped only, so appointment
scoping would be new scope with no existing behaviour to inherit.

**Stakeholder answer:**

> _______________________________________________

---

### D8 — Tombstones *(asked only if D1 = Option B)*

**Question.** Are media **tombstones** required, so desktop clients can purge media deleted
elsewhere?

| | |
|---|---|
| Yes | — |
| No | — |

**Decision impact.** Controls whether a tombstone table mirroring the existing
`DeletedPatient` is created, and whether a client sync contract for media deletion is needed.
`DeletedPatient` exists precisely because patient deletion is a hard delete that desktop
clients cannot otherwise observe. Whether clients cache media at all is not established, so
the codebase does not determine this.

**Stakeholder answer:**

> _______________________________________________

---

### D9 — Audit logging and resource identification *(asked only if D1 = Option B)*

**Question, part 1 — is access logged?** Must media uploads, views and deletions be
audit-logged?

**Question, part 2 — queryability.** Must the audit trail be queryable by patient, which would
require the audit record to identify the media resource?

| | |
|---|---|
| Part 1 | yes / no |
| Part 2 | yes (schema change) / no (free-text details acceptable) |

**Decision impact.** Controls whether audit events are emitted, and whether `AuditEvent` gains
a resource/target field. The existing `AuditEvent` has nine fields and **no** resource
identifier, so a media event recorded today is not queryable or joinable. Part 2 selecting
"schema change" implies a Clinic Server migration, which is in scope only once answered.
`PatientController` currently emits no audit events at all.

**Stakeholder answer, part 1:**

> _______________________________________________

**Stakeholder answer, part 2:**

> _______________________________________________

---

### D10 — TLS guarantee *(asked only if D1 = Option B)*

**Question.** Is TLS guaranteed **before any media upload is enabled**? If so, how is that
guarantee enforced — deployment-only, or checked in code so the upload path refuses to run
without it?

| | |
|---|---|
| Deployment-only | — |
| Enforced in code | — |
| Other | — |

**Decision impact.** Controls whether the upload path may be enabled at all, and whether a
runtime precondition is implemented. Per **C5** the server ships
`server.ssl.enabled=false` on `server.address=0.0.0.0`; enabling media upload over cleartext
is therefore not an available option, and the remaining choice is **how** TLS is guaranteed
rather than whether.

**Stakeholder answer:**

> _______________________________________________

---

### D11 — Legacy defect disposition *(asked only if D1 = Option A)*

**Question.** For each legacy media defect M1–M14 listed in §B1.1, is it **fixed** or
**deliberately accepted**? An accepted defect requires a recorded reason.

| ID | Defect (abbreviated) | Fixed or accepted | Reason if accepted |
|---|---|---|---|
| M1 | Folder keyed on a machine-local SQLite id | ____ | ____ |
| M2 | Folder name embeds the patient name | ____ | ____ |
| M3 | `sanitizeFileName` strips non-Latin characters | ____ | ____ |
| M4 | `mkdirs()` return values ignored | ____ | ____ |
| M5 | `*.*` filter defeats the extension list | ____ | ____ |
| M6 | No size cap, quota or count limit | ____ | ____ |
| M7 | Extension whitelist narrower than reality | ____ | ____ |
| M8 | Copy on the UI thread, no progress or cancel | ____ | ____ |
| M9 | Result dialog always styled as success | ____ | ____ |
| M10 | `MediaPlayer` never disposed | ____ | ____ |
| M11 | Non-transitive, overflow-prone comparator | ____ | ____ |
| M12 | Synchronous directory scan per repaint | ____ | ____ |
| M13 | No EXIF orientation handling | ____ | ____ |
| M14 | No video thumbnails | ____ | ____ |

**Decision impact.** Controls the scope of the Option A client implementation, and which
inherited behaviours are reproduced on purpose. M1 and M5 are the two that cause silent data
loss rather than inconvenience, and §B1.6 measured both consequences directly (all 102
`Images`/`Videos` directories in the legacy tree are empty, and the gallery was never opened
on the machine inspected).

**Stakeholder answer:** the table above, completed in place.

---

## Required operational information

These are not decisions. They are facts about the clinic's operation that the implementation
cannot proceed without, and none can be derived from code or from a filesystem.

### I2 — Production media volume and image/video mix

**Question.** What is the expected production volume, and is the mix **image-only** or
**image and video**? Roughly how many patients accumulate media, and at what rate?

**Decision impact.** Controls the multipart size limits that must be set deliberately
(**C2** — the 1 MB default rejects any photo today), the storage sizing, whether media must
be streamed rather than buffered, and the failure/retry contract for large transfers. Video
dominates every cost and risk in these areas.

**Stakeholder answer:**

> _______________________________________________

---

### I3 — Legal or clinical retention obligation

**Question.** Is there any legal, regulatory or clinical retention obligation that applies to
patient media — for example a minimum retention period, or a prohibition on deleting imagery
before a retention window expires?

**Decision impact.** Controls whether a retention period can be chosen at all (D6), whether
patient deletion must be blocked or must purge media, and whether an expiry job may exist.
Nothing of the kind is encoded anywhere in the system, and it must not be guessed.

**Stakeholder answer:**

> _______________________________________________

---

### I4 — Audit queryability by patient

**Question.** Must the audit trail be queryable **by patient** — for example, to answer "who
viewed this patient's photographs"?

**Decision impact.** Determines whether D9 part 2 can be answered as free-text, or whether the
audit schema must gain a resource identifier. A "yes" implies a Clinic Server migration and
changes the compliance posture; a "no" keeps the change out of scope.

**Stakeholder answer:**

> _______________________________________________

---

### I5 — Deployment TLS posture

**Question.** How is TLS provided in the clinic's deployment — a TLS-terminating reverse proxy
in front of the Clinic Server, or `SSL_ENABLED=true` with a keystore on the server itself? Is
it already in place today?

**Decision impact.** Controls the TLS precondition in D10 and whether it can be a deployment
assumption or must be checked in code. Per **C5** the application itself does not provide
transport protection by default.

**Stakeholder answer:**

> _______________________________________________

---

### I6 — Migration of existing production media

**Question.** Does the clinic hold media today that must be carried into the Tauri client? If
so, how much, and is migration in scope? Is starting empty acceptable?

**Decision impact.** Controls whether a migration path is required at all, and if so what it
must resolve. The read-only inventory in §B1.6 found **zero** patient media on the machine
inspected and therefore establishes nothing about the clinic's machines; a migration would
also have to resolve the local-id keying defect M1, because legacy media folders are keyed on
a machine-local SQLite identifier rather than the server patient id.

**Stakeholder answer:**

> _______________________________________________

---

## Approval rule

> **An approved B1 specification exists only when D1–D11 and required I2–I6 information have
> explicit stakeholder values. The current decision register is not itself an approved
> specification.**

Applied to the current state:

| Layer | State |
|---|---|
| **C1–C6** | Verified technical constraints. Not questions. Not answerable here. |
| **D1–D11** | **Unanswered — 0 of 11.** Every field above is blank. |
| **I2–I6** | **Missing.** None can be derived from code or disk. |

A blank field is a valid, expected state. It must not be filled by inference, by majority
assumption, by analogy with another data class, or by the absence of contrary evidence.

**No implementation task is created by this section.** Endpoint, table, entity, migration,
multipart, storage, authorization, client and migration work all begin only from the approved
specification that these answers produce.

```text
B1      = BLOCKED — DECISION_REQUIRED
Overall = NOT_READY
```

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

## 4c. B1 — `DECISION_REQUIRED`

Full analysis is in the **B1 section at the top of this document**: current JavaFX media
behaviour with file/line evidence, Option B requirements R1–R8, the authorization matrix,
an Option A/B comparison, and the **decision register** in §B1.5.

**Register state: 0 of 11 decisions answered** (D1–D11 all outstanding). Six technical
constraints (C1–C6) are settled and bound the answers. Gate:
`B1 = BLOCKED — DECISION_REQUIRED`, `Overall = NOT_READY`.

Not implemented; no endpoint, table, entity, migration, multipart setting, storage layer,
authorization rule, client change or media migration created. `Clinic Server` untouched.

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

### `NOT_READY — B1 patient media (DECISION_REQUIRED)`

B2 and B3 are closed. **0 of 11 B1 decisions have been answered.** One decision stands between
this and `READY_TO_RETIRE_JAVA_FX`, and nine more follow it if Option B is chosen.

**The decision register is §B1.5.** It records all eleven as **UNANSWERED**, the six settled
technical constraints (C1–C6) that bound the answers, the outstanding questions including the
information that must be supplied alongside them, and the implementation prerequisites for
each option. No value has been assumed or defaulted.

The recommendation recorded earlier stands — **Option B**, conditional on D2–D5 — but a
recommendation is not a decision and nothing has been approved. Two settled constraints sharpen
it: **C4**, `checkOwnership` fails open for `createdBy == null`, which is exactly the
community-booking case, so unmodified reuse would make that media world-readable; and **C5**,
the server ships `server.ssl.enabled=false` on `0.0.0.0`, so upload cannot be enabled over an
unprotected transport.

**Option A** remains legitimate and cheap if the clinic genuinely runs a single front-desk PC —
but it requires an explicit D11 disposition for each of the fourteen inherited defects, and
M1 (folder keyed on a machine-local SQLite id) and M5 (`*.*` filter) should not be accepted
without a deliberate decision.

Nothing else blocks retirement. Every other workflow is REPLACED, and 15 of those are
**strictly better** than the legacy implementation — most notably signed updates, live SSE
notifications, Arabic-capable PDFs, real role-based authorization, and correct appointment
cancellation.

**The JavaFX applications must not be retired until B1 is decided and, if Option B, shipped
and verified.** They remain the only working home for patient media today.
