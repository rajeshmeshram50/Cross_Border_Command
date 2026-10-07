# P2P — Purchase Order, Payment Requests & Advance Refund Adjustment
# End-to-End Flow

> One document, three modules. They are not three features — they are three
> consecutive states of the same money. A Purchase Order commits it, a Payment
> Request releases it, and an Advance Receipt Refund Adjustment gets it back
> when the order dies after payment.
>
> Read this before the API, Functional, Technical or Code Walkthrough documents.
> Those answer *how*; this one answers *why there are three of them*.

---

## 1. The one-paragraph version

A buyer raises a **Purchase Order** against a supplier, through three stages
(header → items → terms) and submits it. Trade documents are then assembled and
signed, and goods are inspected. Money does not move with the PO: each release
is a **Payment Request** (`PRQ-001`) which somebody else approves, and against
an approved request one or more **payments** are recorded with a UTR and a
proof. If the order has to be cancelled **after** money has gone out, it cannot
simply be cancelled — an **Advance Receipt Refund Adjustment** (`ADR/<FY>/<SEQ>`)
is raised, which cancels the PO, states how much the supplier must return and
how much is retained, and stays open until **recoveries** add up to the refund.
Every one of those steps can be mirrored into **Zoho Books**, always explicitly,
never as a side effect of saving.

---

## 2. Why three modules and not one

| Concern | Module | Why it is separate |
|---|---|---|
| What we agreed to buy | Purchase Order | Commercial commitment. Changes to it are versioned and quantity-logged. |
| When money leaves | Payment Request | Needs a **second person** to approve. Raising and approving must not be the same action, or the control is theoretical. |
| Getting money back | Advance Refund Adjustment | A cancellation with money outstanding is an open receivable, not a deletion. It needs its own identity, document and ageing. |

The separation exists so that **no single screen can both commit and release
funds**. A PO can be raised by procurement; only an approver can turn a request
into money; and once money is out, only a refund adjustment can unwind it.

---

## 3. The whole flow

```
                         ┌──────────────────────────────┐
                         │  STAGE 01  Create PO (draft) │  POST /p2p/orders
                         │  header, supplier, linkage   │  → PO/<FY>/<SEQ>
                         └──────────────┬───────────────┘
                                        │
                         ┌──────────────▼───────────────┐
                         │  STAGE 02  Items             │  PUT /{id}/items
                         │  qty · rate · GST · tax mode │  qty changes logged
                         └──────────────┬───────────────┘
                                        │
                         ┌──────────────▼───────────────┐
                         │  STAGE 03  Terms + SUBMIT    │  PUT /{id}/terms
                         │  draft ──────────► submitted │  Stage 04 rows made
                         └──────────────┬───────────────┘
                                        │
         ┌──────────────────────────────┼──────────────────────────────┐
         │                              │                              │
┌────────▼─────────┐         ┌──────────▼──────────┐        ┌──────────▼─────────┐
│ STAGE 04         │         │  PAYMENT REQUESTS   │        │  STAGE 05          │
│ Trade documents  │         │  PRQ-001, PRQ-002…  │        │  Physical          │
│ generate → sign  │         │                     │        │  inspection        │
│ (Zoho Sign)      │         │  pending            │        │                    │
└──────────────────┘         │     │               │        └────────────────────┘
                             │     ├── approved ──► payments (UTR + proof)
                             │     └── rejected    │        │
                             └─────────────────────┘        │
                                                            │
                                   po.paid_amount ◄─────────┘
                                   po.balance_amount
                                        │
                        ┌───────────────┴────────────────┐
                        │  Does the PO need cancelling?  │
                        └───────────────┬────────────────┘
                                        │
                  paid_amount = 0 ──────┴────── paid_amount > 0
                        │                             │
            ┌───────────▼──────────┐    ┌─────────────▼──────────────────┐
            │ POST /{id}/cancel    │    │ ADVANCE RECEIPT REFUND         │
            │ status = cancelled   │    │ ADJUSTMENT  ADR/<FY>/<SEQ>     │
            │ cancel_stage=closed  │    │ POST /refund-adjustments       │
            │ (direct cancel)      │    │ cancel_stage = initiated       │
            └──────────────────────┘    └─────────────┬──────────────────┘
                                                      │
                                        ┌─────────────▼─────────────┐
                                        │  RECOVERIES               │
                                        │  pending → partial →      │
                                        │  recovered                │
                                        └─────────────┬─────────────┘
                                                      │ balance = 0
                                        ┌─────────────▼─────────────┐
                                        │ cancel_stage = closed     │
                                        └───────────────────────────┘
```

---

## 4. The hand-offs, in order

### 4.0 Before any money can be requested — three gates

`PoPaymentRequestController::payable()` runs before **every** request, TDS save
and payment. All three must pass:

```php
if ($po->isCancelled())
    → "This PO is cancelled — no payment requests or payments can be made."

if ($po->status !== STATUS_SUBMITTED)
    → "Submit the PO before managing its payments."

/* Money moves only after the paperwork is out: the supplier has to have
   been sent the PO for signature before anything is requested or paid. */
if (!$po->signingStarted())
    → "Send this PO for signature first — payments are managed only once the documents are out."
```

So the real order is **Stage 03 submit → Stage 04 send for signature → money**.
A submitted PO whose documents have never gone to the supplier cannot be paid
against, by design.

And on a **domestic** PO there is a fourth gate, checked in `store()`:

```php
if ($order->document_type !== 'international' && !$order->tds_updated_at)
    → "Deduct the TDS on this PO first — save it (even as 0) before raising a payment request."
```

TDS decides the net payable, which is the ceiling every later rule uses. It has
to exist before anything draws against it.

### 4.1 PO → Payment Request

A payment request is raised **against a PO** (`POST /p2p/orders/{po}/payment-requests`).
It carries a payment type — *Advance Payment*, *Partial Payment*, *Final Payment*
or *Balance Payment* — and an amount.

The PO supplies the ceiling. `po.net_payable_amount` (after TDS) is what the
requests collectively draw against, and `po.paid_amount` / `po.balance_amount`
are **stored on the PO** and rebuilt from the payment rows inside the same
transaction as every change.

### 4.2 Payment Request → Payment

A request is `pending` until somebody decides it:

| Decision | Requires | Effect |
|---|---|---|
| **approved** | `approved_amount` (≥ 1) | Payments may now be recorded against it |
| **rejected** | a reason (≤ 300 chars) | Nothing can be paid against it |

Approval and payment are different actions. An approved request is a
**permission to pay**, not a payment. The actual release is one or more
`p2p_po_payments` rows, each with bank, UTR/cheque number and date, and a proof
file.

### 4.3 Payment → Zoho Books

Only when somebody asks. A payment posted to Zoho becomes a **vendor payment**
applied against the PO's bill, and the uploaded proof is attached to the **bill**
— Zoho Books has no attachment endpoint for a vendor payment, so the bill is
where the evidence can live and still be found from the transaction.

### 4.4 PO → Refund Adjustment (the important fork)

```php
// PurchaseOrderController::cancel()
if ((float) $po->paid_amount > 0) {
    return $this->fail('Payments are recorded on this PO — raise the advance refund adjustment instead.');
}
```

This is the hinge of the whole design. **A PO with money against it cannot be
cancelled directly.** The plain cancel route refuses, and the only way forward
is a refund adjustment. Without that rule a cancellation would silently write
off cash already with the supplier.

Raising the adjustment does five things in one transaction:

1. Locks the PO row
2. Refuses if it is already cancelled, already has an adjustment, or has no money against it
3. Creates `ADR/<FY>/<SEQ>` with the refund / retained split
4. **Rejects every still-pending payment request** with `Closed — PO cancelled (ADR/…)`
5. Cancels the PO at `cancel_stage = initiated`

### 4.5 Refund Adjustment → Recoveries → closure

Each repayment from the supplier is a **recovery** row. After every change:

```
recovered = Σ recoveries
balance   = refund_amount − recovered

balance = 0        → status = recovered  → po.cancel_stage = closed
recovered > 0      → status = partial    → po.cancel_stage = initiated
otherwise          → status = pending    → po.cancel_stage = initiated
```

The PO's cancellation is only **closed** when the money is actually back. Until
then it is *Cancellation Initiated* — an open receivable, visible as such.

---

## 4A. Tab by tab — Purchase Order (`/p2p/order`)

Five tabs. Each one is a different question about the same table, and the SQL
behind it is the definition:

```php
'all'          => 'TRUE',
'with'         => "link_type = 'with_shipment'",
'without'      => "COALESCE(link_type, 'standalone') <> 'with_shipment'",
'cancelinit'   => "status = 'cancelled' AND cancel_stage = 'initiated'",
'cancelclosed' => "status = 'cancelled' AND COALESCE(cancel_stage,'closed') = 'closed'",
```

Counts for **every** tab come back in one query, so the badges are always right
without five round trips.

---

### TAB 1 · All PO's

**Holds** every PO of the branch, any status — `'all' => 'TRUE'`.

#### What the row shows

Sr No · PO Number · PO Type · Document Type · Shipment ID · Opportunity ID ·
Procurement ID · Supplier · Risk Alert · Expected Delivery Date · Total PO
Amount · Net Payable Amount · Total Paid Amount · Balance

The last four come from the stored columns `grand_total`, `tds_amount`,
`paid_amount`, `balance_amount` — which is why they are stored at all: the list
needs them per row without aggregating payments.

#### Filters that apply to every tab

| Filter | Values |
|---|---|
| Status | `draft` · `submitted` · `cancelled` |
| Document Type | `domestic` · `international` |
| PO Type | `material_goods` · `services` · `ffd_transporter` |
| Link Type | `with_shipment` · `standalone` |
| Supplier, Shipment, Procurement request | by id |
| Search | PO code, supplier name/code, and the linked shipment / opportunity / PI **ids** |
| Rows per page | 1–50, default 10 |

The tab condition is applied **after** the counts are computed, so every badge
reflects the current filters.

#### The five steps behind "Create PO"

| Step | Screen name | What is captured |
|---|---|---|
| 01 | **Link Supplier Details** | Supplier, PO type, document type, linkage, currency + exchange rate, incoterm, transport mode, ports, country of origin, expected delivery date, delivery location, payment type, **Physical Inspection Required** toggle |
| 02 | **Product Details** | Lines: product, description, qty, rate, GST % |
| 03 | **Terms & Conditions** | Terms text, shipping / packaging / other charges → **Submit** |
| 04 | **Post-PO Trade Document Management** | Generate, upload, mark necessary, e-sign, email |
| 05 | **Payment Management** | TDS, payment requests, payments — see §4C |

Physical inspection is a **toggle on Step 01**, not a step of its own. Its
verdict screen appears only when the toggle is on.

#### Lifecycle from this tab

```
Create PO ──► draft ──────────► submitted ──────────► cancelled
                │                    │                     │
      editable, steps 01–03     steps 04–05 live      Tab 4 or Tab 5
      deletable (soft)          cannot be deleted     depending on money
```

| Action | Available when | Refused when |
|---|---|---|
| Resume the wizard | `draft` | — |
| Delete | `draft` | Once submitted |
| Stage 04 documents | `submitted` | While `draft` |
| Payment Management | `submitted` **and** documents sent for signature | See §4.0 |
| Cancel | Not already cancelled | `paid_amount > 0` → use a refund adjustment |
| Zoho Sync | Zoho configured | Preflight failures are returned verbatim |

**Rows leave this tab never** — it is `TRUE`. They change which *other* tab they
also appear in.

---

### TAB 2 · With Shipment ID PO's — the **with purchase order** flow

**Holds** `link_type = 'with_shipment'`. The PO is raised against a **Shipment
Order** and the **Proforma Invoice** underneath it.

#### Where the lines come from

```
Opportunity / Lead
      │
Shipment Order  ──────►  Proforma Invoice  ──────►  PI items
      │                                                 │
      │  GET /p2p/orders/shipments/{shipment}/pi-lines  │
      │                                                 ▼
Step 01 picks the shipment            Step 02 shows every PI line with
(+ proforma_invoice_id,                 · ordered quantity so far
   lead_id carried along)               · quantity still available
                                        · which POs already took some
```

The operator does **not** type the products. They pick PI lines and say how much
of each this PO takes. `pi_item_id` is stored on every PO line, which is what
ties the order back to the proforma invoice.

