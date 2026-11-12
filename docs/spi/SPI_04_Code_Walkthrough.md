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

## 4. Stage 4 allocation UI (`Step4PutawayAllocation.tsx`)

- **Disposition** (`dispositionOf`): damaged→damaged, mismatched→mismatch, extra→inv, else `forDispatch ? 'ship' : 'inv'`, where **`forDispatch = !!poNumber || !!shipmentId`**.
- Right panel = a 3-step stepper:
  1. `PutawayReviewBox` → storage-mode modal (`spiApi.putawayModes`).
  2. `PutawaySelectLocation` — Section A recommendation (`spiApi.putawayLocations`) + Section B custom Zone›Rack›Shelf; `assignSpot` → `spiApi.putawayAssign` (409-aware).
  3. `PutawayConfirmPlacement` → the **method chooser**:
     - Option 01 → `raiseScanTask` (`spiApi.putawayScanTask`) → *Awaiting scan*; `PutawayScanTask` dialog polls `spiApi.putawayTask`.
     - Option 02 → `confirmManual` (`spiApi.putawayConfirmManual`) → *Put-away Completed*.
- `onProgress` / `putawayBoard` feeds the `allPlaced` gate.

---

## 4a. Stage 2 UI (`Step2InvoiceProducts.tsx`)

The same component renders all four flavours; what changes is the seed and which columns are live (see Technical §6):
- **With PO** → lines prefilled from `spiApi.poLines(poId)` (3-way if the PO carries a PI, else 2-way); `ProductTable` shows `qty_pi / qty_po / qty_spi`. No Add Product; a line can be removed/restored but not below packed.
- **Direct + Shipment** → lines fixed to the shipment's PI (2-way, no Add).
- **Direct, no shipment** → empty grid + **+ Add Product** (`SelectedProducts` picker).
- Invoice fields (`invoice_no/date`, invoice attachment, optional e-way) + the grid + totals POST together via `spiApi.saveItems` (multipart). Over-bill rows surface a non-blocking warning banner.

## 4b. Stage 3 UI (`Step3BoxPackaging.tsx` + friends)

The screen is driven from the **SPI Box Generation System** table (one row per billed product, `remainingOf = spiQty − packed elsewhere`) and feeds the `BoxDrawer`. Three pack actions map to the three scenarios:
- `singleBox(line)` → BoxDrawer at **s1**.
- `applySplit(line)` (a Sub-Box Count) → `MultiBoxPanel` at **s2**; `splitQuantity` across N (≤ `maxSplitBoxes`), `setBoxQty` per box; a 1-box split normalises back to s1.
- `toggleSelect` ≥2 products → `packSelected` → BoxDrawer at **s3** (mixed carton; `mixedQty`/`setMixedLineQty` per SKU).

`BoxDrawer` collects dims · weights (volumetric shown) · condition · stackable · temperature (`TemperatureModal`) · flags (built-in + custom via `ProductFlagsModal`) · identity (per-box for s1/s2, per-SKU for s3) · remark+note · photos (upload/camera). `validate()` runs client-side (required dims, Net≤Gross, remaining-qty cap, expiry/MFG, non-correct needs a note, extra-only-if-over-billed) before `spiApi.createBox` — the server re-checks via `validateBox`/`guardOverPacking`.

`PackedProducts` lists saved boxes (`openEdit` until allocated; `closePack`/`removeSplitBox` to delete; `BoxStickerModal` to print — which locks the code). `finishStage3` enforces every-unit-boxed then warehouse capability, opening `WarehouseFixModal` on `warehouse_incompatible` before `spiApi.completeStage3`. See Functional §5 (Stage 3) and Technical §3.1.

## 4c. Payment & Evidence Vault UI

- **Payments** are opened from the SPI list / wizard, not a stage: `InvoicePaymentsModal.tsx` (history — `spiApi` → `/payment-requests`) and `InvoicePaymentModal.tsx` ("Make SPI Payment" — `/payment-requests/{req}/payments`). `payment-chips.tsx` renders the `pending_payment_requests` / `approved_unpaid_amount` badges on the row. Money is raised from the invoice but stored on the PO (Technical §7).
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

---

## 8. Suggested reading order for a newcomer

1. **Functional doc** → understand the flow and the four flavours.
2. `routes/api.php` `p2p/spi` block → the endpoint map.
3. `SupplierInvoice` model → statuses, stages, `isStandalone`.
4. `SupplierInvoiceController@store / updateItems / completeStage3 / submit` → the spine.
5. `SpiPutaway` + `SpiPutawayTask` models → the Stage-4 state machines.
6. `Step4PutawayAllocation.tsx` + `SpiPutawayAllocationController` + `SpiPutawayScanController` → allocation and the handheld.
