# Zebra Devices (Printing & Scanning) — Code Walkthrough

> Where the code is, and what happens on each request — for a developer with
> the file open, debugging.
> Read the Technical document first for the why; this one is the where.
>
> _Last updated: 2026-11-12._

---

## 1. The file map

### 1.1 Backend

| File | Role |
|---|---|
| [ScanDeviceController.php](../../../app/Http/Controllers/Api/ScanDeviceController.php) | Allow-list CRUD, `rotate`, `enroll`, public `check` |
| [ScanDevice.php](../../../app/Models/ScanDevice.php) | `issueToken()`, `findByToken()`, `actorId()`, `toClient()` |
| [SpiPutawayScanController.php](../../../app/Http/Controllers/Api/P2p/SpiPutawayScanController.php) | **The handheld API.** `session`, `show`, `scan`, `confirm`, `complete`, `release`; `device()`, `classify()`, `scanBox()`, `scanLocation()`, `commit()`, `refuse()`, `state()` |
| [SpiPutawayTaskController.php](../../../app/Http/Controllers/Api/P2p/SpiPutawayTaskController.php) | Back office: create (`store`), `index`, `queue`, `show`, `activity`, `boxActivity`, `cancel`; `allocateCode()`; `PUTAWAY_REFUSALS` |
| [SpiPutawayTask.php](../../../app/Models/P2p/SpiPutawayTask.php) | The state machine: `currentStep()`, `stepLabel()`, `locationChain()`, `levelIdFor()`, `markLocationScanned()`, `readyToComplete()`, `resetScans()`, `scansAreStale()`, `idleSecondsLeft()` |
| [StickerKey.php](../../../app/Services/Inventory/StickerKey.php) | Builds, signs and parses every QR payload |
| [SpiBoxController.php](../../../app/Http/Controllers/Api/P2p/SpiBoxController.php) | `printSticker`, `downloadSticker`, `stickerPreview`; `stickerData()`, `qr()`, `pictograms()`, `boxFlags()`, `placement()`, `refs()`, `parties()` |
| [BaseInventoryController.php](../../../app/Http/Controllers/Api/Inventory/BaseInventoryController.php) | `labelPdf()`, `scanValue()`, `stickerPayload()`, `qrPng()`, `qr()` |
| [WarehouseController](../../../app/Http/Controllers/Api/Inventory/WarehouseController.php) · [ZoneController](../../../app/Http/Controllers/Api/Inventory/ZoneController.php) · [RackController](../../../app/Http/Controllers/Api/Inventory/RackController.php) · [ShelfController](../../../app/Http/Controllers/Api/Inventory/ShelfController.php) | `preview`, `label`, `qrImage`, private `labelData()` each |
| [PutawayActivityLog.php](../../../app/Models/Inventory/PutawayActivityLog.php) | Event constants; table `inventory_putaway_activity_logs` |
| `app/Services/Inventory/PutawayActivityLogger.php` | `log()`, `snapshot()` |
| `app/Services/Inventory/LocationOccupancyService.php` · `LocationLockService.php` | `liveFor()` / `occupy()` · `held()` / `release()` / `heartbeat()` |
| [config/inventory.php](../../../config/inventory.php) | `sticker_url`, `sticker_secret`, `sticker_accept_legacy`, `scan_stale_minutes` |
| [spi-box-sticker.blade.php](../../../resources/views/pdf/spi-box-sticker.blade.php) · [inventory-label.blade.php](../../../resources/views/pdf/inventory-label.blade.php) | The two label faces |

### 1.2 Frontend

