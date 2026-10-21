# SPI (Supplier Purchase Invoice) — Stages 01–03 Backend Validation Sheet

**Checked:** 2026-10-19 · **Branch:** `saas` · **Method:** code review of every `validate()` / `abort(422)` on the SPI Stage 01–03 endpoints
**Companion:** [SPI_STAGES_1-3_BUG_SHEET.md](SPI_STAGES_1-3_BUG_SHEET.md) (IDs in the *Bug ref* column point there)

**Files:** `Ctl` = `app/Http/Controllers/Api/P2p/SupplierInvoiceController.php` · `BoxCtl` = `app/Http/Controllers/Api/P2p/SpiBoxController.php`

**Severity:** **S1** money / stock / tenant leak · **S2** wrong data saved or flow blocked · **S3** message wording only

---

## Why most messages are unfriendly today

- The project has **no `lang/` folder** and the SPI rules pass **no `attributes`** array.
- Laravel therefore prints the raw field path. For example, the user sees **"The items.0.qty spi field must be greater than 0."** instead of "Row 1: SPI quantity must be more than 0."
- Only 5 custom messages exist across both controllers: 4 file-upload messages and `invoice_no.unique`.

**One-time fix (covers sections A and B):**
1. Add a `messages()` array and an `attributes()` array to each `validate()` call (or move them into FormRequests).
2. Give row-level `items.*` fields friendly attribute names (e.g. `'items.*.qty_spi' => 'SPI quantity'`).
3. Have the frontend turn `items.N.` into "Row N+1" using the **grid** row number, not the filtered payload index (see bug SPI2-F-10).

---

## Summary

| Section | Count |
|---|---|
| A. Stage 01 — header (`POST /p2p/spi`, `PUT /p2p/spi/{id}/stage-1`) | 14 |
| B. Stage 02 — invoice + items (`PUT /p2p/spi/{id}/items`) | 30 |
| C. Stage 03 — boxes (`POST/PUT/DELETE /p2p/spi/{id}/boxes`) | 30 |
| D. Submit / delete SPI | 6 |
| E. Existing custom messages to reword | 14 |
| **Total** | **94** |

Type key: **Missing** = no rule exists · **Weak** = a rule exists but doesn't protect enough · **Msg** = the rule is fine, only the default message is unfriendly.

---

## A. Stage 01 — Header

`validateHeader()` Ctl:1159 · `store()` Ctl:321 · `updateStage1()` Ctl:348

| ID | Field | Current rule | Type | Rule to add | User-friendly message | Sev | Bug ref |
|---|---|---|---|---|---|---|---|
| V1-01 | `vendor_id` | `required, integer` | Weak | `exists:vendors,id` scoped to `client_id` (and not soft-deleted) | "Select a valid supplier." | S1 | SPI1-B-01 |
| V1-02 | `vendor_id` | — | Missing | When `purchase_order_id` is set, it must equal the PO's `vendor_id` | "This supplier doesn't match the purchase order's supplier ({PO supplier})." | S1 | SPI1-B-02 |
| V1-03 | `vendor_id` | — | Missing | The vendor must not be blacklisted / inactive or have a cancelled GSTIN | "{Supplier} is blacklisted / inactive, so an invoice can't be raised against them." | S2 | SPI1-B-09 |
| V1-04 | `vendor_id` | `required` | Msg | — | "Select a supplier." | S3 | — |
| V1-05 | `purchase_order_id` | `nullable, integer` | Weak | `exists:p2p_purchase_orders,id` scoped to client + the user's branch, not deleted | "Select a valid purchase order." | S1 | SPI1-B-01 |
| V1-06 | `purchase_order_id` | — | Missing | The PO's `status` must be `submitted` (or the approved set), not draft / cancelled / closed | "Purchase order {PO code} is {status}. Only approved purchase orders can be invoiced." | S1 | SPI1-B-03 |
| V1-07 | `purchase_order_id` | — | Missing | The PO must still have open (un-invoiced) quantity | "Purchase order {PO code} is already fully invoiced — nothing is left to bill." | S2 | SPI1-F-09 |
| V1-08 | `document_type` | `required, in:DOC_TYPES` | Weak | When a PO is linked, take it from the PO server-side (ignore the request) or require it to match | "Invoice type must match the purchase order ({Domestic/International})." | S1 | SPI1-B-04 |
| V1-09 | `document_type` | `required, in` | Msg | — | "Choose whether this is a Domestic or International invoice." | S3 | — |
| V1-10 | `warehouse_id` | `nullable, exists(scoped)` | Weak | Make it `required` for own storage; a third-party flow must send its 3PL warehouse id (no NULL) | "Select the warehouse where these goods will be received." | S2 | SPI1-B-05 |
| V1-11 | `warehouse_id` | `exists` | Msg | — | "This warehouse isn't available for your branch." | S3 | — |
| V1-12 | `vendor_id`, `document_type`, `warehouse_id` (update) | Only the PO change is blocked once items exist | Missing | Block a vendor / type change once items exist; block a warehouse change once any box has a put-away row | "Supplier / invoice type can't be changed after products are added. Clear Stage 02 first." · "Warehouse can't be changed after boxes have been assigned to shelves." | S2 | SPI1-B-08 |
| V1-13 | `branch_id` | Not validated; never set on create | Missing | Set it server-side from the user's branch, or require a branch for a client admin | "Select a branch before creating an invoice." | S2 | SPI-C-02 |
| V1-14 | Duplicate draft | — | Missing | Refuse a second **draft** SPI for the same PO by the same user within N seconds (idempotency key) | "A draft invoice for {PO code} was just created ({SPI code}). Open that one instead." | S3 | SPI1-I-03 |

