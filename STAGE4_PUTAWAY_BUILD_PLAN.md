# Stage 04 — Temporary Putaway Allocation · Build Plan

What is already built, what has to be built, what changes in the system we
already have, and in what order.

- **Reference design:** `SPI_With_PO_Flow_2 (4).html`, lines ~39,141–40,400
  (`var S4`, `spiPutawayBox()`, the `s4-*` panels) plus the Zebra screens.
- **Where the project stands:** the SPI React app has `Step1SupplierDetails`,
  `Step2InvoiceProducts`, `Step3BoxPackaging`. **There is no Step 4.**
  `PutawaySummary.tsx` exists but is a read-only dialog built from seeded data,
  not the allocation flow.

---

## 1. Headline numbers

| | Count |
|---|---|
| Backend endpoints already built and reused | **9** |
| New backend endpoints | **8** |
| Existing endpoints / behaviours that change | **9** |
| **New database tables** | **3** |
| Existing tables altered | **3** (columns only) |
| New React components | **9** |

The three new tables are the box↔location ledger, the Zebra task, and the
activity log. Everything else — zones, racks, shelves, the putaway row, the
scan log, the device registry — already exists.

---

## 2. The flow, as designed

Four sub-steps inside Stage 04, with the left rail ("Pick a Box") live
throughout and the pinned box showing which sub-step it is on.

### Step 01 · Review Box — read-only

Nothing is written here. Everything shown was captured in Stage 03.

- **Tabs** choose the destination set: All · Shipment Dispatch · Inventory Stock
  · Damaged/Rejected · Mismatch.
- **Groups** inside the list are handling-based: Inventory Storage, Cold Chain
  Zone, Hazardous Zone, Damaged/Rejected, Miss-matched/Return. Empty groups
  still render, showing `None`.
- **Chips** narrow further: HAZ · NON-HAZ · COLD CHAIN, plus a search box.
- **Right panel** shows the pinned box: QR, condition, scenario, totals,
  dimensions, net/gross, cold-chain requirement, temperature range, hazardous,
  stackable, warehouse, source.
- **"View Products"** opens the box's product list; each line opens a product
  detail (code, quantity, segment, remark, four handling flags, and the seven
  advanced fields — `0 of 7 captured` when blank).
- **It gates the step.** With dimensions or weights missing the box reads
  **DATA MISSING**, the banner names each missing field, and
  `Next: Select Location` is disabled.

### Step 02 · Select Location

Opens with a modal, not a screen: **Storage Zone with Rack** (Zone › Rack ›
Shelf, `38 shelves`) or **Storage Zone without Rack** (the zone itself,
`6 zones`). Neither is preselected. The choice is per box.

That choice decides what a placement *is*: a `shelf_id` in rack mode, a
`zone_id` in norack mode.

Then one screen, two routes to the same answer:

- **Section A — System Recommended Location.** One spot, scored (`95% MATCH`),
  named in full and in codes (`ZN-002 › RC-001 › SH-105`), with the arithmetic
  of accepting it: available now, this box uses, occupancy after. One button
  takes it.
- **Section B — Custom Location Selection.** The same warehouse as a tree,
  filtered to the chosen mode, with eligibility counted at every level
  (`13 / 38 eligible`, `3 racks · 14 shelves · 8 eligible`). Each shelf shows
  its fill bar and the change this box causes (`0% → 13%`); ineligible shelves
  are greyed **with the reason on them** (`Full`); the recommended shelf is
  starred in place.

Both paths end in a chosen location. Nothing is committed yet.

### Step 03 · Confirm Placement

Two read-only panels — **Box Details** (QR, condition, scenario, quantities,
dimensions, weights) and **Shelf Details** (zone, rack, shelf, level, shelf
size, available space, max load, available load, occupancy `0% → 12.9%`, cold
chain, hazardous) with a **Change** button back to Step 02 — and one button:
**Putaway Method**.

It opens **Choose Putaway Confirmation Method**, titled with the full address
`PUT-B-001 → WH-001 → ZN-002 → RC-001 → SH-105`:

| | Option 01 · Using Zebra Device | Option 02 · Manual Confirmation |
|---|---|---|
| What it does | sends the box for physical QR verification on a handheld | states the box is already physically placed |
| Badge | **CREATES A SCAN TASK** | **COMPLETES NOW** |
| Tick reads | *"ready to be scanned … and should be sent for Zebra verification"* | *"already physically placed at …"* |
| Button | **Submit for Zebra Verification** | **Complete Putaway** |

Both expand to the same body: box → final shelf, the four-link **putaway
address** (Warehouse · Zone · Rack · Shelf), and the finality warning —

> *"This is final. Once you tick the confirmation, shelf SH-105 is locked for
> PUT-B-001 — it cannot be undone and the box location cannot be changed."*

The button stays disabled until the tick.

#### The Zebra path

Submitting creates a task — `ZT-20261014-001` — and the screen changes state
rather than finishing:

- the box badge becomes **AWAITING SCAN**;
- a banner appears: *"Awaiting Zebra confirmation — Task ZT-20261014-001
  created for PUT-B-001 → WH-001 → ZN-002 → RC-001 → SH-105. The box is placed
  only after the warehouse operator scans the Box QR and the Shelf QR."* with
  chips `Box QR` · `Shelf QR` · `0 / 2 scans`, and buttons **Cancel task** and
  **Open scan task**;
- **Putaway Method** is disabled while a task is open.

**Open scan task** shows the task itself: expected rack, expected shelf,
required scans (`Box QR + Shelf QR`), **capacity reserved — `12.9% of SH-105`**,
created by, created at. Below it the two scans run in order: *Scan 01 · Box QR*
is **READY TO SCAN** against an expected box id; *Scan 02 · Shelf QR* is
**LOCKED** and *"unlocks after the Box QR is verified"*. The verified
destination chain sits underneath, `Destination verification pending`, and the
footer states the rule: **the task completes automatically once both QR scans
are verified.**

**Zebra Verification Tasks** is the queue across boxes: AWAITING SCAN / PLACED /
CANCELLED counts with percentages, then every task with its code, status
(`Pending Device Scan`), box, address chips and per-row **Cancel** / **Open
scan**. Cancel is two-step — the button becomes **Confirm cancel?**.

**Cancelling returns to the method modal** with Option 01 greyed out and badged
**SCAN TASK CANCELLED**; only Manual Confirmation remains selectable.

#### Completion

Either path ends the same way: the header reads **PLACING BOX → PLACING INTO ·
RACK SHELF**, a green **PUTAWAY COMPLETED `ZN-002 → RC-001 → SH-105`** bar
carries the method (`PLACED · Manual Confirmation`), and the box leaves
*Awaiting Putaway* in the left rail for a new group — **STORED · ZN-002 · DRY
STORAGE ZONE B** — with `✓ PLACED` and its address chip.

**And the master moves.** Shelf Details after placement reads *Available space
3.88 m²* (was 4.46) and *Available load 1,741 kg* (was 2,000). That write-back
is the point of the whole stage.

### Step 04 · Putaway Summary

Everything placed and recorded for this invoice. 3PL warehouses get this screen
instead of the allocation flow (4.9).

---

## 3. What already exists — reuse, do not rebuild

### Endpoints

| # | Endpoint | Serves |
|---|---|---|
| 1 | `PUT /p2p/spi/{id}/storage-type` | warehouse choice; full vs 3PL |
| 2 | `GET /p2p/spi/{id}/putaway` | rows + mode + progress |
| 3 | `POST /p2p/spi/{id}/putaway/scan` | box, location, rack, shelf scans |
| 4 | `PUT /p2p/spi/{id}/putaway/{row}/confirm` | confirm a placement |
| 5 | `GET /p2p/spi/{id}/packed-boxes` | boxes with products, flags, dimensions |
| 6 | `GET /p2p/spi/{id}/boxes` | Stage 03's own editable row shape |
| 7 | `GET /inventory/zones\|racks\|shelves/options` | pickers |
| 8 | `POST\|GET /p2p/spi/{id}/boxes/{box}/sticker[/download]` | box sticker + QR |
| 9 | `GET /scan-devices` (+ CRUD, `/rotate`) | registered handhelds |

### Tables

