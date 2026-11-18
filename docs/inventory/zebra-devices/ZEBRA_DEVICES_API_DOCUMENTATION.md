# Zebra Devices (Printing & Scanning) — API Documentation

> Complete REST reference for the Zebra handheld flow: the device allow-list,
> the device-authenticated put-away scan API, the back-office scan-task routes,
> and every endpoint that **prints** a QR label (box stickers and
> warehouse / zone / rack / shelf labels).
> Source of truth: [routes/api.php](../../../routes/api.php).
> Audience: QA, integrators, anyone hitting these routes from Postman or curl.
>
> _Last updated: 2026-11-12._

---

## 0. How to read this

| | |
|---|---|
| Base URL | `{{base}}/api` — staff host for the back office, **scan host** (`https://scan.kryptone.ai`, dev `https://scan-dev.kryptone.ai`) for the handheld |
| Staff auth | `Authorization: Bearer <sanctum token>` — routes under `auth:sanctum` → `user.active` → `tenant` |
| Device auth | Client certificate (mTLS) → front door sets `X-Scan-Cert-CN: zebra-<serial>`. Fallback: `X-Scan-Device: CBCD-…` header or `device_token` body field |
| Content type | `application/json` in, JSON out — except the PDF / PNG routes in §5 and §6 |
| Envelope | Scan routes: `{ status, code?, message?, data }`. Device check: `{ authorized, code, device }`. Admin device routes: `{ data, token? }` |

Groups, in the order a box travels:

| § | Group | Auth |
|---|---|---|
| 1 | Device allow-list (Inventory → Scan Devices) | Staff |
| 2 | Public device check | None (device credential) |
| 3 | Handheld put-away scan API | Device |
| 4 | Back-office scan tasks | Staff |
| 5 | Printing — SPI box sticker | Staff |
| 6 | Printing — location labels | Staff |
| 7 | The QR payload (what every label encodes) | — |
| 8 | Refusal codes | — |
| 9 | Status-code cheat sheet | — |
| 10 | curl, end to end | — |

**Not true:** there is no ZPL, no Zebra Browser Print and no printer API. Every
label is a **PDF** rendered by dompdf and printed from the browser's print
dialog to whatever printer the desk has. "Printing" in this module means
*generating the PDF*.

---

## 1. Device allow-list — `/api/scan-devices`

Controller: [ScanDeviceController](../../../app/Http/Controllers/Api/ScanDeviceController.php).
All routes scope by `auth()->user()->client_id`. A user with no `client_id`
(super-admin) gets:

```
422  Scan devices belong to a client; log in as a client user.
```

No module permission is checked on any of these routes — any logged-in client
user can call them (bug sheet **DEV-01**).

### 1.1 `GET /api/scan-devices`

Lists this client's devices, ordered **active → suspended → retired**, then by
label.

```json
{ "data": [ {
  "id": 1, "serial": "26013524701106", "label": "Pack bench 2", "model": "TC27",
  "branch": "Nagpur WH", "status": "active",
  "enrolled_at": "2026-10-12T09:14:02+00:00",
  "last_seen_at": "2026-11-11T16:40:11+00:00"
} ] }
```

> `enrolled_at` in this shape is the row's **`created_at`**, not the
> `enrolled_at` column (see [ScanDevice::toClient()](../../../app/Models/ScanDevice.php)).
> `branch` is the free-text `location` column, not a branch id.

### 1.2 `POST /api/scan-devices` — add a device

| Field | Rule | On failure |
|---|---|---|
| `serial` | required, string, max 64, unique per client | `This serial is already enrolled.` |
| `label` | required, string, max 120 | Laravel default |
| `model` | nullable, string, max 40 — blank becomes `TC27` | Laravel default |
| `branch` | nullable, string, max 120 — stored in `location` | Laravel default |

`201`:

```json
{ "data": { "id": 4, "serial": "…", "status": "active", … }, "token": "CBCD-7Q2K…(40 chars)" }
```

**The plaintext `token` is returned exactly once, here.** Only its SHA-256 is
stored. Status is always `active` on create; `created_by` is the caller.