#### The reservation — a quantity ledger, not a lock

This is the one piece of logic unique to this tab, and it is subtler than
"the line is taken":

```php
// PurchaseOrderService::orderedByPiItem()
SUM(quantity) GROUP BY pi_item_id
WHERE  po.status = 'submitted'
   OR  EXISTS (gst approval on that PO with status pending | approved)
AND    po.id <> <this PO>
AND    po.deleted_at IS NULL
```

| | |
|---|---|
| **Quantity, not lines** | Two POs can each take part of one PI line. A line is only exhausted when the quantities add up |
| **Submitted POs hold** | The order is real |
| **Drafts with a GST approval in flight hold** | A draft sitting with a senior is not abandoned |
| **Plain drafts do NOT hold** | — see below |
| **The current PO is excluded** | Editing its own lines is not a self-collision |
| **Soft-deleted POs release** | `deleted_at IS NULL` |

The comment in the source records why plain drafts were removed from the rule:

> *A plain draft used to hold it too and nothing ever released it — drafts
> abandoned at Step 02 had taken a whole PI between them, so no further PO could
> be raised and the reason read "nothing left to order".*

#### Release

```
cancel (direct)                  ─┐
cancel via refund adjustment     ─┼─►  svc->releaseAll($po, 'cancelled', $user)
                                  │      · reads what is ordered ELSEWHERE
                                  │      · logs a qty history row per line:
                                  │        previous qty → 0, with the event
                                  └─►    quantity returns to the PI
```

`releaseAll()` does not delete anything — it writes a quantity-history row per
line taking it to zero. The ledger stays auditable.

#### Every quantity change is logged

`p2p_po_item_qty_histories` — append-only, one row per change: previous → current,
the PI line it affected, what was ordered elsewhere at that moment, the event,
and who did it. `GET /p2p/orders/{id}/qty-history` reads it.

---

### TAB 3 · All Other PO's — the **without purchase order** (standalone) flow

**Holds** `COALESCE(link_type,'standalone') <> 'with_shipment'` — note the
`COALESCE`: a PO with a **null** link type counts as standalone, so nothing can
fall between the two tabs.

#### What is different

| | With Shipment | Standalone |
|---|---|---|
| Source of lines | PI items, picked | Typed freely |
| `pi_item_id` on each line | Set | **Null** |
| Quantity ceiling | What the PI line still has | **None** — only the order-value ceiling |
| `shipment_order_id` / `proforma_invoice_id` | Set | Null |
| `lead_id` | Carried from the shipment | Null |
| Reservation | Yes | **Nothing to reserve** |
| `releaseAll()` on cancel | Returns quantity to the PI | Runs, but has no PI lines to release |

#### The flow

```
Step 01   supplier · PO type · document type · currency · incoterm · ports …
             link_type = standalone
             (optionally link_procurement = yes + procurement_request_id/code)
   │
Step 02   add lines by hand: product · description · qty · rate · GST %
             server computes taxable / CGST / SGST / IGST / line_total
             from the PO's tax mode — the client never prices the order
   │
Step 03   terms → submit → the same six gates as any other PO
   │
Step 04   trade documents
   │
Step 05   payment management
```

#### What is NOT different

Everything after Step 02 is identical: the same six submit gates, the same
Stage 04 materialisation, the same payment rules, the same cancellation fork,
the same Zoho chain. The linkage only decides **where the lines come from and
whether anything is reserved**.

#### Procurement linkage

A standalone PO can still reference a procurement request for traceability —
`link_procurement = yes` with `procurement_request_id` and
`procurement_request_code`. That is a **reference only**: no lines are drawn from
it and nothing is reserved against it.

---

### TAB 4 · PO Cancellation Initiated

**Holds** `status = 'cancelled' AND cancel_stage = 'initiated'` — **cancelled,
but money is still owed.**

#### How a row gets in

Exactly one way: `PoRefundAdjustmentController::store()`. There is no other
writer of `cancel_stage = 'initiated'`.

```
PO with paid_amount > 0
        │
        ├─ user tries Cancel on the PO screen  →  REFUSED
        │     "Payments are recorded on this PO — raise the
        │      advance refund adjustment instead."
        │
        └─ user raises ADR/<FY>/<SEQ>
              inside ONE transaction, with the PO row locked:
                1. guards: already cancelled? already has an ADR? paid ≤ 0?
                2. snapshot paid_amount onto the adjustment
                3. split into refund_amount + retained_amount
                4. reject every PENDING payment request
                5. releaseAll() — free the PI lines
                6. status = cancelled, cancel_stage = INITIATED
```

#### What the user sees here

The PO's **Total Paid Amount** is non-zero and its **Balance** is whatever the
refund adjustment has still to recover. The row is an **open receivable** — this
tab is the ageing list.

#### What can still be done to a PO in this tab

| Action | Allowed? |
|---|---|
| Edit any stage | **No** — the PO is cancelled |
| Raise a payment request | **No** — `payable()` refuses a cancelled PO |
| Record / edit / delete a payment | **No** — *"This PO is cancelled — its payments can no longer be changed."* |
| Log a recovery | **Yes** — but from the Advance Refund Adjustment module |
| Zoho sync | **Yes** — vendor credit and refunds |

So nothing is done *from* this tab. It exists to answer "what are we still owed?"

```
A paid PO was cancelled through a refund adjustment
                    │
         ADR/<FY>/<SEQ> raised
                    │
    ┌───────────────▼────────────────┐
    │ This tab = the open receivable │
    │ list. The supplier owes us.    │
    └───────────────┬────────────────┘
                    │  each repayment logged as a recovery
                    │  (Advance Refund Adjustment module)
                    ▼
            balance reaches 0  ──►  moves to TAB 5
```

**Nothing is done from this tab directly** — the work happens in the Advance
Refund Adjustment module. This tab is the *ageing view*: which cancellations are
still costing us money.

A row enters when `PoRefundAdjustmentController::store()` sets
`cancel_stage = initiated`, and leaves when `refreshTotals()` flips it to
`closed`.

---

### TAB 5 · PO Cancellation Closed

**Holds** `status = cancelled AND cancel_stage = 'closed'` — finished, nothing owed.

Two different histories land here:

```
(a) DIRECT CANCEL          PO had no payments
    PurchaseOrderController::cancel()
    → cancel_stage = closed immediately

(b) FULLY RECOVERED        PO was paid, cancelled via ADR,
    refreshTotals()        and every rupee came back
    → cancel_stage = closed when balance hits 0
```

Both read as *Cancellation Closed*. Open the PO to tell them apart — (b) has a
refund adjustment attached, (a) does not.

---

## 4B. Tab by tab — Payment Request Management (`/p2p/payment-request`)

```php
'all'      => 'TRUE',
'awaiting' => "r.status = 'pending'",
'approved' => "r.status = 'approved'",
'declined' => "r.status = 'rejected'",
```

This screen spans **every PO**. The per-PO screen is covered in §4C.

---

### TAB 1 · All

Every request raised in the branch, whatever its state. Use it to find a
request by code (`PRQ-001`), supplier or PO.

---

### TAB 2 · Awaiting (`pending`)

**The approver's queue.** This is the only tab where a decision can be made.

#### What a row carries

`PRQ-001` · PO code · supplier · payment type · percentage · requested amount ·
reason · who raised it · who it is addressed to · when.

#### The four refusals, in the order they are checked

```php
// 1. identity — not permission, not role
if ((int) $row->requested_to !== (int) $user->id)
    → "Only the person this request was sent to can decide it."

// 2. one decision only
if ($row->status !== STATUS_PENDING)
    → "This request is already approved / rejected."

// 3. the PO must still be alive
if (!$po || $po->isCancelled())
    → "This PO was cancelled — there is nothing to decide."

// 4a. never more than requested
if ($approved > $row->requested_amount + 0.001)
    → "You can approve at most the requested 50,000."

// 4b. never more than the PO's remaining headroom
$held = Σ GREATEST(approved_amount, paid_amount) of the PO's OTHER approved requests
$open = $po->grand_total − $po->tds_amount − $held
if ($approved > $open + 0.001)
    → "Only 20,000 is still open to approve on this PO."
```

Cheapest and most absolute checks first; by the time the arithmetic runs,
everything else is known good.

`GREATEST(approved_amount, paid_amount)` matters: if a request somehow carries
more paid than approved, headroom must shrink by the **larger** figure, or the
PO is over-committed by the difference.

```
                 request raised  →  lands here
                                        │
                   ┌────────────────────▼────────────────────┐
                   │ ONLY the named approver may act         │
                   │ (requested_to === auth user id)         │
                   └────────┬───────────────────────┬────────┘
                       APPROVE                  DECLINE
                            │                       │
              approved_amount required      reason required (≤300)
                            │                       │
              ≤ requested amount                    │
              ≤ PO headroom                         │
                            │                       │
                            ▼                       ▼
                       TAB 3 Approved          TAB 4 Declined
```

A row also leaves this tab **without anyone deciding it**: raising a refund
adjustment on its PO force-rejects it into Tab 4 with
`Closed — PO cancelled (ADR/…)`.

Bulk decisions are supported from here (`PUT /payment-requests/decisions`).

---

### TAB 3 · Approved

**Holds** requests that may now be paid. The money has **not** moved yet.

```
approved request
      │
      ├─ record payment(s)  →  amount · bank · UTR · date · proof
      │        (many payments may sit under one request)
      │
      ├─ each write rebuilds, in the same transaction:
      │        request.paid_amount, po.paid_amount, po.balance_amount
      │
      └─ Zoho sync per payment → vendor payment on the PO's bill
```

This is where `approved_amount` and `paid_amount` live side by side — a request
approved for 50,000 with 30,000 paid is still in this tab, partly released.

---

### TAB 4 · Declined

**Terminal.** Two ways in:

| Route in | `decision_note` |
|---|---|
| The approver declined | Their typed reason |
| The PO was cancelled with money out | `Closed — PO cancelled (ADR/…).` |

Nothing can be paid against these. They stay for the audit trail.

---

## 4C. Manage Payment Requests — the one-PO flow in full

This is the screen inside a PO, not a tab on the list. Everything below happens
against **one** order.

```
                    PO submitted  +  documents sent for signature
                                        │
                    ┌───────────────────▼───────────────────┐
                    │  STEP 1 — TDS                         │   PUT /{po}/tds
                    │  percentage OR amount, max 40%        │   (domestic only)
                    │  net payable = total − TDS            │   save even if 0
                    └───────────────────┬───────────────────┘
                                        │
                    ┌───────────────────▼───────────────────┐
                    │  STEP 2 — Raise a request             │   POST /{po}/payment-requests
                    │  type · amount · reason · approver    │   → PRQ-001
                    │  approver must be: active · not a     │
                    │  client admin · in THIS PO's branch   │
                    └───────────────────┬───────────────────┘
                                        │  status = pending
                    ┌───────────────────▼───────────────────┐
                    │  STEP 3 — Decision                    │   PUT /payment-requests/{req}/decision
                    │  ONLY the named approver may decide   │
                    │                                       │
                    │  approve → approved_amount            │   ≤ requested
                    │            ≤ PO headroom              │   ≤ net payable − other approvals
                    │  decline → reason (≤300)              │   terminal
                    └───────────────────┬───────────────────┘
                                        │  status = approved
                    ┌───────────────────▼───────────────────┐
                    │  STEP 4 — Release the money           │   POST /{po}/payment-requests/{req}/payments
                    │  amount · bank · UTR/cheque · date    │   multipart
                    │  · proof of payment (≤10 MB)          │   many payments per request
                    └───────────────────┬───────────────────┘
                                        │
                    ┌───────────────────▼───────────────────┐
                    │  REBUILD, same transaction            │
                    │    request.paid_amount = Σ its payments
                    │    po.paid_amount      = Σ all payments
                    │    po.balance_amount   = net payable − paid
                    └───────────────────┬───────────────────┘
                                        │
                    ┌───────────────────▼───────────────────┐
                    │  STEP 5 — Zoho (optional, explicit)   │   POST …/payments/{payment}/zoho-sync
                    │  vendor payment on the PO's BILL      │   bill must exist first
                    │  proof attached to the bill (queued)  │
                    └───────────────────────────────────────┘
```

### The approve → raise payment sequence, stated plainly