| Table | State |
|---|---|
| `p2p_spi_putaways` | **built, 0 rows** — `box_id` unique, warehouse/zone/rack/shelf (all nullable), four scan timestamps, device, `confirmed_at`/`confirmed_by`, `condition_at_putaway` |
| `p2p_spi_scan_logs` | **built** — every attempt with `failure_reason`, `expected_scan`, `latency_ms` |
| `scan_devices` | **built**, with `serial`, `token_hash`, `last_seen_at` |
| `inventory_zones` | `rack_mode` (`rack` \| `norack`), `cold_chain`, `hazardous`, `temp_min_c`/`max`, area, volume |
| `inventory_racks` | `cold_chain`, `hazardous`, dimensions, `area_sqft`, `code` |
| `inventory_shelves` | `max_weight_kg`, `height_cm`, dimensions, `volume`, `cold_chain`, `hazardous`, `level_no`, and `used_weight_kg` / `boxes_count` that **nothing writes** |

**`inventory_zones.rack_mode` already answers Step 02's opening modal** — the
with-rack / without-rack split is modelled, not missing.

### Behaviour the scanner already enforces

- Both label forms resolve: the QR payload (`ZN:14`, `RC:7`, `SH:41`) and the
  printed code typed by hand.
- A rack in a different zone than the one scanned → `not_on_rack`.
- A shelf not on the scanned rack → `not_on_rack`.
- An inactive zone / rack / shelf → `inactive`.
- Every attempt is logged, refusals included.

---

## 4. New endpoints — 8

### 4.1 `GET /p2p/spi/{id}/putaway/locations?box_id={box}&mode=rack|norack`

Serves the whole of Step 02 in one call:

```
{ modes:       { rack: 38, norack: 6 },
  recommended: { shelf_id, score, used_before, used_after, reason[] },
  zones:       [ { …, racks: [ { …, shelves: [ { …, eligible, reason } ] } ] } ] }
```

Sections A and B run the **identical** eligibility and capacity computation —
the recommendation is the top of the same ranked list. Two endpoints would do
that work twice per box and could disagree with each other.

Filters: the invoice's warehouse, active locations only, cold chain, hazardous,
temperature range, weight capacity, height, and the zone's `rack_mode`.

**Blocked on a decision:** what makes one "best" (10.1).

### 4.2 `POST /p2p/spi/{id}/putaway/{row}/assign`

Writes the chosen location onto the putaway row and **reserves** capacity — one
`inventory_location_occupancy` row in `reserved` state. Reserving at assignment
rather than at confirmation is what stops two operators filling the same shelf
while both their tasks are open; the task modal already prints `CAPACITY
RESERVED 12.9% of SH-105`.

### 4.3 `POST /p2p/spi/{id}/putaway/{row}/confirm-manual`

Option 02. Flips the occupancy row `reserved → occupied`, writes `confirmed_at`,
`confirmed_by`, `verify_method = manual`, and locks the location. Records that
no device was involved — a manual confirmation is somebody's word, a Zebra scan
is evidence.

### 4.4 `POST /p2p/spi/{id}/putaway/{row}/scan-task`

Option 01. Creates `p2p_spi_putaway_tasks` with the expected box and shelf and
`required_scans = 2`; the putaway row stays unconfirmed and the occupancy row
stays `reserved`. Returns the task code (`ZT-YYYYMMDD-NNN`) for the banner.

### 4.5 `GET /p2p/spi/{id}/putaway/tasks` · `GET /putaway/tasks`

The banner, and the **Zebra Verification Tasks** queue — counts (awaiting /
placed / cancelled) plus the rows. Invoice-scoped and branch-scoped forms.

### 4.6 `POST /putaway/tasks/{task}/scan`

The handheld's callback, authenticated by `scan_devices.token_hash`. Enforces
the order (**box QR first; shelf QR locked until it verifies**), checks each
scan against what the task expects, and writes `p2p_spi_scan_logs` either way.
When both scans verify it completes the task and confirms the putaway **through
the same path as 4.3**, so both methods end in one place.

### 4.7 `POST /putaway/tasks/{task}/cancel`

Two-step in the UI, one call here. Cancels the task, **releases the reserved
occupancy**, and leaves the putaway row assigned-but-unconfirmed so Manual
Confirmation is still offered — exactly what the screen does.

### 4.8 `GET /p2p/spi/{id}/putaway/activity` · `GET /putaway/activity`