### 1.3 `PUT /api/scan-devices/{id}` — status / label / location

| Field | Rule |
|---|---|
| `status` | sometimes, `active` \| `suspended` \| `retired` |
| `label` | sometimes, string, max 120 |
| `branch` | sometimes, nullable, string, max 120 |

Returns `{ data }`. Suspending is the **revocation**: it takes effect on the
device's next call, with no Apache / nginx reload.

> Sending `branch: null` does **not** clear the location — the controller
> `array_filter`s out nulls before saving.

### 1.4 `POST /api/scan-devices/{id}/rotate` — new credential

Issues a fresh `CBCD-…` token and overwrites `token_hash`. The old token stops
working immediately. Response: `{ data, token }`. Does not touch the client
certificate — a cert-authenticated device keeps working.

### 1.5 `DELETE /api/scan-devices/{id}`

Hard delete. `{ "message": "Device removed." }`. The Scan Devices screen does
**not** offer this — it offers Retire instead, which keeps history.

### 1.6 `POST /api/scan-devices/enroll` — bind a person to a handheld

Called **on the handheld**, by a logged-in user, to make them the author of
every put-away this device confirms (`enrolled_by`). Called automatically and
silently by the scan page when the browser has both a device token and a staff
login (§ Code Walkthrough 8.3).

| Field | Rule |
|---|---|
| `token` | required, string, max 100 — the device's `CBCD-…` credential |

| Status | Body |
|---|---|
| `200` | `{ "authorized": true, "code": "device_ok", "device": { …, "actor_id": 12 } }` |
| `404` | `{ "authorized": false, "code": "rejected_unauthorized_device", "message": "That credential does not belong to any device on this account." }` |
| `403` | `{ "authorized": false, "code": "rejected_suspended_device", "message": "This device is suspended and cannot be enrolled." }` (or `retired` → `rejected_unauthorized_device`) |

`created_by` is never changed by enroll — it stays the admin who added the row.

---

## 2. `POST /api/scan/device-check` — public

`throttle:60,1` (60/min/IP). No session.

Body (optional when a certificate is present): `{ "token": "CBCD-…" }`.

Resolution order: `X-Scan-Cert-CN` header → strip `zebra-` → look up by
`serial`; otherwise the token hash.

**Always `200`**, so the SPA's global 401 → logout interceptor never fires on a
handheld. The verdict is in `authorized`:

| Device | `authorized` | `code` |
|---|---|---|
| not found | `false` | `rejected_unauthorized_device` (and `device: null`) |
| `active` | `true` | `device_ok` — also stamps `last_seen_at` |
| `suspended` | `false` | `rejected_suspended_device` |
| `retired` | `false` | `rejected_unauthorized_device` |

> The serial lookup is **not client-scoped** (`ScanDevice::where('serial', …)->first()`).
> The DB allows the same serial under two clients; the first row wins (bug
> sheet **SEC-04**). Never register another company's serial.

---

## 3. Handheld put-away scan API — `/api/scan/putaway`

Controller: [SpiPutawayScanController](../../../app/Http/Controllers/Api/P2p/SpiPutawayScanController.php).
`throttle:120,1`. **No Sanctum token.** Every call runs `device()` first:

| Outcome | Status | Body |
|---|---|---|
| No cert CN and no valid token | `401` | `{ status:false, code:"rejected_unauthorized_device", message:"This device is not authorised to scan." }` |
| Device suspended | `403` | `code:"rejected_suspended_device"`, `This device has been suspended. Contact your administrator.` |
| Device retired | `403` | `code:"rejected_unauthorized_device"`, `This device can no longer scan.` |
| No actor (`enrolled_by` and `created_by` both missing / not in this client) | `403` | `code:"device_unclaimed"`, `This device has no enrolled user. Open the enrollment link on it and sign in.` |

On success the request runs **as the device's actor** (`Auth::setUser`) inside
the device's tenant (`TenantContext::fromUser`). The tenant is never read from
the request.

### 3.1 The state object

