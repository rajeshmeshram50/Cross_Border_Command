# HRMS Biometric Integration — Master Documentation

**Product:** Cross_Border_Command (CBC) — HRMS module
**Scope:** Every biometric attendance and biometric authentication capability in the product — browser face recognition (registration, clock-in/out, face login) **and** eSSL / ZKTeco fingerprint terminal integration (file import, LAN connector, live ADMS push).
**Consolidates:** `FACE_ATTENDANCE.md`, `FACE_FRONTEND_SETUP.md`, `ESSL_ATTENDANCE_INTEGRATION.md`, `ESSL_GO_LIVE_CHECKLIST.md`
**Audience:** Developers, QA, DevOps, HR super-users
**Document date:** 2026-09-04

---

## Table of contents

| Part | Contents |
|---|---|
| **A** | Overview — the two biometric systems and how they coexist |
| **B** | Face biometric — architecture, flows, thresholds, API, consent, files |
| **C** | Face biometric — frontend setup, model weights, build and deploy |
| **D** | eSSL device integration — modes, device settings, ingest pipeline, build ledger |
| **E** | Data model, API contracts and downstream impact (payroll) |
| **F** | Go-live checklist, security decisions and rollback |
| **G** | QA — test matrices, error decoder, bug-report template |
| **H** | Glossary, key code locations, open follow-ups |

---

# PART A — Overview

## A1. What "biometric attendance" means in this product

CBC supports **two independent biometric channels**. Both write into the *same* attendance ledger and both render as a **BIOMETRIC** source badge on the HR sheet.

| | **Webcam Face** (built 2026-05-12) | **eSSL Fingerprint device** (built 2026-07-27) |
|---|---|---|
| Where it runs | Any browser, self-service (`/clock-in`) | Fixed terminal at the office door |
| Matching happens | **Server-side** in Laravel (Euclidean distance on a 128-float descriptor) | **On the device** — the fingerprint template never leaves the terminal |
| Identifies the person by | The logged-in user (`user_id` → `employee_id`) | Device **User ID** → `employees.attendance_number` |
| What the app receives | 128-float descriptor + optional GPS + IP | User ID + timestamp + In/Out status code |
| Punch `method` value | `face` | `device` |
| Enrollment | In-app "Register Face" modal (consent-gated) | Fingerprint enrolled **on the terminal** |
| Who is expected to use it | Anyone with a webcam and a face on file | Employees whose `time_tracking = Biometric` |
| Hardware cost | None | eSSL / ZKTeco terminal |

> **They are not alternatives — they run side by side.** The same employee, on the same day, can have a face punch and a device punch; both land in one strictly alternating timeline. Policy is a per-branch choice: *device-primary with face as fallback*, or split per employee using the `time_tracking` flag.

## A2. The single shared pipeline

Whichever channel a punch arrives from, it travels an identical path:

```
Face capture  ──┐
                ├──►  AttendancePunchService  ──►  attendance_punches (method = face | device)
Device punch  ──┘        (resolve day, next direction,
                          append punch, recomputeSummary)
                                     │
                                     ▼
                          attendances  (check_in_at  = first 'in',
                                        check_out_at = last  'out')
                                     │
                                     ▼
                    HR Attendance daily view  (resolveDayStatus →
                                     Present / Late / Missing Out / Absent)
                                     │
                                     ▼
                    Payroll → finalize-attendance → Payslip
                        (paid_days, missing_punches, late-mark LOP)
```

**Consequence:** biometric correctness is a **payroll-grade** requirement, not a display concern. A wrong timezone conversion or a broken alternation directly changes what an employee is paid.

## A3. The one rule the device integration depends on

> **eSSL device User ID / Enrollment No. = `employees.attendance_number` in CBC.**

If employee "Ravi" is `101` in the app, he must be enrolled as User `101` on the terminal. Everything else in Part D is plumbing around this single mapping.

---

# PART B — Face biometric (browser)

## B1. Why it exists

The customer had **no biometric hardware** — no fingerprint reader, no card scanner — and wanted face-based attendance plus face-based login. Three product goals:

1. **Register an employee's face once** (by the employee or by an admin), storing only a mathematical signature — never the photo.
2. **Clock in / out by face with multiple punches per day** — Check In → Step Out → Step In → Lunch Out → Lunch In → Check Out (the Keka pattern), not one in/out per day.
3. **Sign in to the SPA with a face** as an alternative to a password.

All three had to work in a stock browser: no native app, no Python service, no recurring cloud cost.

## B2. Technology choices and rationale

| Layer | Pick | Why |
|---|---|---|
| Detection + recognition | **face-api.js v0.22.2** | Runs entirely in-browser on TensorFlow.js. No cloud calls, no per-call cost. Models load once and cache. |
| Model set | TinyFaceDetector + FaceLandmark68 + FaceRecognition (128-d) | TinyFaceDetector is only ~190 KB — right for laptop webcams at close range. FaceRecognitionNet emits a 128-float embedding compared by Euclidean distance. |
| Camera | `navigator.mediaDevices.getUserMedia` | Browser-native, permission-prompted, no plugin. |
| Matching | **Server-side** Euclidean distance | The threshold lives on the server, so a tampered client cannot send an "always match" body. |
| Storage | Postgres `json` column `employees.face_descriptor` | 128 floats ≈ 1.5 KB per employee. No index needed — the match is always against one known row. |
| Model hosting | `public/face-models/` (self-hosted, 7 files ≈ 6.8 MB) | No CDN dependency, works offline, faster cold load. |
| Frontend | Existing React 19 + TypeScript + Vite 7 + reactstrap | Only one new dependency in the entire feature. |
| Backend | Existing Laravel + Sanctum + Postgres | No new backend dependency. |

## B3. Flow 1 — Face registration (one time per employee)

```
[browser]                                          [Laravel]
  │ face-api.js loads models from /face-models
  │ getUserMedia() opens the webcam
  │ user clicks "Capture"
  │ faceapi.detectAllFaces().withFaceDescriptors()
  │ POST /api/face/register { descriptor[128], consent: true, employee_id? }  ──►
  │                                                  Validate (length 128, consent accepted)
  │                                                  Resolve the target Employee
  │                                                    (self, OR an admin in the same tenant)
  │                                                  UPDATE employees SET
  │                                                    face_descriptor       = [...],
  │                                                    face_registered_at    = now(),
  │                                                    face_consent_given_at = now()  (first time only),
  │                                                    biometric_status      = 'Registered'
  │ ◄── 200 { registered: true }
```

**Access rule:** `employee_id` is optional. Omitted = enroll yourself. Supplied = an admin (super_admin, or a same-tenant client_admin / client_user / branch_user) enrolls somebody else. Cross-tenant enrollment is refused.

## B4. Flow 2 — Face clock-in / clock-out (multi-punch)

```
[browser]                                          [Laravel]
  │ webcam open, face-api ready
  │ user picks an activity label ("Step Out")
  │ snap → 128-d descriptor
  │ POST /api/attendance/face/clock-in { descriptor[128], label, lat?, lng? }  ──►
  │                                                  DB::transaction + lockForUpdate on
  │                                                    today's attendances row
  │
  │                                                  FACE MATCH
  │                                                    d = sqrt(Σ (a[i] − b[i])²)
  │                                                    if d > 0.55 → 422
  │
  │                                                  DIRECTION GUARD (server truth)
  │                                                    read the last punch of the day
  │                                                    last was 'in' → this must be 'out'
  │                                                    mismatch → 422 with a hint
  │
  │                                                  INSERT attendance_punches
  │                                                  recomputeSummary() on the parent row
  │                                                    check_in_at  = first 'in'
  │                                                    check_out_at = last  'out'
  │ ◄── 200 { matched, distance, punch, record }
```

The client **cannot** choose the direction — the server derives it from the last stored punch. That is what makes the alternation invariant trustworthy.

## B5. Flow 3 — Face login

Same match mechanics, but on a **public** route and with a **tighter** threshold:

```
POST /api/login/face { email, descriptor[128] }
  → look up the user by email → find the linked Employee
  → no face on file → 422 with a generic message (does not leak whether the email exists)
  → match the descriptor; if d ≤ 0.50 → issue a Sanctum token
  → apply every gate password login applies:
       active account, active organisation, active branch,
       brute-force lockout (shares the cache key with /api/login)
```

## B6. Match thresholds — and why they differ

| Use case | Threshold (Euclidean distance) | Reasoning |
|---|---|---|
| Attendance clock-in / clock-out | **0.55** | face-api's own default is 0.6; tightened slightly for attendance. |
| **Face login (authentication)** | **0.50** | Stricter — a false match here hands over an entire session. |
| face-api.js library default | 0.6 | Reference point from the library README. |

Real-world distance behaviour:

| Situation | Typical distance |
|---|---|
| Identical capture (same descriptor) | ~0.0 |
| Same person, different angle / lighting | 0.2 – 0.4 |
| Same person, very different conditions | up to ~0.5 |
| **Different person** | > 0.6 |

In production logs most legitimate clock-ins land at **0.30 – 0.45**.

> ⚠️ **Documentation caveat:** the root `CLAUDE.md` states 0.55 for both paths. The code uses **0.55 for attendance and 0.50 for login**. The values in this table are the code truth.

## B7. Multi-punch activity labels

The SPA offers this chip set; the backend accepts any `varchar(50)` so HR can record one-offs.

| Label | Direction | UI tone |
|---|---|---|
| Check In | in | green (start of day) |
| Step Out | out | amber (short break) |
| Step In | in | teal (return from break) |
| Lunch Out | out | pink |
| Lunch In | in | green |
| Meeting | either | indigo |
| Check Out | out | red (end of day) |

The Clock-In page filters the chips by `next_direction`, so a user never sees a "Lunch In" chip when the system is expecting an `out` punch.

## B8. Face and attendance API surface

All routes are under `/api` and Sanctum-protected unless marked **PUBLIC**.

**Face biometric**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/face/status` | Current biometric state (registered?, timestamps) |
| POST | `/api/face/register` | Store the descriptor — requires `consent: true` |
| DELETE | `/api/face/data` | Revoke and wipe the descriptor (keeps `consent_given_at`, stamps `consent_revoked_at`) |

All three accept an optional `employee_id` so an admin can act on another employee in the same tenant; omitted means "self".

**Attendance**

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/attendance` | HR / admin tenant-scoped list |
| GET | `/api/attendance/my` | Caller's own paginated history |
| GET | `/api/attendance/today` | Caller's today row + punches + `next_direction` + `allowed_labels` |
| GET | `/api/attendance/employee/{employeeId}/summary` | Employee Profile → Attendance tab. Returns `employee`, `month`, `stats{present_days, late_marks, missing_biometric, total_leaves}`, `today`, `history[]`. Accepts an employee code **or** a numeric id; the lookup is tenant-scoped. |
| POST | `/api/attendance/face/clock-in` | Records one `in` punch |
| POST | `/api/attendance/face/clock-out` | Records one `out` punch |
| POST | `/api/attendance/import` | Device punch import (Part D / §E3) |

**Auth**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login` | Password login (untouched) |
| POST | `/api/login/face` | **PUBLIC.** `{ email, descriptor[128] }` → Sanctum token on match |

## B9. Consent and privacy (DPDP / GDPR)

Biometric data is **special-category** under the India DPDP Act 2023 and GDPR Article 9. Mishandling it is a regulatory hazard, not just a product wart. What was built:

1. **Explicit opt-in.** The registration modal shows a plain-language disclosure — we store a mathematical signature, not the photo; you may revoke at any time; we do not share it with third parties. The backend enforces `consent: true` with Laravel's `accepted` rule.
2. **`face_consent_given_at` is sticky.** Re-enrolment preserves the original opt-in date, so an admin can prove when the person first consented.
3. **Revoke wipes the descriptor and stamps `face_consent_revoked_at`** while keeping the audit trail — regulators want both timestamps.
4. **The descriptor never serialises.** `$hidden = ['face_descriptor']` on the Employee model; API responses expose only the boolean accessor `face_registered`.

**Deliberately not built (production backlog):**

- **Retention policy** — auto-revoke and wipe after N years of inactivity.
- **Liveness detection** — a printed photo or a phone screen can defeat a plain match. A "blink twice" / "turn your head" challenge is straightforward with face-api landmarks.
- **Encryption at rest** — Postgres `pgcrypto` or a Laravel encrypted cast on the column.

> The eSSL device path carries a **lighter** privacy burden: the fingerprint template never leaves the terminal and the app stores only User ID + time + direction. It should still be named in the employee consent policy.

## B10. Files added / changed for the face feature

**Backend**

| File | Type | Purpose |
|---|---|---|
| `database/migrations/2026_05_12_042448_add_face_biometric_to_employees.php` | new | `face_descriptor` (json), `face_registered_at`, `face_consent_given_at`, `face_consent_revoked_at` |
| `database/migrations/2026_05_12_042451_create_attendances_table.php` | new | Daily summary table |
| `database/migrations/2026_05_12_060843_create_attendance_punches_table.php` | new | Intraday punch ledger — one row per tap |
| `database/migrations/2026_05_12_064252_backfill_attendance_punches.php` | new | One-off backfill: synthesises Check In / Check Out punches for legacy rows predating multi-punch |
| `app/Models/Employee.php` | edited | `face_*` in `$fillable` / `$casts`; `face_descriptor` in `$hidden`; `face_registered` accessor appended |
| `app/Models/Attendance.php` | edited | `hasMany punches`; accessors `total_worked_seconds`, `next_direction`, `punches_count` |
| `app/Models/AttendancePunch.php` | new | Child model for individual punches |
| `app/Http/Controllers/Api/FaceBiometricController.php` | new | `status / register / revoke`, consent-gated, same-tenant access check (accepts `client_id = NULL` global rows) |
| `app/Http/Controllers/Api/AttendanceController.php` | new | All attendance endpoints in §B8 |
| `app/Http/Controllers/Api/AuthController.php` | edited | Added `faceLogin()` |
| `routes/api.php` | edited | Route registration |

**Frontend**

| File | Type | Purpose |
|---|---|---|
| `public/face-models/` | new | 7 model weight files (~6.8 MB) |
| `resources/js/components/FaceCapture.tsx` | new | Reusable webcam tile — loads models, opens the camera, requires exactly ONE face, returns the 128-d descriptor |
| `resources/js/components/FaceRegistrationModal.tsx` | new | Two-step modal: consent disclosure → capture → save |
| `resources/js/components/FaceLoginModal.tsx` | new | Email + face → `POST /login/face` |
| `resources/js/pages/ClockIn.tsx` | new | `/clock-in` page: label picker, live "worked today" timer, full intraday punch timeline |
| `resources/js/pages/employee/EmployeeProfile.tsx` | edited | Attendance tab wired to real data (`AttendanceTabPanel`); "Register Face" trigger on the Security card |
| `resources/js/pages/hrms/HrEmployees.tsx` | edited | "Register Face" row action — smiley icon, green dot when already enrolled |
| `resources/js/pages/auth/Login.tsx` | edited | "Sign in with Face" button below the Google button |
| `resources/js/contexts/AuthContext.tsx` | edited | New `faceLogin(email, descriptor)` |
| `resources/js/components/App.tsx` | edited | `/clock-in` route |
| `resources/js/constants.ts` | edited | Menu config (HR → branch_user; Clock-In → employee) |
| `resources/js/velzon/Layouts/LayoutMenuData.tsx` | edited | `clock-in` slug → `/clock-in`, `CalendarCheck` icon, added to `defaultSlugs` |
| `vite.config.js` | edited | `optimizeDeps.include: ['face-api.js']` |
| `package.json` | edited | `face-api.js@0.22.2` |

## B11. Menu visibility (face features)

| Role | HR menu | Clock-In menu |
|---|---|---|
| super_admin | hidden | hidden |
| client_admin | hidden | hidden |
| client_user | hidden | hidden |
| branch_user | **visible** | hidden |
| employee | hidden | **visible** |

Direct URLs (`/hr/employees`, `/clock-in`) still resolve for any signed-in user — this is a **sidebar-only** restriction. Route gates and API permissions are unchanged.

## B12. Face feature — sign-off test coverage (all PASS)

| Audit | Tests |
|---|---|
| Face register + clock-in + clock-out + revoke + 7 frontend wiring checks | 43/43 |
| Face login (admin registers → user logs in by face) | 20/20 |
| Tenant scope on FaceBiometricController (own / global / cross-tenant / super_admin) | 4/4 |
| Multi-punch flow (six-punch day + direction guard + totals + HR view) | 29/29 |
| Attendance summary endpoint (by code, by id, self, cross-tenant 403, unknown 404, bad month fallback) | 24/24 |
| Employee-code tenant scope fix (two `EMP-001` rows in different tenants) | 4/4 |
| Legacy backfill verification | passes |
| Menu role visibility | 10/10 |

---

# PART C — Face biometric: frontend setup and deployment

Everything the **frontend** needs so that face registration, face clock-in and face login work end-to-end on a fresh clone or a live server.

## C1. NPM package — exactly one new dependency

```bash
npm install face-api.js@0.22.2 --save
```

This is the only library added for the entire face feature. It brings TensorFlow.js as a peer dependency — do **not** install tfjs separately.

On a fresh clone where `package.json` already lists it:

```bash
npm ci          # exact-lockfile install, use this for production deploys
# or
npm install     # if you want to refresh
```

Verify:

```bash
node -e "console.log(require('face-api.js/package.json').version)"
# expect: 0.22.2
```

## C2. Model weights — 7 files, ~6.8 MB, self-hosted

face-api.js ships only the JS library; the trained weights are separate. They are self-hosted under `public/face-models/` so the SPA loads them from our own domain (no external CDN, works offline).

| Filename | Size | Purpose |
|---|---|---|
| `tiny_face_detector_model-weights_manifest.json` | ~3 KB | Detector manifest |
| `tiny_face_detector_model-shard1` | ~190 KB | Detector weights |
| `face_landmark_68_model-weights_manifest.json` | ~8 KB | Landmark manifest |
| `face_landmark_68_model-shard1` | ~350 KB | 68-point landmark net |
| `face_recognition_model-weights_manifest.json` | ~18 KB | Recognizer manifest |
| `face_recognition_model-shard1` | ~4 MB | Recognizer part 1 |
| `face_recognition_model-shard2` | ~2.2 MB | Recognizer part 2 |

Download all seven in one shot:

```bash
mkdir -p public/face-models
cd public/face-models

