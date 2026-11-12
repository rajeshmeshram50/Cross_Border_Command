# SPI — Code Walkthrough
**Module:** Supplier Purchase Invoice (SPI) / Inward · P2P
**Audience:** Engineers onboarding to the module
**Scope:** File-by-file tour — frontend screens, backend controllers, models, services — and how a request flows through them. Pairs with the Functional, Technical and API docs.

---

## 1. Where the code lives

### Frontend — `resources/js/pages/p2p/purchase-management/invoice/`
```
InvoiceList.tsx            SPI list page; owns the create funnel state
MapInvoiceModal.tsx        "Choose SPI type" (With PO vs Direct)
PoPicker.tsx               With-PO source (submitted POs)
DirectSpiSetup.tsx         Without-PO setup (shipment → procurement → supplier)
DirectSpiPicker.tsx        shipment picker
DirectSpiSupplierPicker.tsx supplier picker (domestic)
StorageSelectionModal.tsx  storage-type → warehouse → confirm gate
WarehouseFixModal.tsx      "warehouse can't hold these boxes" switch
InvoiceForm.tsx            the 4-stage wizard shell
InvoiceEvidenceVault.tsx   the invoice Evidence Vault modal (row action)
spi-api.ts                 Axios layer; spiVaultApi (vault + authed file stream), VaultDocument/EvidenceVault types
steps.tsx                  stage labels + list-page marketing steps
steps/
  Step1SupplierDetails.tsx
  Step2InvoiceProducts.tsx
  Step3BoxPackaging.tsx    (BoxDrawer, MultiBoxPanel, PackedProducts, ProductFlagsModal, ProductTable, TemperatureModal, BoxStickerModal)
  Step4PutawayAllocation.tsx
  PutawayStageBrief.tsx  PutawayReviewBox.tsx  PutawaySelectLocation.tsx
  PutawayConfirmPlacement.tsx  PutawayScanTask.tsx  PutawayBoxSticker.tsx  StageSummary.tsx
```
The separate **handheld** screen: `resources/js/pages/p2p/putaway/PutawayScan.tsx` (routes `/putaway-scan`, `/putaway-scan/:taskId`, `/putaway-scan/s/:scanKey`).

The **supplier** Evidence Vault (Stage-1 Legal Status link) is a different screen: `resources/js/pages/p2p/p2p-master-management/supplier-management/SupplierEvidenceVaultModal.tsx` → `/segment-uploads/supplier/{id}/vault`. Don't confuse it with the invoice vault.

### Backend — `app/Http/Controllers/Api/P2p/`
```
SupplierInvoiceController.php     stages 1,2 + completeStage3 + submit + summary/packed-boxes/evidence-vault + payment/zoho
SpiBoxController.php              stage 3 boxes, stickers
SpiPutawayController.php          stage 4 storage-type, eligibility, legacy hand-scan, confirm
SpiPutawayAllocationController.php board, locations, assign, confirm-manual
SpiPutawayTaskController.php      scan-task (Zebra), queue, cancel, activity
SpiPutawayScanController.php      the handheld device endpoints
P2pFileController.php             /p2p/files/download — the authenticated vault file stream
PoPaymentRequestController.php    SPI-scoped payment requests/payments + TDS (money sits on the PO)
```
`P2pVaultService` (`forSpi`/`forPo`) backs both Evidence Vaults; `SegmentDocUploadController@vault` backs the separate **supplier** vault.

### Models — `app/Models/P2p/` (+ `app/Models/Inventory/`)
`SupplierInvoice`, `SupplierInvoiceItem`, `SpiBox`, `SpiBoxItem`, `SpiBoxAttachment`, `SpiPutaway`, `SpiPutawayTask`, `Inventory\PutawayActivityLog`.

### Services — `app/Services/P2p/` + `app/Services/Inventory/`
`SupplierInvoiceService`, `SpiSummaryService`, `P2pVaultService`; `WarehouseCapabilityService`, `LocationFinderService`, `LocationOccupancyService`, `LocationLockService`, `PutawayActivityLogger`, `StickerKey`.