Every successful call (and most refusals) returns the same `data` shape, built
by `state()`:

```json
{
  "device": { "id":1, "serial":"…", "label":"…", "status":"active", "actor_id":12, "claimed":true },
  "task": {
    "id": 31, "task_code": "ZT-20261111-004", "status": "pending",
    "step": "scan_shelf", "step_label": "Now scan the shelf",
    "expected": ["shelf"], "location_slot": "shelf",
    "chain": [ {"kind":"zone","id":3,"scanned":true,"name":"ZN-003"},
               {"kind":"rack","id":7,"scanned":true,"name":"RC-007"},
               {"kind":"shelf","id":41,"scanned":false,"name":"RC-007-SH-02"} ],
    "next_level": "shelf",
    "required_scans": 2, "completed_scans": 0,
    "fail_count": 0, "attempts_left": 3,
    "box_scan_at": "…", "box_confirmed_at": null,
    "shelf_scan_at": null, "shelf_confirmed_at": null,
    "ready_to_complete": false,
    "last_activity_at": "…", "idle_after_minutes": 5, "idle_seconds_left": 212,
    "issued_at": "…", "expires_at": "…"
  },
  "box": { "id":88, "box_code":"B-003", "putaway_code":"PUT-B-003", "spi_code":"SPI/2026-27/007",
           "scenario":"s2", "scenario_label":"1 product → multiple boxes",
           "condition":"perfect", "is_stackable":true,
           "length_cm":40, "width_cm":30, "height_cm":30, "weight_kg":12,
           "net_weight_kg":11, "gross_weight_kg":12.4, "vol_weight_kg":7.2,
           "temp_min_c":null, "temp_max_c":null,
           "flags":[{"id":2,"name":"Fragile","behaviour":"fragile"}],
           "dimensions_cm":"40 x 30 x 30",
           "products":[ { "sr":1, "code":"P-0012", "name":"…", "quantity":10, "uom":"PCS",
                          "batch_no":"…", "expiry_date":"2027-03-31", "image":"https://…" } ] },
  "destination": { "full":"WH-001 / ZN-003 / RC-007 / RC-007-SH-02",
                   "warehouse":"WH-001", "zone":"ZN-003", "rack":"RC-007", "shelf":"RC-007-SH-02",
                   "zone_id":3, "rack_id":7, "shelf_id":41 }
}
```

`step` is one of `scan_box`, `scan_shelf`, `scan_zone`, `complete`.
`idle_seconds_left` is a **duration**, never a deadline — the handheld's clock
is not trusted. It is `null` when nothing is scanned yet or the pair is in.

### 3.2 `POST /api/scan/putaway/session`

First call the page makes. Body: `{}`.

```json
{ "status": true, "data": {
  "device": { … },
  "open":  [ { "id":31, "task_code":"ZT-…", "box_code":"B-003", "spi_code":"SPI/…",
               "step":"scan_box", "step_label":"Scan the box", "destination":"WH-001 / …" } ],
  "count": 1
} }
```

Up to **50** open (`pending`) tasks for the device's client, oldest first.

### 3.3 `GET /api/scan/putaway/{task}`

Current state for a page refresh. Read-only, so a **finished** task may be
viewed. If the task is open and its partial scans are older than
`SCAN_STALE_MINUTES` they are dropped first, and the response carries:

```json
{ "status": true, "data": { … }, "stale_reset": true,
  "notice": "That put-away was left too long — scan the box again to restart it." }
```

`404  No put-away task found with id {id}.` for a task outside the device's client.

### 3.4 `POST /api/scan/putaway/scan` — a barcode arrived

| Field | Rule | Meaning |
|---|---|---|
| `scanned_value` | required, string, max 255 | Whatever the scanner typed: full URL, `/ps/…` path, dot or pipe key, `SH:41`, or a bare box id |
| `task_id` | nullable, integer | The task the page is carrying. **Ignored if closed** — never fails the scan |
| `staged_location` | nullable, integer | A location scanned *before* any box; re-proved here |
| `staged_kind` | nullable, `shelf` \| `zone` \| `rack` | Kind of the staged location |