| File | Role |
|---|---|
| [PutawayScan.tsx](../../../resources/js/pages/p2p/putaway/PutawayScan.tsx) | **The handheld page** — `/putaway-scan`, `/putaway-scan/:taskId`, `/putaway-scan/enroll`, `/ps/:scanKey` |
| `resources/css/putaway-scan.css` | Its styles (360 px handheld) |
| [InventoryScanDevices.tsx](../../../resources/js/pages/inventory/InventoryScanDevices.tsx) | Inventory → Scan Devices |
| [putAwayStore.ts](../../../resources/js/pages/inventory/putAwayStore.ts) | Device API helpers (**real**) + the scan simulation (**fake**) |
| [InventoryHandheldGuide.tsx](../../../resources/js/pages/inventory/InventoryHandheldGuide.tsx) | Static picture of the nine handheld screens |
| [ScanLanding.tsx](../../../resources/js/pages/inventory/ScanLanding.tsx) · `InventoryStickers.tsx` | Simulation landing `/s/:key` and sample sticker sheet |
| [spi-api.ts](../../../resources/js/pages/p2p/purchase-management/invoice/spi-api.ts) | `printSticker`, `stickerPdf`, `putawayScanTask`, `putawayTask`, `putawayBoxActivity`, `putawayCancelTask` |
| `invoice/steps/BoxStickerModal.tsx` · `invoice/PutawayStickerModal.tsx` · `invoice/steps/StickerPdfPreview.tsx` | Sticker print / preview dialogs |
| `invoice/steps/PackedProducts.tsx` · `invoice/steps/PutawayReviewBox.tsx` | The **Sticker** buttons |
| `invoice/steps/Step4PutawayAllocation.tsx` · `invoice/steps/PutawayScanTask.tsx` | Stage 04 Option 01 and the task dialog |
| `inventory-management/label-pdf.ts` · `*/RackQrModal.tsx`, `ShelfQrModal.tsx`, `ZoneQrModal.tsx`, `WarehouseQrModal.tsx` | Location label preview / download |
| [App.tsx](../../../resources/js/components/App.tsx) | Lines ~869–890: the public `/s/`, `/putaway-scan`, `/ps/` route blocks, **above** the auth check |
| `public/manifest.json` · `public/sw.js` | PWA install; pass-through service worker |

### 1.3 Routes

| Lines in [routes/api.php](../../../routes/api.php) | What |
|---|---|
| ~104–125 | Public: `scan/device-check` (60/min), `scan/putaway/*` (120/min) |
| ~160 | Public, local-only: `p2p/spi/sticker-preview` |
| ~612–646 | Staff, `p2p/spi` prefix: box sticker, put-away assign / scan-task / tasks / box activity |
| ~686–735 | Staff, `inventory` prefix: `…/{id}/preview`, `/label`, `/qr` for the four location kinds |
| ~1524–1542 | Staff: `scan-devices` resource + `rotate` + `enroll`; `putaway/tasks` queue / show / activity / cancel |

### 1.4 Infra

| File | Role |
|---|---|
| [storage/certs/tls-proxy.cjs](../../../storage/certs/tls-proxy.cjs) | Local HTTPS + mTLS front door, :8000 → :8001 |
| [storage/certs/README.md](../../../storage/certs/README.md) | Cert issuance, Apache vhost |
| [bootstrap/app.php](../../../bootstrap/app.php) | `trustProxies` (private ranges only) |

---

## 2. Request flow — printing a box sticker

```
PackedProducts.tsx  [Sticker]  → BoxStickerModal
  ├─ spiApi.printSticker(spi, box)          POST /api/p2p/spi/{id}/boxes/{box}/sticker
  │    SpiBoxController::printSticker
  │      tenantUser → findSpi → findBox
  │      DB tx: box.sticker_printed_at = now()
  │             svc->log(spi, 'sticker_printed', stage 3)   → p2p_spi_activities
  │      → { box_code, sticker_printed_at, code_locked, payload }
  └─ spiApi.stickerPdf(spi, box)            GET  …/sticker/download   (responseType blob)
       SpiBoxController::downloadSticker
         load items.invoiceItem, putaway; spi.client, vendor, purchaseOrder(+FKs)
         first time only: stamp + log
         Pdf::loadView('pdf.spi-box-sticker', stickerData())->setPaper('a4','portrait')
         → download "<SPI code with - for />-<box>.pdf"
  window.open(blobUrl)  →  browser print dialog  →  printer
```