### Routes — `routes/api.php`
`Route::prefix('p2p/spi')` (~L562–672) · handheld `scan/putaway` (~L117–125) · floor queue `/putaway/tasks` (~L1536–1542).

---

## 1a. Controller method map

Every public method, the route it answers, and what it does. (`@method` = this controller.)

### `SupplierInvoiceController` — the spine
| Method | Route | Does |
|---|---|---|
| `nextCode` | GET `/p2p/spi/next-code` | preview `SPI/<FY>/NNN` (writes nothing) |
| `poLines` | GET `/orders/{po}/lines` | PO lines to seed Stage 2 (`?exclude_spi`) |
| `index` | GET `/p2p/spi` | paginated list + tab counts |
| `show` | GET `/{id}` | invoice + match + packing + put-away summary |
| `store` | POST `/p2p/spi` | create draft; guards PO-fully-invoiced; `stage_completed` 1 (PO) / 0 (Direct) |
| `updateStage` | PUT `/{id}/stage-1` | edit draft header (while `isEditable()`); returns `blockers[]` |
| `updateItems` | POST `/{id}/items` | save whole grid + totals + invoice/eway files; `max(2,…)`; packing resync |
| `completeStage` | PUT `/{id}/stage-3` | gate: fully packed + warehouse capable; `max(3,…)` |
| `submit` | PUT `/{id}/submit` | triple-guard → `mapped`, `stage_completed=4` |
| `destroy` | DELETE `/{id}` | soft delete; returns qty to PO; refused if `closed` |
| `summary` | GET `/{id}/summary` | put-away summary dialog (`SpiSummaryService`) |
| `packedBoxes` | GET `/{id}/packed-boxes` | packed boxes, paged/filtered (`bucket`/`handling`) |
| `evidenceVault` | GET `/{id}/evidence-vault` | `P2pVaultService::forSpi` |
| `paymentRequests` | GET `/{id}/payment-requests` | payment history popup |
| `zohoSync` / `zohoTracker` | POST/GET `/{id}/zoho-*` | **501** sync; tracker says *why* no bill |

### `SpiBoxController` — Stage 3
| Method | Route | Does |
|---|---|---|
| `index` / `show` | GET `/{id}/boxes[/{box}]` | boxes (+ items, packing summary, uom/flag maps) |
| `packingSummary` | GET `/{id}/packing-summary` | per-line packed/pending + totals |
| `nextCodes` | GET `/{id}/boxes/next-codes` | preview `B-NNN` (`?count`) |
| `store` / `update` / `destroy` | POST/PUT/DELETE `/{id}/boxes[/{box}]` | box CRUD; `validateBox` + `guardOverPacking` |
| `destroyAttachment` | DELETE `…/attachments/{a}` | remove a box photo |
| `printSticker` / `downloadSticker` | POST/GET `…/sticker[/download]` | stamp `sticker_printed_at` (locks code); 4×6 PDF |
| `stickerPreview` | GET `/sticker-preview` | **no-auth** local synthetic preview |

### Stage-4 controllers
| Controller · Method | Route | Does |
|---|---|---|
| `SpiPutawayController@index` | GET `/{id}/putaway` | rows + mode + progress |
| `@setStorageType` | PUT `/{id}/storage-type` | set/clear warehouse (null = 3PL) |
| `@warehouseEligibility` | GET `/{id}/warehouse-eligibility` | required caps + per-warehouse compat |
| `@scan` / `@confirm` | POST/PUT `/{id}/putaway/scan`,`/{row}/confirm` | **legacy** hand-scan path (logs to `SpiScanLog`) |
| `SpiPutawayAllocationController@board` | GET `/{id}/putaway/board` | every box's status/sub-step + counts |
| `@locations` | GET `/{id}/putaway/locations` | tree + recommendation (`box_id`, `mode`) |
| `@assign` | POST `/{id}/putaway/assign` | lock + reserve + row→`draft` (**409** if taken) |
| `@confirmManual` | POST `/{row}/confirm-manual` | Option 02 → `placed` |
| `SpiPutawayTaskController@store` | POST `/{row}/scan-task` | Option 01 → task `pending`, row `awaiting_scan` |
| `@index` / `@queue` | GET `/{id}/putaway/tasks`, `/putaway/tasks` | invoice queue / branch floor queue |
| `@show` / `@activity` | GET `/putaway/tasks/{task}[/activity]` | poll-cheap state / full history |
| `@cancel` | POST `/putaway/tasks/{task}/cancel` | close task (occupancy stays) → row `draft` |
| `@boxActivity` | GET `/{id}/putaway/boxes/{box}/activity` | a box's frozen timeline |