The server classifies the value (§7) and routes it to the box or location
handler. Outcomes:

| Scanned | Situation | Status | Response |
|---|---|---|---|
| Box | Open task found, right box | `200` | `notice: "B-003 · ZT-20261111-004"`, `data` = state |
| Box | Staged location matched | `200` | Both slots filled — **commits immediately** (see below) |
| Box | Already put away, a completed task exists | `200` | `already_placed: true`, `notice: "B-003 of SPI/… is already put away."`, `data` = state + `placed` |
| Location | No task, nothing due there | `200` | `step: "lookup"`, `task: null`, `location` = contents |
| Location | No task, N boxes due there | `200` | `staged_location`, `staged_kind`, `staged_name`, `due_here`, `due_boxes[]`, `location` |
| Location | Right level of this task | `200` | state, with that level (and every level above) marked |
| Anything | Refused | `422` | see §8 |

**The scan that closes the pair completes the put-away.** When the box and the
location have both matched, the same `/scan` call runs `commit()` and returns:

```json
{ "status": true, "message": "Put-away complete.", "data": { "task": { "status": "scanned", … }, … } }
```

If a stale run was dropped on the way, the body also carries
`stale_reset: true` and `notice: "The earlier scan timed out — starting this box again."`

### 3.5 `POST /api/scan/putaway/{task}/confirm`

| Field | Rule |
|---|---|
| `slot` | required, `box` \| `shelf` \| `zone` (`zone` writes the shelf columns — one column pair for either location kind) |

Stamps `{slot}_confirmed_at`. Writes no placement.

| Message (422) | When |
|---|---|
| `Scan the {slot} before confirming it.` | slot not scanned |
| `{Slot} is already confirmed.` | already stamped |

### 3.6 `POST /api/scan/putaway/{task}/complete`

The Complete button. Same `commit()` as the auto-complete.

| Status | Message |
|---|---|
| `200` | `Put-away complete.` + state |
| `422` | `Scan both the box and the location first.` |
| `422` | `The put-away row for this task is gone.` |
| `422` | `That box is already placed.` |
| `409` | `That location is no longer held for this box — it must be assigned again.` |

### 3.7 `POST /api/scan/putaway/{task}/release` — Clear box

Gives back every scan the run had proved (box, zone, rack, shelf and both
confirms), resets `completed_scans`, and clears `device_id` / `device_serial`.
The task stays **open**.

```json
{ "status": true, "message": "Box cleared. Scan it again to start this put-away." }
```

### 3.8 Task-state refusals on write routes

`confirm`, `complete` and `release` require the task to be `pending`:

| Task status | `422` message |
|---|---|
| `scanned` | `{code} is already finished — that box is put away.` |
| `cancelled` | `{code} was cancelled. Ask for a new task.` |
| `expired` | `{code} expired before it was scanned. Ask for a new task.` |
| other | `{code} is closed and can no longer be scanned.` |

---

## 4. Back-office scan tasks

Controller: [SpiPutawayTaskController](../../../app/Http/Controllers/Api/P2p/SpiPutawayTaskController.php).
Staff auth. Tenant comes from the `tenant` middleware and the model's
`BelongsToTenant` scope. A user with no `client_id`:
`403 { status:false, message:"No tenant context" }`.

### 4.1 `POST /api/p2p/spi/{id}/putaway/{row}/scan-task` — Option 01, hand it to the floor

| Field | Rule |
|---|---|
| `confirmed` | required, `accepted` — the operator's acknowledgement that the shelf is locked for this box |
| `ttl_hours` | nullable, integer 1–72 — default **8** |

`201 { status:true, data: { …task row…, box_code, putaway_code, destination, next_scan, scans:{done,required} } }`

| Status | Message |
|---|---|
| `404` | `No supplier invoice found with id {id}.` / `No put-away found with id {row} on {SPI}.` |
| `422` | `That box is already placed.` |
| `422` | `Assign a location before sending it for verification.` |
| `422` | `A task is already open for this box.` |
| `409` | `That location is no longer held for this box — assign it again.` |