for f in \
  tiny_face_detector_model-weights_manifest.json \
  tiny_face_detector_model-shard1 \
  face_landmark_68_model-weights_manifest.json \
  face_landmark_68_model-shard1 \
  face_recognition_model-weights_manifest.json \
  face_recognition_model-shard1 \
  face_recognition_model-shard2
do
  echo "-> $f"
  curl -sSL -o "$f" "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/$f"
done

ls -lh   # expect ~6.8 MB across 7 files
```

On Windows run the same loop in **Git Bash**, or download the files manually from `https://github.com/justadudewhohacks/face-api.js/tree/master/weights` and drop them into `public/face-models/`.

> If the folder is missing, the SPA hangs forever on **"Loading face-recognition models…"**.

## C3. Vite configuration patch

face-api.js is loaded with a **dynamic** `import('face-api.js')` so pages without a camera do not pay the ~1 MB cost. Vite's initial dependency scan misses dynamic imports, so the dev server 404s the pre-bundled chunk on first use.

The fix is already present in `vite.config.js`:

```js
export default defineConfig({
  // …
  optimizeDeps: {
    include: ['face-api.js'],
  },
});
```

After editing `vite.config.js`, clear the stale dependency cache so Vite re-pre-bundles:

```bash
rm -rf node_modules/.vite
```

Then restart `npm run dev`. **Production builds need no extra step** — Rollup follows dynamic imports natively.

## C4. HTTPS is mandatory on any non-localhost environment

`navigator.mediaDevices.getUserMedia()` refuses to run on plain `http://` outside localhost. The live URL **must** be `https://`.

```js
window.isSecureContext   // must be true
```

If the environment is still on `http://`, the registration and clock-in screens show **"Camera permission was denied"** even though the user never saw a prompt. Fix the certificate before debugging anything else.

## C5. Build commands

```bash
npm run dev        # Vite dev server, auto-reload
npm run build      # production build → public/build/ (laravel-vite-plugin reads the manifest there)
npm run preview    # preview the production build locally
```

Vite copies `public/` verbatim into the build output, so `public/face-models/*` ships as-is.

## C6. Optional environment variable

```env
# .env or .env.production
VITE_FACE_MODEL_URL=/face-models
```

Default is `/face-models` (self-hosted). Point it at a CDN if the weights ever move to S3 / CloudFront, e.g. `VITE_FACE_MODEL_URL=https://cdn.example.com/face-models`.

## C7. Full live-deploy sequence (face feature)

```bash
# 1. Pull
git pull origin main

# 2. Backend deps
composer install --no-dev --optimize-autoloader

# 3. Migrations (face columns, attendances, attendance_punches, legacy backfill)
php artisan migrate --force

# 4. Frontend deps
npm ci

# 5. Confirm the 7 weight files shipped (~6.8 MB)
ls -la public/face-models/

# 6. Build the frontend
npm run build

# 7. Clear caches
php artisan config:clear
php artisan route:clear
php artisan view:clear

# 8. Ensure the site is served over HTTPS (see §C4)
```

## C8. Post-deploy sanity check (browser console on the live site)

```js
// 1. Running under HTTPS?
window.isSecureContext                       // expect: true

// 2. Model URL reachable
fetch('/face-models/tiny_face_detector_model-weights_manifest.json')
  .then(r => r.json()).then(j => console.log('manifest OK', j))
  .catch(e => console.error('manifest FAIL', e));

// 3. Camera works (run after a user gesture — click somewhere first)
navigator.mediaDevices.getUserMedia({ video: true })
  .then(s => { console.log('camera OK'); s.getTracks().forEach(t => t.stop()); })
  .catch(e => console.error('camera FAIL', e));
```

All three must succeed. If (2) 404s the weights did not ship — redo §C2. If (3) fails with `NotAllowedError` the user blocked the prompt and must re-grant via browser site settings.

## C9. Files this frontend setup touches

| File | What |
|---|---|
| `package.json` | `face-api.js@0.22.2` in dependencies |
| `package-lock.json` | Locked version — commit it |
| `public/face-models/*` | 7 weight files, ~6.8 MB |
| `vite.config.js` | `optimizeDeps.include: ['face-api.js']` |
| `.env.production` (optional) | `VITE_FACE_MODEL_URL=` if weights move off-domain |

---

# PART D — eSSL fingerprint device integration

> ⚠️ **eSSL fingerprint ≠ webcam face login.** The eSSL terminal is separate hardware that performs its own fingerprint matching. This part is only about the **device** integration.

## D1. What the feature does, in one line

An eSSL fingerprint terminal at the office door records employee punches; those punches flow into CBC and appear on the **HR Attendance** sheet, mapped to the right employee by a single number.

| On the device | Becomes in CBC | Where it shows |
|---|---|---|
| A fingerprint punch (User 101, 09:03, In) | An `attendance_punch` with direction `in` | HR Attendance timeline |
| First punch of the day | `attendances.check_in_at` | HR sheet "In" column |
| Last punch of the day | `attendances.check_out_at` | HR sheet "Out" column |
| Source of the punch | `method = device` → **BIOMETRIC** badge | Punch source pill |

> The device **never** sends a fingerprint image. It matches on-device and transmits only **User ID + timestamp + In/Out status**.

## D2. The three integration modes

| # | Mode | How data moves | Real-time? | Needs a PC? | Needs a public server? | Effort |
|---|---|---|---|---|---|---|
| **A** | **CSV / USB import** | HR exports a file from the device, uploads it in-app | ❌ batch | Only to run the export software | ❌ | Low |
| **B** | **LAN connector (Pull SDK)** | An on-prem service polls the device over TCP 4370 and POSTs to our API | ~1 min | ✅ always-on | ❌ | Medium |
| **C** | **Cloud / ADMS push** | The device POSTs punches to our server itself | ✅ live | ❌ | ✅ | High |

**All three funnel into the same normaliser** — one code path, three front doors. Mode A proves the mapping with zero networking; Mode B is the recommended production mode (no public exposure); Mode C is the true SaaS end-state but requires device→tenant authentication, because a device cannot send a login token.

## D3. Prerequisites checklist — tick ALL before starting

**Hardware**
- [ ] An eSSL / ZKTeco terminal with fingerprint support (eTimeTrack, X990, K90/K30, MB460, iClock…). Face / RFID optional.
- [ ] Firmware supporting at least one of: USB export, TCP/SDK (port 4370), ADMS/Cloud push. Most eSSL business models support all three.
- [ ] Power and a mounting point near the entry.

**Network (per mode)**
- [ ] **Mode A:** none — a USB pen-drive, or eTimeTrackLite on a PC.
- [ ] **Mode B:** device and a Windows PC on the same LAN; TCP **4370** open.
- [ ] **Mode C:** device has internet; our server reachable on a public IP/domain; the ingest port open.

**App / data**
- [ ] Every device-tracked employee has `attendance_number` filled (digits only).
- [ ] Those numbers are **unique per tenant** — no two employees share one.
- [ ] Employee `time_tracking` set to **Biometric**.
- [ ] Employee `date_of_joining` correct — punches before it are rejected.

**People / access**
- [ ] At least one person enrolled as **device Super Admin** (needed to open the device menu at all).
- [ ] An HR user who will run the import and verify the sheet.

## D4. Device settings — what to configure on the terminal

Menu paths are for typical eSSL / ZKTeco firmware; labels vary slightly by model. Press **M/OK** to open the menu.

### D4.1 Common settings — all modes (mandatory)

| Setting | Menu path | Value / note |
|---|---|---|
| **Enroll user** | `User Mgmt → New User` | **User ID = the employee's `attendance_number`.** Enroll 1–2 fingerprints (scan 3×). Privilege = Normal User. |
| **Admin user** | `User Mgmt → New User → Privilege` | Keep 1–2 as **Super Admin** so the menu can be opened. |
| **Date & time** | `System → Date/Time` | Correct **IST**, **DST off**. A wrong clock shifts every punch. |
| **Time format** | `System → Date/Time` | 24-hour recommended — avoids AM/PM parse issues. |
| **In/Out keys** | `Personalize → Shortcut Key` | Enable the **Check-In** / **Check-Out** function keys. |

