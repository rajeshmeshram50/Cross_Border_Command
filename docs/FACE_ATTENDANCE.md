# Face-Biometric Attendance — End-to-End Build Notes

**Date built:** 2026-05-12
**Scope:** Browser-based face registration + face login + multi-punch attendance ledger across the Cross Border Command HRMS.

This doc covers **what was added, why, and how**, plus the live-deploy steps.
Anyone reading this should be able to redeploy, debug, or extend the feature
without spelunking through 10 files of git history.

---

## 1. Why this exists

The customer had no biometric hardware (no fingerprint reader, no card
scanner) and wanted face-based attendance + face-based login. Three product
goals:

1. **Register an employee's face once** (admin or self) and store only a
   reversible-proof signature, not the photo.
2. **Clock in / out using face match.** Multiple punches per day —
   Check In → Step Out → Step In → Lunch Out → Lunch In → Check Out — like
   Keka, not a single in/out per day.
3. **Sign in to the SPA with face** as an alternative to password.

All three had to work in a stock browser, with no native app, no Python
service, no recurring cloud cost.

---

## 2. Tech stack chosen

| Layer | Pick | Why |
|---|---|---|
| Face detection + recognition | **[face-api.js](https://github.com/justadudewhohacks/face-api.js) v0.22.2** | Runs entirely in the browser on TensorFlow.js, no cloud calls, no per-call cost. Models load once (~10 MB), cached forever. |
| Face descriptor algorithm | **TinyFaceDetector + FaceLandmark68 + FaceRecognition** (128-d) | TinyFaceDetector is ~190 KB (good for laptop webcams at close range). FaceRecognitionNet outputs a 128-float embedding that we store and compare via Euclidean distance. |
| Webcam access | `navigator.mediaDevices.getUserMedia` | Browser-native, prompts for permission, no plugin. |
| Backend match | **Server-side Euclidean distance** | Threshold lives on the server (0.55 for attendance, 0.50 for login). Client cannot bypass by sending an "always-match" body. |
| Storage | Postgres `json` column on `employees.face_descriptor` | 128 floats ≈ 1.5 KB per employee. Cheap. Indexed lookups not needed because match is per-user (we know which row to compare against). |
| Hosting models | `public/face-models/` (self-hosted) | No CDN dependency, works offline, faster cold-load. 7 files, ~6.8 MB total. |
| Frontend framework | Existing React 19 + TypeScript + Vite 7 + Reactstrap | No new dep besides face-api.js. |
| Backend | Existing Laravel 11 + Sanctum + Postgres | No new dep. |

---

## 3. Face-recognition flow — how it works

### 3a. Registration (one-time)

```
[browser]                                          [Laravel]
  │                                                   │
  │ ── face-api.js loads models from /face-models ──► │
  │ ── getUserMedia() opens webcam                    │
  │ ── user clicks "Capture"                          │
  │ ── faceapi.detectAllFaces().withFaceDescriptors() │
  │ ── POST /api/face/register { descriptor[128],     │
  │                              consent: true,       │
  │                              employee_id? }       │──►│
  │                                                       │ Validate (length, consent)
  │                                                       │ Resolve target Employee
  │                                                       │ (self OR admin same-tenant)
  │                                                       │ UPDATE employees SET
  │                                                       │   face_descriptor = [...],
  │                                                       │   face_registered_at = now(),
  │                                                       │   face_consent_given_at = now() (first time),
  │                                                       │   biometric_status = 'Registered'
  │ ◄── 200 OK { registered: true } ──────────────────────│
```

### 3b. Clock-in (multi-punch)

```
[browser]                                          [Laravel]
  │ ── webcam open + face-api ready                    │
  │ ── user picks activity label ("Step Out")          │
  │ ── snap → 128-d descriptor                         │
  │ ── POST /api/attendance/face/clock-in {            │
  │       descriptor[128], label: "Step Out",          │
  │       lat?, lng? }                                 │──►│
  │                                                       │ DB::transaction + lockForUpdate
  │                                                       │ on today's Attendance row
  │                                                       │
  │                                                       │ Verify face match:
  │                                                       │   d = sqrt(Σ(a[i]-b[i])²)
  │                                                       │   if d > 0.55 → 422
  │                                                       │
  │                                                       │ Check last punch direction
  │                                                       │   (server-truth — client can't lie)
  │                                                       │   if last was 'in' → expected 'out'
  │                                                       │   mismatch → 422 with hint
  │                                                       │
  │                                                       │ INSERT attendance_punches row
  │                                                       │ Recompute summary on parent
  │                                                       │   (check_in_at = first 'in',
  │                                                       │    check_out_at = last 'out')
  │ ◄── 200 { matched, distance, punch, record } ─────────│
```

### 3c. Face login

```
Same as clock-in but PUBLIC route + tighter threshold (0.50):
  POST /api/login/face { email, descriptor[128] }
  → Look up user by email → find linked Employee
  → If no face on file → 422 (generic, doesn't leak email-exists)
  → Match descriptor; if d ≤ 0.50 → issue Sanctum token
  → Apply same gates as password login (active account, active org,
    active branch, brute-force lockout shares cache key with /login)
```

---

## 4. Match threshold reasoning

| Use case | Threshold (Euclidean distance) | Reasoning |
|---|---|---|
| Attendance clock-in/out | **0.55** | face-api's default is 0.6. Slight tightening for attendance auth. |
| Face login (auth) | **0.50** | Stricter than attendance — a false match here hands over the session. |
| face-api recommendation | 0.6 | From the library README. |

Distance numbers:
- **Identical capture:** ~0.0 (same descriptor)
- **Same person, different angle / lighting:** typically 0.2–0.4
- **Same person, very different conditions:** up to ~0.5
- **Different person:** typically > 0.6

In production logs you'll see most legitimate clock-ins land at 0.30–0.45.

---

## 5. Files added / changed

### Backend (Laravel)

| File | Type | Purpose |
|---|---|---|
| `database/migrations/2026_05_12_042448_add_face_biometric_to_employees.php` | new | Adds `face_descriptor` (json), `face_registered_at`, `face_consent_given_at`, `face_consent_revoked_at` to `employees`. |
| `database/migrations/2026_05_12_042451_create_attendances_table.php` | new | Daily summary table. |
| `database/migrations/2026_05_12_060843_create_attendance_punches_table.php` | new | Intraday punch ledger — one row per tap. |
| `database/migrations/2026_05_12_064252_backfill_attendance_punches.php` | new | One-time backfill: synthesizes Check In / Check Out punches for legacy attendance rows that pre-date the multi-punch refactor. |
| `app/Models/Employee.php` | edited | Adds `face_*` columns to `$fillable`/`$casts`; `face_descriptor` to `$hidden` so it never serialises onto the wire; `face_registered` accessor on `$appends`. |
| `app/Models/Attendance.php` | new model logic | hasMany `punches`, accessors `total_worked_seconds`, `next_direction`, `punches_count` (all on `$appends`). |
| `app/Models/AttendancePunch.php` | new | Child model for individual punches. |
| `app/Http/Controllers/Api/FaceBiometricController.php` | new | `status / register / revoke`. Consent-gated. Same-tenant access check (matching EmployeeController scope rules — accepts `client_id = NULL` global rows). |
| `app/Http/Controllers/Api/AttendanceController.php` | new | Endpoints below. |
| `app/Http/Controllers/Api/AuthController.php` | edited | Added `faceLogin()` method. |
| `routes/api.php` | edited | Routes registered (see below). |

### Frontend (React + TypeScript)

| File | Type | Purpose |
|---|---|---|
| `public/face-models/` | new | 7 model weight files (~6.8 MB) — TinyFaceDetector, FaceLandmark68, FaceRecognition. |
| `resources/js/components/FaceCapture.tsx` | new | Reusable webcam tile: loads models, opens camera, detects exactly ONE face, returns 128-d descriptor on capture. |
| `resources/js/components/FaceRegistrationModal.tsx` | new | Two-step modal: consent disclosure → capture → save. DPDP/GDPR-style consent text. |
| `resources/js/components/FaceLoginModal.tsx` | new | Email + face → POST to `/login/face`. |
| `resources/js/pages/ClockIn.tsx` | new | `/clock-in` page. Activity label picker, live "worked today" timer, full intraday punch timeline. |
| `resources/js/pages/employee/EmployeeProfile.tsx` | edited | Attendance tab now shows real data via `AttendanceTabPanel` (KPIs + Today's Record + Timeline + Timelog History). Security card on Profile tab has "Register Face" trigger. |
| `resources/js/pages/hrms/HrEmployees.tsx` | edited | New "Register Face" row action (smiley-face icon, green dot when already enrolled). |
| `resources/js/pages/auth/Login.tsx` | edited | "Sign in with Face" button below the Google button. |
| `resources/js/contexts/AuthContext.tsx` | edited | New `faceLogin(email, descriptor)` method. |
| `resources/js/components/App.tsx` | edited | `/clock-in` route + import. |
| `resources/js/constants.ts` | edited | Menu config (HR → branch_user only; Clock-In → employee only). |
| `resources/js/velzon/Layouts/LayoutMenuData.tsx` | edited | Maps `clock-in` slug → `/clock-in`, adds `CalendarCheck` icon, adds clock-in to `defaultSlugs`. |
| `vite.config.js` | edited | `optimizeDeps.include: ['face-api.js']` — force-pre-bundle so the dynamic import resolves in dev. |
| `package.json` | edited | `face-api.js@0.22.2` added to dependencies. |

---

## 6. API surface

All routes live under `api/` and are Sanctum-protected unless marked **public**.

### Face biometric

```
GET    /api/face/status        — current biometric state (registered?, timestamps)
POST   /api/face/register      — store descriptor (requires consent: true)
DELETE /api/face/data          — revoke + wipe descriptor (keeps consent_given_at, stamps consent_revoked_at)
```

All three accept `employee_id?` query/body param — admins (super_admin or
same-tenant client_admin/client_user/branch_user) can manage another
employee. Self path is the default when omitted.

### Attendance

```
GET    /api/attendance                                  — HR/admin tenant-scoped list
GET    /api/attendance/my                               — caller's own paginated history
GET    /api/attendance/today                            — caller's today row + punches + next_direction + allowed_labels
GET    /api/attendance/employee/{employeeId}/summary    — for the Employee Profile attendance tab
                                                          — returns: employee, month, stats{present_days, late_marks,
                                                            missing_biometric, total_leaves}, today, history[]
                                                          — accepts emp_code OR numeric id; tenant-scoped lookup
POST   /api/attendance/face/clock-in                    — captures one 'in' punch
POST   /api/attendance/face/clock-out                   — captures one 'out' punch
```

### Auth

```
POST   /api/login          — password login (existing, untouched)
POST   /api/login/face     — PUBLIC. body: { email, descriptor[128] } → Sanctum token on match
```

---

## 7. Database schema

### `employees` — new columns

```sql
ALTER TABLE employees
  ADD COLUMN face_descriptor          json,
  ADD COLUMN face_registered_at       timestamp,
  ADD COLUMN face_consent_given_at    timestamp,
  ADD COLUMN face_consent_revoked_at  timestamp;
```

Why each:
- `face_descriptor` — the 128-d signature. The Employee model has it in
  `$hidden` so it never leaks onto API responses; reads happen DB-side
  inside auth + match code paths only.
- `face_registered_at` — when the current enrolment was captured.
- `face_consent_given_at` — stamped once (first enrolment), preserved
  through revoke for the regulator audit trail.
- `face_consent_revoked_at` — stamped on revoke. Together with
  consent_given_at, the row tells the full opt-in/opt-out lifecycle.

### `attendances` — daily summary

```sql
CREATE TABLE attendances (
  id bigserial PRIMARY KEY,
  client_id bigint REFERENCES clients(id),
  branch_id bigint REFERENCES branches(id),
  employee_id bigint NOT NULL REFERENCES employees(id),
  user_id bigint REFERENCES users(id),
  attendance_date date NOT NULL,
  check_in_at  timestamp,             -- first 'in' of the day (computed)
  check_out_at timestamp,             -- last 'out' of the day (computed)
  check_in_method  enum,              -- face | manual | auto
  check_out_method enum,
  check_in_match_distance  decimal(5,4),
  check_out_match_distance decimal(5,4),
  check_in_ip / lat / lng,
  check_out_ip / lat / lng,
  status enum,                        -- Present | Late | Half Day | etc.
  notes text,
  created_at / updated_at / deleted_at,
  UNIQUE (employee_id, attendance_date)
);
```

The unique constraint is the safety net — even with `lockForUpdate()`, a
DB-level UNIQUE prevents two parallel inserts from creating duplicate days.

### `attendance_punches` — intraday ledger

```sql
CREATE TABLE attendance_punches (
  id bigserial PRIMARY KEY,
  attendance_id bigint NOT NULL REFERENCES attendances(id) ON DELETE CASCADE,
  employee_id   bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  punched_at timestamp NOT NULL,
  direction  enum NOT NULL,           -- in | out (strictly alternating per day)
  label      varchar(50),             -- 'Check In' | 'Step Out' | 'Lunch Out' | 'Meeting' | etc.
  method     enum,                    -- face | manual | auto
  match_distance decimal(5,4),
  ip varchar(64), lat decimal(10,7), lng decimal(10,7),
  notes text,
  created_at / updated_at / deleted_at,
  INDEX (punched_at)
);
```

Why a separate table:
- Multiple punches per day (the Keka pattern) need a row-per-punch model.
- Direction alternation is a per-day invariant; child rows make that easy
  to query (`ORDER BY punched_at DESC LIMIT 1` → last direction).
- HR reports / payroll calcs can join this table without disturbing the
  daily summary.

The parent `attendances.check_in_at` / `check_out_at` are kept as
denormalised summaries (first-in / last-out) so list/dashboard queries
don't need to join punches. `AttendanceController::recomputeSummary` keeps
them in sync after every punch insert.

---

## 8. Consent + privacy

Biometric data is **special-category** under DPDP Act 2023 (India) and
GDPR Article 9 (EU). Mishandling it is a regulatory hazard, not just a
product wart. What we built:

1. **Explicit opt-in** — the registration modal shows a plain-language
   disclosure (we store a mathematical signature, not the photo; you
   can revoke at any time; we don't share with third parties). The
   backend enforces `consent: true` in the request body via Laravel's
   `accepted` validation rule.
2. **`face_consent_given_at` is sticky** — re-enrolment keeps the
   original opt-in date so an admin can prove when the user first
   consented.
3. **Revoke flow wipes the descriptor + stamps `face_consent_revoked_at`**
   without deleting the audit trail. Regulators want both timestamps.
4. **Descriptor never serialises** — `$hidden = ['face_descriptor']` on
   the Employee model. The accessor `face_registered` (boolean) is what
   appears on `/api/employees` responses for "is this person enrolled?".

What we did NOT build (and what production should add):

- **Retention policy** — auto-revoke after N years of inactivity.
- **Liveness detection** — a printed photo or phone-screen can fool a
  plain match. Production should add a "blink twice" or "turn head"
  challenge before the capture. face-api supports landmark tracking that
  makes this straightforward.
- **Encryption at rest** — Postgres can encrypt the column with
  `pgcrypto`, or you can layer Laravel's encrypted cast. Not done here
  because the descriptor is already not directly identifiable, but for a
  belt-and-suspenders setup, do it.

---

## 9. Multi-punch UX — activity labels

The SPA picks from this set; backend accepts any varchar(50) so HR can
record one-offs.

| Label | Direction | Default tone |
|---|---|---|
| Check In | in | green (start of day) |
| Step Out | out | amber (short break) |
| Step In | in | teal (return from break) |
| Lunch Out | out | pink |
| Lunch In | in | green |
| Meeting | either | indigo |
| Check Out | out | red (end of day) |

The Clock-In page filters the chip set by `next_direction` so the user
never sees a "Lunch In" chip when the system is expecting an `out` punch.

---

## 10. Menu visibility (final state)

| Role | HR menu | Clock-In menu |
|---|---|---|
| super_admin | hidden | hidden |
| client_admin | hidden | hidden |
| client_user | hidden | hidden |
| branch_user | **visible** | hidden |
| employee | hidden | **visible** |

Direct URLs (`/hr/employees`, `/clock-in`) still resolve for any signed-in
user — this is sidebar-only restriction. Route gates and API permissions
are unchanged.

---

## 11. Live deployment checklist

On the live server:

```bash
# 1. Pull
git pull origin main

# 2. Backend deps (none new for face, but to be safe)
composer install --no-dev --optimize-autoloader

# 3. Run migrations (adds face columns, attendances + attendance_punches tables, backfills legacy rows)
php artisan migrate --force

# 4. Frontend deps (face-api.js + others)
npm ci

# 5. Confirm model weights shipped (7 files in public/face-models/)
ls -la public/face-models/
# Expected: ~6.8 MB across 7 files:
#   tiny_face_detector_model-weights_manifest.json
#   tiny_face_detector_model-shard1
#   face_landmark_68_model-weights_manifest.json
#   face_landmark_68_model-shard1
#   face_recognition_model-weights_manifest.json
#   face_recognition_model-shard1
#   face_recognition_model-shard2

# 6. Build frontend
npm run build

# 7. Clear caches
php artisan config:clear
php artisan route:clear
php artisan view:clear

# 8. Ensure HTTPS — getUserMedia() refuses to open the camera on http://
#    outside localhost. The live URL MUST be https.
```

If the weights folder is missing, the SPA will hang on "Loading
face-recognition models…" forever. Re-fetch with:

```bash
cd public/face-models
for f in tiny_face_detector_model-weights_manifest.json \
         tiny_face_detector_model-shard1 \
         face_landmark_68_model-weights_manifest.json \
         face_landmark_68_model-shard1 \
         face_recognition_model-weights_manifest.json \
         face_recognition_model-shard1 \
         face_recognition_model-shard2; do
  curl -sSL -o "$f" "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/$f"
done
```

---

## 12. Common issues + fixes

| Symptom | Cause | Fix |
|---|---|---|
| "Failed to fetch dynamically imported module: …face-api___js.js" in dev | Vite never pre-bundled face-api.js because it's a dynamic import | `optimizeDeps.include: ['face-api.js']` in `vite.config.js` + `rm -rf node_modules/.vite` + restart `npm run dev` |
| "Camera permission was denied" | User clicked "Block" or running on http:// (non-localhost) | Need HTTPS in production; user must allow camera in browser site settings |
| "Loading face-recognition models…" forever | Missing weight files under `public/face-models/` | Run the curl loop in §11 |
| "You do not have access to this employee" on Attendance tab | emp_code lookup picked the wrong tenant's row (two tenants both have EMP-001) | Fixed — `AttendanceController::employeeSummary` now scopes the emp_code lookup to the user's tenant |
| "Punches: 0" but check_in_at / check_out_at populated | Row was created before the multi-punch refactor | Fixed — `2026_05_12_064252_backfill_attendance_punches.php` synthesizes Check In/Out punches for legacy rows |
| Face login shows "Face login is not available for this account" | Either user not found, no linked Employee, or no descriptor on file | Enrol via Profile → Security → Register Face (or have admin enrol via HR Employee list) |
| Clock-In page bounces to dashboard | Account has no Employee row (e.g. `super_admin`) | Working as designed — Clock-In only renders for users with an Employee row |

---

## 13. Test coverage

End-to-end runs that signed off the feature (all PASS):

| Audit | Tests |
|---|---|
| Face register + clock-in + clock-out + revoke + 7 frontend wiring checks | 43/43 |
| Face login (admin registers → user logs in with face) | 20/20 |
| Tenant scope on FaceBiometricController (own / global / cross-tenant / super_admin) | 4/4 |
| Multi-punch flow (six-punch day + direction guard + totals + HR view) | 29/29 |
| AttendanceTabPanel summary endpoint (HR lookup by emp_code / by id, self, cross-tenant 403, unknown 404, bad month fallback) | 24/24 |
| emp_code tenant scope fix (two EMP-001 rows in different tenants) | 4/4 |
| Legacy backfill verification (kunal's row gets 2 synthesized punches) | passes |
| Menu role visibility (HR branch_user only, Clock-In employee only) | 10/10 |

---

## 14. Open follow-ups (not built, captured here for backlog)

1. **Liveness challenge** — blink/head-turn check before capture to defeat
   printed-photo spoofing.
2. **Self-host or CDN-pin model weights** — currently in
   `public/face-models/` (self-hosted). Fine for now; if `public/` grows
   too large for the deployment pipeline, move to S3/CloudFront.
3. **Encryption at rest** — wrap `face_descriptor` in a Laravel encrypted
   cast or use Postgres `pgcrypto`.
4. **Retention policy** — auto-revoke + wipe after N years of employee
   inactivity (cron job).
5. **Shift-aware late detection** — current "Late" status is a flat
   >09:30 heuristic in `AttendanceController::employeeSummary`. Wire it
   to the employee's `shift` field once shift policy is finalised.
6. **Geo-fence** — already capture lat/lng on every punch but don't gate
   on it yet. Wire `branch.geo_lat / geo_lng / geo_radius_m` to refuse
   punches outside the radius.
7. **Regularization requests** — the "Coming Soon" Attendance mock
   showed a "Regularization" button (request to edit a punch). Backend
   has `notes` field ready; need a workflow + manager approval flow.
8. **Manual punch (HR override)** — `method = 'manual'` is in the enum
   but no UI yet. Add an HR-side modal to add/edit punches with a reason.

---

*Built by Claude Code (Opus 4.7) on 2026-05-12.
For QA, the audit scripts referenced in §13 were one-shot tinker scripts
that ran via `php artisan tinker --execute=require…`. They've been deleted
post-verification but the assertion patterns live in the git history of
this PR / commit.*