Side effects in one transaction: task row (`ZT-YYYYMMDD-NNN`), put-away row →
`awaiting_scan`, the location lock re-pointed to the task and extended to
`expires_at`, an activity row `task_created`, and an SPI log
`putaway_scan_task_created`.

### 4.2 `GET /api/p2p/spi/{id}/putaway/tasks`

This invoice's tasks, newest first, with
`counts: { awaiting_scan, placed, cancelled, expired }`.

### 4.3 `GET /api/putaway/tasks` — the floor queue

Paginated (`per_page`, default 10). Optional `status` filter. Pending first.

### 4.4 `GET /api/putaway/tasks/{task}` — status chip

Cheap enough to poll. Adds `spi_code`, `step`, `step_label`,
`ready_to_complete`, `attempts_left`, `is_open`, `is_done`.
`404  No put-away task found with id {id}.`

### 4.5 `GET /api/putaway/tasks/{task}/activity` — every scan, pass and fail

```json
{ "status": true, "data": {
  "task": { "id":31, "task_code":"ZT-…", "status":"scanned", "fail_count":0, … },
  "timeline": [ { "id":901, "at":"…", "event":"scan_failed", "ok":false, "kind":"scan",
                  "reason":"wrong_location", "reason_label":"Wrong location for this task",
                  "attempt":2, "target": { "kind":"shelf", "code":"RC-007-SH-03", "label":"Shelf RC-007-SH-03" },
                  "actor":"Ravi K", "device":"Pack bench 2", "device_serial":"…" } ],
  "stickers": [ { "label":"Shelf RC-007-SH-03", "tries":3, "passed":1, "failed":2,
                  "reasons":[{"code":"wrong_location","label":"…","count":2}], "accepted":true } ],
  "counts": { "total":9, "passed":4, "failed":2, "resets":1, "labels":3, "retried":1 }
} }
```

`kind` is `scan`, `stale_reset` (server dropped an idle run) or `lifecycle`.
`stickers` folds the timeline by label, worst first.

### 4.6 `GET /api/p2p/spi/{id}/putaway/boxes/{box}/activity`

A box's frozen log — handheld **and** manual — for the Scan Logs popover.
`{ box_code, timeline:[ { at, event, ok, reason_label, slot, location, actor, device } ] }`.
`404  No box {box} on this invoice.`

### 4.7 `POST /api/putaway/tasks/{task}/cancel`

| Field | Rule |
|---|---|
| `reason` | nullable, string, max 120 |

Closes the task **and nothing else** — the occupancy stays reserved and the
lock stays held, handed back to a screen's idle heartbeat. The put-away row
returns to `draft`.
`422  That task is already {status}.` / `404  No verification task found with id {id}.`

---

## 5. Printing — SPI box sticker

Controller: [SpiBoxController](../../../app/Http/Controllers/Api/P2p/SpiBoxController.php).
Staff auth. Blade: [spi-box-sticker.blade.php](../../../resources/views/pdf/spi-box-sticker.blade.php).

### 5.1 `POST /api/p2p/spi/{id}/boxes/{box}/sticker` — mark printed

Stamps `sticker_printed_at = now()` (every call), writes an SPI activity
`sticker_printed` (stage 3), and returns the payload:

```json
{ "status": true, "data": {
  "box_code": "B-003", "sticker_printed_at": "…", "code_locked": true,
  "payload": { "spi_code": "SPI/2026-27/007", "box_code": "B-003", "gross_weight_kg": 12.4,
               "products": [ { "description": "…", "quantity": 10, "uom": "PCS" } ] }
} }
```

### 5.2 `GET /api/p2p/spi/{id}/boxes/{box}/sticker/download` — the PDF

`application/pdf`, downloaded as `SPI-2026-27-007-B-003.pdf` (slashes in the
SPI code become dashes). On the **first** download it stamps
`sticker_printed_at` and logs `sticker_printed`; later downloads do not.
The screens call §5.1 first when the user chooses Print, so each print is
logged there.

