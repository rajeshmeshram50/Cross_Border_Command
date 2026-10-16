# SPI put-away — API test flow

A run-through of Stage 04 end to end, in the order the calls must happen, with
what to expect from each and what to check afterwards.

Collection: `docs/p2p/supplier-invoice/SPI.postman_collection.json`
Folder numbers below match the folders in it.

---

## 0. Before you start

```
base_url      http://localhost:8000/api
sticker_url   http://localhost:8000
```

Run **00 · Login**. It stores `{{token}}`. Everything else fills itself in from
test scripts as you go — `spi_id`, `box_id`, `putaway_id`, `task_id`,
`warehouse_id`, `zone_id`, `rack_id`, `shelf_id`.

Folder **07 is different**: it sends `X-Scan-Device`, not a bearer token. Get a
credential from **09 · Add a device**, or from Inventory → Scan Devices. The
plaintext is shown once and never stored, so copy it when it appears.

One thing that wastes an afternoon if missed: `public/hot` must not exist. It
is written while `npm run dev` runs, and it makes every page load assets from
the Vite dev server. If pages render blank, that is why.

---

## 1. Reach Stage 04

Only what Stage 04 needs; Stages 01–03 have their own cases.

| # | folder | call | gives you |
|---|---|---|---|
| 1 | 03 | Create draft | `spi_id` |
| 2 | 04 | Save the grid | items to pack |
| 3 | 05 | Create box | `box_id` — repeat for each box |
| 4 | 05 | Download sticker | the PDF whose QR you will scan |

**Check:** `05 · Packing summary` reads `qty_pending = 0`. Submit refuses later
if anything is unpacked, and that is a confusing place to discover it.

---

## 2. Allocate a location — folder 06

Run in this order. Each one depends on the last.

### 2.1 Set storage type

```
PUT /p2p/spi/{id}/storage-type     {"warehouse_id": …}
```

Response carries `putaway_mode`: `full` for an own warehouse (rack → shelf),
`summary` for a 3PL. **Skip this and the Locations calls return 422** — the
invoice has no warehouse to search.

### 2.2 Board

```
GET /p2p/spi/{id}/putaway/board
```

Every box with its status (`pending` · `draft` · `awaiting_scan` · `placed`)
and the counts behind the progress bar. Built from the BOXES, not the put-away
rows — a box nobody has started has no put-away row, and that is exactly the
one being looked for.

### 2.3 Locations — counts, then the tree

```
GET …/putaway/locations?box_id=…                 modes.rack / modes.norack
GET …/putaway/locations?box_id=…&mode=rack       recommended + zones[]
```

`recommended` is the top of the same ranked list the tree is built from, so the
two cannot disagree.

**Worth asserting:** every ineligible shelf carries a `reason` from this set —
`inactive` · `in_use` · `no_cold_chain` · `no_hazardous` · `no_temp_control` ·
`temp_out_of_range` · `too_tall` · `full` · `over_weight` · `over_capacity`.

Scoring, if a pick looks wrong: fit 45 · consolidate 20 · ergonomics 20 ·
grouping 15 · proximity 0 (dormant). **Fit rewards the tightest fit, not the
emptiest shelf** — a 48 kg carton on a 2,000 kg shelf strands the remainder.
Heavy boxes score better low down.

### 2.4 Assign

```
POST …/putaway/assign
{"box_id":…, "mode":"rack", "zone_id":…, "rack_id":…, "shelf_id":…}
```

**This is where capacity is taken**, not at confirmation — a scan task can sit
open for hours and the shelf must not read as free meanwhile.

After it: put-away row `draft`, occupancy `reserved`, location locked, shelf
counters resynced.

Call it again with a different shelf and it is the Change button — the previous
hold is released first and logged as `reassigned` with both addresses.

**Negative cases**

| do this | expect |
|---|---|
| another operator holds that location | 409 |
| shelf not on a rack in that zone | 422 |
| `mode` disagrees with the zone's `rack_mode` | 422 |
| box already placed | 422 — a placed box is final |

For a no-rack zone send `mode=norack` and omit `rack_id` / `shelf_id`.

---

## 3. Finish it — two branches

### Branch A · by hand (folder 06)

```
POST …/putaway/{putaway_id}/confirm-manual
{"confirmed": true, "condition_at_putaway": "perfect"}
```

`confirmed` must be `true` — send `false` and it is refused.

After: occupancy `reserved → occupied`, `verify_method=manual`, lock released.
**The shelf counters do not move** — the space was taken at assign. What changes
is who says the box is on the shelf.

Refused while a Zebra task is open on that box.

### Branch B · by scan (folders 06 → 07)

```
POST …/putaway/{putaway_id}/scan-task     {"confirmed": true, "ttl_hours": 8}
```

201 with `ZT-YYYYMMDD-NNN`, numbered per branch per day. The box stays
unplaced, capacity stays reserved, and the lock now follows the task deadline.

Then on the handheld — **folder 07, `X-Scan-Device` only, no bearer**:

```
POST /scan/putaway/session      device + the open queue
POST /scan/putaway/scan         the box
POST /scan/putaway/scan         the location
```

**The second half completes the put-away by itself.** Both scans had to match
the task to be accepted, so the barcodes have already proved everything a
button press could. `POST …/complete` exists but is not normally reached.

#### Scan order — all four must pass

| order | expect |
|---|---|
| shelf alone | done — `chain` shows zone ✓ rack ✓ shelf ✓ |
| zone → rack → shelf | each accepted, the shelf finishes it |
| zone → shelf | fine, skipping a level is allowed |
| location first, then the box | fine — the trolley-at-the-rack flow |

