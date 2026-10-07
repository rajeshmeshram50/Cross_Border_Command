# P2P Payment Request Management — API Documentation

## 0. How to read this

Base URL `/(api)`. All routes sit behind `auth:sanctum` + `user.active` and are
tenant-scoped; `client_id`, `branch_id` and the actor are taken from the
authenticated user, never from the body.

Controller: `App\Http\Controllers\Api\P2p\PoPaymentRequestController`
Prefix: **`/api/p2p/orders`** (shared with the PO module)

**Authorisation.** Every method calls `tenantUser()`, which needs a `client_id`
and otherwise returns `403 — No tenant context`. There is **no role test and no
module-permission test** on raising a request, saving TDS, recording a payment
or syncing. Two things are enforced by identity instead:

| | |
|---|---|
| **Who may decide** | Only the user named in `requested_to`. A client admin with every permission cannot decide someone else's request |
| **Which rows you see** | Scoped by role on the list — see §3 |

The browser additionally checks `p2p.payment_request.can_approve` before
offering the decision buttons. **The server never reads that flag**, so the
permission decides what is *offered* and the addressee rule decides what is
*accepted*.

**Envelope**

```json
{ "status": true,  "data": { … } }
{ "status": false, "message": "…", "errors": { "field": ["…"] } }
```

The module has **two faces**:

| Face | Scope | Routes |
|---|---|---|
| Manage Payment Requests | One PO | `/{po}/payment-requests`, `/{po}/tds`, payments |
| Payment Request Management | All POs | `/payment-requests`, decisions |

---

## 1. TDS — settled before anything is requested

### `PUT /p2p/orders/{po}/tds`

```json
{ "tds_percentage": 2 }      // or
{ "tds_amount": 1500 }
```

One of the two is required. The other is derived.

| Rule | Message |
|---|---|
| Max **40%** | *TDS cannot be more than 40%.* |
| Cannot exceed the PO base | *TDS cannot be more than the PO base amount of X.* |
| International PO | *TDS does not apply to an international PO.* |

The cap holds whichever field was typed — an *amount* above 40% is the same
deduction as a *percentage* above 40%.

TDS sets `net_payable_amount = total − TDS`, which is what every request draws
against. **A domestic PO must have TDS saved — even as 0 — before a request can
be raised.**

---

## 2. Raising a request (one PO)

### `POST /p2p/orders/{po}/payment-requests`

| Field | Rules |
|---|---|
| `payment_type` | `Advance Payment` · `Partial Payment` · `Final Payment` · `Balance Payment` |
| `percentage` | optional, 0–100 |
| `requested_amount` | required, ≥ 1 |
| `reason` | required, ≤ 300 chars |
| `requested_to` | required — the approver's user id |

**Approver rules**

- Must be an **active user of your company**
- Must **not** be a `client_admin` — *"A request stops at the branch head"*
- Must be **in this PO's branch**

**→ `201`** with the request, coded `PRQ-001` (plain running serial, not
FY-based — see the Technical doc for why).

### `GET /p2p/orders/{po}/payment-requests`
Every request on that PO, plus the PO's summary figures.

---

## 3. Deciding (all POs)

### `GET /p2p/orders/payment-requests`

| Query | Rule | Meaning |
|---|---|---|
| `tab` | one of the four below | Which tab |
| `search` | ≤ 100 chars | **Not `q`.** Request code, PO code, supplier code / company / legal name |
| `page` | 1-based | |
| `per_page` | 1–**50**, default 10 | |

| `tab` | SQL applied |
|---|---|
| `all` | `TRUE` |
| `awaiting` | `r.status = 'pending'` |
| `approved` | `r.status = 'approved'` |
| `declined` | `r.status = 'rejected'` |

Note the last one: the **tab** is `declined`, the **status** is `rejected`.
Filtering by status and filtering by tab do not use the same word.

#### Rows are scoped by role, before the tab is applied

| Who | Sees |
|---|---|
| `client_admin` | Every request of the company |
| `branch_user` | Every request of **their branch**, **plus** any sent to them personally |
| Everyone else | **Only** requests where `requested_to` is them |

So the same call returns different totals for different callers, and an
ordinary user's `all` means "all of mine". Seeing a request is not deciding
it — a branch head sees their branch's requests and can still only decide the
ones addressed to them.

`meta.counts` carries every tab's total alongside the page, so the tab badges
need no extra call. `meta` also has `total`, `page`, `per_page`, `last_page`.

### `GET /p2p/orders/payment-requests/{req}`
One request in full: PO, supplier, amounts, decision, payments.

### `PUT /p2p/orders/payment-requests/{req}/decision`

```json
{ "decision": "approved", "approved_amount": 50000, "note": "…" }
{ "decision": "rejected", "note": "reason (required, ≤300)" }
```