### D4.2 Attendance status / function keys

The employee presses a function key **before** scanning; that sets the punch status code.

| Status code | Meaning |
|---|---|
| 0 | Check-In |
| 1 | Check-Out |
| 2 | Break-Out |
| 3 | Break-In |
| 4 | Overtime-In |
| 5 | Overtime-Out |

> **Reality check:** operators routinely forget to press the key, so status is frequently `0` for every punch. The importer therefore **must not trust the status** — it sorts by time and forces in/out alternation. This is risk #1 (§D8).

### D4.3 Mode A — USB / software export

| Setting | Menu path | Value / note |
|---|---|---|
| USB export | `USB Manager → Download → Attendance Data` | Produces an `AttLog` file (`.dat` / `.txt` / `.xls`) on the pen-drive |
| Alternative | eTimeTrackLite on a PC | Connect the device → **Download Logs** → export CSV / Excel |

AttLog file format (tab- or space-delimited — what the importer parses):

```
UserID   DateTime(YYYY-MM-DD HH:MM:SS)   Status   VerifyMode   WorkCode
101      2026-07-27 09:03:12            0        1            0
101      2026-07-27 18:31:40            1        1            0
```

`Status` uses the §D4.2 codes. `VerifyMode`: 1 = fingerprint, 15 = face, etc.

### D4.4 Mode B — LAN connector (TCP 4370)

| Setting | Menu path | Value / note |
|---|---|---|
| IP Address | `Comm → Ethernet → IP Address` | **Static** IP in the office subnet, e.g. `192.168.1.201` |
| Subnet Mask | `Comm → Ethernet` | e.g. `255.255.255.0` |
| Gateway | `Comm → Ethernet` | Router IP |
| Device ID | `Comm → PC Connection` | Unique per device, e.g. `1` |
| Comm Key | `Comm → PC Connection → Comm Key` | Default `0`; if non-zero the connector must use the same key |
| Port | fixed | **4370** TCP — the ZKTeco SDK default; open it on the LAN |

### D4.5 Mode C — Cloud / ADMS push

Do the §D4.4 network settings first, then:

| Setting | Menu path | Value / note |
|---|---|---|
| Server Mode | `Comm → Cloud Server Setting` | `ADMS` (or `Domain Name`) |
| Server Address | `Comm → Cloud Server Setting` | Our public IP or domain, e.g. `cbc.idims.in` |
| Server Port | `Comm → Cloud Server Setting` | The ingest port (`80` / `443` / `8080`) |
| Proxy | `Comm → Cloud Server Setting` | `OFF` unless the site requires one |
| HTTPS | `Comm → Cloud Server Setting` | `ON` when the model and our endpoint support TLS |

## D5. Development ledger — what was built (status 2026-07-27)

The integration is **feature-complete for Mode A (file import) and Mode C (live push)**, fully operable from the UI. Mode B shipped as a standalone on-prem tool.

**Build status by phase**

| Phase | What | Status |
|---|---|---|
| 0 | Foundation: `device` method enum + provenance columns; shared `AttendancePunchService`; `attendance_number` uniqueness rule | ✅ done |
| 1 | Normaliser `EsslAttendanceImporter` (map → UTC → alternate-by-time → idempotent) | ✅ done |
| 2 | File import: `POST /attendance/import` + "Import Punches" UI | ✅ done |
| 3 | Verify and harden (IP allow-list, throttle) | ✅ done |
| C | ADMS / iclock receiver + `device_terminals` registry + HR "Biometric Devices" screen | ✅ done |
| B | `tools/essl-connector/` LAN poller (Python / pyzk) | ✅ done |

**Backend files**

| File | Role |
|---|---|
| `app/Services/AttendancePunchService.php` | Shared day resolve / next direction / append / recompute (face **and** device) |
| `app/Services/EsslAttendanceImporter.php` | The normaliser — every ingest mode funnels here |
| `app/Http/Controllers/Api/EsslDeviceController.php` | Mode C `/iclock/*` receiver |
| `app/Http/Controllers/Api/DeviceTerminalController.php` | Terminal registry CRUD (`/api/device-terminals`) |
| `app/Http/Controllers/Api/AttendanceController.php` | `import()` (Phase 2); `facePunch()` now delegates to the shared service |
| `app/Models/DeviceTerminal.php` | Registry model + `permitsIp()` |
| `app/Models/AttendancePunch.php` | Added `device_serial` / `device_user_id` / `raw_status` to fillable |
| `routes/web.php` | Public `/iclock/*` (throttled, declared above the SPA catch-all) |
| `routes/api.php` | `/attendance/import`, `apiResource device-terminals` |
| `bootstrap/app.php` | CSRF-exempt `iclock/*` |

**Frontend files**

| File | Role |
|---|---|
| `resources/js/pages/hrms/HrBiometricDevices.tsx` | Devices CRUD + "Import Punches" modal |
| `App.tsx`, `constants.ts`, `LayoutMenuData.tsx`, `routeAccess.ts` | Route `/hr/devices` + menu leaf, riding on the `hr.attendance` permission |

**Standalone tool**

| File | Role |
|---|---|
| `tools/essl-connector/essl_connector.py` (+ config, README, requirements) | Mode B LAN poller → `/attendance/import` |

**Endpoints**

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET/POST | `/iclock/cdata` | public (serial registry) | Mode C handshake + ATTLOG push |
| GET | `/iclock/getrequest` | public | Device command poll |
| POST | `/iclock/devicecmd` | public | Device command ack |
| GET/POST/PUT/DELETE | `/api/device-terminals[/{id}]` | sanctum | Terminal registry |
| POST | `/api/attendance/import` | sanctum | File / JSON import (Modes A and B) |

**Migrations**

| Migration | Status |
|---|---|
| `2026_07_27_000001` — `device` method enum + provenance columns | ✅ applied |
| `2026_07_27_000003` — `device_terminals` table | ✅ applied |
| `2026_07_27_000004` — `allowed_ips` | ✅ applied |
| `2026_07_28_000001` — unique punch instant `(employee_id, punched_at)` | ✅ applied |
| `2026_07_27_000002` — unique `attendance_number` per client | ⏳ **HELD** — blocked by a duplicate (client 1, number `1212`). Resolve the duplicate, then run `php artisan migrate --path=database/migrations/2026_07_27_000002_unique_attendance_number_per_client.php` |

## D6. Phase detail — how each piece works

**Phase 0 — Foundation (shared by all modes).**
Migration `2026_07_27_000001` adds `'device'` to the `method` CHECK constraint on `attendances` (check-in and check-out) **and** `attendance_punches`, plus `device_serial`, `device_user_id` and `raw_status` columns on `attendance_punches`. The day / next-direction / append / `recomputeSummary` logic was extracted into `AttendancePunchService`, and `AttendanceController::facePunch()` now delegates to it — behaviour-preserving, so face clock-in is unchanged. Per-tenant uniqueness of `attendance_number` was added to the employee validator (mirroring `pan_number`); the DB index is the held migration noted above.

**Phase 1 — The normaliser (`EsslAttendanceImporter`).**
Given rows of `(user_id, punched_at, status)` it:
1. maps `attendance_number → employee`, **tenant-scoped**;
2. converts device-local time → UTC;
3. **normalises to strict in/out alternation by time**, ignoring the unreliable status code;
4. upserts `attendances` + `attendance_punches` with `method = 'device'`, **idempotently** — a punch already stored at the same `employee_id` + `punched_at` is skipped;
5. returns a summary: imported / skipped_duplicates / unmatched_user_ids / errors / date_range.

Verified end-to-end: all-status-`0` input produces correct alternation; a re-run reports all rows as duplicates; IST→UTC conversion is correct; unmatched IDs and before-joining rows are reported rather than dropped.

**Phase 2 — Import endpoint and screen.**
`POST /attendance/import` (authenticated) accepts an AttLog/CSV **file upload** or an inline `punches` JSON array. It parses tab- or comma-delimited input, auto-skips a header row, optionally attaches to a registered terminal (`device_terminal_id`, inheriting branch / timezone / serial) or else uses the caller's client plus an optional `branch_id` / `timezone`, runs the Phase-1 normaliser, and returns the summary. The **"Import Punches"** modal on the Biometric Devices screen surfaces a live result summary including **unmatched User IDs** and skipped rows — nothing is silently dropped.

**Phase 3 — Verify and harden.**
Confirm punches appear in HR Attendance with the **BIOMETRIC** badge, then run the full test matrix (§G1).

