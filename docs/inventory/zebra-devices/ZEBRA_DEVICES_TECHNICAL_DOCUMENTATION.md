# Zebra Devices (Printing & Scanning) — Technical Documentation

> How label printing and Zebra handheld scanning are built, and why they are
> built that way.
> Audience: developers joining the module, and whoever has to change it.
> Server / certificate runbooks: [ZEBRA_SERVER_SETUP.md](../../ZEBRA_SERVER_SETUP.md),
> [ZEBRA_DEVICE_SETUP_SHEET.md](../../ZEBRA_DEVICE_SETUP_SHEET.md),
> [storage/certs/README.md](../../../storage/certs/README.md).
>
> _Last updated: 2026-11-12. Schema pulled from the live database with
> `Schema::getColumnListing()` on that date._

---

## 1. Stack

| Layer | Technology | Used for |
|---|---|---|
| PDF | `barryvdh/laravel-dompdf` | Box stickers and location labels |
| QR | `chillerlan/php-qrcode` (ECC **H**) | Every printed QR and the `/qr` PNG |
| QR in browser | `qrcode` (npm) | Only the device **enrollment** QR on Scan Devices |
| Signing | `hash_hmac('sha256')` + `hash_hkdf` | Sticker signatures |
| Device trust | mTLS at the front door (Apache `mod_ssl`, nginx, or `storage/certs/tls-proxy.cjs` locally) | Identifying the handheld |
| Device fallback | SHA-256-hashed bearer credential `CBCD-…` | Devices without a certificate |
| Handheld UI | React page in the SPA, installed as a PWA (`public/manifest.json`, `public/sw.js`) | The scanner app |
| Input | Zebra **DataWedge** keyboard wedge | The barcode arrives as keystrokes + ENTER |
| DB | PostgreSQL (partial unique index, check constraint) | Tasks, logs, devices |

There is no printer driver, no ZPL and no Zebra SDK in the codebase. Printing
is "render a PDF and let the OS print it".

---

## 2. Architecture

```
  PRINTING (staff host, Sanctum)                 SCANNING (scan host, device)
  ─────────────────────────────                  ────────────────────────────
  SPI Stage 03 ─► SpiBoxController               Zebra TC27 · Chrome PWA
     downloadSticker()                             DataWedge types the QR URL
        │ stickerData()                             │
        │ StickerKey::url('BOX', id, client)        │ https://scan.<host>/ps/<key>
        ▼                                           ▼
  pdf/spi-box-sticker.blade ─► dompdf A4      ┌─ front door (Apache / nginx / node) ─┐
                                              │ TLS + client cert vs Device CA       │
  Inventory masters ─► Rack/Shelf/Zone/       │ strip client X-Scan-Cert-CN          │
     WarehouseController                      │ set   X-Scan-Cert-CN = verified CN   │
        │ labelData() → scanValue()           └───────────────┬──────────────────────┘
        │ StickerKey::fromShort('RC:7')                       ▼
        ▼                                     SPA route /ps/:scanKey → PutawayScan.tsx
  pdf/inventory-label.blade ─► dompdf A4        fetch('/api/scan/putaway/scan')
  …/qr ─► PNG  ·  …/preview ─► JSON             headers: X-Scan-Device (fallback)
                                                      ▼
                                              SpiPutawayScanController
                                                device() ── scan_devices
                                                  Auth::setUser(actor)
                                                  TenantContext::fromUser(actor)
                                                classify() ── StickerKey::parse()
                                                scanBox() / scanLocation()
                                                commit() ── one transaction:
                                                  occupancy RESERVED→OCCUPIED
                                                  p2p_spi_putaways → placed
                                                  location lock released
                                                  task → scanned
                                                  activity logs

  BACK OFFICE (staff host)
  SPI Stage 04 ─► SpiPutawayTaskController::store()  → p2p_spi_putaway_tasks (pending)
               ─► queue / show / activity / cancel
  Inventory → Scan Devices ─► ScanDeviceController   → scan_devices
```

Two trust domains that must not be confused:

| | Real flow | Simulation |
|---|---|---|
| Pages | `/putaway-scan`, `/ps/:key` → [PutawayScan.tsx](../../../resources/js/pages/p2p/putaway/PutawayScan.tsx) | `/inventory`, `/inventory/stickers`, `/inventory/scan-log`, `/s/:key` → [putAwayStore.ts](../../../resources/js/pages/inventory/putAwayStore.ts), [ScanLanding.tsx](../../../resources/js/pages/inventory/ScanLanding.tsx) |
| Signing | HMAC-SHA256, server only | FNV fold in JS, sample data |
| Storage | PostgreSQL | `localStorage` |
| Shared | `scan_devices` + `/api/scan/device-check` (the simulation's device check is real) | |

`StickerKey::PATH` is `/ps/` precisely so a real carton never lands in the
simulation's `/s/` landing page. Both paths are **parsed**, so labels printed
before the split still resolve.

---

## 3. The sticker payload and its maths

[app/Services/Inventory/StickerKey.php](../../../app/Services/Inventory/StickerKey.php)

```
URL   = rtrim(STICKER_URL ?: APP_URL, '/') . '/ps/' . dots(key)
key   = body . '|' . sign(body)
body  = 'CBC1' | tenant | TYPE | id | nonce
nonce = substr(base36(FNV1a32("{tenant}:{TYPE}:{id}", basis 0x2166136f)), 0, 5)   // deterministic
sign  = substr(base32(HMAC_SHA256(body, K)), 0, 16)                               // 80 bits
K     = HKDF_SHA256(STICKER_SECRET ?: APP_KEY, 32, info 'cbc-sticker-hmac-v2')
```

Design points, each from the code's own comments:

- **A URL, not text.** *"A stranger's phone decodes a bare string and shows it
  to them; it decodes a URL and OPENS it, which puts the scan on our server,
  where a request with no device credential is answered with 'Device blocked'."*
- **Dots, not pipes, on the wire** — no percent-escaping, so a smaller QR.
- **The id, never the code.** Box codes restart at B-001 per invoice; location
  codes restart at 001 per branch.
- **Deterministic nonce** — a reprint tomorrow is byte-identical to today's.
- **80 bits, base32.** Every character is another QR module; base32 survives a
  scanner profile that upper-cases. `parse()` upper-cases the whole key first.
- **No default secret.** The old `'demo-signing-secret'` shipped in git and
  made every label forgeable. If `STICKER_SECRET` is unset (or still that
  literal), the key derives from `APP_KEY`. HKDF keeps this use from being
  replayable against anything else `APP_KEY` protects.

### 3.1 Legacy acceptance

`parse()` checks the HMAC first; if that fails and
`inventory.sticker_accept_legacy` is on, it checks the retired 7-char FNV
fold. The result reports `valid` and `legacy` separately. **Refusing is the
caller's job** — `parse()` only reports.

### 3.2 What the classifier accepts

`SpiPutawayScanController::classify()`:

| Input | kind | signed | valid |
|---|---|---|---|
| Any `CBC1` key / URL (`/ps/` or `/s/`) | from TYPE: `BOX`→box, `SHELF`→shelf, `RACK`→rack, `ZONE`→zone, **anything else → null** | true | from `parse()` |
| `SH:n` / `RC:n` / `ZN:n` | shelf / rack / zone | false | **true** |
| Digits only | box | false | **true** |
| Anything else | null | false | false |

Consequence: a `WAREHOUSE` key is signed and parsed but classifies to `null`
and is refused as `unreadable`. Unsigned short forms are accepted — they still
have to pass the device-client and task checks, but they carry no forgery
protection (bug sheet SEC-07).

### 3.3 Where the payload is decided

One source per label family, because they drifted before:

| Label | Payload source |
|---|---|
| Box sticker | `SpiBoxController::stickerData()` → `StickerKey::url('BOX', $box->id, $spi->client_id)` |
| Location PDF, `/qr`, `/preview` | `BaseInventoryController::scanValue()` → `StickerKey::fromShort('RC:7', auth()->user()->client_id)`, falling back to `'RC:7'` when there is no tenant; then `stickerPayload()` returns it untouched |

---

## 4. Device identity

### 4.1 Resolution order

`SpiPutawayScanController::device()` and `ScanDeviceController::check()`:

1. `X-Scan-Cert-CN` header → strip `^zebra-` (case-insensitive) → `ScanDevice::where('serial', …)->first()`.
2. Else the token: `X-Scan-Device` header, or `device_token` / `token` in the
   body → `sha256(trim(token))` → `token_hash` (unique).

The header is trustworthy **only** because the front door strips any copy the
client sent and sets it from the verified certificate:

| Front door | Strip | Set |
|---|---|---|
| Apache | `RequestHeader unset X-Scan-Cert-CN` | `RequestHeader set X-Scan-Cert-CN "%{SSL_CLIENT_S_DN_CN}s" "expr=%{SSL_CLIENT_VERIFY} == 'SUCCESS'"` |
| nginx | `fastcgi_param HTTP_X_SCAN_CERT_CN $ssl_client_s_dn_cn` (unconditional overwrite) | same line |
| Local node proxy | `delete headers['x-scan-cert-cn']` | set from `getPeerCertificate().subject.CN` when `socket.authorized` |

PHP itself does not check where the request came from. If PHP is reachable
around the front door, a forged header *is* the device (bug sheet **SEC-01**).
PHP-FPM / `artisan serve` must listen on `127.0.0.1` or a socket only.

### 4.2 Acting as a person

```php
$actor = $device->actorId()                    // enrolled_by ?: created_by
    ? User::where('client_id', $device->client_id)->find($device->actorId())
    : null;
// none → 403 device_unclaimed
Auth::setUser($actor);           // guard only; no session, no token issued
TenantContext::fromUser($actor); // turns the BelongsToTenant scope back on
```

Why, from the comment: half the machinery reaches for `auth()->user()`
unprompted — the tenant trait that fills `client_id`,
`SupplierInvoiceService::log()`'s `performed_by` — and on a sessionless request
those came back null and hit a NOT NULL column at the last step of a put-away.

### 4.3 Credential

`ScanDevice::issueToken()` → `'CBCD-' . Str::upper(Str::random(40))`, stored as
SHA-256. A DB leak hands out no working credentials. The enrollment link is
`<STICKER_URL>/putaway-scan/enroll#<token>` — a **fragment**, so it never
reaches a server or proxy access log. The page writes it to `localStorage`
(`cbc_scan_device_token_v1`) and `history.replaceState`s it out of the URL.

---

## 5. Data model

### 5.1 `scan_devices`

`id, client_id, serial, label, model, location, status, token_hash, last_seen_at, created_by, created_at, updated_at, enrolled_by, enrolled_at`

| Column | Notes |
|---|---|
| `client_id` | FK `clients`, cascade on delete |
| `serial` | varchar 64; **unique (`client_id`, `serial`)** — not globally |
| `model` | default `TC27` |
| `location` | free text; surfaced to the SPA as `branch` |
| `status` | `active` \| `suspended` \| `retired` (varchar, no DB check) |
| `token_hash` | char 64, **unique** |
| `created_by` | FK `users`, null on delete — the admin who added it |
| `enrolled_by`, `enrolled_at` | the person bound on the handheld (migration `2026_10_16_000002`) |

### 5.2 `p2p_spi_putaway_tasks`

`id, client_id, branch_id, supplier_invoice_id, putaway_id, box_id, occupancy_id, task_code, warehouse_id, zone_id, rack_id, shelf_id, required_scans, completed_scans, box_scan_at, shelf_scan_at, status, capacity_reserved_pct, issued_at, issued_by, device_id, device_serial, completed_at, cancelled_at, cancelled_by, failed_reason, expires_at, created_by, updated_by, created_at, updated_at, box_confirmed_at, shelf_confirmed_at, fail_count, zone_scan_at, rack_scan_at`

| Constraint | Definition | Why |
|---|---|---|
| Status check | `status in ('pending','scanned','failed','cancelled','expired')` | |
| `uq_putaway_task_open_box` | unique `(box_id) where status = 'pending'` | *"One open task per box. A second one would be a second instruction to place the same box, and the two could name different shelves."* |
| `idx_putaway_task_open` | `(branch_id, status) where status = 'pending'` | The floor queue reads only pending rows |
| `p2p_spi_putaway_tasks_code_unique` | unique `(client_id, branch_id, task_code)` | |

The destination (`warehouse_id … shelf_id`) is **copied** from the put-away
row at creation: *"what the operator was TOLD to scan is what a mismatch must
be judged against. A scan can confirm the instruction or refuse it; it never
rewrites it."*

`shelf_scan_at` / `shelf_confirmed_at` are the **location slot** whether the
location is a shelf or a rackless zone (`locationSlot()`).

### 5.3 `inventory_putaway_activity_logs`

`id, client_id, branch_id, subject_type, subject_id, occupancy_id, putaway_id, task_id, box_id, event, from_location, to_location, actor_type, actor_id, device_id, meta, created_by, created_at`

Append-only (`UPDATED_AT = null`). Indexes `(box_id, created_at)`,
`(occupancy_id, created_at)`, `(client_id, actor_id, created_at)`.
Events (`PutawayActivityLog` constants): `assigned`, `reassigned`,
`task_created`, `task_cancelled`, `scan_passed`, `scan_failed`,
`confirmed_manual`, `confirmed_device`, `released`, `lock_acquired`,
`lock_released`.

`meta.act` distinguishes rows that share an event: `scan`, `confirm`,
`lookup`, `stale_reset`. `meta.reason` holds the refusal code; the sentence is
**not stored** — `SpiPutawayTaskController` maps codes back through
`PUTAWAY_REFUSALS`.

### 5.4 Tables this module writes but does not own

| Table | Written by | What |
|---|---|---|
| `p2p_spi_boxes` | sticker routes | `sticker_printed_at` |
| `p2p_spi_activities` | `SupplierInvoiceService::log()` | `sticker_printed`, `putaway_scan_task_created`, `putaway_confirmed` |
| `p2p_spi_putaways` | task create / cancel, `commit()` | `status`, `task_id`, `confirmed_at`, `confirmed_by`, `verify_method='scan'` |
| `inventory_location_occupancy` | `commit()` via `LocationOccupancyService::occupy()` | RESERVED → OCCUPIED |
| `inventory_location_locks` | task create / cancel, `commit()` | re-pointed to the task, extended, released `RELEASED_COMPLETED` |

### 5.5 Migrations

| Migration | |
|---|---|
| `2026_10_12_000001_create_scan_devices_table` | allow-list |
| `2026_10_14_000001_create_inventory_location_occupancy_table` | reservations |
| `2026_10_14_000002_create_p2p_spi_putaway_tasks_table` | tasks + check + partial indexes |
| `2026_10_14_000003_create_inventory_putaway_activity_logs_table` | log |
| `2026_10_14_000007_create_inventory_location_locks_table` | locks |
| `2026_10_16_000001_add_confirm_steps_to_putaway_tasks_table` | `*_confirmed_at`, `fail_count` |
| `2026_10_16_000002_add_enrolled_by_to_scan_devices_table` | `enrolled_by`, `enrolled_at` |
| `2026_10_16_000003_add_zone_rack_scans_to_putaway_tasks_table` | `zone_scan_at`, `rack_scan_at` |

---

## 6. The task state machine

```
                 store()  (Stage 04 Option 01)
                    │  put-away row → awaiting_scan
                    ▼
   ┌──────────── pending ────────────┐
   │   box_scan_at   shelf_scan_at    │  scan / confirm / release / 3-strike reset /
   │   (either order)                 │  stale reset all stay inside pending
   │            both set              │
   │               ▼                  │
   │     commit()  (auto on the scan  │
   │      that closes the pair, or    │
   │      POST /complete)             │
   └──────┬───────────────────┬───────┘
          ▼                   ▼
       scanned            cancelled  (back office; row → draft, shelf still held)

   expired / failed : allowed by the check constraint, set by no code today
```

`currentStep()`: `scan_box` until `box_scan_at`; then `scan_<slot>` until
`shelf_scan_at`; then `complete`. `stepLabel()` names the deepest level still
owed (`nextLocationLevel()`), but **any** level of this task's chain is accepted.

`markLocationScanned($kind)` fills that level and every level above it — a
shelf proves its rack and zone. A zone scan on a rackless task also fills
`shelf_scan_at`, finishing the location slot.

### 6.1 Attempts and resets

| Rule | Code |
|---|---|
| `MAX_FAILS = 3` blamed refusals in a row → `resetScans()` | `refuse()` |
| A successful box or location scan sets `fail_count = 0` | `scanBox()`, `scanLocation()` |
| `already_placed` is not blamed (`$blame = false`) | `scanBox()` |
| Stale: partial run with last scan older than `SCAN_STALE_MINUTES` → `resetScans()` + `scan_failed` row with `act: stale_reset` | `dropStaleScans()` on `show` and `scan` |
| Untouched or ready-to-complete tasks never go stale | `scansAreStale()` |

`idleSecondsLeft()` returns a **duration**: *"The handheld's clock is not ours
to trust, and a device ten minutes fast would read every fresh scan as already
expired."*

> `scansAreStale()` falls back to **30** minutes and `idleSecondsLeft()` to
> **5** if the config key is missing. The key always exists in
> [config/inventory.php](../../../config/inventory.php) (default 5), so both
> use 5 — but the two fallbacks disagree.

---

## 7. Concurrency and race handling

| Race | Guard |
|---|---|
| Two open tasks for one box | Partial unique index `uq_putaway_task_open_box`, plus an `exists()` pre-check for a friendly 422 |
| Two tasks raised in the same second get the same code | `allocateCode()` locks the **branch row** `FOR UPDATE` inside the create transaction, then reads the day's max `ZT-YYYYMMDD-NNN` |
| Reservation vanished between assign and scan | `occupancy->liveFor(TYPE_SPI_BOX, box_id)` inside both `store()` and `commit()` → `409` and rollback |
| Box placed by manual confirm while a task was open | `commit()` checks `$row->isPlaced()` → `422 That box is already placed.` |
| Half-placed box | Scans and confirms touch only the task and the log. Occupancy, put-away row, lock and task status flip in **one** transaction in `commit()` |
| A refusal rolled back with its own evidence | `refuse()` writes the log row **outside** any transaction: *"a rollback would destroy the one record it exists to make."* |
| Shelf taken while the task waits on the floor | The location lock's `held_for_type/id` is re-pointed to the task and `expires_at` set to the task's deadline (a browser hold is 30 idle minutes) |
| Shelf taken between Cancel and manual confirm | Cancel keeps the occupancy and the lock, re-points the lock to the put-away row and heartbeats it |
| Two devices on one task | Not locked. The last scan wins on the slot columns; `device_id` records whoever scanned the box last. **Clear box** nulls the device so the next opener starts clean |

---

## 8. Multi-tenancy

| Path | How the tenant is resolved | Where scope is deliberately lifted |
|---|---|---|
| Scan Devices admin | `auth()->user()->client_id`; every query `where('client_id', …)`; `422` without one | — |
| `device-check` | From the device row | Serial lookup is **unscoped** — the request has no tenant yet. Same serial in two clients → first row wins (SEC-04) |
| `/scan/putaway/*` | `device()` → device row's `client_id` → `TenantContext::fromUser($actor)` | — |
| Box lookup in `scanBox()` | `SpiBox::withoutGlobalScopes()->find($id)`, then `client_id` compared to the device | **Lifted on purpose**: a scoped lookup reported another tenant's box as "No box matches that label", sending operators to raise duplicates. The refusal names nothing about the other tenant. Reachable only after the signature check |
| Branch check | `TenantContext::branchId()` vs `box.branch_id`; null on either side = client-wide | — |
| Location names / usability | `nameLocation()` and `locationUsable()` scope by `client_id` (CS-956) | `nameLocation()` without a device (internal display of an already-scoped task) |
| Location contents / children | Read by location id after the scoped name lookup has passed | Occupancy rows are not re-filtered by `client_id` |
| Back-office tasks | `tenant` middleware + `BelongsToTenant` on `SpiPutawayTask`; `show`/`activity` also filter `client_id` explicitly | `allocateCode()` uses `withoutGlobalScopes()` with explicit `client_id` + `branch_id` |
| Location labels | `scopeTenant()` + `branchScope()` in each master controller | — |
| Box sticker | `findSpi()` / `findBox()` through the tenant scope | — |

---

## 9. Where every field comes from

### 9.1 Handheld state

| Field | Source |
|---|---|
| `box.*` | `p2p_spi_boxes` |
| `box.flags` | `p2p_spi_boxes.flags` (json ids) → `inventory_product_flags` (`flag_name`, `behaviour`) |
| `box.products[]` | `p2p_spi_box_items` → `p2p_supplier_invoice_items` → `products` ⟕ `clm_segments` ⟕ `master_uom`; image via `file_url()` |
| `box.vol_weight_kg` | `L×W×H / SpiBox::VOLUMETRIC_DIVISOR` |
| `destination.*` | task's own ids → `inventory_warehouses/zones/racks.code`; shelf name = `<rack code>-SH-<level_no 2-digit>` |
| `location.boxes[]` | `inventory_location_occupancy` where status RESERVED or OCCUPIED |
| `location.max/free/used` | `inventory_shelves.max_weight_kg` (shelves only) vs Σ occupancy `weight_kg` |
| `location.details` | rack / shelf / zone master columns |
| `location.children` | shelves of a rack, or racks of a racked zone, with open tasks grouped per child |

### 9.2 Box sticker

| Field | Source |
|---|---|
| References (SHP, OPP, PROC, PI, PO, SPI) | `refs()` off the SPI and its PO's shipment order / proforma / lead |
| Customer / consignee / supplier | `parties()` — consignee via `consignees.consignee_code`, supplier `vendor_code` |
| Condition | `p2p_spi_boxes.condition` |
| Cold chain | any flag with `behaviour = cold_chain`, **or** a temperature on the box |
| Hazardous + class | flag `behaviour = hazardous`; the class is that flag's `code` |
| Stacking | `box.is_stackable`, else "not stackable" if any box item is not |
| Placement | `p2p_spi_putaways` → codes from the location masters |
| QR | `StickerKey::url('BOX', box.id, spi.client_id)` |

---

## 10. Derived server-side, never accepted from the client

- Which step the task is on, what is expected next, attempts left.
- Whether the pair matches — the page sends only the raw scanned string.
- The task the box belongs to. `task_id` from the page is a hint, dropped if
  closed; the open task is found from the box.
- The staged location — re-proved against the task on the box scan.
- The tenant, the branch and the acting user — from the device row.
- How old a scan is (`idle_seconds_left`).
- The QR payload and its signature.

The page's own header comment: *"It decides nothing… A handheld that could
decide for itself would be a second copy of the rules, free to disagree with
the first."*

---

## 11. Configuration

[config/inventory.php](../../../config/inventory.php):

| Key | Env | Default | Effect |
|---|---|---|---|
| `sticker_url` | `STICKER_URL` | `APP_URL` | Host printed into every QR. **Baked into the carton at print time** |
| `sticker_secret` | `STICKER_SECRET` | none → derived from `APP_KEY` | Must match on every server that prints or reads labels |
| `sticker_accept_legacy` | `STICKER_ACCEPT_LEGACY` | `true` | Accept FNV-signed labels. Turn off once the floor is reprinted |
| `scan_stale_minutes` | `SCAN_STALE_MINUTES` | `5` | Idle window for a half-finished run |

Code constants: `SpiPutawayTask::DEFAULT_TTL_HOURS = 8`, `MAX_FAILS = 3`,
task TTL request range 1–72 h, session list limit 50, due-boxes limit 25.

Throttles (`routes/api.php`): `device-check` 60/min/IP, `/scan/putaway/*`
120/min/IP.

---

## 12. Security posture

| Control | Where | Status |
|---|---|---|
| mTLS on the scan host | Apache `SSLVerifyClient require` / nginx / node proxy | In place |
| Separate Device CA per environment | `device-ca.pem` vs `device-ca-prod.pem` | In place |
| Header strip + reset at the door | §4.1 | In place on every front door |
| PHP not reachable around the door | deployment | **Must be verified per server** (SEC-01) |
| Scanner paths denied on the staff host, incl. `/index.php/…` | Apache `LocationMatch` | Apply the `(index\.php/)?` form (SEC-03) |
| Signed labels, HMAC, no repo secret | `StickerKey` | In place |
| Unsigned short codes accepted | `classify()` | Open (SEC-07) |
| Serial lookup cross-client | `check()`, `deviceFromCert()` | Open (SEC-04) |
| Device admin / task routes permission-gated | — | Open — auth + tenant only (DEV-01, S4-B-01) |
| Revocation | `status = suspended`, checked on every call | In place — no CRL needed |
| Credential at rest | SHA-256 only | In place |
| Credential in transit | fragment URL, never a query string | In place |
| Cross-tenant box read | unscoped by design, refusal reveals nothing | In place |

---

## 13. Frontend internals

| Concern | How [PutawayScan.tsx](../../../resources/js/pages/p2p/putaway/PutawayScan.tsx) does it |
|---|---|
| HTTP | Its own `fetch` wrapper, **not** the shared Axios client — that one treats any 401 as the user's session expiring and redirects to `/login` |
| Timeout | `AbortController`, 15 s → synthetic `no_answer` |
| Idle TLS recovery | On `no_answer`, one navigation to `/putaway-scan` (flag `pwscan_reconnect` in sessionStorage) — the only moment Chrome re-offers the certificate picker |
| Scanner input | One focused `<input>`; a document `keydown` pulls focus back on the first printable key; auto-submit after 120 ms when the text is a whole `CBC1` key (DataWedge without ENTER) |
| Camera / phone | `/ps/:scanKey` posts the key on load. `localStorage` `cbc_putaway_run_v1` carries `task_id` and the staged location across page loads |
| Idle countdown | From the server's `idle_seconds_left`, measured against `Date.now()` (a backgrounded interval is throttled); re-ticks on `visibilitychange` |
| Claiming | When the browser has both the device token and `cbc_token`, one silent `POST /scan-devices/enroll` |
| PWA | `manifest.json` (`start_url /putaway-scan`, standalone, portrait); `sw.js` is a pass-through — **deliberately not a cache** |
| Routing | `App.tsx` short-circuits `/putaway-scan*` and `/ps/*` **before** the auth check, so the page renders with no user session |

---

## 14. Deployment notes

1. Set `STICKER_URL` to the **scan host** before printing anything. Every
   label printed earlier keeps its old host.
2. Set `STICKER_SECRET` identically on every server that prints or scans —
   or leave it unset everywhere a single `APP_KEY` is shared. A mismatch makes
   genuine labels read as tampered.
3. Front door per [ZEBRA_SERVER_SETUP.md](../../ZEBRA_SERVER_SETUP.md); verify
   the forged-header test (§9 step 6 there) after every proxy change.
4. `trustProxies` in [bootstrap/app.php](../../../bootstrap/app.php) trusts
   loopback and private ranges only, so generated URLs come out `https://`.
5. Never `php artisan serve --host=0.0.0.0` on a server.
6. Local: `node storage/certs/tls-proxy.cjs` (:8000 TLS → :8001 PHP).
   `REQUIRE_DEVICE_CERT=0` + `DEV_SCAN_CERT_CN=zebra-<serial>` stands in for a
   certificate — **LAN dev only**: anyone reaching the port becomes that device.
7. Device certificates expire (5 years in the setup sheet, 825 days in the
   server runbook). Calendar the date — a fleet that expires together stops the
   warehouse.

---

## 15. Open technical items

| Item | Detail |
|---|---|
| No task reaper | `expires_at` is set; nothing moves a task to `expired`, and the lock's `expires_at` follows it. Needs a scheduled command |
| Pre-task refusals not logged | `refuse()` logs only when a task is held — `unknown_box`, `device_wrong_client`, `no_task` etc. from the queue leave no row, despite the `scan()` docblock saying every outcome is logged |
| `toClient()['enrolled_at']` | returns `created_at`, not the `enrolled_at` column |
| `update()` cannot clear `location` | `array_filter` drops nulls |
| Stale fallbacks disagree | 30 vs 5 minutes (§6.1) |
| Paper-size comments | Route comment "4x6in" and `label()` docblocks "4x3in" — the code sets A4 |
| Unused sticker data | `logo`, `brand`, `printNo`, `printedOn`, `receiving`, `boxNo`, `totalBoxes`, `productName` are computed and not printed |
| Full register | [ZEBRA_SCAN_BUG_SHEET.md](../../ZEBRA_SCAN_BUG_SHEET.md) — 185 items as of 2026-10-21; some have since been fixed in code (e.g. HMAC signing, CS-956 location scoping), so re-verify an item before ticketing it |