### `SpiPutawayScanController` — handheld (device-auth)
| Method | Route | Does |
|---|---|---|
| `session` | POST `/scan/putaway/session` | who is this device + its open tasks |
| `scan` | POST `/scan/putaway/scan` | classify + judge a barcode; the closing scan auto-completes |
| `show` | GET `/scan/putaway/{task}` | current state; drops stale scans |
| `confirm` | POST `/scan/putaway/{task}/confirm` | operator agrees with a slot |
| `complete` | POST `/scan/putaway/{task}/complete` | **only** call that moves stock |
| `release` | POST `/scan/putaway/{task}/release` | "Clear box" — give back proved scans |

---

## 2. Create funnel (frontend)

`InvoiceList.tsx` owns the funnel as three pieces of state:
```
"Create" button → MapInvoiceModal (pick type)
                → confirmMap → StorageSelectionModal (storageFor)
                → confirmStorage → InvoiceForm (formFor)
```
- **With PO:** `MapInvoiceModal` → `PoPicker` sets the PO; `StorageSelectionModal` opens `InvoiceForm` with no server draft (the draft is created on Stage-1 save).
- **Without PO:** `DirectSpiSetup` collects shipment + supplier; `StorageSelectionModal.confirmStorage` calls `spiApi.create({ purchase_order_id: null, … })` right away → opens the wizard at Stage 1.

`WarehouseFixModal` is reached mid-Stage-3 when the warehouse can't hold the boxes.

---

## 3. The wizard (`InvoiceForm.tsx`)

A full-screen portal with a 4-step stepper. `STAGES` / `DIRECT_STAGES` / `UNMATCHED_STAGES` swap the labels per flavour. The footer button text (`Save & Next` / `Update & Next` / `Map Invoice`) is derived from stage + edit state. Each stage component owns its own fields and `goNext` validation:

| Stage component | Saves via | Gate |
|---|---|---|
| `Step1SupplierDetails` | `spiApi.create` (With-PO, first draft) / `spiApi.updateStage1` (Direct) | supplier chosen; Direct GST gate (`stage1Gate`) |
| `Step2InvoiceProducts` | `spiApi.saveItems` | invoice no/date/attachment; rows valid; nothing below packed |
| `Step3BoxPackaging` | `spiApi.createBox` / `spiApi.completeStage3` | every unit boxed; warehouse capable (else `WarehouseFixModal`) |
| `Step4PutawayAllocation` | assign / confirm-manual / scan-task + `spiApi.submit` | every box placed → `mapInvoice` |

Match-type is skeleton-shimmered until the SPI loads (CS-1139). View-only banners appear for submitted/mapped statuses and after all boxes are placed.

---

## 3a. The Axios layer (`spi-api.ts`)

One module wraps every SPI call so components never touch `api` directly. Each function `call(label, () => api.X(...), unwrap)` so a failure carries a readable label and the response is already unwrapped to `data`. The groups:
- **Header/items:** `nextCode`, `poLines`, `create`, `updateStage1`, `saveItems`, `submit`, `remove`.
- **Boxes:** `boxes`, `box`, `nextBoxCodes`, `packingSummary`, `createBox`, `updateBox`, `deleteBox`, `printSticker`, `completeStage3`, `setWarehouse`.
- **Put-away:** `putaway`, `putawayBoard`, `putawayLocations`, `putawayModes`, `putawayAssign`, `putawayConfirmManual`, `putawayScanTask`, `putawayTask`, `putawayTaskCancel`, `warehouseEligibility`, `setStorageType`.
- **Payment/Zoho:** `paymentRequests`, `storePaymentRequest`, `storePayment`, `saveTds`, `zohoTracker`.
- **Vault:** `spiVaultApi.vault` + `spiVaultApi.file(url, preview)` (streams through `/p2p/files/download`), with the `EvidenceVault` / `VaultDocument` types.