Scanning the shelf satisfies its rack and zone because a shelf cannot be
anywhere but its own rack. Only the **deepest assigned level** finishes the
location.

#### Input shapes — all must be accepted

```
https://host/ps/CBC1.1.BOX.4.15DYC.0B5KQFG      the printed URL
CBC1.1.BOX.4.15DYC.0B5KQFG                      the bare key
CBC1|1|BOX|4|15DYC|0B5KQFG                      typed by hand
SH:1                                            the short form
4                                               a legacy bare box id
```

Plus: trailing newline, trailing tab, leading space, `https`, a query string, a
trailing slash, and a lower-cased payload. A scanner is a keyboard and every
one of these is something a profile can produce.

#### Refusals to prove

| case | message |
|---|---|
| rack label when the shelf is owed | *That is a rack label. Scan the shelf label — WH-001 / …* |
| wrong box while on a task | *Wrong box — this task wants B-002. B-003 belongs to ZT-…* |
| box already away | *B-002 is already put away at … Nothing to do.* |
| box never allocated | *No put-away initiated for B-004.* |
| allocated but no task | *No scan task for B-001. It is allocated to … — raise a task, or confirm it by hand.* |
| location with nothing due | returns the location's CONTENTS instead of refusing |
| three refusals in a row | task resets to the box, `reset: true` |
| unknown credential | 401 |
| suspended device | 403 |

**The rack-vs-shelf one is the important case.** Shelf 1, rack 1 and zone 1 all
exist at once, because each table numbers from its own sequence. A check that
compares ids without comparing kinds will accept a rack label as proof the
operator was standing at the shelf — which is the exact mistake scanning exists
to catch.

#### Staleness

A half-finished scan is dropped after `SCAN_STALE_MINUTES` (default 30) and the
response says so. Test by ageing `box_scan_at`:

- 29 minutes → survives
- 31 minutes → resets, *The earlier scan timed out — starting this box again.*
- 3 hours but both halves scanned → **kept**, never discarded

### If a scan task goes wrong

```
POST /putaway/tasks/{task_id}/cancel      {"reason": "handheld offline"}
```

Works on a partly scanned task. Refused once the task is scanned, cancelled or
expired.

The occupancy stays **reserved** and the location stays **locked** on purpose:
the screen reopens on the same shelf offering manual confirm, and releasing the
space in between would hand that shelf to somebody else mid-decision.

Then confirm by hand on the **same put-away id** — that is the recovery path.

---

## 4. Read back — folder 08

| call | answers |
|---|---|
| `GET /putaway/tasks/{id}` | where this box is up to — small enough to poll |
| `GET /putaway/tasks/{id}/activity` | how it got there, every attempt, pass and fail |
| `GET /putaway/tasks?status=pending` | the floor's queue across invoices |

The activity read is the **only place refusals survive**. On the task row a
put-away that took four attempts and one wrong rack is indistinguishable from a
clean one. Each row carries `meta.value` — the raw string scanned — so you can
see it was a rack URL rather than guess.

It is also about 16× the size of the status read. Do not poll it.

---

## 5. Close — folder 10

```
PUT /p2p/spi/{id}/submit      {"note": "…"}
```

Sets `status=mapped`, `stage_completed=4`. **The only place `stage_completed` is
written** — nothing advances the invoice when the last box is placed.

Two guards:

```
unpacked goods   422  "… is still unpacked. Goods not in a box have no box code…"
unplaced boxes   422  "B-004 has not been put away. Place it before submitting."
                      + "unplaced": ["B-004"]
```

Run `06 · Put-away rows` first to see what is outstanding, rather than learning
it from a 422.

---

## 6. Verify in the database

A 200 is not proof. After a completed put-away:

```sql
-- the task
SELECT status, completed_scans, box_scan_at, zone_scan_at, rack_scan_at,
       shelf_scan_at, box_confirmed_at, shelf_confirmed_at
FROM p2p_spi_putaway_tasks WHERE id = ?;        -- scanned, 2/2

-- the placement
SELECT status, verify_method, confirmed_by FROM p2p_spi_putaways WHERE id = ?;
                                                -- placed, scan|manual

-- the ledger
SELECT status, placed_at, placed_by FROM inventory_location_occupancy
WHERE occupant_id = ?;                          -- occupied

-- the counters, which are RECOMPUTED from the ledger and never incremented
SELECT used_weight_kg, boxes_count FROM inventory_shelves WHERE id = ?;
```

Reserved rows count toward the shelf: a box on its way is occupying the space
even though nobody has put it down. A shelf showing boxes it does not visibly
hold is correct if those rows are `reserved`.

**Authorship.** `verify_method` says how it was attested. On a scan the author
is `scan_devices.enrolled_by` — whoever signed in to enrol the handheld. If
nobody did, it falls back to `created_by`, the admin who added the device row.
Seeing the wrong name here usually means enrolment was done without signing in
first.

---

## 7. Known gaps

Not bugs in the above — work that was scoped and not built.

- **Nothing expires an abandoned task.** `expires_at` is written on every task
  and read by nothing, so a task left open holds its shelf reserved
  indefinitely and that capacity never returns.
- **No lock heartbeat endpoint.** `LocationLockService::heartbeat()` exists with
  no route, so a long put-away can lose its shelf to the idle timer.
- **No way to move a placed box.** Cancel refuses a completed task and nothing
  un-places one. A box placed at the wrong shelf and confirmed can only be
  corrected in the database.
- **`failed_reason` is not cleared on success.** A task that completed after a
  refusal still carries the reason of that refusal, which reads as a failure on
  a screen.
- **The physical Zebra is untested.** Every input shape it can produce has been
  verified; the device itself has not.
