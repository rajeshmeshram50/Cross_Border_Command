# P2P Purchase Order — API Documentation

## 0. How to read this

Base URL `/(api)`. Every route below sits behind `auth:sanctum` + `user.active`
and is tenant-scoped: `client_id`, `branch_id` and `created_by` are taken from
the authenticated user and **never** from the request body.

Prefix for this module: **`/api/p2p/orders`**
Controller: `App\Http\Controllers\Api\P2p\PurchaseOrderController`

**Response envelope**

```json
{ "status": true,  "data": { … } }
{ "status": false, "message": "…", "errors": { "field": ["…"] } }
```

`422` for business-rule refusals and validation, `403` for cross-tenant access,
`404` for not found. A super admin has no client, so **writes are refused** for
them — they have no tenant to create a PO under.

**Authorisation: there is none beyond the tenant check.** Every method calls
`tenantUser()`, which requires a `client_id` and otherwise returns
`403 {"status":false,"message":"No tenant context"}`. There is **no** role test
and **no** module-permission test on any route in this group. The menu leaf
`p2p.order` is permission-gated in the UI; these endpoints are not. Treat that
as a finding, not as intended behaviour.

> **There are two Purchase Order APIs.** This document covers
> **`/api/p2p/orders`** (the screen labelled *Order*, at `/p2p/order`).
>
> The older `/api/p2p/purchase-orders` belongs to a different screen and
> controller, and carries endpoints this one does **not** have: `preview-code`,
> `preview-pdf`, `suppliers`, `shipments`, `attachment-status`, `reattach`,
> `send-for-signature`, `zoho-pdf`. Finding them in `routes/api.php` is not
> evidence that this module has them.
>
> Two lookups are the exception: the supplier and shipment dropdowns on this
> screen deliberately reuse `/p2p/purchase-orders/suppliers` and
> `/p2p/purchase-orders/shipments`, as the route file notes.

---

## 1. Lookups

### `GET /p2p/orders/next-code`
The code the next PO would receive. **Read only** — nothing is locked or
reserved. Returns `PO/<FY>/<SEQ>`, e.g. `PO/2026-27/018`.

### `GET /p2p/orders/shipments/{shipment}/pi-lines`
Proforma-invoice lines available on a shipment, for Stage 02 when the PO is
linked to one. Lines already ordered on another PO are flagged so the same PI
line is not bought twice.

---

## 2. List and detail

### `GET /p2p/orders`
Paged list.

| Query | Rule | Meaning |
|---|---|---|
| `tab` | one of the five below | Which tab |
| `search` | ≤ 100 chars | **Not `q`.** See below for what it covers |
| `status` | `draft` · `submitted` · `cancelled` | |
| `link_type` | `with_shipment` · `standalone` | |
| `shipment_order_id` · `vendor_id` · `procurement_request_id` | integer | Exact-match filters |
| `per_page` | 1–**50**, default 10 | |
| `page` | 1-based | |

**The tab keys are short — they are not the `link_type` values:**

| `tab` | SQL applied |
|---|---|
| `all` | `TRUE` |
| `with` | `link_type = 'with_shipment'` |
| `without` | `COALESCE(link_type, 'standalone') <> 'with_shipment'` |
| `cancelinit` | `status = 'cancelled' AND cancel_stage = 'initiated'` |
| `cancelclosed` | `status = 'cancelled' AND COALESCE(cancel_stage, 'closed') = 'closed'` |

Note the `COALESCE` on `without`: a PO with a **null** `link_type` lands there
too, so it is a catch-all rather than a `standalone` filter.

**What `search` covers.** The PO code, `procurement_request_code`, the supplier
(code, company name, legal name), and — through a subquery on their own tables —
the shipment code, the PI code and the opportunity code. It also matches the
**labels the list prints**, not the stored values: "Domestics", "International",
"Material / Goods", "Draft", "Submitted", "Cancelled". A label only joins the
search from **three characters** — *"two letters would pull in half the list."*

`meta.counts` carries every tab's total in one query, so the tab badges need no
extra calls.

### `GET /p2p/orders/{id}`
Full PO: header, items, totals, payment figures, documents, inspection, GST
gate and Zoho state. `signing_started` reflects documents sent from Stage 04 and
any request Zoho has since declined.

---

## 3. The three stages

### `POST /p2p/orders` — Stage 01, create draft
Creates the PO in `status = draft`, `current_step = 1`, allocates `PO/<FY>/<SEQ>`
under a lock, and remembers the supplier's currency.