1. **Raise** — `PRQ-001`, `status = pending`, addressed to one named person.
2. **Decide** — only that person. Approval is capped twice: never more than
   requested, and never more than the PO's remaining headroom
   (`grand_total − tds_amount − Σ GREATEST(approved, paid)` of the PO's other
   approved requests).
3. **Approved ≠ paid.** The request is now a *permission to pay*. The PO's
   `paid_amount` has not moved.
4. **Record the payment** — one or more rows against that approved request, each
   with its own UTR, date and proof. A part release today and the rest next week
   is two rows under one request.
5. **Totals rebuild** — never incremented, always recomputed from the surviving
   rows, inside the same transaction.
6. **Sync** when somebody asks.

### Editing and deleting payments

| Action | Allowed while | Blocked when |
|---|---|---|
| Edit a payment | PO not cancelled | The payment is already in Zoho (`zohoLocked`) |
| Delete a payment | PO not cancelled | Same |

> *"This PO is cancelled — its payments can no longer be changed."*

Deleting takes a `lockForUpdate()` on the PO and rebuilds the totals from the
rows that remain, so the balance can never drift away from the evidence.

---

## 4D. Tab by tab — Advance Refund Adjustment (`/p2p/advance-refund-adjustment`)

```php
'all'       => 'TRUE',
'pending'   => "status <> 'recovered'",
'recovered' => "status = 'recovered'",
```

Note **`pending` is `<> 'recovered'`** — it holds both `pending` *and* `partial`.
The tab answers "is there still money to chase?", not "what is the status
column?".

---

### TAB 1 · All

Every adjustment raised, settled or not. The Zoho Sync column lives here too.

---

### TAB 2 · Pending (`status <> 'recovered'`)

**The money we are still owed.** Both `pending` (nothing back) and `partial`
(some back) sit here.

#### Raising one — every field and its rule

| Field | Rule | Message when it fails |
|---|---|---|
| Purchase Order | Not cancelled · `paid_amount > 0` · no existing ADR | *This PO already has a refund adjustment.* / *No money has been released on this PO — cancel it directly instead.* |
| Refund type | `Full Refund` or `Partial Refund` | — |
| Amount to be refunded | ≤ amount paid | *The amount to be refunded cannot be more than the X paid.* |
| | ≥ amount already recovered (on edit) | *X has already been recovered — the refund cannot be less…* |
| Retained (derived) | Full ⇒ must be 0 | *A full refund must return the whole X paid — choose Partial Refund…* |
| | Partial ⇒ must be > 0 | *A partial refund must be less than the amount paid — choose Full Refund…* |
| Retained reason | Required when retained > 0 | *Give the reason and a remark for the X not being refunded.* |
| Retained remark | Required when retained > 0 | same |
| Reason | Required | — |
| Supplier ref no. | Optional | — |
| Attachment | pdf/jpg/jpeg/png/webp, **≤ 2 MB** | — |

Retained reasons: *Cancellation Charges · Restocking Fee · Freight / Logistics
Already Incurred · Bank & Remittance Charges · Non-Recoverable GST · Customs /
Duty Already Paid · Work Already Completed · Contractual Retention · Other*

#### Logging a recovery — every field and its rule

| Field | Rule | Message when it fails |
|---|---|---|
| Amount | ≥ ₹1 | *The recovered amount must be at least ₹1.* |
| Refunded date | ≤ today | *Refunded date cannot be in the future.* |
| | ≥ the adjustment's date | *Refunded date cannot be before the refund adjustment date.* |
| Cheque / UTR no. | ≤ 64 chars, **unique across the whole client** | *Cheque / UTR number X is already recorded on ADR/… · PO/… for ₹Y on DD-MMM-YYYY. Enter the reference from this payment instead.* |
| Proof | **one** file, pdf or image, ≤ 10 MB | *A recovered payment can carry one proof of payment.* |

The uniqueness sweep is case- and whitespace-insensitive, excludes the row being
edited, and **names the record holding the duplicate** — the earlier generic
wording left people hunting for which one (CS-567).

```
                 ADR raised  →  status = pending
                                     │
                     ┌───────────────▼───────────────┐
                     │  Log a recovery               │
                     │  amount · date · UTR · proof  │
                     │  date ≥ ADR date, ≤ today     │
                     │  UTR unique across the client │
                     └───────────────┬───────────────┘
                                     │ refreshTotals()
                     ┌───────────────▼───────────────┐
                     │ recovered = Σ recoveries      │
                     │ balance   = refund − recovered│
                     └───────────────┬───────────────┘
                                     │
              some back ─────────────┴───────────── all back
                     │                                   │
            status = partial                    status = recovered
            STAYS IN THIS TAB                   MOVES TO TAB 3
            po.cancel_stage = initiated         po.cancel_stage = closed
```

**Everything editable happens in this tab** — and only until a row reaches Zoho:

| Action | Blocked when |
|---|---|
| Edit the adjustment | The vendor credit is in Zoho |
| Edit a recovery | `zoho_sync_status = 'synced'` **or** `zoho_refund_id` is set |
| Delete a recovery | Same |

> *"This refund is already posted to Zoho Books — it can no longer be changed or deleted."*

---

### TAB 3 · Recovered

**Holds** `status = 'recovered'` — the balance reached zero.

```
balance ≤ 0.005
      │
      ├─ adjustment.status      = recovered
      ├─ po.cancel_stage        = closed
      └─ po.cancel_closed_at    = now
```

Read-only in practice. The PO simultaneously moves to its own **PO Cancellation
Closed** tab — the two lists stay in step because `refreshTotals()` writes both
in one statement.

The `0.005` tolerance is deliberate: half a paisa, so rounding across many
recoveries cannot leave an adjustment permanently one paisa short of settled.

---

## 4E. The three compliance blockers on submit, and their flows

Submitting a PO is where compliance is enforced. Three separate systems can
stop it, each with its own flow. They are checked **in this order**, and all of
them re-read live data at the moment of submission — which is why the frontend
cannot pre-empt them.

---

### BLOCKER 1 · The GST gate

#### How the gate is decided

`PurchaseOrderService::gstGate($vendorId, $international)` reads the supplier's
**latest GST scrutiny row** (`vendor_gst_scrutiny`) and compares two dates
against a cutoff of **3 months ago** (`GST_STALE_MONTHS = 3`):