The **409** on `putawayAssign` and the vault's **blob** fetch are the two places a component branches on the raw error/response rather than the unwrapped data.

---

## 4. The four stages, UI side (in order)

### 4.1 Stage 1 UI (`Step1SupplierDetails.tsx`)
- **With PO** → a read-only PO panel; the supplier is locked (from the PO). **Direct** → an editable supplier picker (`+ Add Supplier` reuses the supplier master wizard).
- Supplier cards: Details · Address & Contact · **Legal Status** (compliance %, opens `SupplierEvidenceVaultModal` → the *supplier* vault) · GST Scrutiny · Risk Alert.
- Saves via `spiApi.create` (With-PO, first draft) or `spiApi.updateStage1` (Direct). The Direct GST gate (`stage1Gate`) surfaces `blockers[]`; a pending-document notice appears before advancing.

### 4.2 Stage 2 UI (`Step2InvoiceProducts.tsx`)
The same component renders all four flavours; what changes is the seed and which columns are live (see Technical §6):
- **With PO** → lines prefilled from `spiApi.poLines(poId)` (3-way if the PO carries a PI, else 2-way); `ProductTable` shows `qty_pi / qty_po / qty_spi`. No Add Product; a line can be removed/restored but not below packed.
- **Direct + Shipment** → lines fixed to the shipment's PI (2-way, no Add).
- **Direct, no shipment** → empty grid + **+ Add Product** (`SelectedProducts` picker).
- Invoice fields (`invoice_no/date`, invoice attachment, optional e-way) + the grid + totals POST together via `spiApi.saveItems` (multipart). Over-bill rows surface a non-blocking warning banner.

### 4.3 Stage 3 UI (`Step3BoxPackaging.tsx` + friends)
The screen is driven from the **SPI Box Generation System** table (one row per billed product, `remainingOf = spiQty − packed elsewhere`) and feeds the `BoxDrawer`. Three pack actions map to the three scenarios:
- `singleBox(line)` → BoxDrawer at **s1**.
- `applySplit(line)` (a Sub-Box Count) → `MultiBoxPanel` at **s2**; `splitQuantity` across N (≤ `maxSplitBoxes`), `setBoxQty` per box; a 1-box split normalises back to s1.
- `toggleSelect` ≥2 products → `packSelected` → BoxDrawer at **s3** (mixed carton; `mixedQty`/`setMixedLineQty` per SKU).

`BoxDrawer` collects dims · weights (volumetric shown) · condition · stackable · temperature (`TemperatureModal`) · flags (built-in + custom via `ProductFlagsModal`) · identity (per-box for s1/s2, per-SKU for s3) · remark+note · photos (upload/camera). `validate()` runs client-side (required dims, Net≤Gross, remaining-qty cap, expiry/MFG, non-correct needs a note, extra-only-if-over-billed) before `spiApi.createBox` — the server re-checks via `validateBox`/`guardOverPacking`.

`PackedProducts` lists saved boxes (`openEdit` until allocated; `closePack`/`removeSplitBox` to delete; `BoxStickerModal` to print — which locks the code). `finishStage3` enforces every-unit-boxed then warehouse capability, opening `WarehouseFixModal` on `warehouse_incompatible` before `spiApi.completeStage3`. See Functional §5 (Stage 3) and Technical §3.1.