Key body fields:

| Field | Notes |
|---|---|
| `po_type` | `material_goods` · `services` · `ffd_transporter` |
| `document_type` | `domestic` · `international` |
| `vendor_id` | supplier |
| `link_type` | `with_shipment` · `standalone` |
| `shipment_order_id`, `proforma_invoice_id` | when linked |
| `currency_code`, `exchange_rate` | |
| `inco_term` | `CIF` · `C&F` · `EXW` · `FOB` |
| `mode_of_transport` | `Sea` · `Road` · `Air` |
| `port_of_loading`, `port_of_discharge`, `final_destination`, `country_of_origin` | |
| `expected_delivery_date`, `delivery_location` | `after_or_equal:today` · ≤ 255 |
| `physical_inspection` | `yes` · `no` — **required**, not optional |
| `link_procurement` | `yes` · `no` — **required on `with_shipment`, prohibited on `standalone`** |
| `procurement_request_id` | required when `link_procurement = yes` |
| `procurement_request_code` | ≤ 30 |

**Corrections to an earlier version of this table:**

| | |
|---|---|
| `po_type` | All three values are listed, but only **`material_goods`** is accepted — `OPEN_PO_TYPES`. The others return *"Only Material / Goods purchase orders can be raised for now."* |
| `proforma_invoice_id` | **Not a body field.** It is derived from the shipment (`piIdForShipment()`); a shipment without a PI is refused with *"This shipment has no Proforma Invoice to order against."* |
| `currency_code` | On an international PO it is **required and may not be INR**; on a domestic one it is ignored in favour of INR |
| `exchange_rate` | `> 0` and `≤ 10,000` (`FxRate::MAX`) |

**→ `201`** with the full PO.

### `PUT /p2p/orders/{id}/stage-1`
Same field set. Changing the supplier re-evaluates the GST gate, the tax mode
and the currency lock.

Two changes are refused outright:

| Change | `422` |
|---|---|
| The **shipment**, once the PO has lines | *Remove the product lines before changing the shipment — they are matched to its PI.* |
| The **supplier or document type**, once a GST approval is pending **or** approved | *This PO has gone to the senior for approval — the supplier and document type can no longer change.* — with `errors.vendor_id` = *"The supplier is fixed once the PO is sent for senior approval."* |

The second fires on a **pending** request, not only an approved one: once a
senior has been asked to accept a risk on a named supplier, that supplier is
fixed.

### `PUT /p2p/orders/{id}/items` — Stage 02
Replaces the line set **and the charges**. The charges live here, not on
`/terms`.

| Field | Rule |
|---|---|
| `lines` | **required, array, min 1** — the key is `lines`, *not* `items` |
| `lines.*.pi_item_id` | nullable integer, **`distinct`** — one PO line per PI line |
| `lines.*.product_id` | nullable, **`required_without:lines.*.pi_item_id`** |
| `lines.*.quantity` | required, `> 0`, ≤ **10,000,000** |
| `lines.*.rate` | required, `>= 0`, ≤ the unit ceiling |
| `lines.*.description` | nullable string |
| `shipping_charges` · `packaging_charges` · `other_charges` | nullable, `>= 0`, ≤ the order ceiling |

> **`gst_pct` is not accepted.** It is read from the product master
> (`products.gst_id` → `master_gst_percentage.percentage`) and forced to `0` on
> an international PO. Sending it has no effect. An earlier version of this
> document listed it as a body field — it never was.

#### The ceilings, in rupees

Both money ceilings are **₹1,000,000,000** (₹100 crore) and are divided by the
PO's exchange rate, so the limit is expressed in the PO's own currency:

```php
MAX_ZOHO_BASE      = 1_000_000_000   // the whole PO, and each charge
MAX_UNIT_RATE_BASE = MAX_ZOHO_BASE   // one unit's rate — tied to it deliberately
MAX_QUANTITY       = 10_000_000      // one line, currency-agnostic
```

| Breach | `422` |
|---|---|
| Quantity | *Quantity looks wrong — the most this PO takes on one line is 10,000,000.* |
| Rate | *Rate looks wrong — the most this PO takes for one unit is `<CCY> <amount>`.* |
| A charge | *Shipping charges look wrong — the most this PO takes is `<CCY> <amount>`.* (likewise packaging, other) |