The QR encodes `StickerKey::url('BOX', box.id, spi.client_id)` (§7).

> **Paper is A4 portrait.** The route comment in `routes/api.php` still says
> "4x6in PDF" — the code calls `->setPaper('a4', 'portrait')`.

### 5.3 `GET /api/p2p/spi/sticker-preview` — local only

Renders the sticker from synthetic data, no auth. `404` outside
`APP_ENV=local`. Query parameters:

| Param | Effect |
|---|---|
| `cold=1&temp=2 to 8 °C` | Cold-chain band + snowflake |
| `haz=3` | Hazardous, class 3 (`hazClass` alias) |
| `fragile=1` | Fragile pictogram |
| `nostack=1` or `stack=no` | Do Not Stack |
| `condition=perfect\|minor\|major\|severe` | Condition line |
| `scenario=s1\|s2\|s3` | Scenario label |
| `refs=absent` | Blank every reference, party and location |

---

## 6. Printing — location labels

Controllers: [WarehouseController](../../../app/Http/Controllers/Api/Inventory/WarehouseController.php),
[ZoneController](../../../app/Http/Controllers/Api/Inventory/ZoneController.php),
[RackController](../../../app/Http/Controllers/Api/Inventory/RackController.php),
[ShelfController](../../../app/Http/Controllers/Api/Inventory/ShelfController.php) —
shared helpers in [BaseInventoryController](../../../app/Http/Controllers/Api/Inventory/BaseInventoryController.php).
Blade: [inventory-label.blade.php](../../../resources/views/pdf/inventory-label.blade.php).
Staff auth; the row is found through the tenant / branch scope, so another
client's id is a `404`.

| Kind | Preview (JSON) | Label (PDF) | QR (PNG) |
|---|---|---|---|
| Warehouse | `GET /api/inventory/warehouses/{id}/preview` | `GET …/warehouses/{id}/label` | `GET …/warehouses/{id}/qr` |
| Zone | `GET /api/inventory/zones/{id}/preview` | `GET …/zones/{id}/label` | `GET …/zones/{id}/qr` |
| Rack | `GET /api/inventory/racks/{id}/preview` | `GET …/racks/{id}/label` | `GET …/racks/{id}/qr` |
| Shelf | `GET /api/inventory/shelves/{id}/preview` | `GET …/shelves/{id}/label` | `GET …/shelves/{id}/qr` |

### 6.1 `…/preview`

```json
{ "status": true, "data": {
  "kind": "RACK", "code": "RC-007", "scan": "https://scan.kryptone.ai/ps/CBC1.12.RACK.7.K3J9Q.ABCD…",
  "title": "Rack 7", "subtitle": "Main WH  /  Cold Zone",
  "rows": { "Shelves": 4, "Size": "2 x 1 x 3 m", "Temp": "2 to 8 C" },
  "path": [ {"label":"WAREHOUSE","code":"…"}, {"label":"ZONE","code":"…"}, {"label":"RACK","code":"RC-007"} ],
  "flags": [ {"text":"COLD CHAIN","tone":"cold"} ],
  "qr": "data:image/png;base64,…",
  "download_url": "https://…/api/inventory/racks/7/label"
} }
```

The preview and the PDF both read the same `labelData()`, so the screen and the
paper cannot disagree.

### 6.2 `…/label`

`application/pdf`, downloaded as `{code}.pdf`. **A4 portrait**, one page. The
docblocks on the four `label()` methods still say "4x3in" — that was the
previous stock.

### 6.3 `…/qr`

`image/png`, `Content-Disposition: inline`, `Cache-Control: private, max-age=86400`.

| Param | Rule |
|---|---|
| `scale` | pixels per module, clamped 1–20, default 10 |

Encodes the **same bytes** as the printed PDF (`stickerPayload()`), ECC level H.

---

## 7. The QR payload — what every label encodes

Built and parsed by [StickerKey](../../../app/Services/Inventory/StickerKey.php).