**Phase 4 — Mode B connector.**
`tools/essl-connector/` is a standalone Python (pyzk) connector: `essl_connector.py` + `config.example.ini` + `requirements.txt` + `README.md`. It polls the device over TCP 4370, keeps a cursor of the last pulled timestamp, and forwards new punches to `POST /api/attendance/import` with a service Sanctum token — reusing the Phase-2 endpoint and Phase-1 normaliser. It runs unattended via Task Scheduler or NSSM.

Design notes for the connector:

| Concern | Design |
|---|---|
| Tech | Python + `pyzk` (shipped), or C#/.NET + `zkemkeeper.dll` (official SDK) |
| Connect | `Connect_Net(ip, 4370)` with the Comm Key |
| Poll cadence | Every 1–5 minutes, or subscribe to real-time events (`OnAttTransactionEx`) |
| Cursor | Persist the last pulled timestamp so only new logs are forwarded (avoids re-pull storms) |
| Forward | `POST /attendance/import` with a dedicated service user's Sanctum token |
| Resilience | Queue locally if the API is down; retry with backoff; never drop logs |
| Clear device logs? | **No** — leave them as a fallback; let the device overwrite the oldest when full |
| Multi-device | One connector can poll several terminals; tag each punch with its `device_serial` |

> eSSL terminals hold tens of thousands of logs, so a few hours of PC downtime loses nothing — the connector catches up on the next poll.

**Phase 5 — Mode C ADMS receiver.**
Public iclock endpoints live in `routes/web.php` **above** the SPA catch-all and are CSRF-exempt in `bootstrap/app.php`: `GET|POST /iclock/cdata`, `GET /iclock/getrequest`, `POST /iclock/devicecmd` → `EsslDeviceController`. The `device_terminals` registry maps serial → client / branch / timezone with `is_active` and `last_seen_at`. The handshake replies a valid ADMS options block; an ATTLOG POST is parsed and fed to the Phase-1 normaliser; **unknown or inactive serials are acknowledged but NOT ingested** — the tenant is always derived from the registered serial, never from the payload.

Hardening added the same day: a per-terminal **IP allow-list** (`device_terminals.allowed_ips`; blank = allow any, enforced in the receiver — a push from a disallowed IP is acked but not ingested) and a `throttle:120,1` rate limit on `/iclock/*`. Terminals are registered and activated from the app via the tenant-scoped `DeviceTerminalController`, not from tinker.

## D7. The ADMS / iclock protocol (how the device talks)

In Cloud/ADMS mode the device initiates plain-text HTTP to our server:

| Step | Device sends | Our server replies |
|---|---|---|
| Handshake | `GET /iclock/cdata?SN=<serial>&options=all` | `GET OPTION FROM: <serial>` + stamp / interval config |
| Poll for commands | `GET /iclock/getrequest?SN=<serial>` | `OK`, or queued commands such as "clear" / "reboot" |
| **Push punches** | `POST /iclock/cdata?SN=<serial>&table=ATTLOG`, body = tab-delimited rows | `OK: <count>` |

ATTLOG row body (same fields as the file format):

```
101<TAB>2026-07-27 09:03:12<TAB>0<TAB>1<TAB>0 ...
```

**Server responsibilities in Mode C:**

- The route is **public and unauthenticated** (the device cannot send a bearer token), so it must be protected by an `SN` → `device_terminals` lookup plus an IP allow-list, rejecting unknown serials and logging every push.
- Map `SN` → `client_id` / `branch_id` — this is how a push lands in the right tenant.
- Reuse the **same normaliser** as Modes A and B.
- Idempotency and replay protection — devices resend whenever in doubt, so deduplicate hard.
- Reply `OK` promptly, otherwise the device retries and may buffer or duplicate.

## D8. Highest-risk areas — test these hardest

1. **Alternation invariant.** The app rejects two same-direction punches in a row, and device status is frequently all `0`. The importer **must** re-derive in/out from time and never replay raw status. *Risk #1.*
2. **`attendance_number` uniqueness.** Two employees sharing a number means punches land on the wrong person. Enforce per-tenant uniqueness before go-live.
3. **Timezone.** The device sends local time; the app stores UTC and displays IST. Convert at ingest or everything is 5½ hours out.
4. **Duplicates / re-import.** Devices resend and HR may upload the same file twice — idempotency is mandatory.
5. **Multi-tenant scoping.** Punches inherit `client_id` / `branch_id` from the **matched employee**, never from the file. In Mode C the tenant comes from the registered serial.
6. **Reuse, don't copy.** The extracted `AttendancePunchService` is what makes the face and device paths behave identically.
7. **Face stays independent.** Device-tracked employees need no webcam enrollment; the `time_tracking` toggle separates the two populations.

## D9. End-to-end flow (Mode A, the recommended start)

```
SETUP (one time, per employee)
  1. HR sets employee.attendance_number = 101
  2. Enroll the fingerprint ON the device as User 101   (IDs MUST match)
  3. Set employee time_tracking = Biometric

DAILY
  4. Employee presses the Check-In / Check-Out key and scans a finger
  5. HR exports the AttLog file from the device
  6. HR uploads it via HR → Biometric Devices → Import Punches
       Backend:  map UserID → attendance_number (tenant-scoped)
                 device-local time → UTC
                 NORMALISE to strict in/out alternation      ← critical
                 upsert attendances + punches (method='device')
                 idempotent — skip already-imported rows
  7. Punches appear in HR Attendance with a BIOMETRIC source badge
```

## D10. Interaction with existing HR features (do not break these)

| Feature | Interaction |
|---|---|
| **Shift / Late** | `resolveDayStatus` marks Late from first-in vs shift start + 10 min grace, computed in IST. Device punches must be UTC-correct or Late marks are unfair — and they flow to payroll. |
| **Weekly off** | `parseWeeklyOff` + the `weekly_off` field — a punch on a weekly-off day still records; status handling is unchanged. |
| **Holidays** | `holidayDatesForGroups` (holiday_group_id) — punches on holidays are unusual but allowed; do not suppress them. |
| **Regularization** | Employees correct wrong days via `AttendanceRegularizationController` (approval-routed). A device punch is just another input a regularization can correct — but a bad import generates regularization noise. |
| **21:00 auto-checkout** | An open, unpaired `in` is auto-closed at 21:00 IST for the worked-hours calculation — identical to the face path. Do not special-case device days. |
| **Payroll finalize** | Import **before** `POST /payroll/finalize-attendance`; the run snapshots attendance. |
| **`time_tracking` flag** | `Manual` / `Biometric` tells you which employees to expect device punches for, and stops false alerts on face-only staff. |
| **Row status** | New device `attendances` rows default `status` exactly like the face path (Present on first in) and let `resolveDayStatus` / payroll refine it. Do not invent new statuses. |
| **Payroll snapshot** | The payslip "Biometric Input" columns read a snapshot frozen when payroll was generated. Importing punches after a run is generated does **not** retro-update it — import first, or regenerate. |

## D11. Operational edge cases

| Case | Handling |
|---|---|
| Employee not yet enrolled on the device | Their punches simply do not exist; HR sees a gap → regularize or enroll |
| Employee leaves | Delete or disable them on the device; the import guards on employee `status` |
| Re-enrollment / new finger | No app change — the same User ID keeps the mapping |
| Wrong-branch device | An employee punching at another branch's terminal maps by number and lands under **their own** branch (from the employee, not the device). Decide whether that is allowed. |
| Device clock drift | Sync device time periodically; Modes B and C can push time, §D4.1 is the manual fallback |
| Device memory full | Terminals overwrite the oldest logs — export / pull often enough, or run Mode C in real time |
| Duplicate scan (double tap) | Two punches seconds apart — the normaliser plus a small dedupe window collapses accidental doubles |
| Multiple devices in one branch | Tag each punch with `device_serial`; employee mapping still resolves by number |
| Attendance-number reuse | If a leaver's number is reassigned, old device logs could attach to the new person. Retire numbers, or gate by `date_of_joining` and employee `status`. |

## D12. Security and privacy (device path)

- **Biometric data never leaves the device.** Fingerprint templates stay on the terminal; the app stores only User ID, time and direction. This is a lighter privacy burden than the webcam face system, but it still belongs in the employee-consent policy.
- **The Mode C endpoint is the attack surface.** It is public, so: validate `SN` against `device_terminals`, allow-list source IPs, rate-limit, log every hit, and **never** trust the tenant from the payload.
- **Spoofed punches.** Without device authentication anyone could POST fake ATTLOG rows and fabricate attendance — which becomes payroll fraud. Device registration plus IP allow-listing is mandatory for Mode C; a per-device `ingest_token` is the reserved next step.

## D13. The physical device on hand (read from the unit, 2026-07-27)