```php
$cutoff = now()->subMonths(3)->startOfDay();

$gate = !$scrutiny || $scrutiny->lt($cutoff)   ? 'blocked'
      : (!$filing  || $filing->lt($cutoff)     ? 'approval_required'
                                               : 'clear');
```

| Gate | Condition | What it means |
|---|---|---|
| **`clear`** | Scrutiny **and** last filing both within 3 months | Proceed |
| **`approval_required`** | Scrutiny fresh, but **the return is overdue** | A senior may approve past it |
| **`blocked`** | **No scrutiny at all, or scrutiny older than 3 months** | Nobody can approve past it |

> **An international PO is always `clear`** — *"An import has no Indian GST —
> scrutiny and filing are not checked."*

#### The distinction that matters

```
scrutiny stale  →  BLOCKED            we have not LOOKED at this supplier recently.
                                      No senior can wave that through — go and
                                      re-run the scrutiny.

filing overdue  →  APPROVAL_REQUIRED  we have looked, and the supplier has not
                                      filed. That is a commercial risk somebody
                                      senior may choose to accept.
```

The rule written into the approval endpoint says it plainly: *"only an overdue
return can be approved past."*

---

### BLOCKER 1a · The senior approval flow

```
PO at Step 03, gate = approval_required
        │
        ├── POST /p2p/orders/{id}/gst-approval/request
        │       body: requested_to (senior's user id), note (≤1000)
        │
        │    GUARDS, re-read live:
        │      · PO not cancelled
        │      · a supplier is selected      → "Select a supplier on Step 01 first."
        │      · gate ≠ blocked              → "GST scrutiny is older than 3 months —
        │                                       a senior cannot approve past that."
        │      · gate ≠ clear                → "The supplier's GST is up to date —
        │                                       this PO needs no approval."
        │
        ▼
   p2p_po_gst_approvals row, status = pending
   po.gst_approval_status = pending
   po.gst_approval_requested_by / _at set
        │
        │   the senior sees it in their INBOX
        │   (GET /p2p/orders/gst-approvals, PoApprovalInboxSection)
        ▼
   PUT /p2p/orders/gst-approvals/{approval}
        body: decision = approved | rejected,  reason (REQUIRED, ≤1000)
        │
        │  GUARDS:
        │    · only the senior it was sent to may decide
        │        → "Only the senior this was sent to can decide it."
        │    · one decision only
        │        → "This request is already approved / rejected."
        │    · the PO must still exist and not be cancelled
        │
        ├── APPROVED ──► po.gst_approval_status = approved
        │                 po.gst_approval_by / _at recorded
        │                 → the PO may now be submitted
        │
        └── REJECTED ──► po.gst_approval_status = rejected
                          → submit still refused:
                            "The senior rejected this PO: <reason>"
```

Both outcomes **notify the requester** with the senior's name and reason, and a
link back to `/p2p/order`.

#### Re-requesting after a rejection — no approver shopping

```php
/* A PO that was rejected goes back to the senior who rejected it — the
   requester does not get to shop around for a softer approver. Any
   requested_to sent with it is ignored. Only if that senior is no longer
   active does the pick open up again. */
```

So after a rejection, `requested_to` becomes **optional and ignored** — the
request returns to the same senior automatically. The field only reopens if that
person has since been deactivated.

#### Who can be a senior

`GET /p2p/orders/gst-approvals/approvers` — active users of the client, with
their department and designation.

> *"A branch head is the senior of their branch, so they may always pick
> themselves. Everyone else is listed only when the caller asks for it
> (`?include_self=1`) — a payment request may be sent to yourself, a senior GST
> approval may not."*

#### The four submit messages, by approval state

| State at submit | Message |
|---|---|
| Gate `blocked` | *GST scrutiny is older than 3 months — …* |
| `approval_required`, **no request raised** | *The supplier's last GST return is overdue — send it for senior approval before submitting.* |
| `approval_required`, request **pending** | *Senior approval is still pending — the PO can be submitted once it is approved.* |
| `approval_required`, request **rejected** | *The senior rejected this PO: `<reason>`* |
| `approval_required`, request **approved** | Submit proceeds |

---

### BLOCKER 2 · The supplier's documents (CS-407)

> *An expired KYC / DD / trade licence is no cover at all, so the PO does not
> leave Step 03 until it is renewed.*

#### What is actually checked

Not every document the supplier has ever uploaded. Only the ones **this
supplier's own segment rules ask for**, on the Domestic or International side
its address puts it on:

```php
$codes = app(SegmentDocScope::class)->applicableCodes($vendor, 'vendor', $clientId);
$scoped = ['kyc' => …, 'dd' => …, 'tl' => …];
// then: segment_doc_uploads for this vendor, in those codes, expired
```

The comment records why that scoping exists:

> *Without this the gate blocked on any expired upload the supplier ever had —
> including documents no rule selects, which the Evidence Vault never lists,
> leaving nothing to renew.*

That is the failure mode to remember: a blocker pointing at a document the user
**cannot even see**, let alone renew.

#### The flow

```
Step 03 submit
     │
     ├─ resolve the supplier's applicable document codes
     │    (segment rules × Domestic / International side)
     │
     ├─ find expired uploads among ONLY those codes
     │
     ├─ none expired ────────────────────────────► continue to Blocker 3
     │
     └─ some expired ────────────────────────────► 422
            message names each expired document
            response carries `expired_documents` for the UI
                   │
                   ▼
            renew them in the Supplier Evidence Vault
            (GET /segment-uploads/supplier/{id}/vault)
                   │
                   ▼
            submit again — re-read live, so a renewal
            made a moment ago is honoured immediately
```

---

### BLOCKER 3 · Case to Case

> *This supplier's earlier POs must have their necessary Stage 04 paperwork
> signed before another order is placed on them.*

```
Step 03 submit
     │
     ├─ look at this supplier's OTHER purchase orders
     ├─ for each, the Stage 04 documents marked NECESSARY
     ├─ any still unsigned?
     │
     ├─ no  ──► submit proceeds
     │
     └─ yes ──► 422, listing the outstanding documents
                response carries `case_to_case`
                      │
                      ▼
                go and get the earlier PO's documents signed
                (Step 04 → send for signature / Zoho Sign)
```

