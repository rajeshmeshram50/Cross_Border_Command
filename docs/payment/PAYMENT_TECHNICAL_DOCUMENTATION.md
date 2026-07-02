# PAYMENT / BILLING MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Billing → Payments (Razorpay-backed)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the Payment module is
The Payment module records and processes tenant billing. A **Client** subscribes to a **Plan**; the subscription **checkout** creates a Razorpay order, verifies the payment signature, and **activates the plan** (updates the client, regrants permissions, enforces branch limits). Every transaction is stored as a **Payment** row with GST, totals, method, status and an invoice PDF. Super-admins can also record manual payments and email reminders/invoices.

There is **no `Subscription` model** — subscription state lives on the `clients` table (`plan_id`, `plan_type`, `plan_expires_at`, `status`), updated at activation.

### 1.2 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                                │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │            React 19 + TypeScript SPA                           │ │
│  │  Payments.tsx (admin list + KPIs + record + reminder)         │ │
│  │  ClientPayments.tsx (per-client history)                      │ │
│  │  PlanSelection.tsx (Razorpay checkout — the whole pay flow)   │ │
│  │  Razorpay checkout.js loaded on demand                        │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
        │ authed JSON              │ checkout                │ webhook (public)
        ▼                         ▼                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       APPLICATION LAYER (Laravel 12)                 │
│  ┌────────────────────┐ ┌──────────────────────┐ ┌────────────────┐ │
│  │ PaymentController   │ │ SubscriptionController│ │ Razorpay       │ │
│  │ index/stats/store/  │ │ plans/status/        │ │ WebhookCtrl    │ │
│  │ show/destroy/       │ │ createOrder/         │ │ handle()       │ │
│  │ sendReminder/       │ │ verifyPayment/       │ │ (public, sig-  │ │
│  │ invoice view+dl     │ │ cancelOrder          │ │  verified)     │ │
│  └────────────────────┘ └──────────┬───────────┘ └───────┬────────┘ │
│                                     │  activatePlan()      │          │
│                                     ▼                      ▼          │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  RazorpayService  (createOrder · verifyPaymentSignature ·      │ │
│  │                    verifyWebhookSignature · fetchPayment)      │ │
│  │  InvoiceMailer    (invoice PDF + email)                        │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER                                   │
│  PostgreSQL (c_b_c): payments · plans · plan_modules · modules       │
│  clients (plan_id / plan_type / plan_expires_at / status)            │
│  permissions (regranted on activation) · personal_access_tokens      │
│  gateway_response stored as JSONB · invoice PDFs on disk             │
│  External: Razorpay (orders, checkout, webhook)                      │
└─────────────────────────────────────────────────────────────────────┘
```

> **Stack note:** PostgreSQL (`c_b_c`); `gateway_response` is a JSONB column. Razorpay is the only live gateway (test keys). No queue worker — invoice mail is sent inline (after commit).

### 1.3 Two distinct signature verifications (do not conflate)
| Verification | Method | Secret | Status locally |
|---|---|---|---|
| **Checkout / payment** | `RazorpayService::verifyPaymentSignature(order,payment,sig)` (HMAC of `order_id\|payment_id`) | `RAZORPAY_SECRET` (set) | **Active** — this is the working billing path |
| **Webhook** | `RazorpayService::verifyWebhookSignature(body,sig)` | `RAZORPAY_WEBHOOK_SECRET` (**blank**) | **Disabled** — returns false → webhook 400s for every call |

> Because `RAZORPAY_WEBHOOK_SECRET` is empty, the webhook path is effectively dead in this environment. QA/production activation runs through **create-order → checkout → verify-payment**.

### 1.4 Module Structure

```
app/
├── Http/Controllers/Api/
│   ├── PaymentController.php          # list/stats/record/show/destroy/reminder/invoice
│   ├── SubscriptionController.php     # checkout: create-order → verify-payment (activatePlan)
│   └── RazorpayWebhookController.php   # public webhook (signature-gated; disabled locally)
├── Services/
│   ├── RazorpayService.php            # order create + signature verify + fetch
│   └── InvoiceMailer.php             # invoice PDF + email
├── Models/
│   └── Payment.php                    # a billing transaction (no SoftDeletes)
└── Mail/
    ├── PlanReminderMail.php            # expiry reminder
    └── (InvoiceMailer sends invoice)

database/migrations/
└── 2026_04_14_000010_create_payments_table.php