| Field | Rule |
|---|---|
| `decision` | `approved` · `rejected` |
| `approved_amount` | required when approving, ≥ 1 |
| `note` | required when rejecting (≤ 300); optional remark on approval (≤ 400) |

**Refusals**

| Condition | Message |
|---|---|
| You are not the addressee | *Only the person this request was sent to can decide it.* |
| Already decided | *This request is already approved / rejected.* |
| PO cancelled | *This PO was cancelled — there is nothing to decide.* |
| Approving more than requested | *You can approve at most the requested X.* |
| Approving beyond PO headroom | *Only X is still open to approve on this PO.* |

**Headroom** = `grand_total − tds_amount − Σ GREATEST(approved_amount, paid_amount)`
of the PO's *other* approved requests.

### `PUT /p2p/orders/payment-requests/decisions`

| Field | Rule |
|---|---|
| `ids` | required array, **1–50** |
| `decision` | `approved` · `rejected` |
| `note` | required when rejecting (≤ 300); optional on approval (≤ 400) |

There is **no `approved_amount`**: approving a batch approves each request **in
full**, because a part-approval is an amount of its own and stays a
single-request decision.

Each id is put through the *same* `recordDecision()` as a single decision, on
its own, so one refusal never holds up the rest — the response names what was
decided, what was not, and why (CS-429 / CS-436).

---

## 4. Payments against an approved request

### `GET /p2p/orders/{po}/payment-requests/{req}/payments`

### `POST /p2p/orders/{po}/payment-requests/{req}/payments`
`multipart/form-data`

| Field | Rules |
|---|---|
| `amount` | required |
| `bank_name` | |
| `utr_cheque_number` | `[A-Za-z0-9]{6,22}` — cheque (6) through RTGS UTR (22) |
| `utr_cheque_date` | |
| `proof` | pdf/doc/docx/xls/xlsx/jpg/jpeg/png/webp, ≤ 10 MB |

### `POST /p2p/orders/{po}/payment-requests/{req}/payments/{payment}`
Edit. **POST, not PUT** — the edit may carry a new proof file, which means
multipart.

### `DELETE /p2p/orders/{po}/payment-requests/{req}/payments/{payment}`

Every one of these rebuilds `request.paid_amount`, `po.paid_amount` and
`po.balance_amount` **inside the same transaction**.

**A payment already in Zoho is frozen.** Editing or deleting one returns:

> *This payment is already posted to Zoho Books — it can no longer be changed
> or deleted.*

Our row and Zoho's vendor payment would otherwise disagree, with nothing to
say which is right.

---

## 5. Zoho Books

### `POST /p2p/orders/{po}/payment-requests/{req}/payments/{payment}/zoho-sync`

Posts this one payment as a **Vendor Payment** applied to the PO's bill.
Requires the bill to exist first. The proof is then attached to the **bill**
(queued job) — Zoho Books has no attachment endpoint for a vendor payment.

Returns `422` with Zoho's own message when it refuses, e.g.
*"Some of the taxes have been deleted…"* or
*"Both CGST and SGST has to be applied, as this is an intra state transaction"*.

---

## 6. Status model

```
pending ──approve──► approved ──► payments recorded
   │
   └──reject───► rejected        (terminal)
```

A request is also force-rejected when a **refund adjustment** is raised on its
PO, with the note `Closed — PO cancelled (ADR/…)`.

---

## 7. curl quick reference

```bash
TOKEN=...

# 1. TDS first (domestic PO)
curl -X PUT https://host/api/p2p/orders/17/tds \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"tds_percentage":2}'

# 2. Raise
curl -X POST https://host/api/p2p/orders/17/payment-requests \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"payment_type":"Advance Payment","requested_amount":50000,
       "reason":"Advance against PO","requested_to":42}'

# 3. Approve (as user 42)
curl -X PUT https://host/api/p2p/orders/payment-requests/7/decision \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"decision":"approved","approved_amount":50000}'

# 4. Record the payment
curl -X POST https://host/api/p2p/orders/17/payment-requests/7/payments \
  -H "Authorization: Bearer $TOKEN" \
  -F amount=50000 -F bank_name=HDFC -F utr_cheque_number=1789632456987 \
  -F utr_cheque_date=2026-10-06 -F proof=@advice.pdf

# 4b. The queue, as the approver sees it  ("search", not "q")
curl "https://host/api/p2p/orders/payment-requests?tab=awaiting&search=PRQ-001&per_page=10" \
  -H "Authorization: Bearer $TOKEN"

# 5. Push to Zoho
curl -X POST https://host/api/p2p/orders/17/payment-requests/7/payments/8/zoho-sync \
  -H "Authorization: Bearer $TOKEN"
```