| Field | Value |
|---|---|
| Device name | `x2008` (eSSL) |
| Platform | `ZLM60_TFT` |
| Firmware version | `8.0.4.3-20230515` |
| System version | `22.5.10-20170306` |
| Push Service | `2.0.33S-20220613` ✅ ADMS / push capable |
| Bio Service | `2.1.12-20170420` |
| Fingerprint algorithm | `Finger VX10.0` |
| **Serial Number** | **`NFZ8252004771`** ← the `SN` used for device→branch binding |
| MAC | `00:17:61:11:13:ae` |
| Capacity | Users 2000 · Fingerprints 2000 · T&A records 2,000,000 |
| Usage when inspected | 7 users · 8 fingerprints · 73 records (effectively empty — a test unit) |
| Network | Static IP `192.168.1.201`, mask `255.255.255.0`, GW `192.168.1.1`, DNS `192.168.1.1`, DHCP OFF |
| TCP COMM port | `4370` (Mode B ready) |

### 🔴 Critical finding — the unit was already pushing to Keka

`COMM → Cloud Server Setting` read: Server Mode **ADMS**, Enable Domain Name **ON**, Server Address **`cin3.a.keka.com`**, Proxy OFF, HTTPS ON.

1. **Mode C is proven on this exact unit** — Keka ingests over the same iclock/ADMS protocol, so real-time push already works.
2. **Repointing `Server Address` to CBC will STOP the Keka sync.** Only do it if the Keka integration is a test, not production.
3. The unit is nearly empty, which suggests a test/eval device — good for a pilot.

### Local LAN pilot settings for this device

Because the device sits on a static LAN IP and the dev machine is on the same `192.168.1.x` network, no public server is needed to pilot Mode C:

| Setting | Local pilot value |
|---|---|
| Server Mode | `ADMS` |
| Enable Domain Name | **OFF** (use a raw IP) |
| Server Address | the dev PC's LAN IP, e.g. `192.168.1.50` |
| Server Port | `8000` (the `php artisan serve` port) |
| Enable Proxy Server | OFF |
| HTTPS | **OFF** (local dev has no TLS) |

### Go-live test procedure with the real device

1. **Register the terminal** — HR → Biometric Devices → Add Device, serial `NFZ8252004771`, bound to the tenant/branch under test. (Tinker equivalent: `DeviceTerminal::create(['client_id'=>1,'branch_id'=>2,'serial'=>'NFZ8252004771','name'=>'Front door x2008','timezone'=>'Asia/Kolkata','is_active'=>true]);`)
2. **Enroll each employee** on the device with **User ID = their `attendance_number`**.
3. Set the Cloud Server settings per the table above.
4. Run the app so the device can reach it: `php artisan serve --host=0.0.0.0 --port=8000`.
5. Punch on the device, watch `storage/logs/laravel.log` for `[eSSL] ATTLOG ingested`, then open **HR Attendance** and confirm the **BIOMETRIC** badge.
6. For production, point Server Address at **cbc.idims.in** with HTTPS ON and register the serial against the production branch.

## D14. Rollout plan (pilot → cutover)

1. Ship Phases 0–3 (Mode A working in staging).
2. **Pilot one branch, one device.** Enroll roughly five employees and run the device **in parallel** with the face clock for 1–2 weeks.
3. **Reconcile daily** (§D15) — device punches vs face punches vs expected.
4. Fix mapping, timezone and normalisation issues found in the pilot.
5. **Cut over** the pilot branch to device-primary, keeping face as the fallback.
6. Roll out to further branches; add Mode B or C only where real-time is needed.

> Never big-bang all branches. Attendance errors are visible to every employee and flow straight onto their payslip.

## D15. Monitoring and reconciliation after go-live

- **Daily unmatched-ID report** — device User IDs with no matching `attendance_number` (someone enrolled on the device but not mapped in the app).
- **Coverage check** — employees with `time_tracking = Biometric` and **zero** punches on a working day; usually a device or enrollment problem, not absence.
- **Odd-punch report** — days ending on an unpaired `in` (forgot to check out), run before payroll finalisation.
- **Import audit** — retain every import summary (imported / skipped / unmatched) for dispute resolution.

## D16. Effort estimate (for planning)

| Scope | Rough size |
|---|---|
| Phase 0 — migration, extract service, uniqueness | Small |
| Phases 1–2 — normaliser + import endpoint + screen | Medium — **Mode A shippable** |
| Phase 3 — verify + test matrix | Small |
| Phase 4 — Mode B connector | Medium (separate on-prem app) |
| Phase 5 — Mode C ADMS endpoint + device registry | Large |

**Minimum viable eSSL integration = Phases 0–3 (Mode A).** Everything after that is an upgrade to real time; the core map / normalise / store logic is shared across all modes.

---

# PART E — Data model and API contracts

## E1. `employees` — face columns

```sql
ALTER TABLE employees
  ADD COLUMN face_descriptor          json,
  ADD COLUMN face_registered_at       timestamp,
  ADD COLUMN face_consent_given_at    timestamp,
  ADD COLUMN face_consent_revoked_at  timestamp;
```

| Column | Why |
|---|---|
| `face_descriptor` | The 128-d signature. In `$hidden`, so it never leaves the API; read only inside auth and match code paths. |
| `face_registered_at` | When the current enrolment was captured |
| `face_consent_given_at` | Stamped once at first enrolment and preserved through revoke, for the regulator audit trail |
| `face_consent_revoked_at` | Stamped on revoke; together with the given-at date the row tells the full opt-in/opt-out lifecycle |

Device-side, the mapping column is `employees.attendance_number` (added by `2026_05_01_000006_add_employee_extended_fields.php`), which must be digits-only and **unique per tenant**.

## E2. Attendance tables

**`attendances` — daily summary**

```sql
CREATE TABLE attendances (
  id bigserial PRIMARY KEY,
  client_id       bigint REFERENCES clients(id),
  branch_id       bigint REFERENCES branches(id),
  employee_id     bigint NOT NULL REFERENCES employees(id),
  user_id         bigint REFERENCES users(id),
  attendance_date date NOT NULL,
  check_in_at     timestamp,          -- first 'in' of the day (computed)
  check_out_at    timestamp,          -- last  'out' of the day (computed)
  check_in_method  enum,              -- face | manual | auto | device
  check_out_method enum,
  check_in_match_distance  decimal(5,4),
  check_out_match_distance decimal(5,4),
  check_in_ip  / lat / lng,
  check_out_ip / lat / lng,
  status enum,                        -- Present | Late | Half Day | …
  notes  text,
  created_at / updated_at / deleted_at,
  UNIQUE (employee_id, attendance_date)
);
```

The UNIQUE constraint is the safety net: even with `lockForUpdate()`, it prevents two parallel inserts creating duplicate days.

**`attendance_punches` — intraday ledger**

```sql
CREATE TABLE attendance_punches (
  id bigserial PRIMARY KEY,
  attendance_id bigint NOT NULL REFERENCES attendances(id) ON DELETE CASCADE,
  employee_id   bigint NOT NULL REFERENCES employees(id)   ON DELETE CASCADE,
  punched_at  timestamp NOT NULL,
  direction   enum NOT NULL,          -- in | out  (strictly alternating per day)
  label       varchar(50),            -- 'Check In' | 'Step Out' | 'Lunch Out' | 'Meeting' | …
  method      enum,                   -- face | manual | auto | device
  match_distance decimal(5,4),
  ip varchar(64), lat decimal(10,7), lng decimal(10,7),
  -- device provenance (added 2026_07_27_000001)
  device_serial  varchar(64) INDEX,   -- which terminal sent it
  device_user_id varchar(50),         -- the raw ID as sent by the device
  raw_status     varchar(8),          -- 0..5 as sent, before normalisation
  notes text,
  created_at / updated_at / deleted_at,
  INDEX (punched_at)
);
```

Why a separate table: multiple punches per day need a row-per-punch model; direction alternation is a per-day invariant that child rows make trivial to query (`ORDER BY punched_at DESC LIMIT 1`); and HR reports / payroll can join punches without disturbing the daily summary. The parent's `check_in_at` / `check_out_at` are denormalised so list and dashboard queries need no join — `recomputeSummary()` keeps them in sync after every insert.

> Keep `device_user_id` **and** the mapped `employee_id`. Storing the raw ID keeps disputes reconstructable even if `attendance_number` is later changed.

## E3. Import endpoint contract

**`POST /api/attendance/import`** · auth: `auth:sanctum` + `user.active` (admin only)

Request — a multipart file **or** JSON rows:

```json
{
  "device_serial": "NFZ8252004771",
  "device_terminal_id": 3,
  "punches": [
    { "user_id": "101", "punched_at": "2026-07-27 09:03:12", "status": "0" },
    { "user_id": "101", "punched_at": "2026-07-27 18:31:40", "status": "1" }
  ],
  "source_tz": "Asia/Kolkata"
}
```

Response — always reports, never silently drops:

```json
{
  "data": {
    "imported": 42,
    "skipped_duplicates": 5,
    "unmatched_user_ids": ["777", "888"],
    "employees_affected": 19,
    "date_range": ["2026-07-01", "2026-07-27"],
    "errors": [
      { "user_id": "101", "punched_at": "2026-06-30 09:00", "reason": "before date_of_joining" }
    ]
  }
}
```

- **Tenant-scoped:** only employees under the caller's `client_id` are matched.
- **Idempotent:** re-posting the same rows increments `skipped_duplicates`, not `imported`.
- `unmatched_user_ids` drives an HR "fix these attendance numbers" follow-up.

## E4. Uniqueness and idempotency guards

| Guard | Where |
|---|---|
| Partial unique index on `attendance_number` scoped to `client_id`, ignoring NULLs | Migration `2026_07_27_000002` (⏳ held on a data duplicate) plus a friendly 422 in the employee FormRequest |
| Unique `(employee_id, punched_at)` | Migration `2026_07_28_000001` — blocks double-insert on re-upload / re-push |
| Unique `(employee_id, attendance_date)` | `attendances` table — blocks duplicate day rows |

## E5. `device_terminals` registry

```
device_terminals
  id, client_id, branch_id, serial (unique), name, timezone,
  allowed_ips, is_active, last_seen_at, ingest_token (reserved),
  created_at / updated_at
```

Binds a physical terminal to a tenant and branch. Mandatory for Mode C (it is how a push resolves its tenant), and useful for Mode B auditing. Managed from **HR → Biometric Devices**, backed by the tenant-scoped `DeviceTerminalController`.

---

# PART F — Go-live and deployment

Target environment: **`https://cbc.idims.in`**.

## F1. What ships (27 files)

- **Backend (new):** `DeviceTerminalController`, `EsslDeviceController`, `DeviceTerminal`, `AttendancePunchService`, `EsslAttendanceImporter`.
- **Backend (modified):** `AttendanceController`, `EmployeeController`, `AttendancePunch`, `bootstrap/app.php` (CSRF-exempt `iclock/*`), `routes/api.php`, `routes/web.php`.
- **Migrations (5):** `2026_07_27_000001`…`000004`, `2026_07_28_000001`.
- **Frontend:** `HrBiometricDevices.tsx` plus `App.tsx`, `constants.ts`, `ClockIn.tsx`, `routeAccess.ts`, `IdimsHeader.tsx`, `LayoutMenuData.tsx` — **must be rebuilt** (`npm run build`).
- **On-prem tool:** `tools/essl-connector/` — runs on an office PC, **not** on the web server.
- **Docs:** this guide, the audit register, the Postman collection.

## F2. Commit and push

```bash
git add -A
git commit -m "eSSL biometric attendance integration + attendance audit fixes"
git push origin saas          # or whichever branch prod deploys from
```

Confirm which branch `cbc.idims.in` builds from and merge accordingly.

## F3. Deploy on the server

```bash
git pull
composer install --no-dev --optimize-autoloader
php artisan migrate --force                 # runs the 5 new migrations
npm ci && npm run build                     # or upload a prebuilt public/build
php artisan optimize:clear && php artisan optimize
php artisan queue:restart                   # if a worker is running
```

⚠️ **Before `migrate`** — the two UNIQUE-index migrations fail if production data violates them. Check first:

```sql
-- duplicate attendance numbers (blocks 2026_07_27_000002)
SELECT client_id, attendance_number, count(*) FROM employees
 WHERE deleted_at IS NULL AND attendance_number <> '' GROUP BY 1,2 HAVING count(*) > 1;

-- duplicate punch instants (blocks 2026_07_28_000001)
SELECT employee_id, punched_at, count(*) FROM attendance_punches
 WHERE deleted_at IS NULL GROUP BY 1,2 HAVING count(*) > 1;
```

Resolve every duplicate, then migrate.

## F4. Production one-time setup

1. **Register the terminal** — HRMS → Biometric Devices → Add Device (serial `NFZ8252004771` → the correct client and branch), or via tinker on the server.
2. **Connector service account** (Mode B only) — create a dedicated `client_admin` user that is never used for interactive login and mint a token:
   `User::firstOrCreate(['email'=>'essl-connector@…'],[… 'user_type'=>'client_admin','client_id'=>…])->createToken('essl-connector')->plainTextToken`
3. **Employee mapping** — set each device employee's **Attendance Number = their device User ID**, unique per client (now enforced).

## F5. Choosing the production ingestion mode — a security decision

### ✅ Mode B — connector pull (RECOMMENDED for production)

No public exposure. The connector runs on an **office PC** (it needs LAN access to the device at `192.168.1.85:4370`) and POSTs to the **authenticated** `/api/attendance/import` over HTTPS.

- `tools/essl-connector/config.ini` → `api_base_url = https://cbc.idims.in`, `api_token = <prod service token>`, `device_ip = 192.168.1.85`, `device_terminal_id = <prod id>`.
- Run it on-prem via Task Scheduler or NSSM. **Nothing on `cbc.idims.in` is exposed.**

### ⚠️ Mode C — device push (only if real-time is required)

Device → `COMM → Cloud Server`: Server Mode `ADMS`, Server Address **`cbc.idims.in`**, Port **`443`**, **HTTPS ON**, Domain Name ON.

**This makes `/iclock/*` internet-facing.** Because a device authenticates only by its serial — a printed, guessable value — anyone on the internet could inject punches. If you choose Mode C you **must**:

- Set the terminal's **`allowed_ips`** to the office's public static IP (HR → Biometric Devices → edit; **blank means accept ANY IP**).
- Ensure `TrustProxies` is configured correctly so `allowed_ips` sees the real client IP.
- Preferably implement the reserved `ingest_token` check — see `docs/ATTENDANCE_AUDIT_2026-07-28.md`, "serial is the sole credential".

## F6. Verification on live

| Check | Where |
|---|---|
| Menu unlocks | HRMS → **Biometric Devices** (top-nav mega-menu and sidebar) |
| Register / list terminals | Biometric Devices screen |
| Face clock-in shows only **Check In / Check Out** | `/clock-in` |
| Face punch lands | Punch → hard refresh → Today's Summary + timeline |
| Device punch lands | Mode B: within the poll interval. Mode C: near real-time → HR → Attendance, source **BIOMETRIC** |
| Import (file / JSON) | Biometric Devices → Import Punches (admin only) |
| API smoke test | Postman collection with `base_url = https://cbc.idims.in` → Login → import → iclock |

## F7. Post-deploy security review

- Terminal `allowed_ips` set (Mode C).
- Review the **OPEN** items in `docs/ATTENDANCE_AUDIT_2026-07-28.md` before wide rollout — especially **import-after-payroll-finalize**. (faceLogin org-selection is now implemented.)
- Confirm production `.env`: `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL=https://cbc.idims.in`.

## F8. Rollback

All five migrations are additive (new tables, columns, indexes) and reversible:

```bash
php artisan migrate:rollback --step=5
git revert <commit>      # then rebuild the frontend
```

No existing table is dropped or destructively altered.

## F9. Key deployment facts

- The **connector always runs on-prem** — it needs LAN access to the device. Only the **API** lives on `cbc.idims.in`.
- **Local test data does not go to production.** Production starts clean: register the terminal there and set attendance numbers there.
- All 11 attendance-audit fixes (alternation, tenant safety, soft-delete 500s, import authorisation) ship with this deploy.

---

# PART G — QA

## G1. Device-import test matrix

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | User ID not mapped | Import a log whose User ID matches no `attendance_number` | Row **skipped and reported** in the summary, never silently dropped |
| 2 | Status all `0` | Import a day where the function keys were never pressed | The normaliser alternates in/out **by time** correctly |
| 3 | Missing out-punch | An odd number of punches in a day | Day shows "Missing Out"; the open pair auto-closes at 21:00 like the face path |
| 4 | Re-import the same file | Upload the same AttLog twice | **No duplicate** punches — fully idempotent |
| 5 | Device clock in local time | Import IST-timed logs | Punches display the correct IST time after import |
| 6 | Shared attendance number | Two employees with the same number | **Blocked at validation** / flagged — never mis-assigned |
| 7 | Punch before joining | A log dated before `date_of_joining` | **Rejected**, mirroring the face-path guard |
| 8 | Cross-branch | Import for an employee in branch B, then look at branch A | Lands under B's tenant/branch; invisible to A |
| 9 | Mixed device + face | Same day carries a device punch and a face punch | Timeline stays strictly alternating; the two sources render distinctly |
| 10 | Break punches | Logs carrying status 2 / 3 (break out / in) | Handled as ordinary in/out taps; totals correct |
| 11 | Large file | A month of logs for many employees | Completes; the summary is accurate; no timeout or partial write |
| 12 | Unmatched + matched mix | A file with some mapped and some unmapped IDs | Mapped rows import, unmapped are listed — no all-or-nothing failure |