The log the operator and the auditor read: every event against a box, a shelf,
an operator or a device, newest first, from `inventory_putaway_activity_logs`.

### 4.9 `GET /p2p/spi/{id}/putaway/summary` — 3PL mode

`isFullPutaway()` already returns false for a `tpl` warehouse and expects a
summary path. Neither screen nor endpoint exists; a whole warehouse type has no
Stage 4 today.

---

## 5. New database tables — 3

### 5.1 `inventory_location_occupancy` — which box is in which location

**The box↔location table.** One live row per occupant; closed, never deleted.

| Column | Note |
|---|---|
| `client_id`, `branch_id` | tenancy |
| `warehouse_id`, `zone_id`, `rack_id`, `shelf_id` | denormalised; rack and shelf null in norack mode |
| `occupant_type`, `occupant_id` | polymorphic — an SPI box today, a GRN box or return tomorrow |
| `box_code` | the shelf readable without joining the source |
| `weight_kg`, `volume_cm3`, `footprint_cm2` | what this occupant consumes |
| `status` | `reserved` · `occupied` · `released` |
| `reserved_at`, `placed_at`, `placed_by` | the two moments |
| `released_at`, `released_reason` | null while live |

Why this cannot be answered from `p2p_spi_putaways`:

- that table is **SPI-scoped**, and a shelf will later hold GRN boxes, returns
  and transfers that have no SPI row;
- a *temporary* putaway is **released** when the box converts at GRN, and
  nothing there says the shelf is free again;
- it is one row per box forever, so reading a shelf means scanning every putaway
  row ever written.

**Both sides carry the link, as asked:** `p2p_spi_putaways.occupancy_id` points
at the row, and the row points back through `occupant_id`, so a change on either
side is one update. One caveat worth saying plainly — **the shelf master cannot
hold a single `occupancy_id`, because a shelf holds many boxes.** The reverse
link is the partial index on `(shelf_id, status)`; that is what makes "what is
on this shelf" one query.

### 5.2 `p2p_spi_putaway_tasks` — the Zebra hand-off

A task outlives the request that created it, so it needs its own row.

| Column | Note |
|---|---|
| `client_id`, `branch_id`, `supplier_invoice_id`, `putaway_id`, `box_id`, `occupancy_id` | what it is for |
| `task_code` | `ZT-YYYYMMDD-NNN`, per branch, allocated under the same row-lock pattern as the PO/SPI codes |
| `warehouse_id`, `zone_id`, `rack_id`, `shelf_id` | the **expected** address |
| `required_scans`, `completed_scans` | drives `0 / 2 scans` |
| `box_scan_at`, `shelf_scan_at` | the ordered pair; shelf stays locked until box verifies |
| `status` | `pending` · `scanned` · `failed` · `cancelled` · `expired` |
| `capacity_reserved_pct` | what the modal prints |
| `issued_at`, `issued_by`, `device_id`, `device_serial` | who sent it, which handheld answered |
| `completed_at`, `cancelled_at`, `cancelled_by`, `failed_reason` | how it ended |
| `expires_at` | so an unanswered task surfaces instead of sitting forever |

`p2p_spi_scan_logs` stays what it is — the **attempt** log, every scan good and
bad. This is the **work item**. "Did anyone scan this?" and "what is still
outstanding?" are different questions.

### 5.3 `inventory_putaway_activity_logs` — the activity trail

The scan log only knows about scans. The trail this flow implies covers
everything done to a putaway: assigned, re-selected via **Change**, task
created, task cancelled, confirmed manually, confirmed by device, released.

| Column | Note |
|---|---|
| `client_id`, `branch_id` | tenancy |
| `subject_type`, `subject_id` | putaway row, task, or occupancy row |
| `occupancy_id`, `putaway_id`, `task_id`, `box_id` | direct handles for filtering |
| `event` | `assigned` · `reassigned` · `task_created` · `task_cancelled` · `scan_passed` · `scan_failed` · `confirmed_manual` · `confirmed_device` · `released` |
| `from_location`, `to_location` | json snapshots of the address |
| `actor_type`, `actor_id`, `device_id` | person or handheld |
| `meta` | json — reason, percentages, whatever the event carries |
| `created_at` | append-only; **no updates, no deletes** |

