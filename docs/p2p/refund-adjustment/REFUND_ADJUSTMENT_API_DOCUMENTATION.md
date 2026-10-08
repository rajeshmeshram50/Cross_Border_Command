# P2P Advance Receipt Refund Adjustment — API Documentation

## 0. How to read this

Base URL `/(api)`. All routes behind `auth:sanctum` + `user.active`, tenant
scoped; identity fields come from the authenticated user, never the body.

Controller: `App\Http\Controllers\Api\P2p\PoRefundAdjustmentController`
Prefix: **`/api/p2p/orders/refund-adjustments`**

**Authorisation.** Every method calls `tenantUser()`, which needs a `client_id`
and otherwise returns `403 — No tenant context`. There is **no role test and no
module-permission test** anywhere in this controller: any authenticated user
inside the tenant can raise an adjustment, log recoveries, edit, delete and
sync. The menu leaf `p2p.advance_refund` is permission-gated in the UI only, so
hiding it does not stop these endpoints answering. Recorded as a finding.

**There is no approval endpoint, because there is no approval step.** `POST
/refund-adjustments` takes effect immediately — it cancels the PO, declines its
pending payment requests and releases its PI lines in one transaction. No
draft, no pending state, no undo.

**Envelope**

```json
{ "status": true,  "data": { … } }
{ "status": false, "message": "…", "errors": { "field": ["…"] } }
```

**What this module is for**

> Raising one **cancels a PO that has money released** (Cancellation Initiated);
> the supplier's refunds are logged as recoveries until nothing is outstanding
> (Cancellation Closed).

Saving **never** calls Zoho. Syncing is a separate, explicit action.

---

## 1. Picking a PO

### `GET /p2p/orders/refund-adjustments/eligible-pos`

Three conditions, all of them, and nothing else:

```php
paid_amount > 0                   // there is money to get back
AND status <> 'cancelled'         // not already dead
AND whereDoesntHave('refundAdjustment')   // one per PO, ever
```

| Query | Rule |
|---|---|
| `search` | ≤ 100 chars — PO code, or the supplier's company / legal name |

Returns the **50 most recent** matches, newest first. Each row carries
`paid_amount` **and `currency_code`**, because the paid figure is in the
order's own currency and the picker has to say which.

A PO absent from this list is absent for one of exactly those three reasons.

### `GET /p2p/orders/refund-adjustments/eligible-pos`
POs that can take an adjustment: not cancelled, `paid_amount > 0`, and no
adjustment already.

### `GET /p2p/orders/refund-adjustments/po/{po}`
The adjustment on a given PO, if any.

---

## 2. List and detail

### `GET /p2p/orders/refund-adjustments`

| Query | Meaning |
|---|---|
| `tab` | `all` · `pending` (`status <> 'recovered'`) · `recovered` |
| `q` | search |
| `page`, `per_page` | paging |

### `GET /p2p/orders/refund-adjustments/{id}`
Full adjustment: PO, supplier, amounts, retained reason, recoveries, Zoho state.

---

## 3. Raising one

### `POST /p2p/orders/refund-adjustments`
`multipart/form-data`

| Field | Rules |
|---|---|
| `purchase_order_id` | required |
| `refund_type` | `Full Refund` · `Partial Refund` |
| `refund_amount` | required |
| `reason` | required |
| `supplier_ref_no` | optional |
| `retained_type` | required when anything is retained — see §4 |
| `retained_remark` | required when anything is retained |
| `attachment` | pdf/jpg/jpeg/png/webp, ≤ **2 MB** |

**Refusals**

| Condition | Message |
|---|---|
| PO already cancelled | *This PO is already cancelled.* |
| Adjustment already exists | *This PO already has a refund adjustment.* |
| No money released | *No money has been released on this PO — cancel it directly instead.* |
| Refund > paid | *The amount to be refunded cannot be more than the X paid.* |
| Full Refund with money retained | *A full refund must return the whole X paid — choose Partial Refund…* |
| Partial Refund with nothing retained | *A partial refund must be less than the amount paid — choose Full Refund…* |
| Retained without a reason/remark | *Give the reason and a remark for the X not being refunded.* |

**Side effects, all in one transaction**

1. PO row locked
2. `ADR/<FY>/<SEQ>` created
3. Every **pending payment request** on the PO is rejected with
   `Closed — PO cancelled (ADR/…)`
4. PI-line reservations released
5. PO set to `cancelled`, `cancel_stage = initiated`

**→ `201`**

### `POST /p2p/orders/refund-adjustments/{id}`
Edit. **POST, not PUT** — the edit may carry a new attachment.

Amounts are **fixed once the vendor credit is in Zoho**.

---

## 4. Retained money

`retained_amount = paid_amount − refund_amount`

Whenever it is greater than zero, both a reason and a remark are mandatory.

`retained_type` must be one of:

```
Cancellation Charges · Restocking Fee · Freight / Logistics Already Incurred
Bank & Remittance Charges · Non-Recoverable GST · Customs / Duty Already Paid
Work Already Completed · Contractual Retention · Other
```

---

## 5. Recoveries