### 4.4 Stage 4 UI (`Step4PutawayAllocation.tsx`)
- **Disposition** (`dispositionOf`): damaged→damaged, mismatched→mismatch, extra→inv, else `forDispatch ? 'ship' : 'inv'`, where **`forDispatch = !!poNumber || !!shipmentId`**.
- Right panel = a 3-step stepper:
  1. `PutawayReviewBox` → storage-mode modal (`spiApi.putawayModes`).
  2. `PutawaySelectLocation` — Section A recommendation (`spiApi.putawayLocations`) + Section B custom Zone›Rack›Shelf; `assignSpot` → `spiApi.putawayAssign` (409-aware).
  3. `PutawayConfirmPlacement` → the **method chooser**:
     - Option 01 → `raiseScanTask` (`spiApi.putawayScanTask`) → *Awaiting scan*; `PutawayScanTask` dialog polls `spiApi.putawayTask`.
     - Option 02 → `confirmManual` (`spiApi.putawayConfirmManual`) → *Put-away Completed*.
- `onProgress` / `putawayBoard` feeds the `allPlaced` gate → the footer **Map Invoice** (`spiApi.submit`).

### 4.5 Payment & Evidence Vault UI
- **Payments** are opened from the SPI list / wizard, not a stage: `InvoicePaymentsModal.tsx` (history — `spiApi` → `/payment-requests`) and `InvoicePaymentModal.tsx` ("Make SPI Payment" — `/payment-requests/{req}/payments`); `payment-chips.tsx` renders the `pending_payment_requests` / `approved_unpaid_amount` badges. **PO-backed → the request/payment lands on the PO; Direct → on the invoice itself** (see Technical §7 — *not* "always on the PO").
- **Invoice Evidence Vault** → `InvoiceEvidenceVault.tsx` loads `spiVaultApi.vault(id)`, renders `groups → sections → documents`, and streams each file through `spiVaultApi.file(url, preview)` (= `/p2p/files/download`). It branches on `doc.source` (`uploaded/generated/signed/awaited`) to decide which of View/Download are live — never on which URL is null (Technical §8).

## 5. Backend request flow (end to end)

```
POST /p2p/spi                    SupplierInvoiceController@store        → SupplierInvoice (draft)
POST /p2p/spi/{id}/items         @updateItems                          → SupplierInvoiceService::saveItems + syncPackingStage
POST /p2p/spi/{id}/boxes         SpiBoxController@store                 → SpiBox (+ SpiBoxItem) + guardOverPacking + syncPackingStage
PUT  /p2p/spi/{id}/stage-3       @completeStage3                       → WarehouseCapabilityService::missingFor (gate)
POST /p2p/spi/{id}/putaway/assign        SpiPutawayAllocationController@assign    → LocationLock + LocationOccupancy + SpiPutaway (draft)
POST /p2p/spi/{id}/putaway/{row}/scan-task  SpiPutawayTaskController@store        → SpiPutawayTask (pending), row awaiting_scan
    (handheld) POST /scan/putaway/{task}/complete   SpiPutawayScanController@complete  → occupancy occupy + row placed + task scanned
 or POST /p2p/spi/{id}/putaway/{row}/confirm-manual  @confirmManual    → row placed (verify_method=manual)
PUT  /p2p/spi/{id}/submit         @submit                              → status mapped, stage_completed=4
```

### Key responsibilities
- **`SupplierInvoiceController`** — the header + items + the gate/submit endpoints; delegates arithmetic and stage derivation to `SupplierInvoiceService`.
- **`SupplierInvoiceService`** — owns packing math (`packingSummary` from `SpiBoxItem` SUM), `normaliseBoxScenarios`, `syncPackingStage` (2↔3), `syncFulfilment` (writes `SpiPoFulfilment`; returns qty to the PO on cancel), code allocation.
- **`SpiBoxController`** — box CRUD, over-packing guard, sticker PDF (DomPDF + signed QR via `StickerKey`).
- **`SpiPutawayAllocationController`** — `assign` acquires a `LocationLock`, reserves `LocationOccupancy`, creates/moves the `SpiPutaway` row to `draft`; `confirmManual` flips it to `placed`.
- **`SpiPutawayTaskController`** — creates/queues/cancels Zebra tasks; `/putaway/tasks/*` is the branch-wide floor queue.
- **`SpiPutawayScanController`** — the only path a device talks to; `/complete` is the **only** call that moves stock.
- **`PoPaymentRequestController`** — SPI-scoped payment: `storeFromSpi`/`storePaymentFromSpi` branch on `purchase_order_id` (PO-backed → `store($po)`/`storePayment($po)`; Direct → `storeForSpi`/`savePaymentForSpi` on the invoice); `saveTdsForSpi` (Direct, else redirected to the order). All reuse the PO module's approver + UTR-uniqueness rules.
- **`P2pVaultService`** — read-only `forSpi`/`forPo`; gathers, never generates. **`P2pFileController@download`** is the one authenticated file stream the vault links to.