> **The browser disagrees with the server.** `create-po/validation.ts` still
> carries the pre-tightening pair — ₹10 bn per unit and ₹1 trillion per PO — so
> a line between ₹100 cr and ₹1,000 cr passes every client check and is refused
> here with a different number. Raised as a defect; both figures are recorded
> until it is fixed.

#### Refused outright once money exists

```
if (po.paid_amount > 0) → 422
  "Payments are already recorded on this PO — its product lines and charges
   can no longer change."
```

Not "if the change would take the total below what is paid" — **any** payment
freezes the lines and the charges, because the stored balance and TDS rest on
the line total.

The server computes `taxable_amount`, `cgst_amount`, `sgst_amount`,
`igst_amount` and `line_total` from the PO's **tax mode** — client-sent amounts
are ignored. Every quantity change is written to `p2p_po_item_qty_histories`.

### `PUT /p2p/orders/{id}/terms` — Step 03, Terms & Conditions (+ submit)

| Field | Rule |
|---|---|
| `terms` | `nullable|string|max:20000` |
| `submit` | `'yes'` or `'no'` — **an enum, not a boolean** |

Saving without `submit: 'yes'` just stores the terms and sets `current_step = 3`.

**Only `terms` and `submit` are accepted here.** The charges are saved by
`PUT /items`, despite appearing on the Step 03 screen.

#### The six gates on submit

Every one returns `422` and the PO stays a draft.

| # | Check | Message |
|---|---|---|
| 1 | A supplier is selected | *Select a supplier before submitting.* |
| 2 | At least one product line | *Add at least one product line before submitting.* |
| 3 | **Every line still belongs to this supplier** — product or its segment must be mapped | *`PRD-001, PRD-004` — neither the product nor its segment is mapped to this supplier.* |
| 4 | **GST gate, re-read now** | `blocked` → *GST scrutiny is older than N months…* |
| | | `approval_required` + pending → *Senior approval is still pending…* |
| | | `approval_required` + rejected → *The senior rejected this PO: `<reason>`* |
| | | `approval_required` + none → *The supplier's last GST return is overdue — send it for senior approval before submitting.* |
| 5 | **Supplier's standard documents in date** — KYC, due diligence, trade licence | Lists the expired ones. *An expired KYC / DD / trade licence is no cover at all* (CS-407) |
| 6 | **Case to Case** — this supplier's earlier POs have their necessary Stage 04 paperwork signed | Lists the outstanding documents |

Gate 3 exists because **the supplier may have been changed after the lines were
saved**. Gate 4 re-reads GST at the moment of submission, not at creation.

#### What submitting does

```
status        = submitted
submitted_at  = now, submitted_by = user
current_step  = max(current_step, 3)
ensureDefaultDocuments()        ← Stage 04 rows materialised
GeneratePoDocumentPdf::dispatch()->afterCommit()   ← QUEUED
```

The PO PDF renders in a **background job** — dompdf takes seconds — and Step 04
polls for it. A missing PDF immediately after submit is expected, not a fault;
a missing PDF with no queue worker running is the fault.

### `GET /p2p/orders/{id}/qty-history`
Append-only log of every quantity change: previous → current, who and when.

---

## 4. Cancellation

### `POST /p2p/orders/{id}/cancel`
Body: `reason` (required, ≤ 1000).

```
if (po.paid_amount > 0) → 422
  "Payments are recorded on this PO — raise the advance refund adjustment instead."
```

This is the single most important rule in the module. A PO with money against
it **cannot** be cancelled here; it must go through
`POST /p2p/orders/refund-adjustments`.

On success: `status = cancelled`, `cancel_stage = closed`, `cancel_closed_at`
set, all PI-line reservations released, and the supplier currency lock forgotten.

### `DELETE /p2p/orders/{id}`
**Drafts only**, and not the same action as cancelling.

```
if (po.status !== 'draft') → 422
  "Only a draft PO can be deleted — cancel a submitted PO instead."
```

On success, inside one transaction:

```
svc->releaseAll($po, 'deleted', $user->id)   ← PI quantity released, logged as "deleted"
currency()->forget(client, vendor, po)        ← the supplier currency lock is DROPPED
$po->delete()                                 ← soft delete
```

→ `{ "status": true, "data": { "id": 17, "deleted": true } }`

Two consequences worth testing: the PO leaves **every** tab (it is not listed as
cancelled), and the supplier is free to trade in a different currency on the
next PO because the lock went with it.

---

## 5. GST approval

When the supplier's GST return is overdue the PO is gated. A senior approval is
raised here and decided from the Inbox.

