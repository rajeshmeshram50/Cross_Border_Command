# Database Backup Email — Cross Border Command

Full reference for the automatic database-backup-over-email feature: what it is,
which files drive it, how the "every 15 days" check works, the on-demand APIs,
how to test it, and the current pending issues.

_Last updated: 2026-07-31_

---

## 1. What it does

Automatically takes a **full logical dump of the entire PostgreSQL database**
(`pg_dump`), gzip-compresses it, and **emails it as a `.sql.gz` attachment** to
the configured recipient(s) — **once every 15 days**, with no manual action.

The same pipeline is also exposed as **on-demand APIs** (super-admin only) so an
admin can send a backup right now and check when the next one is due.

- **Scope:** whole database (all tables, all tenants) — one dump per run.
- **Recipient:** `BACKUP_EMAIL_RECIPIENTS` in `.env` (comma-separated).
- **Interval:** 15 days (self-gated — see §4).
- **Sent inline** (not queued) so success/failure is immediate — this project has
  no queue worker running.

---

## 2. Moving parts (files used)

| Part | File | Role |
|---|---|---|
| Scheduled command | [app/Console/Commands/SendDatabaseBackupEmail.php](../app/Console/Commands/SendDatabaseBackupEmail.php) | `backup:email` — gates on 15 days, generates + emails the dump |
| Dump service | [app/Services/DatabaseBackupService.php](../app/Services/DatabaseBackupService.php) | Runs `pg_dump` (whole DB) → temp `.sql` file |
| Mailable | [app/Mail/DatabaseBackupMail.php](../app/Mail/DatabaseBackupMail.php) | Builds the email + `.sql.gz` attachment |
| Schedule entry | [routes/console.php](../routes/console.php) | Runs `backup:email` daily at **02:00** |
| API controller | [app/Http/Controllers/Api/BackupController.php](../app/Http/Controllers/Api/BackupController.php) | On-demand status + send endpoints (super-admin) |
| API routes | [routes/api.php](../routes/api.php) | `/api/backup/email/status`, `/api/backup/email/send` |
| Marker file | `storage/app/backups/.last_email_backup` | Stores last successful send timestamp (the 15-day clock) |
| Postman collection | [docs/DB_Backup_APIs.postman_collection.json](DB_Backup_APIs.postman_collection.json) | Import to test all endpoints |

---

## 3. Config (`.env`)

```env
# Recipients for the automatic 15-day database backup email (comma-separated).
# Falls back to MAIL_FROM_ADDRESS when unset.
BACKUP_EMAIL_RECIPIENTS=php@inhpl.com

# pg_dump binary used by DatabaseBackupService
PG_DUMP_PATH="C:/Program Files/PostgreSQL/18/bin/pg_dump.exe"

# Mail transport (must be valid — see §7 pending issues)
MAIL_MAILER=smtp
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=php@inhpl.com
MAIL_PASSWORD=<app-password>       # Gmail App Password, NOT the login password
MAIL_ENCRYPTION=tls
MAIL_FROM_ADDRESS=php@inhpl.com
MAIL_FROM_NAME="INHPL GROUP"
```

> After any `.env` change: `php artisan config:clear`

---

## 4. How the "every 15 days" check works

It is **not** a hard calendar rule. It is a **marker-file gate** so the interval
stays correct even if the scheduler misses a day.