### Side flows (not the stage spine)
```
POST /p2p/spi/{id}/gst-approval/request   PoGstApprovalController@storeForInvoice  (Direct only)
PUT  /p2p/spi/{id}/tds                     PoPaymentRequestController@saveTdsForSpi
POST /p2p/spi/{id}/payment-requests        @storeFromSpi   → PO (PO-backed) | invoice (Direct)
POST …/payment-requests/{req}/payments     @storePaymentFromSpi  (request must be approved)
GET  /p2p/spi/{id}/evidence-vault          @evidenceVault  → P2pVaultService::forSpi
```

---

## 5a. Models in depth

### `SupplierInvoice` (`p2p_supplier_invoices`)
- **Predicates:** `isStandalone()` (=`purchase_order_id === null` — the single With-PO/Direct discriminator), `isDraft()`, `isCancelled()`, `isEditable()` (draft|mapped), `isInternational()`, `ownsZohoBill()` (=`isStandalone()`).
- **Relations:** `purchaseOrder`, `shipmentOrder`, `vendor`, `warehouse`, `items`, `boxes`, `putaways`, `fulfilments`, `activities`, `gstApprovals`, `paymentRequests`.
- **Consts:** `STATUSES` (draft→mapped→grn_pending→closed→cancelled), `DOC_TYPES` (domestic|international).

### `SupplierInvoiceItem` (`p2p_supplier_invoice_items`) — the match row
- `getMissingQtyAttribute()` → `max(0,(qty_po??qty_pi)−qty_spi)` (derived); `extra_qty` stored; `variance()` = `qty_spi−qty_po`; `isUnmapped()` (=`po_item_id===null`, consumes no PO qty).
- **Packed is not here** — it's `SUM(boxItems.quantity)`.

### `SpiBox` / `SpiBoxItem` — Stage 3
- `SpiBox`: `isCodeLocked()` (sticker printed), `isDamaged()` (condition≠perfect), `volumetricWeightKg()` (L×W×H ÷ `VOLUMETRIC_DIVISOR`); `putaway` is **HasOne** (one resting place). `CONDITIONS = perfect|minor|major|severe`.
- `SpiBoxItem`: `REMARKS = correct|damaged|mismatched|extra`; `isDamaged()`, `isExpired()`, `hasFlag()`. This table **is** the packing tracker.

### `SpiPutaway` — Stage-4 row (one per box)
- **Status is derived** by `stage()`/`stage4Status` from the scan timestamps + open task: `pending → draft → awaiting_scan → placed`. Helpers: `isPlaced()`, `nextScan()`, `isReadyToConfirm()`, `draftSince()`, `STEPS` (status→sub-step).

### `SpiPutawayTask` — the Zebra task (two-slot machine)
- Box slot + location slot, scannable in either order. `locationChain()`/`nextLocationLevel()`/`markLocationScanned()` walk zone→rack→shelf (a shelf proves its rack+zone). `currentStep()`/`readyToComplete()`/`resetScans()` (after `MAX_FAILS`), `scansAreStale()`/`idleSecondsLeft()` (TTL `DEFAULT_TTL_HOURS=8`). Not soft-deleted (reaped).

---

## 5b. Services in depth