| Route | Purpose |
|---|---|
| `POST /p2p/orders/{id}/gst-approval/request` | Raise |
| `GET /p2p/orders/gst-approvals/approvers` | Who can decide |
| `GET /p2p/orders/gst-approvals` | List |
| `GET /p2p/orders/gst-approvals/{approval}` | Detail |
| `PUT /p2p/orders/gst-approvals/{approval}` | Approve / reject |

`gst_gate` on the PO is one of `clear`, `approval_required`, `blocked`.

---

## 6. Stage 04 — documents

| Route | Purpose |
|---|---|
| `GET /p2p/orders/{po}/documents` | List (re-materialises missing rows) |
| `POST /p2p/orders/{po}/documents` | Add an ad-hoc document |
| `POST /p2p/orders/{po}/documents/needs` | Set which are Necessary |
| `POST /p2p/orders/{po}/documents/{doc}/file` | Upload |
| `POST /p2p/orders/{po}/documents/{doc}/generate` | Render from template |
| `PATCH /p2p/orders/{po}/documents/{doc}/status` | Status change |
| `GET /p2p/orders/{po}/documents/{doc}/download` | Download |
| `POST /p2p/orders/{po}/documents/sign` | Send to Zoho Sign |
| `POST /p2p/orders/{po}/documents/mark-sent` | Mark as sent |
| `POST /p2p/orders/{po}/documents/email` | Email to the supplier |
| `DELETE /p2p/orders/{po}/documents/{doc}` | Remove |

Document codes are `DOC/<FY>/<SEQ>`, one sequence per client — same allocator as
the PO, so `DOC/2026-27/004`.

#### `POST /p2p/orders/{po}/documents` — file one of your own

The seeded set is not the whole set. Refused only when the PO is cancelled.

| Field | Rule |
|---|---|
| `name` | **required**, ≤ 150 |
| `doc_kind` | one of `PurchaseOrderDocument::KINDS`, default `other` |
| `is_required` | `yes` · `no`, default `no` |
| `valid_up_to` | nullable date |
| `file` | nullable, **≤ 10 MB**, `pdf,doc,docx,jpg,jpeg,png` |

The row arrives at `status = pending` and `needed` mirroring `is_required` —
*"same start as the seeded rows: answered Not necessary (CS-414)."* The file is
stored **before** the row and removed again if the insert fails.

#### Refusals on this group

| Attempt | `422` |
|---|---|
| Anything, on a cancelled PO | *This PO is cancelled.* |
| Mark a mandatory document not necessary | *`<name>` always goes with the order and cannot be marked not necessary.* |
| Mark a sent document not necessary | *`<name>` has already been sent for signature — it stays Necessary.* |
| Replace a signed file | *A signed document cannot be replaced.* |
| Sign an already-signed document | *This document is already signed.* |
| Sign with no file attached | *Attach the document file before sending it.* |
| Bulk sign with any file missing | *Attach a file first: `<names>`* |
| Bulk action with a foreign id | *Some documents were not found on this PO.* |
| Generate anything but the PO document | *Only the Purchase Order document is generated.* |

**`POST /documents/sign` is the gate for Step 05.** It sets `signing_started` on
the PO, which is what the payment endpoints check.

---

## 7. Physical inspection

`PurchaseOrderInspectionController`. Every route returns the **same full
summary** — header references, every line with its verdict and proof, and the
sign-off — so one response is enough to redraw the screen after any change.

| Route | Purpose |
|---|---|
| `GET /p2p/orders/{po}/inspection` | The summary |
| `POST /p2p/orders/{po}/inspection/lines/{item}` | Verdict and/or proof for one line (**multipart**) |
| `DELETE /p2p/orders/{po}/inspection/lines/{item}/files/{index}` | Remove one proof file |
| `POST /p2p/orders/{po}/inspection/sign-off` | Sign off (**multipart**) |
| `POST /p2p/orders/{po}/inspection/withdraw` | Reopen a signed-off inspection |
| `GET /p2p/orders/{po}/inspection/files/{index}` | Download a sign-off note file |
| `GET /p2p/orders/{po}/inspection/lines/{item}/files/{index}` | Download a line proof file |

### Two gates on every route

```
if (po.physical_inspection !== 'yes') → 422 "This PO does not require physical inspection."
if (po.status !== 'submitted')        → 422 "Only a submitted PO can be inspected."
```

