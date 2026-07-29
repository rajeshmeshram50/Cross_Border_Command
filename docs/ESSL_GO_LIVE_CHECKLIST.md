# ESSL Attendance — Go-Live Checklist (cbc.idims.in)

> Deploying the eSSL biometric + face-attendance work to production and verifying it end
> to end. Everything is currently **local & uncommitted** on branch `saas`.
>
> ⚠️ **Read §4 first.** Going public exposes the device push endpoint (`/iclock/*`) to the
> internet — pick the ingestion mode deliberately.

---

## 0. What ships (27 files)
- **Backend (new):** `DeviceTerminalController`, `EsslDeviceController`, `DeviceTerminal`,
  `AttendancePunchService`, `EsslAttendanceImporter`.
- **Backend (modified):** `AttendanceController`, `EmployeeController`, `AttendancePunch`,
  `bootstrap/app.php` (CSRF-exempt `iclock/*`), `routes/api.php`, `routes/web.php`.
- **Migrations (5):** `2026_07_27_000001..000004`, `2026_07_28_000001`.
- **Frontend:** `HrBiometricDevices.tsx` + `App.tsx`, `constants.ts`, `ClockIn.tsx`,
  `routeAccess.ts`, `IdimsHeader.tsx`, `LayoutMenuData.tsx` → **must be rebuilt** (`npm run build`).
- **On-prem tool:** `tools/essl-connector/` — runs on an office PC, **not** on the web server.
- **Docs:** integration guide, audit register, Postman collection.

---

## 1. Commit & push
```
git add -A
git commit -m "eSSL biometric attendance integration + attendance audit fixes"
git push origin saas          # or the branch prod deploys from
```
Confirm which branch `cbc.idims.in` builds from (main? saas? a release branch?) and merge accordingly.

---

## 2. Deploy on the server (cbc.idims.in)
```
git pull
composer install --no-dev --optimize-autoloader
php artisan migrate --force                 # runs the 5 new migrations
npm ci && npm run build                     # or upload prebuilt public/build
php artisan optimize:clear && php artisan optimize
php artisan queue:restart                   # if a worker is running
```
⚠️ **Before `migrate`** — the two UNIQUE-index migrations fail if prod data violates them:
```
# duplicate attendance numbers (blocks 000002):
SELECT client_id, attendance_number, count(*) FROM employees
 WHERE deleted_at IS NULL AND attendance_number <> '' GROUP BY 1,2 HAVING count(*)>1;
# duplicate punch instants (blocks 2026_07_28_000001):
SELECT employee_id, punched_at, count(*) FROM attendance_punches
 WHERE deleted_at IS NULL GROUP BY 1,2 HAVING count(*)>1;
```
Resolve any duplicates first, then migrate.

---

## 3. Prod DB one-time setup
1. **Register the terminal in prod**: HRMS → Biometric Devices → Add Device (serial
   `NFZ8252004771` → correct client + branch), or via tinker on the server.
2. **Connector service account** (only if using Mode B): create a dedicated
   `client_admin` user (never used for interactive login) and mint a token — same as local:
   `User::firstOrCreate(['email'=>'essl-connector@…'],[...'user_type'=>'client_admin','client_id'=>…])->createToken('essl-connector')->plainTextToken`
3. **Employee mapping**: set each device employee's **Attendance Number = their device User
   ID** (unique per client — now enforced).

---

## 4. Pick the ingestion mode on prod — SECURITY DECISION

### ✅ Mode B — connector pull (RECOMMENDED for production)
No public exposure. The connector runs on an **office PC** (it needs LAN access to the
device at `192.168.1.85:4370`) and POSTs to the **authenticated** `/api/attendance/import`
over HTTPS.
- `tools/essl-connector/config.ini` → `api_base_url = https://cbc.idims.in`,
  `api_token = <prod service token>`, `device_ip = 192.168.1.85`, `device_terminal_id = <prod id>`.
- Run it on-prem (Task Scheduler / NSSM). **Nothing on `cbc.idims.in` is exposed.**

### ⚠️ Mode C — device push (only if you need real-time)
Device → `COMM → Cloud Server`: Server Mode `ADMS`, Server Address **`cbc.idims.in`**,
Port **`443`**, **HTTPS ON**, Domain Name ON.
**This makes `/iclock/*` internet-facing.** Because a device authenticates only by its
Serial (a printed, guessable value), anyone on the internet could inject punches. If you
use Mode C you MUST:
- Set the terminal's **`allowed_ips`** to your office's **public/static IP** (HR → Biometric
  Devices → edit; blank = accept ANY IP).
- Ensure `TrustProxies` is correct so `allowed_ips` sees the real client IP.
- (Recommended) implement the reserved `ingest_token` check — see the audit register
  (`docs/ATTENDANCE_AUDIT_2026-07-28.md`, "serial is the sole credential").

---

## 5. Verify on live (`https://cbc.idims.in/...`)
| Check | Where |
|---|---|
| Menu unlocks | HRMS → **Biometric Devices** (top-nav mega-menu + sidebar) |
| Register/list terminals | Biometric Devices screen |
| Face clock-in shows only **Check In / Check Out** | `/clock-in` |
| Face punch lands | punch → refresh (hard) → Today's Summary + timeline |
| Device punch lands | Mode B: within the poll interval; Mode C: near real-time → HR → Attendance (source **BIOMETRIC**) |
| Import (file/JSON) | Biometric Devices → Import Punches (admin only now) |
| API smoke test | Postman collection with `base_url = https://cbc.idims.in` → Login → import → iclock |

---

## 6. Post-deploy security (public prod)
- Terminal `allowed_ips` set (Mode C).
- Review the **OPEN** items in `docs/ATTENDANCE_AUDIT_2026-07-28.md` before wide rollout —
  especially **faceLogin org-selection** (public `/login/face`) and **import-after-payroll-
  finalize**.
- Confirm `.env` on prod: `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL=https://cbc.idims.in`.

---

## 7. Rollback
All 5 migrations are additive (new tables / columns / indexes) and reversible:
```
php artisan migrate:rollback --step=5
git revert <commit>   # then rebuild frontend
```
No existing tables are dropped or altered destructively.

---

## Key facts
- The **connector always runs on-prem** (LAN access to the device); only the **API** lives
  on `cbc.idims.in`.
- **Local test data does NOT go to prod** — prod starts clean; register the terminal and set
  attendance numbers there.
- All 11 audit fixes (alternation, tenant-safety, soft-delete 500s, import authz) ship with
  this deploy.