Flow (see [SendDatabaseBackupEmail.php:42-50](../app/Console/Commands/SendDatabaseBackupEmail.php#L42-L50)):

1. The scheduler runs `backup:email` **daily at 02:00** — but it does **not**
   email every day.
2. The command reads the marker file `storage/app/backups/.last_email_backup`,
   which holds the timestamp of the **last successful send**.
3. It compares "days since last send" against `INTERVAL_DAYS = 15`:
   - **< 15 days** → prints `Not due yet — next due <date>` and exits. No email.
   - **≥ 15 days**, OR **marker file missing** (never sent) → generates the dump
     and emails it.
4. On a **successful** send it writes the current timestamp into the marker file
   ([line 100](../app/Console/Commands/SendDatabaseBackupEmail.php#L100)) — so the
   15-day clock restarts from that moment.

So the effective rule is: **last successful send + 15 days**, not "the 1st and
16th of the month".

```
Day 0   send OK  → marker = Day 0
Day 1..14  run daily → "Not due yet"  (no email)
Day 15  run → 15 days elapsed → send OK → marker = Day 15
Day 16..29 → "Not due yet"
...
```

---

## 5. On-demand APIs (super-admin only)

All require `Authorization: Bearer <sanctum_token>` and `user_type = super_admin`.
Base URL locally: `http://127.0.0.1:8000`.

### GET `/api/backup/email/status`
When it last went out, when it's next due, configured recipients.
```json
{
  "interval_days": 15,
  "recipients": ["php@inhpl.com"],
  "last_sent_at": null,
  "last_sent_human": null,
  "next_due_at": null,
  "is_due_now": true,
  "ever_sent": false
}
```

### POST `/api/backup/email/send`
Generate + email a backup **now** (bypasses the 15-day gate, re-stamps the marker).
```json
{
  "message": "Backup emailed successfully.",
  "recipients": ["php@inhpl.com"],
  "size_kb": 342,
  "sent_at": "2026-07-31T..."
}
```

### POST `/api/backup/email/send` with body (override recipients for this run)
```json
{ "to": "php@inhpl.com,ceo@inhpl.com" }
```

**Errors:** `403` (not super-admin) · `422` (no valid recipients) · `500`
(pg_dump or SMTP failure — the real error message is returned).

---

## 6. How to test / verify (QA)

**Check status (when it last went, when due):**
```
GET /api/backup/email/status
```

**Force a send now (ignore the 15-day gate):**
```powershell
php artisan backup:email --force
```

**Normal gated run (respects 15 days):**
```powershell
php artisan backup:email
# → "Not due yet — next due <date>"  if < 15 days since last send
```

**Dry run (no dump, no email — just shows recipients):**
```powershell
php artisan backup:email --dry
```

**Inspect the marker file directly:**
```powershell
cat storage/app/backups/.last_email_backup
```

**See the schedule is registered:**
```powershell
php artisan schedule:list
```

---

## 7. Pending issues (must fix for auto-send to actually work)

1. **Mail credentials must be valid.**
   Currently Gmail SMTP with a placeholder App Password → `535 Authentication
   Failed`. Until a real **Gmail App Password** (2-Step Verification must be ON)
   is set in `MAIL_PASSWORD`, no backup email will send — even after 15 days.
   The dump itself succeeds; only the email step fails.

2. **OS scheduler not installed.**
   Laravel's schedule only fires if the OS runs `schedule:run` every minute. On
   this Windows server there is **no such task**, so the 02:00 daily trigger
   never fires on its own. Register it once (as admin):
   ```powershell
   schtasks /create /tn "Laravel Scheduler - CBC" /sc minute /mo 1 `
     /tr "php c:\xampp\htdocs\Cross_Border_Command\artisan schedule:run" /ru SYSTEM
   ```
   Until this exists, only the **on-demand API / artisan command** works; the
   automatic 15-day cycle does not.

---

## 8. Quick reference

| I want to… | Do this |
|---|---|
| Change who receives it | Edit `BACKUP_EMAIL_RECIPIENTS` in `.env`, then `php artisan config:clear` |
| Send a backup right now | `php artisan backup:email --force` or `POST /api/backup/email/send` |
| See when next backup is due | `GET /api/backup/email/status` |
| Reset the 15-day clock | Delete `storage/app/backups/.last_email_backup` |
| Change the interval | Edit `INTERVAL_DAYS` in `SendDatabaseBackupEmail.php` |
| Change the run time | Edit `->dailyAt('02:00')` in `routes/console.php` |