The comment on the PO eager load is worth knowing when a reference prints as
a dash:

```php
/* The three FOREIGN KEYS matter as much as the columns that
   print: a BelongsTo cannot resolve off a model whose key was
   not selected, and the label then shows a dash for a
   reference that exists. */
```

---

## 3. Request flow — printing a location label

```
RackMaster → RackQrModal
  ├─ GET /api/inventory/racks/{id}/preview     → labelData() + qr (base64) + download_url
  └─ useLabelPdf('racks', id)                  GET /api/inventory/racks/{id}/label  (blob)
        RackController::label
          labelData($request, $id)
            scopeTenant(Rack::query(), user, branchScope())->findOrFail($id)
            'scan' => $this->scanValue('RC', $r->id)
                         └─ StickerKey::fromShort('RC:7', auth()->user()->client_id) ?: 'RC:7'
          labelPdf($data, $data['code'])
            payload = stickerPayload($data)            // = $data['scan']
            Pdf::loadView('pdf.inventory-label', $data + [qr, qrUrl, printedOn])
               ->setPaper('a4','portrait')->download("RC-007.pdf")
```

`GET …/qr` runs the same `labelData()` and hands `stickerPayload()` to
`qrPng()` — the docblock: *"Whatever the printed label encodes, byte for byte —
one source, so a QR saved from this screen and one glued to the rack can never
resolve to different things."*

---

## 4. Request flow — adding and enrolling a device

```
InventoryScanDevices.tsx  [Add device]
  enrollDevice(form)                       POST /api/scan-devices
    ScanDeviceController::store
      clientId() — 422 without one
      validate (serial unique per client)
      [$plain, $hash] = ScanDevice::issueToken()     // 'CBCD-' + 40 random, sha256
      create(status 'active', created_by = caller)
      → 201 { data, token: $plain }                    // only time it exists
  EnrollQr(makeEnrollUrl(token))           <STICKER_URL>/putaway-scan/enroll#<token>

On the Zebra: scan that QR
  PutawayScan.tsx  (path ends /enroll)
    localStorage.cbc_scan_device_token_v1 = hash fragment
    history.replaceState → /putaway-scan             // secret out of history
    POST /api/scan/putaway/session  (X-Scan-Device: token, + client cert)
  If cbc_token (staff login) is also present and device.claimed === false:
    POST /api/scan-devices/enroll { token }  Authorization: Bearer <cbc_token>
      ScanDeviceController::enroll
        findByToken; client must equal caller's; must be active
        enrolled_by = caller, enrolled_at = now
```

---

## 5. Request flow — raising a Zebra task (back office)

```
Step4PutawayAllocation → Option 01 → PutawayScanTask dialog (tick required)
  spiApi.putawayScanTask(spi, row)         POST /api/p2p/spi/{id}/putaway/{row}/scan-task
    SpiPutawayTaskController::store
      tenantUser                           403 No tenant context
      SupplierInvoice::find / SpiPutaway…->find      404 with the id named
      validate confirmed=accepted, ttl_hours 1..72
      guards: isPlaced · !zone_id · open task exists            422
      DB tx:
        occ = occupancy->liveFor(TYPE_SPI_BOX, box)   none → rollback, 409
        task = create(…, task_code = allocateCode(client, branch),   // branch row FOR UPDATE
                      required_scans 2, status pending,
                      expires_at = now + ttl (default 8h))
        put-away row: task_id, status awaiting_scan
        lock: held_for_type 'putaway_task', held_for_id task, expires_at = task.expires_at
        activity: task_created           svc->log: putaway_scan_task_created
      → 201 body()
```

---

## 6. Request flow — a scan on the handheld