### `SupplierInvoiceService` (the arithmetic & stage brain)
`financialYear` · `nextCode`/`previewCode` (per-branch `SPI/<FY>/NNN`) · `openQtyByPoItem` (how much of a PO is still billable) · `splitBalance` (open/over/closed) · `packingSummary`/`packingTotals` (packed/pending from `SpiBoxItem` SUM) · `normaliseBoxScenarios` (s2→s1 collapse) · `syncPackingStage` (derive the 2↔3 boundary) · `rollupTotals` · `saveItems` · `syncFulfilment` (writes `SpiPoFulfilment`; `EVENT_CANCELLED` returns qty to the PO) · `log` (SpiActivity).

### Inventory services (Stage 4)
- `WarehouseCapabilityService` — `requiredFor`/`missingFor` → the `warehouse_incompatible` gate.
- `LocationFinderService::forBox` — ranked recommendation + the location tree.
- `LocationOccupancyService` — reserve / release / occupy.
- `LocationLockService` — `acquireOrExtend`/`release`/`heartbeat` (the **409** on `assign`).
- `PutawayActivityLogger` — append-only `log`/`snapshot`.
- `StickerKey` — signed QR url/parse for BOX/ZONE/RACK/SHELF/WAREHOUSE.

---

## 5c. Request lifecycles (narrated)

**Create (Direct):** `store` → `validateHeader` (tenant-scopes shipment/warehouse) → `nextCode` under a lock → `SupplierInvoice` at `stage_completed=0` → `log('created')` → 201.

**Save items:** `updateItems` (POST) → validate invoice no/date/files + lines + totals → (Direct) `guardSupplierSegments` → store files (supersede) → `saveItems` → `max(2,…)` → `normaliseBoxScenarios` + `syncPackingStage` → `{invoice, match, warnings[]}`.