One table answers "what happened to this box", "what did this operator do
today", and "who filled this shelf" without joining four others.

### 5.4 Columns on existing tables

| Table | Column | Why |
|---|---|---|
| `inventory_product_flags` | `behaviour` enum(`hazardous`,`cold_chain`,`fragile`,`none`) | `code` is a sequence (`PF-001`…) and only `flag_name` says "Hazardous". A tenant renaming it, or adding "Hazmat Class 3", silently breaks the HAZ/COLD buckets and every placement rule. Zones, racks and shelves already carry real `cold_chain`/`hazardous` booleans — this makes both ends speak the same language. |
| `p2p_spi_putaways` | `occupancy_id`, `task_id`, `verify_method`, `suggested_shelf_id` | the links above, plus "did the operator take the suggestion?" so the ranking can ever be tuned |
| `inventory_shelves` | `code` | zones and racks store a code; shelves compute `SH-101` in the model. These codes are **printed on the labels the handheld scans** — a computed code that drifts from a printed sticker breaks the scan, not just the display. |

---

## 6. What changes in the current system

| # | Where | Change |
|---|---|---|
| 1 | `SpiSummaryService::packedBoxes` / `SupplierInvoiceController::packedBoxes` | add `bucket`, `search`, `page`, `per_page` (default 10); return `counts`, `buckets`, `scenarios`, `progress`, `blocking[]`, per-box `is_hazardous` / `is_cold`, and the product's `segment`. **Counts are invoice-wide aggregates, never computed from the returned page** — otherwise "All Boxes 7" becomes "All Boxes 10". |
| 2 | `SpiPutawayController::confirm` | splits into assign → confirm-manual / scan-task; opens and closes the occupancy row instead of only stamping `confirmed_at` |
| 3 | `SpiPutawayController::scan` | adds the **temperature check**. A box carries `temp_min_c`/`temp_max_c`, a zone carries its own, and nothing compares them today — a −20 °C box can be confirmed onto an ambient shelf and nothing objects. Of every gap here this is the costliest: a silent cold-chain breach is found when the goods are opened. |
| 4 | `ShelfController` | stops accepting `used_weight_kg` / `boxes_count` from the form. Its own comment says they *"belong to the put-away, not to this master"* — from here they are system-maintained (7.2). |
| 5 | `Shelf` model | `load_pct` / `occupancy` finally read non-zero values |
| 6 | `Shelf` code accessor | replaced by the stored `code` column, so the printed label and the scanned value cannot diverge |
| 7 | Zone / rack / shelf option endpoints | accept `mode=rack\|norack` so Step 02 filters at the source |
| 8 | Product-flag master (API + UI) | exposes `behaviour`; the three seeded defaults get it in a data migration |
| 9 | Bucket rule | moves server-side out of `spiPackBoxType()`. **Note the mismatch:** the DB enum is `correct\|damaged\|mismatched\|extra`, the prototype tests `remark === 'mismatch'`. Ported literally, the Mismatch bucket stays empty forever. `extra` belongs with Inventory, as the prototype's own card label says. |

**Leave `Shipment Dispatch` disabled.** The prototype hardcodes its count to `0`
with the subtitle *"Not applicable for SPI"* — a deliberate placeholder, not a
missing feature.

---

## 7. Scale — hundreds of boxes, thousands of locations

The screens above show a 7-box invoice in a 38-shelf warehouse. The design has
to survive 100× that, so the structure follows the standard mapping:

| Requirement | Structure |
|---|---|
| Warehouse hierarchy | relational tables with foreign keys — already the case |
| Search by warehouse, zone, status | B-tree composite indexes |
| Find free locations | **partial** B-tree index |
| Fit boxes by dimension | numeric filters over an indexed candidate set |
| Track many boxes on one shelf | the occupancy table (5.1) |
| Rank best locations | SQL scoring, `ORDER BY … LIMIT k` |
| Prevent duplicate allocation | transactions + unique constraints |
| Large candidate sets in memory | sets / bitmaps **only if a benchmark justifies them** |

### 7.1 Indexes