```
DataWedge types "https://scan…/ps/CBC1.12.BOX.88.K3J9Q.ABCD…⏎"
  PutawayScan.tsx  submitScan(raw)          (or /ps/:scanKey on page load)
    call('post','/scan/putaway/scan', { scanned_value, task_id, staged_location, staged_kind })
      fetch with X-Scan-Device, 15 s abort
                     │
  front door: verify client cert, set X-Scan-Cert-CN
                     ▼
SpiPutawayScanController::scan
  1. device()                    cert CN → serial, else token        401 / 403
                                 actor = enrolled_by ?: created_by   403 device_unclaimed
                                 Auth::setUser · TenantContext::fromUser · last_seen_at
  2. validate
  3. hit = classify(value)       StickerKey::parse / SH:n / digits
  4. task = findTask(task_id, false); closed → null                  (lenient)
  5. stale = dropStaleScans(task)
  6. signed && !valid            → refuse bad_signature
     !kind                       → refuse unreadable
  7. box      → scanBox()
     location → scanLocation()
  8. if response ok and the task is now readyToComplete() → commit()
  9. if stale → add stale_reset + notice
```

### 6.1 `scanBox()` — guards in order

1. `SpiBox::withoutGlobalScopes()->whereNull('deleted_at')->find(id)` → `unknown_box`
2. `box.client_id !== device.client_id` → `device_wrong_client`
3. Branch mismatch (both non-null) → `device_wrong_branch`
4. No SPI for the box in this client → `box_not_packed`
5. No open task for this box + SPI + client:
   - latest put-away row **placed** and a completed task exists → `200 already_placed` with the done task's state
   - placed, no completed task → `refuse already_placed` (not blamed)
   - otherwise → `no_task` (allocated, or not initiated, naming a staged location if any)
6. Page holds a different task → `wrong_box`
7. A staged location: kind and id must equal the task's slot → else `wrong_location`; if right, fill both location columns
8. Stamp `box_scan_at`, `device_id`, `device_serial`, `fail_count = 0`; log `scan_passed`
9. `200 notice "B-003 · ZT-…"`

### 6.2 `scanLocation()` — guards in order

**No task held:**

1. `nameLocation(kind, id, device)` (client-scoped) → `unknown_location`
2. Count open tasks where `{kind}_id = id`
3. None due → `200 step 'lookup'` + `locationContents()`
4. Some due → `200` with `staged_*`, `due_here`, `due_boxes[]`, `location`

**Task held:**

1. `shelf_scan_at` already set → `already_scanned`
2. `levelIdFor(kind)` is null → `wrong_label_type`
3. id ≠ expected → `wrong_location` (or *"No {kind} on this account…"* when the id names nothing)
4. `locationUsable()` — exists in this client, `status = 1`, zone/rack in the task's warehouse → `location_unusable`
5. `markLocationScanned(kind)`, `fail_count = 0`, log `scan_passed`, `200 state`

### 6.3 `commit()` — the only code that moves stock

```php
/* Both slots acknowledged. Stamped before the transaction so the
   columns still record agreement separately from when each barcode
   was read — whether that came from the Complete button or from the
   scan that closed the pair. */
$task->forceFill([
    'box_confirmed_at'   => $task->box_confirmed_at ?: now(),
    'shelf_confirmed_at' => $task->shelf_confirmed_at ?: now(),
])->save();
```

Then: row gone → 422 · row placed → 422 · **transaction**: `liveFor()` (none →
rollback, 409) → `occupy($occ, $actor)` → put-away `placed`,
`verify_method 'scan'` → `releaseLockFor()` → task `scanned`,
`completed_at`, `completed_scans = required_scans` → activity
`confirmed_device` with a `to_location` snapshot → SPI log
`putaway_confirmed` *"Scanned on {serial}"* → commit.

### 6.4 `refuse()`

```php
/**
 * Written OUTSIDE any transaction on purpose. The log row is the only
 * thing a refusal leaves behind, and a rollback would destroy the one
 * record it exists to make.
 */
```

With a task and `$blame`: `fail_count + 1`, `failed_reason = code`; at
`MAX_FAILS` → `resetScans()`, `reset: true`, message suffix. Logs
`scan_failed` with `meta.reason`. **With no task, nothing is logged.**
Always `422` with `attempts_left` and the live state.