**That is all.** Inspection does **not** require the documents to have been sent
for signature — that gate guards Step 05 only — and the PO being cancelled is
not checked here.

### `POST …/lines/{item}`

| Field | Rule |
|---|---|
| `verdict` | nullable, **`required_without:files`**, one of `correct` · `damaged` · `mismatched` |
| `remark` | nullable, ≤ 1000 |
| `files` | nullable array, ≤ 10 |
| `files.*` | ≤ **20 MB**, `mimetypes:image/*,video/*,application/pdf` |

So proof may be sent with no verdict, or a verdict with no proof — but not
neither. Each call **merges**: new files are appended to what the line holds and
`remark` is only overwritten when the key is present.

The 10-file cap is on the **line total** and is checked before anything reaches
storage:

| | `422` |
|---|---|
| Already at 10 | *This product already has 10 proof files — remove one to add another.* |
| Partial room | *Only `<N>` more proof file(s) can be added to this product (up to 10 in total).* |

### `POST …/sign-off`

`note` ≤ 1000 and up to 10 `files` on the same rule. Refused while any line is
unmarked:

```
"<N> line(s) have no verdict yet — mark every line before signing off."
```

On success: `inspection_status = completed`, plus the note, note files,
`inspected_by` and `inspected_at`.

### After sign-off

| Attempt | `422` |
|---|---|
| `POST …/lines/{item}` · `DELETE …/files/{index}` | *Inspection is signed off — withdraw the sign-off to change a line.* |
| `POST …/withdraw` when not signed off | *There is no sign-off to withdraw.* |
| `DELETE` a stale index | *That file is no longer on this line.* (**404**) |

### `POST …/withdraw`

Returns `inspection_status` to `pending` and clears `inspected_by` /
`inspected_at`.

> **It does not clear `inspection_note` or `inspection_note_files`.** The note
> from the withdrawn sign-off stays on the PO and reads as current. Verified in
> the controller — raise it rather than relying on it.

### Downloads

Both file routes **stream as an attachment** rather than redirecting at the
stored file, because *"the browser drops the `download` hint across origins"*
once the disk is Azure. Route parameters arrive in URL order, which is why the
note file and the line file have separate methods rather than one optional
argument.

---

## 8. Zoho Books

### What is pushed automatically, and what is not

| Record | Pushed on save? |
|---|---|
| Purchase Order / Bill | **No** — explicit sync only |
| **Payment** | **Yes, conditionally** — `postToZoho()` fires after the save, **but only if `po.zoho_bill_id` already exists**. A failure is logged and swallowed; the payment still saves |
| Refund adjustment | **No** — *"Saving never calls Zoho"* |
| Recovery | **No** |

So the rule is not "Zoho is never called on save". It is: **nothing creates a
Zoho record implicitly, but a payment attaches itself to a bill that is already
there.** If the PO was never synced, the payment simply stays local until
somebody syncs.

### `POST /p2p/orders/{id}/zoho-sync`
Runs the **whole chain**: PO + bill, then payments, then vendor credit, then
refunds. Safe to re-run — each step skips what already carries a Zoho id.

Returns `{ "status": true, "message": "Synced to Zoho Books — <summary>." }`,
or `422` with a readable message when preflight fails (missing GSTIN, missing
tax, contact currency mismatch…).

### `GET /p2p/orders/{id}/zoho-tracker`
Per-step state: what is synced, what is pending, what failed and why.

### `GET /p2p/orders/{id}/zoho-tracker` (detail)

Built from **our own columns**, never by querying Zoho. Each step is
`done` · `pending` · `failed`, where `failed` means an error was recorded.

| `key` | `title` | `done` when |
|---|---|---|
| `purchase_order` | Purchase Order Created | `zoho_purchaseorder_id` set |
| `bill` | Bill Created | `zoho_bill_id` set |
| `payments` | PO Payment Completed | **every** payment posted |
| `vendor_credit` | Vendor Credit Created | the adjustment has a credit id |
| `refunds` | Refund Received | **every** recovery refunded |

The last two appear **only** when the PO has a refund adjustment. The `payments`
step carries an `items[]` array — one line per payment, each with its own
`state`, `amount`, `ref`, `at` and `error`, labelled `UTR <no>`, else the bank
name, else `Payment #<id>` — *"so a part-posted step says which one is
missing."* Its `note` reads `"3 of 5 posted"`, or `"No payment released yet"`.