## G2. Face biometric test focus

| # | Scenario | Expected |
|---|---|---|
| 1 | Register a face with consent unchecked | 422 — the `accepted` rule blocks it |
| 2 | Admin registers another employee's face, same tenant | Allowed |
| 3 | Admin registers a **cross-tenant** employee's face | Refused |
| 4 | Clock in twice in a row (two `in` punches) | Second attempt 422 with a direction hint |
| 5 | Clock in with a different person's face | 422 — distance above 0.55 |
| 6 | Face login with a good match | Token issued, same gates as password login |
| 7 | Face login for an email with no face on file | Generic 422 — must not reveal whether the email exists |
| 8 | Face login repeated failures | Brute-force lockout, sharing the cache key with `/api/login` |
| 9 | Revoke face data | Descriptor wiped, `face_consent_revoked_at` stamped, `face_consent_given_at` preserved |
| 10 | Any API response containing an employee | `face_descriptor` is **never** present; only the `face_registered` boolean |
| 11 | Six-punch day | Timeline alternates correctly; worked-hours total is right |
| 12 | Clock-In page as a user with no Employee row | Bounces to dashboard — working as designed |

## G3. Error decoder — bug, or expected?

| What you see | Meaning | Log as a bug? |
|---|---|---|
| Rows "skipped — no matching employee" | Those User IDs are not set as any `attendance_number` | ❌ Setup — fill the field or re-enroll |
| Punch time off by 5½ hours | Device clock wrong, or the timezone conversion is missing | ✅ If the device clock is correct → **log it** |
| Two same-direction punches accepted | The normaliser failed | ✅ **Log — high priority** |
| Duplicate punches after a re-import | Idempotency broke | ✅ **Log — high priority** |
| Punch assigned to the wrong person | Shared / duplicate `attendance_number` | ✅ Log it, and fix the number |
| A branch A import visible in branch B | Tenant isolation broke | ✅ **Log — high priority** |
| Import blocked for a pre-joining date | The guard working as designed | ❌ Expected |
| Device menu will not open | No admin enrolled on the device | ❌ Device setup — enroll a Super Admin |
| "Loading face-recognition models…" forever | Weight files missing under `public/face-models/` | ❌ Deployment — redo §C2 |
| "Camera permission was denied" with no prompt | Site is on `http://`, or the browser has it blocked | ❌ Environment — see §C4 |
| "Failed to fetch dynamically imported module: face-api___js.js" | Stale Vite dependency cache | ❌ Dev environment — `rm -rf node_modules/.vite`, restart |
| Face captures but no face detected | Lighting too dark, face too far, or more than one face in frame | ❌ User-side — better lighting, one face, fill the circle |
| "Face login is not available for this account" | No user, no linked Employee, or no descriptor on file | ❌ Enroll via Profile → Security → Register Face |
| "Punches: 0" but check_in_at / check_out_at populated | A row predating the multi-punch refactor | ❌ Fixed by the backfill migration |

## G4. Bug-report template (paste into JIRA)

```
Title:      [HRMS Biometric] <symptom in one line>
Module:     Face attendance / Face login / Biometric device import
Mode:       Face  |  Device Mode A (CSV)  |  Device Mode B (LAN)  |  Device Mode C (Cloud)
Env:        local / staging / production      Tenant / Branch: <client / branch>
Device:     <model + serial>                  Browser: <name + version>

Pre-conditions:
  - Employee attendance_number set and unique?   Y / N   (value: ____)
  - Device User ID == attendance_number?          Y / N
  - Device date/time correct (IST, DST off)?      Y / N
  - time_tracking = Biometric?                    Y / N
  - Face registered (face_registered = true)?     Y / N
  - Site served over HTTPS?                       Y / N

Steps to reproduce:
  1.
  2.
  3.

Expected:
Actual:
Import summary (imported / skipped / unmatched):
Punch timeline in HR Attendance:
Match distance shown (face):
Screenshots: (device log or export + the app HR sheet)
```

---

# PART H — Reference

## H1. Glossary

| Term | Meaning |
|---|---|
| **User ID / Enrollment No.** | The number an employee is enrolled under on the device; **must equal** `attendance_number` |
| **AttLog** | The device's attendance transaction log (punch records) |
| **Status code** | The In/Out/Break code set by the device function keys (0–5) |
| **VerifyMode** | How a punch was verified (1 = fingerprint, 15 = face, …) |
| **ADMS / Push SDK** | The protocol where the **device** POSTs logs to a server (Mode C) |
| **Pull SDK / `zkemkeeper.dll`** | The Windows library used to poll a device over TCP 4370 (Mode B) |
| **eTimeTrackLite** | eSSL's official desktop software, used for Mode A export |
| **Comm Key** | The device connection password; the connector must match it |
| **Normaliser** | Our importer step that re-derives strict in/out alternation from raw logs |
| **`method = device`** | The punch source value for device punches — renders as **BIOMETRIC** |
| **`method = face`** | The punch source value for webcam face punches — also renders as **BIOMETRIC** |
| **Descriptor** | The 128-float face embedding produced by face-api.js and stored on the employee |
| **Distance** | Euclidean distance between two descriptors; lower means a closer match |

## H2. Key code locations

| What | Where |
|---|---|
| Shared punch logic (day, next direction, append, recompute) | `app/Services/AttendancePunchService.php` |
| Device normaliser | `app/Services/EsslAttendanceImporter.php` |
| Face match + punch endpoints | `app/Http/Controllers/Api/AttendanceController.php` — `facePunch()`, `recomputeSummary()`, `resolveDayStatus()` |
| Face enrolment / revoke | `app/Http/Controllers/Api/FaceBiometricController.php` |
| Face login | `app/Http/Controllers/Api/AuthController.php` — `faceLogin()` |
| Mode C receiver | `app/Http/Controllers/Api/EsslDeviceController.php` |
| Terminal registry | `app/Http/Controllers/Api/DeviceTerminalController.php`, `app/Models/DeviceTerminal.php` |
| `attendance_number` column | `database/migrations/2026_05_01_000006_add_employee_extended_fields.php` |
| `method` enum | `database/migrations/2026_05_12_060843_create_attendance_punches_table.php` |
| HR sheet emits `attendanceNumber` | `AttendanceController.php` (HR list payload) |
| **BIOMETRIC** source pill | `resources/js/pages/hrms/HrAttendance.tsx` |
| Clock-in screen | `resources/js/pages/ClockIn.tsx` |
| Biometric Devices screen | `resources/js/pages/hrms/HrBiometricDevices.tsx` (route `/hr/devices`, gated by `hr.attendance`) |
| On-prem connector | `tools/essl-connector/essl_connector.py` |

## H3. Related documents

| Document | Covers |
|---|---|
| `docs/ATTENDANCE_AUDIT_2026-07-28.md` | The 11 fixed attendance bugs plus the remaining OPEN items |
| `docs/HR_ATTENDANCE.md` | The wider HR attendance module |
| `docs/PAYROLL_QA_RULES.md` | How attendance feeds payroll rules |
| `docs/ESSL_Attendance.postman_collection.json` | API smoke tests for import and iclock |

## H4. Open follow-ups (backlog, not built)

**Face**

1. **Liveness challenge** — blink or head-turn before capture, to defeat printed-photo spoofing.
2. **Encryption at rest** — a Laravel encrypted cast or Postgres `pgcrypto` on `face_descriptor`.
3. **Retention policy** — auto-revoke and wipe after N years of employee inactivity (scheduled job).
4. **Geo-fence** — lat/lng are already captured on every punch but not enforced; wire `branch.geo_lat / geo_lng / geo_radius_m` to refuse out-of-radius punches.
5. **Model weights on a CDN** — currently self-hosted in `public/`; move to S3 / CloudFront if the deployment artifact grows too large.
6. **Manual punch (HR override)** — `method = 'manual'` exists in the enum but has no UI; add an HR modal to add or edit a punch with a reason.
7. ~~faceLogin organisation selection~~ — **now implemented**: an email registered in more than one tenant returns a 409 `needs_org_selection` picker on `/login/face`, the same gate password and Google login apply.

**Device**

8. **Held migration** `2026_07_27_000002` — resolve the duplicate `attendance_number` (client 1, number `1212`) then apply the per-client unique index.
9. **Per-device `ingest_token`** — the column is reserved; today the serial plus the IP allow-list is the only credential for Mode C.
10. **Import after payroll finalisation** — partly addressed: a punch landing in a **locked (paid)** period is now rejected, and draft/generated payslips are recomputed in place. An **approved** run still keeps its snapshot.
11. **Night-shift handling** — a shift crossing midnight is not yet modelled in day resolution.
12. **Automated device time sync** — Modes B and C can push the device clock; not implemented.

---

*Consolidated master document — supersedes the four source sheets for day-to-day reference. When any behaviour below changes, update this file and note the change date.*