### `POST /p2p/orders/refund-adjustments/{id}/recoveries`
`multipart/form-data`

| Field | Rules |
|---|---|
| `amount` | required, ≥ 1 |
| `recovered_date` | required, **not in the future**, **not before the adjustment date** |
| `reference_no` | optional, ≤ 64, **unique per client** |
| `proof` / `proofs[]` | ≤ 1 file, pdf/jpg/jpeg/png/webp, ≤ **10 MB** |
| `keep[]` | paths of stored proofs to retain |

**Duplicate reference** is refused with the offending record named:

> *Cheque / UTR number 1789632456987 is already recorded on ADR/2026-27/001 · PO/2026-27/004 for ₹25,000.00 on 06-Oct-2026. Enter the reference from this payment instead.*

### `POST /p2p/orders/refund-adjustments/{id}/recoveries/{rec}`
Edit — POST for the same multipart reason.

### `DELETE /p2p/orders/refund-adjustments/{id}/recoveries/{rec}`

**All three are refused once the recovery is in Zoho:**

> *This refund is already posted to Zoho Books — it can no longer be changed or deleted.*

**After every change** the adjustment recomputes:

```
recovered = Σ recoveries
balance   = refund_amount − recovered

balance ≤ 0     → status = recovered  → po.cancel_stage = closed
recovered > 0   → status = partial    → po.cancel_stage = initiated
otherwise       → status = pending    → po.cancel_stage = initiated
```

---

## 6. Zoho Books

> **Corrected.** An earlier version described these as pushing one record each,
> and said the vendor credit "must exist first". Neither is how they behave.

### `POST /p2p/orders/refund-adjustments/{id}/zoho-sync`
### `POST /p2p/orders/refund-adjustments/{id}/recoveries/{rec}/zoho-sync`

**Both call `PoZohoService::syncAll()` on the parent PO.** They are the same
operation reached from two places, and each walks the entire chain in order:

```
1. Purchase Order   →  Zoho Purchase Order
2.                  →  Zoho Bill
3. Payments         →  Vendor Payments applied to that bill
4. The adjustment   →  Vendor Credit
5. Each recovery    →  Vendor Credit Refund
```

> *"Same chain as every other Zoho Sync button, so this refund can never land
> before the PO, its bill, its payments and the vendor credit are there."*

So **ordering is automatic** — there is no need to sync the credit before the
recoveries, and no endpoint requires `zoho_vendorcredit_id` to be present
beforehand. Anything already carrying a Zoho id is skipped, so either call is
safe to repeat.

| Call | What is actually pushed |
|---|---|
| `{id}/zoho-sync` | The PO, its bill, its payments, the credit **and every recovery** |
| `{id}/recoveries/{rec}/zoho-sync` | Exactly the same |

The recovery route adds one check **after** the chain has run. If that
particular refund still has no Zoho id, it reports failure rather than success:

> *"This refund was not posted to Zoho Books — try again."*

Both return `200` with the refreshed detail and a message built from
`PoZohoService::summary()`. A `RuntimeException` from `preflight()` — missing
vendor contact, missing GSTIN, a tax absent from Zoho, a currency mismatch —
comes back as `422` with that message.

**Because the whole chain runs, a failure anywhere stops the step you wanted.**
A refund will not post if the PO's bill cannot be created, and the message will
be about the bill.

Both are driven from the list's **Zoho Sync** column. Saving never calls Zoho.

---

## 7. The document

### `GET /p2p/orders/refund-adjustments/{id}/pdf`
The *Advance Receipt Refund Adjustment* document, rendered from our own data —
not from Zoho.

---

## 8. Status model

```
pending  ──first recovery──►  partial  ──balance = 0──►  recovered
   │                                                          │
   └──────────── po.cancel_stage = initiated ─────────────────┤
                                       po.cancel_stage = closed ┘
```

---

## 9. curl quick reference

```bash
TOKEN=...

# Which POs can take one
curl -H "Authorization: Bearer $TOKEN" \
  https://host/api/p2p/orders/refund-adjustments/eligible-pos

# Raise (partial refund, something retained)
curl -X POST https://host/api/p2p/orders/refund-adjustments \
  -H "Authorization: Bearer $TOKEN" \
  -F purchase_order_id=17 -F refund_type='Partial Refund' \
  -F refund_amount=40000 -F reason='Supplier could not deliver' \
  -F retained_type='Cancellation Charges' -F retained_remark='Agreed 10%' \
  -F attachment=@supplier-letter.pdf

# Log a recovery
curl -X POST https://host/api/p2p/orders/refund-adjustments/3/recoveries \
  -H "Authorization: Bearer $TOKEN" \
  -F amount=25000 -F recovered_date=2026-10-06 \
  -F reference_no=UTR123456 -F proof=@bank-advice.pdf

# Push to Zoho
curl -X POST https://host/api/p2p/orders/refund-adjustments/3/zoho-sync \
  -H "Authorization: Bearer $TOKEN"

# The document
curl -H "Authorization: Bearer $TOKEN" \
  https://host/api/p2p/orders/refund-adjustments/3/pdf -o adr.pdf
```