### `GET /p2p/orders/{id}/proofs`
Feeds the **PO Evidence Vault**. Three collections, not just payments:

| Key | From | Reference |
|---|---|---|
| `adjustment` | `p2p_po_refund_adjustments` (latest) | Its code, date, refund amount and the attachment filed with it |
| `payments` | `p2p_po_payments` | The payment request's code, falling back to the UTR / cheque number |
| `recoveries` | `p2p_po_refund_recoveries` | The adjustment's code, falling back to the reference number |

Each row is `{ id, amount, date, ref, name, url }`, with `url` null when no
proof file was uploaded. Soft-deleted rows are excluded.

> **Not the same as the supplier's Evidence Vault.** The supplier's KYC / DD /
> trade licences — the ones submit's Blocker 5 checks — come from
> `GET /segment-uploads/supplier/{id}/vault`, a different module entirely.

---

## 9. Error messages you will meet

| Message | Cause |
|---|---|
| *Payments are recorded on this PO — raise the advance refund adjustment instead.* | Cancel attempted with `paid_amount > 0` |
| *This PO is already cancelled.* | Repeat cancel |
| *This PO already has a refund adjustment.* | Second adjustment attempted |
| *GST (CGST+SGST) X% tax not found in Zoho Books — add it and try again.* | Tax rate missing in Zoho |
| *Zoho Books: Both CGST and SGST has to be applied…* | Intra-state bill sent a single tax instead of the group |
| *No tenant context* (`403`) | The caller has no `client_id` — a super admin, on any route here |
| *Only a draft PO can be deleted — cancel a submitted PO instead.* | `DELETE` on a submitted or cancelled PO |
| *Payments are already recorded on this PO — its product lines and charges can no longer change.* | `PUT /items` with `paid_amount > 0` |
| *Remove the product lines before changing the shipment — they are matched to its PI.* | `PUT /stage-1` changing the shipment on a PO with lines |
| *This PO has gone to the senior for approval — the supplier and document type can no longer change.* | `PUT /stage-1` after a GST approval was raised |
| *This shipment has no Proforma Invoice to order against.* | A shipment with no PI |
| *This PI line is fully ordered — nothing is left to order against it.* | `PUT /items` against an exhausted PI line |
| *Only Material / Goods purchase orders can be raised for now.* | `po_type` other than `material_goods` |
| *This PO does not require physical inspection.* / *Only a submitted PO can be inspected.* | Any inspection route on the wrong PO |
| *`<N>` line(s) have no verdict yet — mark every line before signing off.* | Sign-off with lines unmarked |
| *Inspection is signed off — withdraw the sign-off to change a line.* | Editing a line after sign-off |

---

## 10. curl quick reference

```bash
TOKEN=...   # from POST /api/login

# Create a draft
curl -X POST https://host/api/p2p/orders \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"po_type":"material_goods","document_type":"domestic","vendor_id":8,
       "link_type":"standalone","currency_code":"INR","physical_inspection":"no"}'

# Items + charges  —  the key is "lines", and gst_pct is NOT accepted
curl -X PUT https://host/api/p2p/orders/17/items \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"lines":[{"product_id":3,"description":"Rice","quantity":10,"rate":500}],
       "shipping_charges":1200,"packaging_charges":0,"other_charges":0}'

# Terms + submit   ("yes" / "no", NOT a boolean)
curl -X PUT https://host/api/p2p/orders/17/terms \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"terms":"30 days","submit":"yes"}'

# Sync to Zoho
curl -X POST https://host/api/p2p/orders/17/zoho-sync -H "Authorization: Bearer $TOKEN"

# Physical inspection — one line, verdict plus two photos (multipart)
curl -X POST https://host/api/p2p/orders/17/inspection/lines/41 \
  -H "Authorization: Bearer $TOKEN" \
  -F 'verdict=damaged' -F 'remark=Two sacks torn in transit' \
  -F 'files[]=@sack1.jpg' -F 'files[]=@sack2.jpg'

# Sign off (refused while any line is unmarked)
curl -X POST https://host/api/p2p/orders/17/inspection/sign-off \
  -H "Authorization: Bearer $TOKEN" -F 'note=Checked against the PO on arrival'

# The evidence vault's files
curl https://host/api/p2p/orders/17/proofs -H "Authorization: Bearer $TOKEN"

# Delete a DRAFT (a submitted PO must be cancelled instead)
curl -X DELETE https://host/api/p2p/orders/17 -H "Authorization: Bearer $TOKEN"
```