---

## B. Stage 02 — Invoice + Items

`validateInvoiceDetails()` Ctl:1199 · `updateItems()` Ctl:399-470 · `priceLines()` Ctl:1306

### B1. Supplier invoice header

| ID | Field | Current rule | Type | Rule to add | User-friendly message | Sev | Bug ref |
|---|---|---|---|---|---|---|---|
| V2-01 | `invoice_no` | `required, string, max:60, unique(client, vendor)` | Weak | Ignore soft-deleted / cancelled rows in `unique`, and fix the DB unique index to match (partial index `WHERE deleted_at IS NULL`) | "This supplier has already billed invoice no. {no} on {SPI code}." | S2 | SPI1-B-06 |
| V2-02 | `invoice_no` | case-sensitive unique | Weak | Compare trimmed and case-insensitive (`lower(invoice_no)`) | Same as above | S2 | SPI1-B-06 |
| V2-03 | `invoice_no` | `string` | Weak | `regex:/^[A-Za-z0-9\/\-_. ]+$/` (no stray symbols or newlines) | "Invoice no. may only contain letters, numbers and / - _ ." | S3 | — |
| V2-04 | `invoice_no` | `required`, `max:60` | Msg | — | "Enter the supplier's invoice number." · "Invoice no. can't be longer than 60 characters." | S3 | — |
| V2-05 | `invoice_date` | `before_or_equal:today` (UTC) | Weak | Compare against today in the tenant / app timezone (`Asia/Kolkata`), not UTC | "Invoice date can't be in the future." | S2 | SPI1-B-07 |
| V2-06 | `invoice_date` | — | Missing | `after_or_equal:{PO date}` when a PO is linked | "Invoice date ({date}) can't be before the purchase order date ({PO date})." | S2 | SPI1-B-07 |
| V2-07 | `invoice_date` | — | Missing | Not older than a configured limit (e.g. 365 days) — warn, or block per setting | "Invoice date is more than a year old. Please check the date." | S3 | — |
| V2-08 | `invoice_date` | `required, date` | Msg | — | "Enter the invoice date." · "Invoice date isn't a valid date." | S3 | — |
| V2-09 | `currency_code` | `required_if:document_type,international` (never fires) | Weak | Read `document_type` from the SPI row, not the request; add `exists:master_currencies,code` | "Select the invoice currency." · "{code} isn't a valid currency." | S2 | SPI2-B-11 |
| V2-10 | `exchange_rate` | `nullable, numeric, gt:0` | Weak | `required` when international; `max:10000` (same cap as the FE); `decimal:0,6` | "Enter the exchange rate." · "Exchange rate must be between 0 and 10,000." | S2 | SPI2-B-11 |
| V2-11 | `eway_no` | `nullable, string, max:40` | Weak | `digits:12` (an e-way bill no. is 12 digits); required when the invoice value is above ₹50,000 and domestic (per setting) | "E-way bill no. must be 12 digits." · "E-way bill is required for invoices above ₹50,000." | S3 | — |
| V2-12 | `invoice_file` | `nullable, file, mimes, max:10240` | Weak | `required` when the SPI has no `invoice_file_path` yet (the UI already requires it) | "Attach the supplier's invoice copy." | S2 | SPI2-F-09 |