---

## 7. Request flow — the back-office activity read

```
GET /api/putaway/tasks/{task}/activity
  SpiPutawayTaskController::activity
    task scoped to client
    log = PutawayActivityLog where task_id, by id
    names: one users query · devices: one scan_devices query
    stickerTargets(): parse each meta.value with StickerKey, one lookup per KIND
                      key = "{kind}:{id}" so URL and bare-key reads of one label merge
    timeline rows: kind = stale_reset | scan | lifecycle, attempt = Nth read of that label
    stickerAttempts(): fold by label, worst first
```

---

## 8. Frontend flow — `PutawayScan.tsx`

### 8.1 Boot

`useEffect([taskId, scanKey, token])`:

- `scanKey` present (arrived from a camera / URL) → read the run from
  `localStorage` → `POST /scan` with it → `apply()`.
- `taskId` → `GET /scan/putaway/{id}`; else `POST /session`.
- A `notice` in the body → red toast *"Put-away restarted"*.

### 8.2 `call()` — why not Axios

```ts
/* Deliberately NOT the shared api client. That one treats any 401 as the
   USER's session expiring — it wipes cbc_token and redirects to /login, so
   a stale device credential would sign the operator out of the handheld. */
```

Throws axios-shaped `{ response: { status, data } }` so `fail()` reads either.

### 8.3 `apply()` / `fail()`

- `apply()` sets state, clears the error, computes whether the scan moved the
  chain (`chainRef`) — a repeated rack scan toasts *"Rack already scanned"*
  rather than "accepted" — and writes the run (`null` when the task is
  `scanned`).
- `fail()`: 401/403 → **Device blocked**; `no_answer` → one navigation to the
  queue (`pwscan_reconnect`); `already_placed` with `placed` → the done card;
  else the `SHORT[code]` text plus a "Scan the {level} {code}" hint from the
  live state; on `reset` drop the staged location.

### 8.4 Render order (why it matters)

`blocked` → `placed` → `!state` → queue (no task, open tasks, nothing staged) →
the task screen. `placed` **must** come before `!state`:

```ts
/* A device whose first action is scanning a placed box is answered with
   `data: null`, because there is no open task to describe. So there is no
   state to fall through to, and the guard below would render
   "Checking this device…" for ever on a page that had its answer all along. */
```

---

## 9. Patterns you will see in this code

| Pattern | Why |
|---|---|
| One `state()` shape for every endpoint, including refusals | The page re-renders from whatever came back; a refusal never leaves a stale screen |
| The server decides; the page renders | No second copy of the rules on the device |
| Messages name the box **with its invoice** (`B-003 of SPI/…`) | `box_code` restarts per invoice — "B-001" is four cartons on a busy floor |
| Kind compared before id | Shelf 1, rack 1 and zone 1 coexist |
| `forceFill()` on task / device writes | These columns are not mass-assignable from a request |
| `abort(response()->json(…))` in helpers | `device()` / `findTask()` end the request with a shaped body from any depth |
| Refusal code stored, sentence regenerated | `PUTAWAY_REFUSALS` in the task controller maps codes back for history |
| `try { localStorage… } catch {}` everywhere | Private mode and managed devices throw |
| Durations, never deadlines, to the device | The handheld's clock is not trusted |
| Comments that record the bug that was fixed | Read them before "simplifying" a rule |

---

## 10. Symptom → file

