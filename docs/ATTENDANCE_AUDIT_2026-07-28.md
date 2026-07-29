# Attendance System — Deep Bug Audit & Fix Register (2026-07-28)

> End-to-end audit of **both** the eSSL device/biometric punch path **and** the face
> login / face clock-in path, plus status derivation, payroll interaction, and the data
> model. Four parallel audit passes. This sheet lists every verified finding with
> severity, file:line, the concrete failure scenario, and **status** (✅ FIXED this pass /
> ⏳ OPEN with recommendation).
>
> Fixes were verified (out-of-order alternation, soft-delete restore, null-client guard,
> authz gate) and the live device import still works idempotently.

---

## ✅ FIXED THIS PASS (11)

| # | Sev | Bug | Fix (file) |
|---|---|---|---|
| 1 | **CRITICAL** | **Out-of-order punch insert silently breaks in→out alternation and corrupts worked-time.** A device import / backfill with a timestamp earlier than existing punches got the wrong direction → two `in` in a row → wrong hours. (Confirmed live during setup.) | New `AttendancePunchService::recomputeDay()` re-derives EVERY punch's direction+label from strict time order after any insert; importer calls it per day. `AttendancePunchService.php`, `EsslAttendanceImporter.php` |
| 2 | **CRITICAL** | **Null `client_id` disabled tenant scoping → cross-tenant punch misrouting.** A terminal whose client row was deleted (nulls `client_id`) ran an unscoped `attendance_number` lookup across ALL tenants. | Importer fails closed: aborts + logs when `client_id` is null. `EsslAttendanceImporter.php` |
| 3 | **CRITICAL** | **Soft-deleted attendance row → permanent 500 on next punch.** The `unique(employee_id,date)` index is non-partial; `findOrCreateDay` didn't see the trashed row and `create()` hit the constraint. | `findOrCreateDay` now `withTrashed()` finds + `restore()`s the row. `AttendancePunchService.php` |
| 4 | **HIGH** | **First-punch-of-day race → 500.** `lockForUpdate` can't serialise a not-yet-existent row; two concurrent first-punches both create → unique violation. | `findOrCreateDay` catches the unique violation and re-resolves. `AttendancePunchService.php` |
| 5 | **HIGH** | **`/attendance/import` had no authorization.** Any authenticated employee could fabricate/alter attendance for anyone in the tenant. | Gated to super-admin / client-admin; connector runs on a dedicated `client_admin` service account. `AttendanceController.php::import` |
| 6 | **MED-HIGH** | **Soft-deleted punches resurrected on device re-push.** Dedup `exists()` excluded trashed rows, so a deleted (corrected) punch came back when the device re-sent its buffer. | Dedup now `withTrashed()`; + new **DB partial-unique index** `(employee_id, punched_at)` for concurrency-safe idempotency; importer catches the race. `EsslAttendanceImporter.php`, migration `2026_07_28_000001` |
| 7 | **MEDIUM** | **facePunch never checked disabled/terminated status.** A terminated employee with a live login + enrolled face could keep clocking in. | `facePunch` rejects `isDisabled()`. `AttendanceController.php` |
| 8 | **MEDIUM** | **Terminated / attendance-tracking-off employees still imported** from the device. | Importer skips `Terminated`/`Resigned` and `attendance_tracking=false` employees (reported in `errors`). `EsslAttendanceImporter.php` |
| 9 | **MEDIUM** | **`dailyView` future date marked everyone "Absent."** `date` param unclamped. | Clamped to today. `AttendanceController.php::dailyView` |
| 10 | **MEDIUM** | **Contradictory summary on an open day** (check_out_at set while still clocked in; out-only day = Present/0h). | `recomputeSummary` leaves `check_out_at` null while the day ends on an open `in`. `AttendancePunchService.php` |
| 11 | **MEDIUM** | **No row cap on the public `/iclock` push (DoS) + no header-skip parity.** | 5000-row cap + header-line skip in `parseAttlog`. `EsslDeviceController.php` |

---

## ⏳ OPEN — recommended, not fixed this pass (larger / design decisions)

### Face authentication
| Sev | Bug | file:line | Recommendation |
|---|---|---|---|
| **HIGH** | `faceLogin` has **no org-selection** — with the same email in multiple tenants it logs into whichever stored descriptor is numerically closest (noise decides the tenant). Password/Google login return `needs_org_selection`; face does not. | `AuthController.php:206-256` | Return `needs_org_selection` (409) when >1 same-email account has a face / matches; require `client_id`. |
| **HIGH/MED** | Closest-match winner may be an **inactive/terminated** account → blocks an otherwise-valid login. | `AuthController.php:230-286` | Filter candidates to active/eligible BEFORE closest-match selection. |
| **MEDIUM** | **No liveness / replay protection** — server trusts any POSTed 128-float descriptor; geo is advisory. Buddy/remote punch + a leaked descriptor is a reusable credential against the public `/login/face`. | `AttendanceController.php:1080+`, `AuthController.php:218+` | Document as an assurance gap; add challenge-nonce + optional geofence if enforcement needed. |
| **MEDIUM** | **Face descriptors stored plaintext at rest** (passwords are Crypt-encrypted; biometrics are not). | migration `2026_05_12_042448:23`, `Employee.php:113` | Cast `'face_descriptor' => 'encrypted:array'`. |
| **MEDIUM** | **Enrollment dedup is a TOCTOU race** (no lock) → one face → two employees. | `FaceBiometricController.php:78-100` | Wrap dedup+update in a locked transaction. |
| **LOW-MED** | **Inconsistent descriptor validation** — `faceLogin`/`register` have no value bounds or length re-check (punch has `between:-5,5`); degenerate all-zero / `INF` vectors accepted. | AuthController:188, FaceBiometricController:57 | Apply `size:128` + `between:-5,5` on all three paths; reject degenerate vectors. |
| **LOW** | Brute-force lockout is settings-gated (**default OFF**); face relies solely on 20/min IP throttle. | `AuthController.php:35-51` | Enable brute-force for the face route regardless of tenant setting. |