resources/js/
├── pages/Payments.tsx                 # admin Revenue & Payments
├── pages/client/ClientPayments.tsx    # per-client history
└── pages/plan/PlanSelection.tsx       # Razorpay checkout
```

---

## 2. TECHNOLOGY STACK

### 2.1 Backend
| Component | Technology | Purpose |
|---|---|---|
| PHP 8.2+ / Laravel 12 | — | API |
| PostgreSQL (`c_b_c`) | — | `payments` (+ JSONB `gateway_response`) |
| Sanctum 4 | — | Bearer-token auth (query-token for invoice PDFs) |
| Razorpay PHP SDK | `RazorpayService` | Orders + signature verification |
| DomPDF | `InvoiceMailer` | Invoice PDF |
| SMTP mail | — | Invoice + reminder emails (inline) |

### 2.2 Frontend
| Component | Technology | Purpose |
|---|---|---|
| React 19 + TS + Vite | — | UI |
| reactstrap + Bootstrap + Tailwind | — | Velzon theme |
| @tanstack/react-table | — | Payments grid |
| Razorpay checkout.js | — | Hosted checkout modal (loaded on demand) |
| xlsx + file-saver | — | Excel export |

---

## 3. DATABASE SCHEMA

### 3.1 ERD (billing)

```
┌────────────┐        ┌──────────────────────────────┐        ┌──────────┐
│   plans    │        │           payments           │        │ clients  │
├────────────┤        ├──────────────────────────────┤        ├──────────┤
│ id      PK │◄───────┤ plan_id     FK (nullOnDelete) │        │ id    PK │
│ name/price │        │ client_id   FK (cascade) ─────┼───────►│ plan_id  │
└────────────┘        │ txn_id      UNIQUE            │        │ plan_type│
                      │ order_id    (gateway order)   │        │ plan_    │
┌────────────┐        │ amount/gst/discount/total     │        │  expires │
│   users    │◄───────┤ processed_by FK (nullOnDelete)│        │ status   │
└────────────┘        │ currency/method/gateway       │        └──────────┘
                      │ billing_cycle                 │
                      │ valid_from / valid_until      │        activation updates
                      │ status (pending/success/      │        clients + permissions
                      │   failed/refunded[/expired])  │        (no Subscription table)
                      │ refund_amount/reason/at       │
                      │ invoice_number / invoice_path │
                      │ gateway_response  (JSONB)     │
                      │ notes                         │
                      └──────────────────────────────┘
```

### 3.2 Table: `payments`
No SoftDeletes (deletes are hard). Indexes: `client_id`, `status`, `txn_id`, `valid_until` (+ unique `txn_id`).

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| id | bigint PK | no | — | |
| client_id | bigint FK | yes | — | → clients cascadeOnDelete |
| plan_id | bigint FK | yes | — | → plans nullOnDelete |
| txn_id | varchar(100) | yes | — | **unique** (payment id or `PENDING-…`) |
| order_id | varchar(100) | yes | — | gateway order id (or `FREE-…`) |
| amount | decimal(10,2) | yes | — | base |
| gst | decimal(10,2) | yes | 0 | 18% (checkout); arbitrary in manual store |
| discount | decimal(10,2) | yes | 0 | |
| total | decimal(10,2) | yes | — | amount + gst − discount |
| currency | varchar(5) | yes | INR | |
| method | varchar(50) | yes | — | upi/credit_card/debit_card/net_banking/wallet/cash/cheque |
| card_info | varchar(100) | yes | — | masked |
| gateway | varchar(50) | yes | — | razorpay/stripe/paytm/manual |
| billing_cycle | varchar(20) | yes | — | monthly/quarterly/yearly |
| valid_from / valid_until | date | yes | — | subscription window |
| auto_renew | boolean | yes | false | |
| status | varchar(20) | yes | pending | pending/success/failed/refunded (expired listed, unused) |
| refund_amount / refund_reason / refunded_at | — | yes | — | |
| invoice_number | varchar(50) | yes | — | `INV-…` |
| invoice_path | varchar(500) | yes | — | PDF path |
| gateway_response | **jsonb** | yes | — | order id, signature, webhook payload, cancel meta |
| notes | text | yes | — | |
| processed_by | bigint FK | yes | — | → users nullOnDelete |
| created_at / updated_at | timestamp | yes | — | |

> No `subscriptions` table/model. Plan state is on `clients`.

---

## 4. MODEL

### Payment (`app/Models/Payment.php`)
```php
class Payment extends Model {   // no SoftDeletes
    protected $casts = [
        'amount'=>'decimal:2','gst'=>'decimal:2','discount'=>'decimal:2','total'=>'decimal:2',
        'refund_amount'=>'decimal:2','valid_from'=>'date','valid_until'=>'date',
        'refunded_at'=>'datetime','auto_renew'=>'boolean','gateway_response'=>'array',
    ];
    public function client()      { return $this->belongsTo(Client::class); }
    public function plan()        { return $this->belongsTo(Plan::class); }
    public function processedBy() { return $this->belongsTo(User::class, 'processed_by'); }
    public function isSuccess(): bool { return $this->status === 'success'; }
    public function isExpired(): bool { return $this->valid_until?->isPast(); }
}
```

---

## 5. API ENDPOINTS CONFIGURATION

```php
// PUBLIC (outside auth group)
Route::post('/razorpay/webhook',                 [RazorpayWebhookController::class, 'handle']);         // signature-gated
Route::get ('/payments/{payment}/invoice/download',[PaymentController::class, 'downloadInvoice']);      // ?token= auth
Route::get ('/payments/{payment}/invoice/view',    [PaymentController::class, 'viewInvoice']);          // ?token= auth