### B2. Item rows (`items.*`)

| ID | Field | Current rule | Type | Rule to add | User-friendly message | Sev | Bug ref |
|---|---|---|---|---|---|---|---|
| V2-13 | `items` | `required, array, min:1` | Msg | Add `max:500` | "Add at least one product with a quantity." | S3 | — |
| V2-14 | `items.*.po_item_id` | `nullable, integer` | Weak | `exists:p2p_purchase_order_items,id` **where `purchase_order_id` = this SPI's PO** | "Row {n}: this product line doesn't belong to purchase order {PO code}." | S1 | SPI2-B-03 |
| V2-15 | `items.*.po_item_id` | — | Missing | `required` when the SPI has a PO; `prohibited` when it has none | "Row {n}: link this product to a purchase order line." | S1 | SPI2-B-03 |
| V2-16 | `items.*.po_item_id` | — | Missing | `distinct` — the same PO line can't appear twice | "Row {n}: {product} is already on row {m}. Combine the quantities into one row." | S2 | SPI2-B-08 |
| V2-17 | `items.*.product_id` | `required, integer` | Weak | `exists:products,id` scoped to `client_id`, not deleted | "Row {n}: select a valid product." | S1 | SPI2-B-05 |
| V2-18 | `items.*.product_id` | — | Missing | Must equal the PO line's `product_id` when `po_item_id` is set | "Row {n}: product doesn't match the purchase order line ({PO product})." | S1 | SPI2-B-06 |
| V2-19 | `items.*.qty_spi` | `required, numeric, gt:0` | Weak | `decimal:0,3`, `max:9999999999.999` (fits `decimal(14,3)`) | "Row {n}: SPI quantity is too large." | S3 | SPI2-B-13 |
| V2-20 | `items.*.qty_spi` | — | Missing | Must be ≥ the quantity already packed in boxes for that item | "Row {n}: {product} already has {packed} packed in boxes. Remove it from the boxes before reducing the quantity below {packed}." | S1 | SPI2-B-02 |
| V2-21 | `items.*.qty_spi` | Over-billing only warns | Weak | Block (or require a confirm flag) above open qty + tolerance % from settings | "Row {n}: {qty} is more than the {open} still open on the purchase order. Reduce it, or tick 'Accept extra quantity'." | S2 | SPI2-B-08 |
| V2-22 | `items.*.qty_spi` | `gt:0` | Msg | — | "Row {n}: enter a quantity more than 0." | S3 | — |
| V2-23 | `items.*.rate` | `required, numeric, min:0` | Weak | `decimal:0,4`, `max:9999999999.99`; `gt:0` unless the line is free-of-cost | "Row {n}: rate must be more than 0." · "Row {n}: rate is too large." | S2 | SPI2-B-13 |
| V2-24 | `items.*.gst_pct` | `nullable, numeric, 0–100` | Weak | `in:0,0.1,0.25,1.5,3,5,12,18,28` (the valid GST slabs) for domestic; `prohibited` for international | "Row {n}: {x}% isn't a valid GST rate." | S2 | SPI2-F-01 |
| V2-25 | `items.*.taxable_amount` | `required, numeric, min:0` — stored as sent | Weak | Recompute `qty_spi × rate` on the server (or reject a mismatch > ₹1) | "Row {n}: taxable amount doesn't match quantity × rate. Refresh and try again." | S1 | SPI2-B-04 |
| V2-26 | `items.*.cgst/sgst/igst_amount` | `nullable, numeric, min:0` — stored as sent | Weak | Recompute from `gst_pct` and the tax mode; refuse CGST/SGST **and** IGST together; CGST must equal SGST | "Row {n}: use either CGST + SGST or IGST, not both." · "Row {n}: tax amount doesn't match the GST rate." | S1 | SPI2-B-04 |
| V2-27 | `items.*.line_total` | `required, numeric, min:0` — stored as sent | Weak | Recompute taxable + tax | "Row {n}: line total doesn't add up." | S1 | SPI2-B-04 |
| V2-28 | `items.*.extra_qty` | `nullable, numeric, min:0` from the client | Weak | Ignore it (`prohibited`) and always compute it server-side, including for standalone SPIs | — (server-computed, never shown) | S3 | SPI2-B-14 |

### B3. Totals