### Payroll / status interaction
| Sev | Bug | Recommendation |
|---|---|---|
| **HIGH** | **Import after payroll generate is silently ignored** (payslip freezes a live snapshot at generate; a later import never reaches pay; a `paid` run can't reopen). `PayrollService.php:376-383,626-628` | Block/warn `import` into a finalized period; mark the run stale on drift. |
| **HIGH** | **Regularization ↔ device import conflict.** Regularization deletes+rewrites the day at minute precision (`method=manual`); a later device `in` appends → open/unpaired day; or the delete wipes device punches + provenance. `AttendanceRegularizationController.php:462` | Lock a regularized day against auto-import (a `regularized_at` guard the importer respects) or reconcile. |
| **HIGH/MED** | **Cross-branch `attendance_number` mis-routing.** `attendance_number` is unique per-CLIENT and the importer ignores the terminal's `branch_id` (dead `$branchId` param) — two branches can't reuse device number `1`, and a branch-B punch resolves to branch-A's employee. | Scope importer resolution by terminal `branch_id`; make uniqueness per-branch (or per-device). |
| **MEDIUM** | **Attendance weekly-off vs payroll working-days diverge** (`parseWeeklyOff` uses the employee's off-day + Sunday fallback; payroll always subtracts Sundays). | Derive payroll working-days from the same weekly-off + holiday logic. |

### Punch / model / import (lower)
| Sev | Bug | Recommendation |
|---|---|---|
| **HIGH** | **Overnight / night-shift = 0 worked hours** (bucketed by local date; the 21:00 auto-checkout cap zeroes a >21:00 open `in`; a leading `out` next day is skipped). `Attendance.php:93-152` | Make auto-checkout shift-aware; pair a trailing open `in` with next-day leading `out`. |
| **LOW-MED** | `Carbon::parse` non-strict (rolls over `25:00`); embedded offsets ignore terminal tz. `EsslAttendanceImporter.php:92` | `createFromFormat('Y-m-d H:i:s', …, $tz)` strict. |
| **LOW-MED** | **Leading-zero device IDs** (`001` vs `1`) never match → silently unmatched. | Normalise numeric IDs on both sides. |
| **LOW-MED** | Dead `$branchId` param; `import()`'s `branch_id` input has no effect. | Wire it through or remove. |
| **LOW-MED** | `import()` trusts body `client_id` for super-admin (client-less). `AttendanceController.php:101` | Require a validated `device_terminal_id` instead. |
| **LOW** | Serial is the sole credential; default `allowed_ips` blank = any IP; `ingest_token` unused; TrustProxies dependency. | Require `ingest_token` and/or default IP allow-list; document TrustProxies. |
| **LOW** | `employee_id` FKs `cascadeOnDelete` — a hard `forceDelete` wipes all attendance/punch history. | `restrictOnDelete` or archival guard. |
| **LOW** | IST hardcoded for the face path & worked-time while the importer honours per-terminal tz — day-boundary divergence for non-IST tenants. | Thread terminal/employee tz into the worked-seconds accessor. |
| **INFO** | **Half-Day is never computed** anywhere (dead enum + dead branch). | Implement or remove the concept. |

---

## Verified SAFE (probed, no bug)
- Read-side tenant/branch scoping in `index` / `dailyView` / `employeeSummary` (client_id always from auth; branch_user pinned to own branch).
- `import()` blocks selecting another client's `device_terminal_id`.
- Unknown/inactive/disallowed-IP serial: acked but not ingested; tenant always from the terminal, never the payload.
- `revoke` wipes descriptor + anonymises historical match distances; descriptor never leaked over the API.
- Same-instant punches for DIFFERENT employees both persist correctly.

---

## Fix verification (this pass)
- Out-of-order import → `09:in, 12:out, 18:in` — **alternation OK ✅**
- Soft-deleted day → `findOrCreateDay` **reused + restored ✅** (no 500)
- Null-client import → **0 imported (fail-closed) ✅**
- Import authz → service account **allowed**, regular employee **403 ✅**
- Idempotency migration applied; real device re-import → **0 imported / all dupes, alternation OK ✅**