```
https://<STICKER_URL>/ps/CBC1.<tenant>.<TYPE>.<id>.<nonce>.<signature>
```

| Part | Meaning |
|---|---|
| `CBC1` | Format version |
| `tenant` | `client_id` |
| `TYPE` | `BOX`, `SHELF`, `RACK`, `ZONE`, `WAREHOUSE` |
| `id` | The row **id**, never the code (codes restart per branch / per invoice) |
| `nonce` | 5 chars base36, derived from tenant+type+id — a reprint is byte-identical |
| `signature` | 16 chars base32 = first 80 bits of HMAC-SHA256 over the first five parts |

The scan endpoint accepts all of these forms, case-insensitively:

| Form | Example | Signed? |
|---|---|---|
| Full URL | `https://scan.kryptone.ai/ps/CBC1.12.BOX.88.K3J9Q.ABCDEFGHIJKLMNOP` | yes |
| Old path | `…/s/CBC1.…` (labels printed before the `/ps/` split) | yes |
| Dot key | `CBC1.12.BOX.88.K3J9Q.ABCD…` | yes |
| Pipe key | `CBC1\|12\|BOX\|88\|K3J9Q\|ABCD…` | yes |
| Short location | `SH:41`, `RC:7`, `ZN:3` | **no** — accepted as valid |
| Bare number | `88` → box id 88 | **no** — accepted as valid |

Legacy labels signed with the retired 7-char FNV fold are accepted while
`STICKER_ACCEPT_LEGACY=true` (default).

> **A warehouse label is not a put-away label.** `WAREHOUSE` keys are printed
> and signed, but the scan classifier only knows `BOX`/`SHELF`/`RACK`/`ZONE`, so
> scanning one on the handheld returns `422 unreadable — That is not a Cross Border label.`

---

## 8. Refusal codes

A refused scan returns `422`:

```json
{ "status": false, "code": "wrong_location",
  "message": "B-003 of SPI/2026-27/007 goes to WH-001 / ZN-003 / RC-007 / RC-007-SH-02. You are at RC-007-SH-03.",
  "reset": false, "attempts_left": 2, "data": { …state… } }
```

When it is the **third** blamed refusal in a row on the task, the scans are
wiped, `reset: true`, and the message gains
` Three failed scans — start again from the box.`

| `code` | Message (verbatim pattern) | Counts as an attempt |
|---|---|---|
| `bad_signature` | `That label did not pass its signature check. Use the printed label.` | yes, if a task is held |
| `unreadable` | `That is not a Cross Border label.` | yes, if a task is held |
| `unknown_box` | `No box matches that label.` | yes |
| `device_wrong_client` | `That box belongs to another organisation. This device is not allocated to it.` | yes |
| `device_wrong_branch` | `{box} belongs to another branch. Ask your administrator to allocate this device to that branch.` | yes |
| `box_not_packed` | `{box} is not packed against any supplier invoice. It cannot be put away.` | yes |
| `already_placed` | `{box} of {SPI} is already put away.` + `placed:{…}` | **no** |
| `no_task` | `No scan task for {box} of {SPI}. It is allocated to {dest} — raise a task, or confirm it by hand.` / `No put-away initiated for {box} of {SPI}.[ It does not belong at {loc}.]` | yes |
| `wrong_box` | `Wrong box — this task wants {box} of {SPI}. {box} of {SPI} belongs to {ZT-…}.` | yes |
| `wrong_location` | `{box} goes to {dest}. You are at {loc}.` / `{box} of {SPI} is assigned to {dest}. You are at {loc}.` / `No {kind} on this account matches that label.` | yes |
| `wrong_label_type` | `That is a {kind} label, and this put-away has no {kind}. Scan the {slot} — {dest}.` | yes |
| `already_scanned` | `That location is already scanned for this task.` | yes |
| `location_unusable` | `That location no longer exists.` / `That location is not active — it cannot take stock.` / `That {zone\|rack} is in a different warehouse.` | yes |
| `unknown_location` | `No {kind} on this account matches that label.` (location scanned with no task) | — (no task) |