| ID | Field | Current rule | Type | Rule to add | User-friendly message | Sev | Bug ref |
|---|---|---|---|---|---|---|---|
| V2-29 | `taxable_total`, `total_cgst/sgst/igst`, `grand_total` | `numeric, min:0` — stored as sent | Weak | Recompute from the saved lines; reject if the posted figure differs by > ₹1 | "Invoice totals don't match the product lines. Refresh and save again." | S1 | SPI2-B-04 |
| V2-30 | Concurrency | none | Missing | Send `updated_at` (or a version) with the save; reject if the row changed since it was loaded | "Someone else updated this invoice while you were editing. Reload to see their changes." | S2 | SPI2-B-12 |

---

## C. Stage 03 — Boxes

`boxRules()` BoxCtl:~455 · `assertBoxConsistent()` · `guardOverPacking()` BoxCtl:712 · `store()/update()/destroy()`

### C1. Box header

| ID | Field | Current rule | Type | Rule to add | User-friendly message | Sev | Bug ref |
|---|---|---|---|---|---|---|---|
| V3-01 | `scenario` | `required, in:s1,s2,s3` | Msg | — | "Choose how this box is packed: Single, Split or Mixed." | S3 | — |
| V3-02 | `length/width/height_cm` | `nullable, min:0, max:9999.99`; "all three or none" | Weak | `required`, `gt:0`, `decimal:0,2` (the frontend already requires them) | "Enter the box length, width and height (more than 0 cm)." | S2 | SPI3-B-10 |
| V3-03 | `length/width/height_cm` | `max:9999.99` | Msg | — | "Box {dimension} can't be more than 9,999.99 cm." | S3 | — |
| V3-04 | `length/width/height_cm` | — | Missing | Plausibility check: any side > 1,000 cm (10 m) needs a confirm flag. This catches the CM/M toggle bug | "{L}×{W}×{H} cm looks too large for a box. Check the unit (CM / M)." | S2 | SPI3-F-02 |
| V3-05 | `gross_weight_kg` | `nullable, min:0` | Weak | `required`, `gt:0`, `decimal:0,3` | "Enter the gross weight of the box (more than 0 kg)." | S2 | SPI3-B-10 |
| V3-06 | `net_weight_kg` | `nullable, min:0`; must be ≤ gross | Weak | `gt:0` when given | "Net weight must be more than 0 kg." | S3 | — |
| V3-07 | `weight_kg` | `nullable` — duplicates gross | Weak | Drop it, or set `prohibited` and derive it from gross | — | S3 | — |
| V3-08 | `gross_weight_kg` | — | Missing | Plausibility: < 0.01 kg or > 5,000 kg needs a confirm. Catches the KG/G toggle bug | "{x} kg looks wrong for a box. Check the unit (KG / G)." | S2 | SPI3-F-02 |
| V3-09 | `condition` | `required, in:CONDITIONS` | Msg | — | "Select the box condition." | S3 | — |
| V3-10 | `is_stackable` | `nullable, integer, in:0,1` → NOT NULL 500 on null | Weak | `required`, `boolean` (or default null to 0 before saving) | "Say whether this box can be stacked." | S3 | SPI3-B-09 |
| V3-11 | `temp_min_c / temp_max_c` | `nullable, -273.15..100`; both or neither | Weak | Realistic range `-80..60` °C | "Temperature must be between -80 °C and 60 °C." | S3 | — |
| V3-12 | `temp_min_c / temp_max_c` | Messages are custom | Msg | Already friendly — keep | — | — | — |

### C2. Box contents (`items.*`)