// AUTHENTICATED (auth:sanctum + user.active)
Route::get ('/subscription/plans',          [SubscriptionController::class, 'plans']);
Route::get ('/subscription/status',         [SubscriptionController::class, 'status']);
Route::post('/subscription/create-order',   [SubscriptionController::class, 'createOrder']);
Route::post('/subscription/verify-payment', [SubscriptionController::class, 'verifyPayment']);
Route::post('/subscription/cancel-order',   [SubscriptionController::class, 'cancelOrder']);
Route::get ('/payments/stats',              [PaymentController::class, 'stats']);
Route::post('/payments/{payment}/send-reminder', [PaymentController::class, 'sendReminder']);
Route::apiResource('payments', PaymentController::class);   // index, store, show, destroy (NO update method)
```
> `apiResource('payments')` registers a `PUT/PATCH` update route, but `PaymentController` has **no `update` method** — calling it does not resolve. Full request/response detail is in **PAYMENT_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER / SERVICE ANALYSIS

### 6.1 PaymentController
| Method | Purpose | Access |
|---|---|---|
| `index` | Paginated list (search/status/date filters) | client_admin → own client; super_admin → all; else empty |
| `stats` | KPI aggregates (revenue, counts by status, refunds) | same scoping |
| `store` | Record a manual payment (generates invoice) | **super_admin only** |
| `show` | Payment detail | `authorizeViewPayment` (super any / client_admin own) |
| `destroy` | Hard-delete | **super_admin only** |
| `sendReminder` | Email plan-expiry reminder | **super_admin only** (503 if reminder mail disabled) |
| `downloadInvoice` / `viewInvoice` | Invoice PDF | public route, `?token=` self-auth + `authorizeViewPayment` |

### 6.2 SubscriptionController (checkout & activation)
| Method | Purpose |
|---|---|
| `plans` | Active plans for checkout |
| `status` | Current client plan status (`has_plan`, `expired`) |
| `createOrder` | Step 1 — pricing, branch-shrink guard, Razorpay order + pending Payment (free plan activates immediately) |
| `verifyPayment` | Step 2 — verify signature → `activatePlan` |
| `cancelOrder` | Step 2b — mark pending Payment failed (idempotent) |
| `activatePlan` *(private)* | DB transaction: mark success → update client (plan_id/plan_type=paid/status=active/expires) → reset+regrant client-admin permissions per PlanModule → prune downstream perms → enforce branch limit → email invoice after commit |

**Pricing** (`computePricing`): `amount = price × {month 1, quarter 3, year 12}`, yearly discount on `year`, **GST 18%**, `total = amount + gst`, validity now → +cycle.

### 6.3 RazorpayWebhookController
`handle()` verifies the webhook signature, row-locks the Payment (`lockForUpdate`), is idempotent, defends against amount tampering (paise compare), then activates on `payment.captured`/`order.paid` or marks failed on `payment.failed`. Always returns 200 to stop retries. **Disabled locally** (blank secret). Its activation branch **omits** branch-limit enforcement and downstream-permission pruning that the checkout path performs.

### 6.4 RazorpayService
`createOrder(₹, receipt, notes)` (→ paise), `verifyPaymentSignature(order,payment,sig)`, `verifyWebhookSignature(body,sig)` (false if secret blank), `fetchPayment(id)`. Constructor throws if key/secret missing. Config: `RAZORPAY_KEY`, `RAZORPAY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.

---

## 7. FRONTEND COMPONENTS