`attempts_left` is `null` when no task is held. Frontend-only codes:
`no_answer` (request timed out after 15 s) and the device codes from §3.

---

## 9. Status-code cheat sheet

| Code | Where | Meaning |
|---|---|---|
| `200` | everywhere | Success; also `device-check` for **every** verdict |
| `201` | `POST /scan-devices`, `POST …/scan-task` | Created |
| `401` | `/scan/putaway/*` | No device credential resolved |
| `403` | `/scan/putaway/*` | Device suspended / retired / unclaimed |
| `403` | `/scan-devices/enroll` | Device not active |
| `403` | back-office tasks | `No tenant context` |
| `404` | various | Not found in this client — message names the id |
| `409` | `complete`, `scan` (auto-commit), `scan-task` | Location no longer held for this box |
| `422` | scan routes | Refusal (§8) or task closed (§3.8) |
| `422` | `/scan-devices` | Validation, or caller has no `client_id` |
| `429` | `device-check` (60/min), `/scan/putaway/*` (120/min) | Throttled — per IP, so one NAT shares one bucket (bug sheet **SEC-13**) |

---

## 10. curl, end to end

Windows `curl` cannot send PEM client certificates; run the device calls from
Linux / WSL / Git Bash with OpenSSL, or use the token header against a local
dev box.

```bash
BASE=https://dev.kryptone.ai/api          # staff host
SCAN=https://scan-dev.kryptone.ai/api     # scanner host (mTLS)

# 1. Staff login
TOKEN=$(curl -s $BASE/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@client.com","password":"…"}' | jq -r .token)

# 2. Add a handheld — keep the token, it is shown once
curl -s $BASE/scan-devices -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"serial":"26013524701106","label":"Pack bench 2","model":"TC27","branch":"Main WH"}'
DEV=CBCD-…

# 3. Print a box sticker and a shelf label
curl -s -o box.pdf   "$BASE/p2p/spi/7/boxes/88/sticker/download" -H "Authorization: Bearer $TOKEN"
curl -s -o shelf.pdf "$BASE/inventory/shelves/41/label"          -H "Authorization: Bearer $TOKEN"
curl -s -o shelf.png "$BASE/inventory/shelves/41/qr?scale=12"    -H "Authorization: Bearer $TOKEN"

# 4. Hand the box to the floor (row = the put-away row id from Stage 04)
curl -s $BASE/p2p/spi/7/putaway/55/scan-task -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"confirmed":true}'

# 5. On the handheld: cert, or the token fallback
CERT="--cert zebra-26013524701106.crt --key zebra-26013524701106.key"
curl -s $SCAN/scan/device-check  $CERT -H 'Content-Type: application/json' -d '{}'
curl -s $SCAN/scan/putaway/session $CERT -H 'Content-Type: application/json' -d '{}'

# 6. Scan the box, then the shelf — the second scan completes the put-away
curl -s $SCAN/scan/putaway/scan $CERT -H 'Content-Type: application/json' \
  -d '{"scanned_value":"https://scan-dev.kryptone.ai/ps/CBC1.12.BOX.88.K3J9Q.ABCDEFGHIJKLMNOP"}'
curl -s $SCAN/scan/putaway/scan $CERT -H 'Content-Type: application/json' \
  -d '{"scanned_value":"https://scan-dev.kryptone.ai/ps/CBC1.12.SHELF.41.…","task_id":31}'

# 7. Back office: what happened
curl -s $BASE/putaway/tasks/31/activity -H "Authorization: Bearer $TOKEN"

# 8. A forged header must be ignored by the front door
curl -s $SCAN/scan/device-check -H 'X-Scan-Cert-CN: zebra-26013524701106' \
  -H 'Content-Type: application/json' -d '{}'
#  → authorized:false.  TRUE here means the proxy is passing client headers through.
```

The Postman collections [SPI_Putaway_Scan.postman_collection.json](../SPI_Putaway_Scan.postman_collection.json)
and [stickers-and-labels.postman_collection.json](../../stickers-and-labels.postman_collection.json)
cover the same calls.