The point is to stop a supplier accumulating unsigned paperwork across a run of
orders — each new PO is gated on the last one being properly papered.

---

### The three blockers together

| | Blocker 1 — GST | Blocker 2 — Documents | Blocker 3 — Case to Case |
|---|---|---|---|
| Source of truth | `vendor_gst_scrutiny` | `segment_doc_uploads` × segment rules | Other POs' Stage 04 rows |
| Can a senior override? | **Only `approval_required`** | No | No |
| How to clear it | Re-run scrutiny, or get senior approval | Renew the document in the Evidence Vault | Sign the earlier PO's documents |
| Applies to international POs? | **No** — always `clear` | Yes, on the International side | Yes |
| Re-read at submit? | Yes | Yes | Yes |

All three sit **after** "supplier selected" and "at least one line" in the
sequence, and **before** anything is written. A PO that fails any of them stays
exactly as it was — a draft.

---

## 4F. How the tabs line up across the three modules

A single cancelled-with-money PO is visible in three places at once, and they
move together:

| Stage | PO list tab | Payment Request tab | Refund Adjustment tab |
|---|---|---|---|
| Paid, healthy | All / With / Without | Approved | — |
| Just cancelled via ADR | **Cancellation Initiated** | **Declined** (forced) | **Pending** |
| Partly recovered | **Cancellation Initiated** | Declined | **Pending** (`partial`) |
| Fully recovered | **Cancellation Closed** | Declined | **Recovered** |

One transaction moves the first two; `refreshTotals()` moves the last two
together on every recovery change. If a PO ever shows *Cancellation Closed*
while its adjustment is still in **Pending**, those two writes have come apart —
that is a bug, not a state.

---

## 4G. Cancelling a PO — the two paths and the transition

Everything turns on one question: **has money already gone out?**

```
                        POST /p2p/orders/{id}/cancel
                                     │
                      ┌──────────────▼──────────────┐
                      │ po.paid_amount > 0 ?        │
                      └───────┬─────────────┬───────┘
                         NO   │             │   YES
                              │             │
            ┌─────────────────▼───┐   ┌─────▼──────────────────────────────┐
            │ DIRECT CANCEL       │   │ REFUSED                            │
            │                     │   │ "Payments are recorded on this PO  │
            │ releaseAll()        │   │  — raise the advance refund        │
            │ status = cancelled  │   │  adjustment instead."              │
            │ cancel_stage=CLOSED │   └─────┬──────────────────────────────┘
            │ cancel_closed_at=now│         │
            │ currency lock freed │         │
            └─────────────────────┘         │
                                            ▼
                        POST /p2p/orders/refund-adjustments
                                            │
                        ┌───────────────────▼────────────────────┐
                        │ lockForUpdate() on the PO              │
                        │  ├ already cancelled?        → abort   │
                        │  ├ adjustment exists?        → abort   │
                        │  └ paid_amount ≤ 0?          → abort   │
                        ├────────────────────────────────────────┤
                        │ create ADR/<FY>/<SEQ>                  │
                        │   paid = snapshot of po.paid_amount    │
                        │   refund + retained (figures())        │
                        ├────────────────────────────────────────┤
                        │ reject ALL pending payment requests    │
                        │   "Closed — PO cancelled (ADR/…)."     │
                        ├────────────────────────────────────────┤
                        │ releaseAll() — free the PI lines       │
                        ├────────────────────────────────────────┤
                        │ status = cancelled                     │
                        │ cancel_stage = INITIATED  ◄── not closed│
                        └───────────────────┬────────────────────┘
                                            │
                        ┌───────────────────▼────────────────────┐
                        │ RECOVERIES — one per supplier repayment│
                        │   amount · date · UTR · proof          │
                        │   date ≥ adjustment date, ≤ today      │
                        │   UTR unique across the whole client   │
                        └───────────────────┬────────────────────┘
                                            │ after EVERY create/edit/delete
                        ┌───────────────────▼────────────────────┐
                        │ refreshTotals()                        │
                        │   recovered = Σ recoveries             │
                        │   balance   = refund − recovered       │
                        └───────────────────┬────────────────────┘
                                            │
        ┌───────────────────────────────────┼───────────────────────────────────┐
        │                                   │                                   │
  recovered = 0                      0 < recovered < refund              balance ≤ 0
        │                                   │                                   │
  status = PENDING                  status = PARTIAL                 status = RECOVERED
  cancel_stage = INITIATED          cancel_stage = INITIATED          cancel_stage = CLOSED
                                                                      cancel_closed_at = now
```

### The transition table

| Adjustment status | PO `status` | PO `cancel_stage` | Meaning on screen |
|---|---|---|---|
| *(none — direct cancel)* | `cancelled` | `closed` | Cancelled, nothing owed |
| `pending` | `cancelled` | `initiated` | **Cancellation Initiated** — nothing recovered yet |
| `partial` | `cancelled` | `initiated` | **Cancellation Initiated** — part recovered |
| `recovered` | `cancelled` | `closed` | **Cancellation Closed** — money back |

**Both paths end at `status = cancelled`.** `cancel_stage` is the only thing
that distinguishes "cancelled and settled" from "cancelled and still owed" — and
it is written in exactly two places: `PurchaseOrderController::cancel()` (always
`closed`) and `PoRefundAdjustmentController::refreshTotals()` (driven by the
balance).

### What cancelling costs you

| | Direct cancel | Via refund adjustment |
|---|---|---|
| PI lines released | ✓ | ✓ |
| Supplier currency lock freed | ✓ | — |
| Pending payment requests | *(none can exist — nothing was paid)* | **force-rejected** |
| Reversible | No | No |
| Produces a document | No | **Yes** — the ADR PDF |
| Zoho | — | Vendor credit + a refund per recovery |

---

## 5. The money, end to end