```sql
-- "what is live on this shelf" — the hot read
create index idx_occ_shelf_live on inventory_location_occupancy (shelf_id)
  where status in ('reserved','occupied');

-- "where is this box" — the hot lookup, and the uniqueness guarantee
create unique index uq_occ_occupant_live
  on inventory_location_occupancy (occupant_type, occupant_id)
  where status in ('reserved','occupied');

-- candidate selection inside a warehouse
create index idx_shelf_candidates
  on inventory_shelves (rack_id, status, cold_chain, hazardous);
create index idx_zone_mode
  on inventory_zones (warehouse_id, rack_mode, status);

-- the open task queue
create index idx_task_open on p2p_spi_putaway_tasks (branch_id, status)
  where status = 'pending';

-- the activity trail, newest first per box
create index idx_act_box on inventory_putaway_activity_logs (box_id, created_at desc);
```

The partial indexes matter most: released rows accumulate forever, and without
`where status in (…)` every "is this shelf free" read drags the whole history
behind it.

### 7.2 The counter question — and where the earlier draft was wrong

A ledger alone means recomputing a shelf's load with an aggregate on every read.
That is correct, and at 38 shelves it is free. At 100,000 live rows, with the
rack map asking for every shelf in a warehouse at once, it is not.

So **keep both, and make the ledger the authority**:

- `inventory_shelves.used_weight_kg` / `boxes_count` are a **cache**, updated
  **inside the same transaction** as the occupancy insert or release — never
  from application code that can half-fail;
- a scheduled **reconcile job** recomputes them from the ledger and *reports*
  drift rather than silently fixing it;
- anything audit-facing reads the ledger, not the cache.

Increment-only was the error: with no ledger to check against, one double
callback or one failed transaction leaves a wrong number nobody can detect.
With the ledger, the cache is disposable.

### 7.3 Concurrency

Two operators can assign into the same shelf in the same second, and the Zebra
path widens that window from milliseconds to hours.

- `assign` (4.2) runs in a transaction: `select … for update` on the shelf row,
  re-check capacity, insert the `reserved` row, update the cache, commit. The
  partial unique index is the backstop if a check is ever skipped.
- **Reserved capacity counts as used** everywhere — suggestions, the rack map,
  the eligibility counts. Otherwise one shelf is recommended to five operators
  who all hold open tasks.
- A cancelled or expired task releases its reservation in the same transaction
  that closes the task.

### 7.4 Ranking at scale

Rank in SQL and take the top k — never load every shelf into PHP to sort it.
Eligibility is a `where`, the score is an expression, `limit 20` feeds Section A
and the starred shelf in Section B. Bitmaps and in-memory candidate sets come
only after a benchmark says the SQL path is too slow.

### 7.5 Reading the tree

At 38 shelves, return the whole tree. Past a few hundred, return zones with
their aggregate counts and load each rack's shelves on expand — a tree does not
paginate, so the lazy boundary is the rack.

---

## 8. Frontend — 9 components

| # | Component | From the design |
|---|---|---|
| 1 | `Step4PutawayAllocation.tsx` | the stage shell + sub-step state machine |
| 2 | `PutawayBoxList.tsx` | left rail: tabs, chips, groups, pinned box, STORED group |
| 3 | `StorageModeModal.tsx` | "Where do you want to store this box?" |
| 4 | `PutawaySuggestionPanel.tsx` | Section A — match score, before/after |
| 5 | `LocationTree.tsx` | Section B — zone › rack › shelf, fill bars, eligibility, reasons |
| 6 | `PutawayConfirmPanel.tsx` | Step 03's two read-only panels + **Change** |
| 7 | `ConfirmMethodModal.tsx` | Zebra / manual, address strip, finality warning and its tick |
| 8 | `ZebraTaskPanel.tsx` | awaiting banner, scan-task modal, `0 / 2 scans` |
| 9 | `ZebraTaskQueue.tsx` | the cross-box queue, its counts and the two-step cancel |

Constraints the UI must hold because the backend enforces them: the tick is
required before either confirm; **Putaway Method is disabled while a task is
open**; after a cancel Option 01 is greyed and badged `SCAN TASK CANCELLED`; a
placed box leaves *Awaiting Putaway* for the STORED group.

---

## 9. Development order