| Component | Purpose | Key endpoints |
|---|---|---|
| `Payments.tsx` | Admin "Revenue & Payments" list + KPIs + record + reminder + export | `GET /payments`, `GET /payments/stats`, `POST /payments`, `DELETE /payments/{id}`, `POST /payments/{id}/send-reminder`, invoice view (`?token=`) |
| `ClientPayments.tsx` | Per-client history (from Clients grid) | `GET /payments?client_id=` |
| `PlanSelection.tsx` | Razorpay checkout (create-order → checkout.js → verify) | `GET /subscription/plans`, `POST /subscription/create-order`, `POST /subscription/verify-payment`, `POST /subscription/cancel-order` |

Status pill config (both lists): success=green, pending=amber, failed=red, refunded=blue (unknown→pending). Invoice PDF opens `/api/payments/{id}/invoice/view?token=<cbc_token>` (success only).

### 7.1 Routing & role gating (`App.tsx`)
- `/payments` — super_admin or client_admin only (others bounced to dashboard).
- `/clients/:id/payments` — per-client history (super-admin from the Clients grid).
- `/my-plan` — `PlanSelection` checkout; `/plan-blocked` — expired/no-plan screen.
- Header nav: super-admin shows "Payments"; client-admin shows "My Plan" (not Payments, though the route allows client-admin scoped to own client). Export/Delete/Reminder are super-admin only.

---

## 8. SECURITY IMPLEMENTATION

- **Auth:** all billing endpoints require Sanctum except the webhook (signature-gated) and the invoice PDF routes (self-authenticate via `?token=` resolved against `personal_access_tokens`).
- **Authorization:** `authorizeViewPayment()` is the single gate (super-admin any; client_admin own `client_id`; else 403) — it closed a prior data-leak where any authed user could read any payment. Record/delete/reminder are super-admin only. `createOrder`/`verifyPayment`/`cancelOrder` enforce `payment.client_id === user.client_id`.
- **Signature verification:** checkout uses `verifyPaymentSignature` (active); webhook uses `verifyWebhookSignature` (disabled — blank secret).
- **Amount tampering:** webhook compares gateway paise to `total×100` and skips activation on mismatch.
- **Idempotency:** verify/cancel/webhook are idempotent; webhook row-locks the Payment.
- **Config secrets:** `RAZORPAY_*` in env; `VITE_RAZORPAY_KEY` exposed to the SPA for checkout.

---

## 9. ERROR HANDLING

| Condition | HTTP |
|---|---|
| Not authenticated | 401 |
| Not allowed / cross-tenant | 403 |
| Payment not found | 404 |
| Validation | 422 |
| Branch-shrink selection required | 422 (`requires_branch_selection`) |
| Signature verification failed (checkout) | 400 |
| Razorpay order creation failed | 502 |
| Reminder mail disabled | 503 |
| Webhook invalid signature | 400 |

Invoice/reminder mail failures are swallowed after a committed payment (never roll back).

### 9.1 Known caveats
1. **Webhook disabled locally** (blank `RAZORPAY_WEBHOOK_SECRET`) — use the checkout verify path.
2. **Webhook activation branch** omits `enforceBranchLimit` + `cascadePrune` that checkout runs.
3. **`apiResource('payments')` exposes an update route with no controller method.**
4. **Invoice PDF routes are public** (query-token auth).
5. **Free-plan activation still sets `client.plan_type='paid'`** (no path resets to `free`).
6. **GST hardcoded 18%** in checkout pricing; manual `store` accepts arbitrary GST.
7. **No refund UI** — refunded status is display/back-office only.

---

## 10. PERFORMANCE

| Optimization | Where |
|---|---|
| Eager load client/plan/processedBy | `index()`, `show()` |
| Client-side pagination (`per_page=9999`) + filters | `Payments.tsx` |
| Razorpay checkout.js loaded on demand (memoised) | `PlanSelection.tsx` |
| Row-lock only the Payment being reconciled | webhook `handle()` |
| Invoice mail after commit | activation paths |

---

## 11. CODE QUALITY METRICS

| Metric | Value |
|---|---|
| Controllers | 3 (Payment, Subscription, RazorpayWebhook) |
| Service | RazorpayService (+ InvoiceMailer) |
| payments columns | ~27 |
| DB transactions | activatePlan / activateFromWebhook |
| Models | Payment (no Subscription model) |
| Test coverage | none automated |

---

*Related documents: PAYMENT_FUNCTIONAL_DOCUMENTATION.md · PAYMENT_CODE_WALKTHROUGH.md · PAYMENT_API_DOCUMENTATION.md*