| Symptom | Look at |
|---|---|
| Handheld shows **Device blocked** | `SpiPutawayScanController::device()`; then the front door — is `X-Scan-Cert-CN` arriving? (`tls-proxy.cjs` / Apache vhost) |
| `device_unclaimed` | `ScanDevice::actorId()` — `enrolled_by`/`created_by` missing or in another client |
| Stuck on **Checking this device…** | `PutawayScan.tsx` `call()` timeout and the render order (§8.4); the cert picker cannot appear for a background fetch |
| **No answer from the server** loops | `fail()` `pwscan_reconnect` handling |
| Genuine label → *did not pass its signature check* | `StickerKey::keyBytes()` — `STICKER_SECRET` / `APP_KEY` differs from the printing server |
| Warehouse label → *not a Cross Border label* | `classify()` — no `WAREHOUSE` branch (by design today) |
| Box → *No box matches that label* | `scanBox()` step 1 — box soft-deleted, or id from another environment |
| *Not this organisation* | `scanBox()` step 2 — device row's `client_id` |
| *No put-away initiated* / *No scan task* | `scanBox()` step 5 — no `pending` task; check `p2p_spi_putaway_tasks` for the box |
| Rack scan accepted as the wrong shelf | `scanLocation()` + `SpiPutawayTask::levelIdFor()` / `markLocationScanned()` |
| *Location is in a different warehouse* | `locationUsable()` |
| Pair matched but nothing placed | `scan()` step 8 → `commit()`; a `409` means `liveFor()` found no reservation |
| Run restarted unexpectedly | `dropStaleScans()` / `SpiPutawayTask::scansAreStale()`; `SCAN_STALE_MINUTES` |
| Three-strikes reset | `refuse()` and `SpiPutawayTask::MAX_FAILS` |
| Wrong person on put-aways | `ScanDevice::actorId()`; `ScanDeviceController::enroll()`; the auto-claim effect in `PutawayScan.tsx` |
| A refused scan is missing from the log | `refuse()` — not logged when no task is held |
| Task code collision | `SpiPutawayTaskController::allocateCode()` and the unique `(client_id, branch_id, task_code)` |
| *A task is already open* but none is visible | Partial index `uq_putaway_task_open_box`; queue filters by tenant / branch |
| Task never expires | No reaper — `expires_at` is informational today |
| Sticker shows `—` for a reference | `SpiBoxController::refs()` and the FK columns in the `purchaseOrder:` eager load |
| Sticker breaks onto two pages | `spi-box-sticker.blade.php` — read its header rules (no % heights, no deep nesting, pin line-height) |
| QR on screen ≠ QR on paper | `BaseInventoryController::scanValue()` / `stickerPayload()` — the one source |
| Label points at the old server | `config('inventory.sticker_url')` at print time |
| Scan typed but never submitted | DataWedge ENTER suffix; auto-submit regex in `PutawayScan.tsx` |
| Admin redirected to `/login` from the handheld | Something used the shared Axios client instead of `call()` |
| 429 on a busy floor | Throttles in `routes/api.php` lines ~107 and ~117 |

---

## 11. How to extend it

| Change | Touch |
|---|---|
| A new label kind (e.g. pallet) | `StickerKey::KINDS` if it has a short form; `classify()` type map; `scanBox()`-style handler; `PUTAWAY_REFUSALS`; `stickerTargets()` table map |
| Allow warehouse labels on the handheld | `classify()` (`'WAREHOUSE' => …`), `SpiPutawayTask::levelIdFor()` / `locationChain()`, `locationUsable()` |
| Expire tasks | A scheduled command: `pending` and `expires_at < now()` → `expired`, release or re-point the lock, put-away row back to `draft`, log `task_cancelled`-style event |
| Log pre-task refusals | `refuse()` — call `log2()` when `$task` is null |
| Gate device admin by permission | Route middleware on the `scan-devices` resource and `putaway/tasks` group, plus `routeAccess.ts` |
| Client-scope the serial lookup | `check()` and `deviceFromCert()` — needs the tenant from the host or the cert (CN today carries only the serial) |
| Change the label face | The blade, then re-render all variants via `/api/p2p/spi/sticker-preview` (local) and **count the pages** |
| Retire legacy labels | `STICKER_ACCEPT_LEGACY=false` once the floor is reprinted |
| Change a refusal message | `SpiPutawayScanController` **and** the API document §8 — the wording is a contract |