| ID | Field | Current rule | Type | Rule to add | User-friendly message | Sev | Bug ref |
|---|---|---|---|---|---|---|---|
| V3-13 | `items` | `required, array, min:1, max:200` | Msg | — | "Add at least one product to the box." | S3 | — |
| V3-14 | `items.*.supplier_invoice_item_id` | `exists` scoped to this SPI | Msg | — | "Row {n}: this product isn't on invoice {SPI code}." | S3 | — |
| V3-15 | `items.*.supplier_invoice_item_id` | — | Missing | `distinct` within one box (the same item twice breaks the own-qty lookup, BoxCtl:719) | "{Product} is added twice in this box. Combine it into one row." | S3 | SPI3-B-11 |
| V3-16 | `items.*.quantity` | `required, numeric, gt:0, decimal:0,3` | Msg | — | "Row {n}: quantity must be more than 0 (up to 3 decimals)." | S3 | — |
| V3-17 | `items.*.quantity` | — | Missing | Whole numbers only when the product UOM is a count unit (Nos / Pcs / Box) | "Row {n}: {product} is counted in {UOM}, so the quantity must be a whole number." | S3 | SPI3-R-13 |
| V3-18 | `items.*.quantity` (over-pack) | Guard runs **before** the lock; `update()` has no lock | Weak | Take `lockForUpdate` on the SPI **before** `guardOverPacking`, in both `store()` and `update()` | (message — see E-08) | S1 | SPI3-B-01 |
| V3-19 | `items.*.mfg_date` | `nullable, date` | Weak | `before_or_equal:today` | "Row {n}: manufacturing date can't be in the future." | S2 | SPI3-B-06 |
| V3-20 | `items.*.expiry_date` | `nullable, date`; > MFG | Weak | `after:today` on **create** (allow it unchanged on edit); `after_or_equal:{invoice_date}` | "Row {n}: {product} has already expired ({date}). Expired goods can't be packed." · "Row {n}: expiry date is before the invoice date." | S2 | SPI3-B-06, SPI3-R-09 |
| V3-21 | `items.*.expiry_date` / `mfg_date` | — | Missing | `required` when the product master marks it as expiry / batch tracked | "Row {n}: {product} is batch-tracked — enter the expiry date." | S2 | — |
| V3-22 | `items.*.batch_no` / `lot_no` / `serial_no` | `nullable, string, max:60` | Weak | `required` when the product is batch / serial tracked; `serial_no` with quantity > 1 is not allowed | "Row {n}: enter the batch no. for {product}." · "Row {n}: a serial no. can only be given for a quantity of 1." | S2 | — |
| V3-23 | `items.*.serial_no` | — | Missing | Unique per product across the client's live boxes | "Serial no. {x} is already received in box {box code}." | S2 | — |
| V3-24 | `items.*.remark` | `nullable, in:REMARKS` | Weak | Accept the same 4 conditions the UI offers; `major` must not be silently changed | "Row {n}: choose Correct, Damaged or Mismatched." | S3 | SPI3-F-13 |
| V3-25 | `items.*.remark_note` | Required when the remark ≠ correct | Weak | `min:5` so a single space or "." isn't accepted | "Row {n}: describe what was damaged / mismatched (at least 5 characters)." | S3 | — |
| V3-26 | `items.*.flags.*` | `integer, exists(scoped)` | Msg | — | "Row {n}: product flag isn't available for this branch. Reload the flags." | S3 | SPI3-F-09 |

### C3. Box edit / delete guards

| ID | Endpoint | Current check | Type | Rule to add | User-friendly message | Sev | Bug ref |
|---|---|---|---|---|---|---|---|
| V3-27 | `PUT boxes/{box}` | None for put-away | Missing | Refuse once the box has any put-away row (assigned / placed) | "{Box code} is already assigned to a shelf. Remove it from put-away before editing." | S1 | SPI3-B-02 |
| V3-28 | `DELETE boxes/{box}` | Only blocks when `confirmed_at` is set | Weak | Also refuse (or release the reservation first) when the put-away is assigned / awaiting scan | "{Box code} is reserved on shelf {location}. Cancel the put-away task first." | S2 | SPI3-B-04 |
| V3-29 | `DELETE boxes/{box}` | No `isEditable()` check | Missing | Same status check as `store()` / `update()` | "{SPI code} is {status} — boxes can no longer be removed." | S2 | SPI3-B-05 |
| V3-30 | `POST/PUT boxes` | `branch_id` never set | Missing | Set `branch_id` from `$spi->branch_id` | — (server-side) | S1 | SPI3-B-03 |

---

## D. Submit / Delete SPI

| ID | Endpoint | Current check | Type | Rule to add | User-friendly message | Sev | Bug ref |
|---|---|---|---|---|---|---|---|
| VD-01 | `PUT /{id}/submit` | No status check | Missing | Only `draft` can be submitted | "{SPI code} is already {status} and can't be submitted again." | S1 | SPI-C-03 |
| VD-02 | `PUT /{id}/submit` | `qty_pending > 0` only | Weak | Also refuse `qty_pending < 0` (over-packed) | "{Product}: {packed} packed but only {qty} invoiced. Fix the boxes before submitting." | S1 | SPI2-B-02 |
| VD-03 | `PUT /{id}/submit` | — | Missing | Required header fields present (invoice no., date, invoice copy, currency / FX if international) | "Complete Stage 02 first: {missing fields}." | S2 | — |
| VD-04 | `PUT /{id}/submit` | — | Missing | Refuse orphan box items whose SPI item was deleted | "Box {box code} holds a product that was removed from the invoice. Repack it before submitting." | S1 | SPI3-I-03 |
| VD-05 | `DELETE /{id}` | Only blocks `closed` | Weak | Also block when any box is placed; release put-away rows / reservations otherwise | "{SPI code} has boxes already on shelves. Remove them from put-away before deleting." | S2 | SPI3-I-05 |
| VD-06 | `DELETE /{id}` | Allowed for `mapped` / `grn_pending` | Weak | Allow `draft` only (or require a reason when mapped) | "{SPI code} is {status}. Only draft invoices can be deleted." | S2 | — |