| Figure | Lives on | Derived from |
|---|---|---|
| `total_amount` | PO | Σ line amounts (qty × rate + GST) |
| `tds_amount` | PO | TDS % (max 40%) applied to the PO |
| `net_payable_amount` | PO | total − TDS |
| `paid_amount` | PO | Σ payments across all its requests |
| `balance_amount` | PO | net payable − paid |
| `approved_amount` | request | Set at approval; may differ from requested |
| `paid_amount` | request | Σ payments against that request |
| `paid_amount` | adjustment | Snapshot of `po.paid_amount` when raised |
| `refund_amount` | adjustment | What the supplier must return |
| `retained_amount` | adjustment | `paid − refund`; needs a reason + remark |
| `recovered_amount` | adjustment | Σ recoveries |
| `balance_amount` | adjustment | `refund − recovered` |

**The invariant that ties them together:**

```
adjustment.paid_amount = adjustment.refund_amount + adjustment.retained_amount
adjustment.balance     = adjustment.refund_amount − adjustment.recovered_amount
```

Enforced in `figures()` and `refreshTotals()` respectively, on every write.

---

## 6. Full Refund vs Partial Refund

| | Full Refund | Partial Refund |
|---|---|---|
| Retained | must be **0** | must be **> 0** |
| Reason + remark | not applicable | **mandatory** |
| Refused if | anything retained | nothing retained |

Choosing *Full Refund* and leaving money behind is rejected, and so is choosing
*Partial Refund* and returning everything. The type and the arithmetic must
agree, so the document cannot say one thing while the figures say another.

Retained money is never silent — it always carries a reason from
`PoRefundAdjustment::RETAIN_REASONS` and a free-text remark, because that is the
line a supplier will dispute.

---

## 7. Zoho Books — the parallel ledger

Nothing reaches Zoho by saving. Every push is explicit, from a **Zoho Sync**
column or button.

| Our record | Becomes in Zoho | Pushed by |
|---|---|---|
| Purchase Order | Purchase Order **+ Bill** | `PoZohoService::syncPo()` |
| Payment | Vendor Payment applied to the bill | `postPayments()` |
| Payment proof | Attachment **on the bill** | `AttachPoPaymentProofToZoho` (queued) |
| Refund Adjustment | **Vendor Credit** | `pushVendorCredit()` |
| Recovery | **Vendor Credit Refund** | `pushRecovery()` |

`syncAll()` runs the whole chain in order and is safe to re-run — each step
skips what already carries a Zoho id.

**Order matters.** A payment cannot be posted before its bill exists; a vendor
credit refund cannot exist before its vendor credit. `preflight()` checks the
preconditions and fails with a readable message rather than letting Zoho reject
the chain halfway through.

---

## 8. Documents produced

| Document | Source | Route |
|---|---|---|
| Purchase Order PDF | Our own Blade template | `PoDocumentService::renderPoPdf()` |
| Trade documents & agreements | CLM segment libraries | Stage 04 |
| Advance Receipt Refund Adjustment | Our own data | `GET /refund-adjustments/{id}/pdf` |

Stage 04 is **additive and re-runnable**: a document added to the segment master
after the PO was raised still reaches the PO, and arrives *Not necessary* so it
never retroactively gates an order that was already complete.

---

## 9. States, all three modules

**Purchase Order** — `draft` → `submitted` → `cancelled`
with a separate cancellation track: `cancel_stage ∈ {initiated, closed}`

**Payment Request** — `pending` → `approved` | `rejected`

**Refund Adjustment** — `pending` → `partial` → `recovered`

A cancelled PO is not the end of the story. `cancel_stage` is what tells you
whether the money question is settled, and that is driven entirely by the
adjustment's recoveries.

---

## 10. The rules that hold the flow together

1. **A PO with `paid_amount > 0` cannot be cancelled directly.** The refund adjustment is the only exit.
2. **One refund adjustment per PO.** Enforced on insert, inside the row lock.
3. **Raising an adjustment closes pending payment requests.** They can never be paid, so leaving them open would be a lie.
4. **The refund can never exceed what was paid**, and can never be reduced below what has already been recovered.
5. **Totals are stored and rebuilt**, never trusted from the client, and always inside the transaction that changed them.
6. **Codes are allocated under a lock**, per client, with the tenant scope lifted — a branch-filtered read would reuse a code another branch already holds.
7. **Zoho is never called on save.** Saving is a local fact; syncing is a deliberate act.

---

## 11. Where each module lives

| Module | Backend | Frontend | Route |
|---|---|---|---|
| Purchase Order | `Api/P2p/PurchaseOrderController` | `p2p/purchase-management/order/` | `/p2p/order` |
| Payment Requests | `Api/P2p/PoPaymentRequestController` | `p2p/payment-management/payment-request/` | `/p2p/payment-request` |
| Refund Adjustment | `Api/P2p/PoRefundAdjustmentController` | `p2p/payment-management/advance-refund/` | `/p2p/advance-refund-adjustment` |

Shared: `PurchaseOrderService` (codes, totals, tax, documents), `PoZohoService`
(all Zoho pushes), `PoDocumentService` (PDF, signing, email).

---

## 12. Companion documents

Four per module, twelve in all. This file is the thirteenth.

| Module | API | Functional | Technical | Code Walkthrough |
|---|---|---|---|---|
| Purchase Order | `P2P_PURCHASE_ORDER_API_DOCUMENTATION.md` | `P2P_PURCHASE_ORDER_FUNCTIONAL_DOCUMENTATION.md` | `P2P_PURCHASE_ORDER_TECHNICAL_DOCUMENTATION.md` | `P2P_PURCHASE_ORDER_CODE_WALKTHROUGH.md` |
| Payment Request Management | `P2P_PAYMENT_REQUEST_API_DOCUMENTATION.md` | `P2P_PAYMENT_REQUEST_FUNCTIONAL_DOCUMENTATION.md` | `P2P_PAYMENT_REQUEST_TECHNICAL_DOCUMENTATION.md` | `P2P_PAYMENT_REQUEST_CODE_WALKTHROUGH.md` |
| Advance Refund Adjustment | `P2P_REFUND_ADJUSTMENT_API_DOCUMENTATION.md` | `P2P_REFUND_ADJUSTMENT_FUNCTIONAL_DOCUMENTATION.md` | `P2P_REFUND_ADJUSTMENT_TECHNICAL_DOCUMENTATION.md` | `P2P_REFUND_ADJUSTMENT_CODE_WALKTHROUGH.md` |

All in `docs/`, alongside the `BIOMETRIC_*` set they follow.