**Pack a box:** `SpiBoxController@store` → `validateBox` + `guardOverPacking` (can't exceed pending) → `SpiBox` + `SpiBoxItem` + attachments → `normaliseBoxScenarios` + `syncPackingStage`. Finish: `completeStage3` → `WarehouseCapabilityService::missingFor` gate → `max(3,…)`.

**Allocate + place (Zebra):** `assign` → `LocationLockService::acquireOrExtend` (409 if held) → `LocationOccupancyService` reserve → `SpiPutaway` → `draft`. `scan-task` → `SpiPutawayTask` pending, row `awaiting_scan`. Handheld `scan` ×2 (box + location) → the closing scan or `complete` → occupancy **occupy** + row **placed** + task **scanned** + lock released + `PutawayActivityLog` rows.

**Submit:** `submit` → refuse if no items / any unpacked / any box not placed → `status=mapped`, `stage_completed=4` → downstream GRN.

---

## 6. State to keep straight

- **With-PO vs Direct** is `purchase_order_id IS NULL` — there is no boolean flag (see `SupplierInvoice::isStandalone()`).
- **Stage never regresses** — every `stage_completed` write uses `max(new, current)`.
- **Packed quantity is not stored** on the item — it is `SUM(SpiBoxItem.quantity)`. Don't add a cached column.
- **`SpiPutaway` status is derived** (`stage4Status`) — the `status` column exists but the scan timestamps + open-task are the source of truth.
- **Box code `B-NNN` is unique only within an invoice**, and locks once the sticker prints (`isCodeLocked`).
- **`PutawayActivityLog` is append-only** — never `update()`; a correction is a new row.
- **Tenancy** comes from the user via `BelongsToTenant`; never trust `client_id`/`branch_id` from the body.

---

## 7. Gotchas / invariants

1. **POST, not PUT, for file saves** — `updateItems` and the box photo update are POST because PHP doesn't populate `$_FILES` on PUT.
2. **Direct-SPI GST gate withholds the stage, it doesn't reject** — fields save; `stage_completed` stays 0 until the senior approval is `approved`.
3. **Over-billing warns, never blocks.**
4. **`completeStage3` double-checks warehouse capability** (`warehouse_incompatible` 422) — the UI mirrors this with `WarehouseFixModal`.
5. **`submit` triple-guards** — no items / any unpacked / any box not placed.
6. **The handheld is server-authoritative** — every rule (which slot is owed, pair match, attempts left, when Complete is allowed) is the server's; the device only renders verdicts.
7. **Two scan logs** — `p2p_spi_scan_logs` (every attempt, from the legacy `SpiPutawayController::scan`) vs `inventory_putaway_activity_logs` (assigns/tasks/confirms, append-only). Don't conflate them.
8. **Direct-SPI payment is on the invoice, not the PO** — `storeForSpi`/`savePaymentForSpi` keep `purchase_order_id` NULL and bound the amount by the *invoice's* net payable. Only a PO-backed SPI's payments land on the order. (A past version of this doc said "money sits on the PO" — true for PO-backed only.)
9. **No per-action permission check** — every SPI method is guarded by `tenantUser()` alone (403 *No tenant context*); the menu leaf `p2p.invoice` is the only visibility gate. See Technical §9.

---

## 8. Suggested reading order for a newcomer

1. **Functional doc** → the flow, the four flavours, the six figures.
2. `routes/api.php` `p2p/spi` block (and **API doc §12** endpoint index) → the endpoint map.
3. `SupplierInvoice` model → statuses, stages, `isStandalone`.
4. `SupplierInvoiceController@store / updateItems / completeStage3 / submit` → the spine.
5. `SpiBoxController` + Technical §3.1 → Stage-3 packing internals.
6. `SpiPutaway` + `SpiPutawayTask` models → the Stage-4 state machines.
7. `Step4PutawayAllocation.tsx` + `SpiPutawayAllocationController` + `SpiPutawayScanController` → allocation and the handheld.
8. `PoPaymentRequestController@storeFromSpi` → how PO-backed vs Direct payment splits (Technical §7).

---

## 9. Companion docs
- **Functional** (`SPI_01`) — screens, flows, figures, business rules, roles.
- **Technical** (`SPI_02`) — data model, state machines, stage transitions, Stage-3 internals (§3.1), payment split (§7), vault (§8), roles (§9).
- **API** (`SPI_03`) — endpoint tables, conventions (§0), worked request/response (§10), query params (§11), endpoint index (§12).
- Adjacent P2P modules: `docs/p2p/purchase-order/*`, `docs/p2p/payment-request/*`, `docs/p2p/refund-adjustment/*`.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **SPI** | Supplier Purchase Invoice — the inward flow (invoice → box → put-away → map) |
| **Direct SPI / standalone** | an SPI with no PO (`purchase_order_id IS NULL`, `isStandalone()`) |
| **N-way match** | 3-way (PI·PO·SPI) / 2-way (PO·SPI or PI·SPI) / plain — Stage-2 quantity reconciliation |
| **Disposition** | the Stage-4 bucket a box goes to: Shipment Dispatch · Inventory · Damaged · Mismatch |
| **`forDispatch`** | `has PO OR has shipment` — routes *correct* goods to Shipment Dispatch vs Inventory |
| **Scenario (s1/s2/s3)** | box shape: single · split carton · mixed carton — **derived from contents** |
| **Packing tracker** | `SpiBoxItem` rows; packed qty = their SUM, never a stored column |
| **Put-away row** | `SpiPutaway`, one per box; status **derived** (`stage4Status`), not set by hand |
| **Zebra task** | `SpiPutawayTask` — a box handed to the floor for QR verification (Option 01) |
| **Two-slot scan** | box QR + location QR, scannable in either order; both close the pair |
| **Map / Mapped** | finishing Stage 4 → `status=mapped` → downstream GRN |
| **Evidence Vault** | read-only gather of an invoice's (or supplier's) documents — `P2pVaultService` / supplier vault |
| **`vault` source states** | `uploaded` · `generated` · `signed` · `awaited` — a screen branches on `source`, not null urls |
| **Code formats** | `SPI/<FY>/NNN` · `B-NNN` · `ZT-YYYYMMDD-NNN` · `PRQ-NNN` · `ADR/<FY>/<SEQ>` |
| **`tenantUser()`** | the only API guard: requires `client_id`, else 403 *No tenant context* |
