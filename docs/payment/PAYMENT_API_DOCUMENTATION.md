# PAYMENT / BILLING MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · Billing → Payments (Razorpay)
> Base URL: `{APP_URL}/api`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS

### 1.1 Authentication
Most endpoints require `Authorization: Bearer <sanctum_token>` + `user.active`. **Exceptions:**
- `POST /razorpay/webhook` — **public**, gated by the Razorpay webhook signature (disabled locally, blank secret).
- `GET /payments/{id}/invoice/view|download` — **public routes** that self-authenticate via a `?token=` query param resolved against `personal_access_tokens`.

### 1.2 Scoping
`client_id` is derived from the authenticated user. `index`/`stats` scope: client-admin → own client; super-admin → all; others → empty. `show`/invoices are gated by `authorizeViewPayment` (super any / client-admin own / else 403).

### 1.3 Response shapes
Ad-hoc (no uniform envelope): `index` returns a raw paginator; actions return `{ message, ... }` or `{ ok: true }`. Errors: `{ message }` (+ `errors` on 422).

### 1.4 Status codes
200/201 · 400 (signature) · 401 · 403 · 404 · 422 (validation / branch-selection) · 502 (Razorpay order) · 503 (mail disabled).

---

## 2. ENDPOINT INDEX

### Subscription (checkout)
| Method | Path | Purpose |
|---|---|---|
| GET | `/subscription/plans` | Active plans for checkout |
| GET | `/subscription/status` | Current client plan status |
| POST | `/subscription/create-order` | Step 1 — create order (or free-activate) |
| POST | `/subscription/verify-payment` | Step 2 — verify signature → activate |
| POST | `/subscription/cancel-order` | Step 2b — mark pending failed |

### Payments (records / back-office)
| Method | Path | Purpose | Access |
|---|---|---|---|
| GET | `/payments` | List (paginated) | client-admin own / super all |
| GET | `/payments/stats` | KPI aggregates | same |
| POST | `/payments` | Record manual payment | super-admin |
| GET | `/payments/{payment}` | Detail | authorizeViewPayment |
| DELETE | `/payments/{payment}` | Hard delete | super-admin |
| POST | `/payments/{payment}/send-reminder` | Email expiry reminder | super-admin |
| GET | `/payments/{payment}/invoice/view` | Invoice PDF inline (public, `?token=`) | authorizeViewPayment |
| GET | `/payments/{payment}/invoice/download` | Invoice PDF download (public, `?token=`) | authorizeViewPayment |
| POST | `/razorpay/webhook` | Razorpay webhook (public, signature-gated) | — |

> `apiResource('payments')` also registers `PUT/PATCH /payments/{payment}`, but there is **no `update` method** — it does not resolve.

---

## 3. SUBSCRIPTION ENDPOINTS

### 3.1 GET `/subscription/plans`
Active plans with modules for the checkout carousel.
**Response 200:** `{ data: [ { id, name, price, period, max_branches, max_users, storage_limit, support_level, is_featured, badge, description, best_for, trial_days, yearly_discount, modules: [{id,name,pivot:{access_level}}] } ] }`

### 3.2 GET `/subscription/status`
**Response 200:**
```json
{ "has_plan": true, "expired": false,
  "plan": { "id": 3, "name": "Pro" }, "plan_type": "paid", "expires_at": "2026-07-31" }
```
`has_plan` = `plan_id !== null && plan_type === 'paid'`. No client → `{ "has_plan": false }`.

### 3.3 POST `/subscription/create-order`
**Body**
```json
{ "plan_id": 3, "payment_method": "upi", "billing_cycle": "month", "kept_branch_ids": [5,6] }
```
`payment_method` ∈ upi|card|net_banking · `billing_cycle` ∈ month|quarter|year.

**Response — free plan (total ≤ 0):**
```json
{ "free": true, "message": "Free plan activated", "txn_id": "…", "plan": {…}, "total": 0, "valid_until": "2026-07-31" }
```
**Response — paid plan:**
```json
{ "free": false, "key": "rzp_test_…", "order_id": "order_Nxxx", "amount": 589820, "currency": "INR",
  "payment_db_id": 42, "plan_name": "Pro", "billing_cycle": "month", "total": 5898.20,
  "prefill": { "name": "…", "email": "…", "contact": "…" }, "org_name": "IGC Group" }
```
`amount` is in **paise**. Pricing: `amount = price × {month 1, quarter 3, year 12}` (yearly discount on year), `gst = 18%`, `total = amount + gst`.

**Errors:** 403 (no client_id) · 502 (Razorpay) · **422 branch-shrink:**
```json
{ "message": "Select which branches to keep.", "requires_branch_selection": true,
  "max_branches": 5, "current_branch_count": 8 }
```

### 3.4 POST `/subscription/verify-payment`
**Body:** `{ "razorpay_order_id": "order_Nxxx", "razorpay_payment_id": "pay_Nyyy", "razorpay_signature": "…" }`
**Response 200:** `{ "message": "Plan activated successfully", "txn_id": "pay_Nyyy", "plan": {…}, "total": 5898.20, "valid_until": "2026-07-31" }`
**Errors:** 404 (no payment for order) · 403 (wrong client) · **400** (signature verification failed → payment marked `failed`). Idempotent if already `success`.