---

## E. Existing custom messages — reword

| ID | Where | Current message (user sees) | Problem | Suggested message |
|---|---|---|---|---|
| E-01 | Ctl:36 | "No tenant context" | Technical jargon | "Your account isn't linked to a company. Contact your administrator." |
| E-02 | Ctl:37 | "No branch context — the invoice number is allocated per branch" | Jargon; blocks client admins even on the list | "Select a branch to work with supplier invoices." |
| E-03 | Ctl:55 | "No supplier invoice found with id {id}." | Shows the internal id | "This supplier invoice doesn't exist or has been deleted." |
| E-04 | Ctl:96 `poLines` | Laravel default "No query results for model [App\Models\…PurchaseOrder] 12" | Raw model class leaks | "This purchase order doesn't exist or has been deleted." |
| E-05 | Ctl:359, :415 | "{code} is {status} and can no longer be edited." | Raw status value (`grn_pending`) | "{code} is {Status label} and can no longer be edited." (map status to its label) |
| E-06 | Ctl:373 | "Items are already mapped to this invoice — clear Stage 02 before changing the purchase order." | "Stage 02" is internal | "Products are already added from this purchase order. Remove them first to change the purchase order." |
| E-07 | BoxCtl `guardOverPacking` | "That product is not on this invoice." | Doesn't say which product | "{Product} isn't on invoice {SPI code}." |
| E-08 | BoxCtl `guardOverPacking` | "Only 5.000 of that product is left to pack." | No product name; 3-decimal noise | "Only 5 {UOM} of {product} is left to pack." |
| E-09 | Ctl:571 submit | "5.000 is still unpacked. Goods not in a box have no box code, so they cannot be scanned, racked or inspected." | No product name; long | "{Product}: 5 {UOM} still not packed. Pack it into a box before submitting." |
| E-10 | Ctl:563 submit | "Add at least one item before submitting." | "item" vs the UI's "product" | "Add at least one product before submitting." |
| E-11 | BoxCtl `assertBoxConsistent` | "Scenario 03 is a mixed box — it needs at least two different products." | "Scenario 03" is internal | "A mixed box needs at least two different products." |
| E-12 | BoxCtl `assertBoxConsistent` | "Scenario 01 and 02 hold one product per box. Use Scenario 03 for a mixed box." | Same | "Single and split boxes hold one product. Use Mixed Box for more than one product." |
| E-13 | BoxCtl cold-chain check | "Mark the box Cold Chain before setting a temperature range." | OK, but fires when flags failed to load (SPI3-F-15) | "Tick the Cold Chain flag on this box to set a temperature range." |
| E-14 | BoxCtl `items.*.flags` closure | "The same product flag is selected twice on one product." | No row / product | "{Product}: the flag '{flag}' is selected twice." |

**Already friendly — keep:** `invoice_no.unique` · the 4 file mime / size messages · "Give all three dimensions, or none…" · "Net weight cannot be more than gross weight." · "Expiry date must be after the manufacturing date." · "A temperature range needs both…" · "The maximum temperature cannot be below the minimum." · "A '{remark}' line needs a note…" · the unplaced-box submit message · "{code} is closed — a received invoice cannot be deleted."

---

## Implementation order

1. **Tenant / PO scoping:** V1-01, V1-05, V1-06, V2-14, V2-15, V2-17, V2-18
2. **Money recompute:** V2-25 to V2-27, V2-29
3. **Stock integrity:** V2-20, V3-18, V3-27, VD-01, VD-02, VD-04
4. **Required fields the frontend already enforces:** V3-02, V3-05, V2-12, V2-09, V2-10
5. **Friendly messages + attributes for every rule (sections A–C "Msg" rows, section E):** one `messages()` / `attributes()` pass per controller