| Phase | Work | Depends on |
|---|---|---|
| **1** | `inventory_location_occupancy` + indexes + the transactional cache update | — |
| **2** | `inventory_putaway_activity_logs`, written by every putaway path | 1 |
| **3** | `inventory_product_flags.behaviour` + data migration + master UI | — |
| **4** | `packed-boxes` extended (filters, pagination, counts, blocking) | 3 |
| **5** | Temperature check in `scan` | — |
| **6** | `/putaway/locations` **without** ranking — eligibility and occupancy only | 1 |
| **7** | `assign` + `confirm-manual` — the whole Option 02 path | 1, 2 |
| **8** | Step 4 shell, box list, mode modal, location tree, confirm panel, method modal (manual only) | 4, 6, 7 |
| **9** | `p2p_spi_putaway_tasks` + create / list / cancel | 7 |
| **10** | Device callback with ordered scans + `ZebraTaskPanel` + queue | 9 |
| **11** | Ranking inside `/putaway/locations` + the match score | 6, **and 10.1** |
| **12** | 3PL summary | 8 |
| **13** | Reconcile job + drift report | 1 |

**Phases 1–8 ship a working Stage 4** on manual confirmation, with real
occupancy and a full activity trail. Zebra (9–10) is the second release, ranking
(11) the third. Neither blocks the other.

---

## 10. Decisions still needed

1. **What makes a suggestion "best"?** Least-occupied, tightest fit, nearest the
   dock? This is the `95% MATCH` number. Blocks phase 11.
2. **What exactly does a box consume?** The prototype is self-consistent on the
   shelf side and inconsistent with the box: `12.9%` of a `2,000 kg` max load is
   `259 kg`, and the final screen deducts exactly that (`2,000 → 1,741`). But
   the box's gross weight is **48 kg** and its stated quantity is **150 Kg** —
   neither is 259. Likewise available space drops `4.46 → 3.88 m²` (−0.58) while
   the box footprint is 1.2 × 0.8 = **0.96 m²**. The deduction basis has to be
   defined before any percentage on these screens is real.
3. **Capacity basis for norack zones.** A zone has no `max_weight_kg` — only
   `area_sqft`, `volume`, `capacity_litres`. Weight on shelves and volume/area in
   zones, or one basis everywhere?
4. **Free or used?** Section A prints `100% → 87.1%` (free), Section B prints
   `0% → 13%` (used) — same shelf, opposite directions, one screen. The API
   should return one canonical pair and let the UI phrase it.
5. **Ineligibility reasons and their priority.** `Full`, cold-chain mismatch,
   hazardous mismatch, too heavy, too tall, inactive — a shelf can fail several
   and the chip shows one.
6. **How long does a task stay open?** `expires_at` needs a number, and somebody
   has to see expired tasks or boxes sit unverified forever.
7. **Manual confirmation after a task was sent** — the floor may simply place it.
   If allowed, the task closes as *superseded* rather than staying pending.
8. **Who may cancel a task, and does it need a reason?** It releases reserved
   capacity, so it is not a neutral act.
9. **Is the Stage 03 condition re-asked at Stage 04 deliberately?** Both exist
   (`p2p_spi_boxes.condition`, `condition_at_putaway`). Damage between packing
   and placement is real, but the two must read as different questions.
10. **Does a 3PL warehouse record box-level placement, or only a count?**
11. **Does the selected box live in the URL?** If yes, add
    `GET /p2p/spi/{id}/packed-boxes/{box}` so a mid-flow refresh survives.
12. ~~May a confirmed putaway be moved?~~ **Answered by the design: no.** The
    dialog locks the shelf and says the location cannot be changed. Coming off a
    shelf is a *cancel and release*, not a move.

---

## 11. Summary

| | |
|---|---|
| New tables | **3** — occupancy ledger, Zebra task, activity log |
| New columns | **8** across 3 existing tables |
| New endpoints | **8** (1 blocked on the ranking decision) |
| Changed behaviour | **9 items**, section 6 |
| Reused endpoints | **9** |
| New components | **9** |
| Ships without Zebra | **Yes** — phases 1–8 |
| Ships without ranking | **Yes** — eligibility and occupancy are enough to place a box |

The one thing that cannot be deferred is the occupancy ledger. Every percentage
on every Stage 04 screen reads from it, and today they would all be zero.
