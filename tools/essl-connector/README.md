# eSSL LAN Connector (Mode B — Pull SDK)

Bridges an eSSL / ZKTeco biometric terminal that is **not** using cloud/ADMS push
into Cross_Border_Command. It polls the device over the LAN (TCP 4370) and forwards
new punches to `POST /api/attendance/import`.

> If your device supports **ADMS/Cloud push (Mode C)**, you don't need this — just
> point the device's Cloud Server at the app (see the main doc §26). Use this
> connector only for pull-mode / older devices, or when you can't expose the app.

## How it fits

```
Device (192.168.1.201:4370)  ──TCP/ZKTeco SDK──►  essl_connector.py  ──HTTPS──►  /api/attendance/import
                                                    (this PC, on LAN)             (same normaliser as /iclock)
```

The connector is a thin bridge: the app-side normaliser (map by attendance_number,
device-local → UTC, alternate in/out, **idempotent**) does the real work, so it's
safe to re-run — duplicates are skipped.

## Setup

1. **Install** (Python 3.10+):
   ```
   pip install -r requirements.txt
   ```
2. **Register the terminal** in the app: HR → Biometric Devices → Add Device
   (serial from Menu → System → Device Info). Note its id.
3. **Mint a service token** on the server:
   ```
   php artisan tinker
   >>> App\Models\User::find(<service_user_id>)->createToken('essl-connector')->plainTextToken
   ```
4. **Configure**:
   ```
   copy config.example.ini config.ini
   ```
   Edit `config.ini` — `device_ip`, `api_base_url`, `api_token`, `device_terminal_id`.
5. **Run**:
   ```
   python essl_connector.py
   ```
   It prints each cycle: how many punches were sent, imported, deduped, unmatched.

## Run it unattended (Windows)

- **Task Scheduler**: create a task "At startup" → run `python C:\path\essl_connector.py`,
  restart on failure.
- **NSSM** (nssm.exe install ESSLConnector) to run it as a Windows service.

## Notes

- **Cursor** (`cursor.txt`) records the last-sent punch time so each poll only forwards
  new records. Delete it to re-scan the whole device buffer (safe — imports are idempotent).
- The connector **does not clear** the device log, so the device keeps its own buffer as a
  fallback.
- Employee **User ID on the device must equal their Attendance Number** in the app, or the
  punch is reported as `unmatched`.
- Device clock timezone is taken from the registered terminal (`timezone`) at import time.