### 3.5 POST `/subscription/cancel-order`
**Body:** `{ "razorpay_order_id": "order_Nxxx", "reason": "user_cancelled" }`
**Response 200:** `{ "ok": true, "status": "failed" }` (no-op `{ "ok": true }` if the order isn't found). Idempotent — won't overwrite success/refunded/failed. **403** on wrong client.

---

## 4. PAYMENT ENDPOINTS

### 4.1 GET `/payments`
**Query:** `search`, `status`, `client_id` (super-admin), `from`, `to`, `per_page` (default 15).
**Response 200** (paginator; each row):
```json
{
  "current_page": 1, "per_page": 15, "total": 2,
  "data": [
    { "id": 42, "client_id": 12, "plan_id": 3,
      "invoice_number": "INV-260701-AB12", "txn_id": "pay_Nyyy", "order_id": "order_Nxxx",
      "amount": "4999.00", "gst": "899.82", "discount": "0.00", "total": "5898.82",
      "currency": "INR", "method": "upi", "gateway": "razorpay",
      "billing_cycle": "monthly", "valid_from": "2026-07-01", "valid_until": "2026-07-31",
      "status": "success", "invoice_path": "invoices/INV-….pdf",
      "client": { "id": 12, "org_name": "IGC Group" },
      "plan": { "id": 3, "name": "Pro", "price": 4999 },
      "processed_by_user": { "id": 1, "name": "Super Admin" } }
  ]
}
```
> Monetary fields are returned as **strings** (decimal cast).

### 4.2 GET `/payments/stats`
```json
{ "total_revenue": 125000, "total_transactions": 30, "successful": 26,
  "pending": 2, "failed": 1, "refunded": 1, "refund_amount": 4999 }
```

### 4.3 POST `/payments` (super-admin — manual record)
**Body**
```
client_id*   exists:clients
plan_id      exists:plans
txn_id / order_id   string(100)
amount*      numeric ≥0
gst / discount   numeric
total*       numeric
currency     string(10)
method*      in: upi,credit_card,debit_card,net_banking,wallet,cash,cheque
gateway      in: razorpay,stripe,paytm,manual
status*      in: pending,success,failed,refunded
billing_cycle  in: monthly,quarterly,yearly
valid_from / valid_until   date
auto_renew   boolean
notes        string
```
**Response 201:** `{ "message": "Payment recorded", "payment": { "id": 43, "invoice_number": "INV-…", "…": "…" } }` — status `success` auto-generates + emails an invoice.
**Errors:** 403 (not super-admin) · 422.

### 4.4 GET `/payments/{payment}`
Full detail (loads client/plan/processedBy). **Errors:** 403 (authorizeViewPayment) · 404.

### 4.5 DELETE `/payments/{payment}` (super-admin)
Hard delete. **Response 200:** `{ "message": "Payment deleted" }`. **Errors:** 403 · 404.

### 4.6 POST `/payments/{payment}/send-reminder` (super-admin)
Emails a plan-expiry reminder to the client's org + admin.
**Response 200:** `{ "message": "Reminder sent" }`. **Errors:** 403 · 422 (no client email) · **503** (reminder mail disabled).

### 4.7 GET `/payments/{payment}/invoice/view` · `/download`
Public routes; authenticate via `?token=<sanctum_token>`. `view` streams the PDF inline; `download` forces attachment (`{invoice_number}.pdf`).
**Errors:** 401 (no/invalid token) · 403 (authorizeViewPayment) · 404 (PDF missing).

### 4.8 POST `/razorpay/webhook` (public, signature-gated)
Header `X-Razorpay-Signature`. Verifies against `RAZORPAY_WEBHOOK_SECRET` (**blank locally → always 400**). On valid `payment.captured`/`order.paid` (and matching amount) it activates; `payment.failed` marks failed. Always returns 200 on valid signatures to stop retries.
**Response:** `{ "ok": true }` (or `{ "ok": true, "note": "amount mismatch" }`). **400** on invalid signature.

---

## 5. ERROR RESPONSE EXAMPLES

**400 — checkout signature**
```json
{ "message": "Payment verification failed" }
```
**403 — cross-tenant / not allowed**
```json
{ "message": "Unauthorized" }
```
**422 — branch shrink**
```json
{ "message": "Select which branches to keep.", "requires_branch_selection": true, "max_branches": 5, "current_branch_count": 8 }
```
**503 — reminder mail disabled**
```json
{ "message": "Email sending is disabled for plan expiry reminders." }
```

---

## 6. QUICK REFERENCE — TYPICAL FLOW

```
GET  /subscription/plans                    # show plans
GET  /subscription/status                    # current plan / expiry
POST /subscription/create-order              # → order_id (or free-activate)
   (Razorpay checkout.js modal)
POST /subscription/verify-payment            # verify → activate
   (on dismiss/failure) POST /subscription/cancel-order

# admin / history
GET  /payments?include stats                 # list + KPIs
POST /payments                               # manual record (super-admin)
GET  /payments/{id}/invoice/view?token=…     # invoice PDF (success)
POST /payments/{id}/send-reminder            # expiry reminder (super-admin)
```

---

## 7. SECURITY NOTES (caveats)
1. **Two signature checks** — checkout `verifyPaymentSignature` (active) vs webhook `verifyWebhookSignature` (disabled, blank secret).
2. **Webhook activation** omits branch-limit + downstream-prune done by checkout.
3. **Invoice routes are public** (query-token auth).
4. **Free-plan activation** sets `plan_type = paid` (no reset-to-free path).
5. **GST hardcoded 18%** on checkout; manual `store` accepts arbitrary GST.
6. **No refund action** in the API/UI (refunded is display/back-office only).

---

*Related documents: PAYMENT_TECHNICAL_DOCUMENTATION.md · PAYMENT_FUNCTIONAL_DOCUMENTATION.md · PAYMENT_CODE_WALKTHROUGH.md*
