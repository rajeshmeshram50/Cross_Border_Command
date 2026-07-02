# PAYMENT / BILLING MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · Billing → Payments (Razorpay-backed)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
The Payment module handles all money movement in the SaaS: a **Client** subscribes to a **Plan** via a Razorpay checkout, the payment is verified, and the plan is **activated** (client marked active, permissions granted, branch limits enforced). Each transaction is stored with GST, totals, method and status, and generates an **invoice PDF**. Super-admins can also record manual/offline payments, resend invoices, and email expiry reminders.

### 1.2 Business Value

| Benefit | Description |
|---|---|
| Automated activation | A verified payment activates the plan and unlocks modules automatically |
| Compliance | Every payment carries GST (18%) and a numbered invoice PDF |
| Revenue visibility | KPI dashboard: revenue, transactions, success/failed/refunded |
| Safety | Signature verification + amount-tampering defence + idempotent activation |
| Flexibility | Monthly / quarterly / yearly cycles; free plans activate instantly |
| Back-office | Manual payment recording, invoice resend, expiry reminders |

### 1.3 Key Features
- **Subscription checkout** — plan carousel → Razorpay modal → verified activation.
- **Free plan fast-path** — zero-total plans activate without checkout.
- **Branch-shrink flow** — downgrading to a smaller plan makes you choose which branches to keep.
- **Payments list** — searchable/filterable, with KPIs and Excel export.
- **Manual payment recording** — super-admin back-office entry (auto-invoice).
- **Invoices** — per-payment PDF (view/download via a tokenized link).
- **Reminders** — plan-expiry emails.
- **Statuses** — success / pending / failed / refunded.

---

## 2. USER ROLES & PERMISSIONS

| Role | Access |
|---|---|
| **Super Admin** | Sees all payments across clients; records manual payments; deletes; sends reminders; exports; views any invoice |
| **Client Admin** | Subscribes/pays via **My Plan**; sees own client's payments (route-scoped); views own invoices |
| Branch User | Walled off to `/plan-blocked` when the plan is expired/missing; no billing management |
| Others | Bounced from `/payments` to the dashboard |

### 2.1 Capability Matrix
| Feature | Super Admin | Client Admin | Others |
|---|---|---|---|
| Subscribe / pay (checkout) | — | ✓ (own client) | ✗ |
| View payments list | ✓ (all) | ✓ (own client) | ✗ |
| KPI stats | ✓ | ✓ (own) | ✗ |
| Record manual payment | ✓ | ✗ | ✗ |
| Delete payment | ✓ | ✗ | ✗ |
| Send expiry reminder | ✓ | ✗ | ✗ |
| Export to Excel | ✓ | ✗ | ✗ |
| View/download invoice | ✓ | own | ✗ |

---

## 3. BUSINESS PROCESS FLOW

### 3.1 Subscription & payment lifecycle

```
┌───────────────────────────────────────────────────────────────────┐
│                   SUBSCRIPTION / PAYMENT LIFECYCLE                  │
└───────────────────────────────────────────────────────────────────┘
                              START
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 1: CHOOSE PLAN (client-admin → My Plan)                     │
│  • Plan carousel; toggle billing cycle (month/quarter/year)      │
│  • Price = base × (1/3/12); yearly discount; +18% GST            │
│  • If new plan has fewer branches than active → pick which to    │
│    KEEP (branch-shrink modal) before paying                      │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 2: CREATE ORDER  (POST /subscription/create-order)         │
│  • FREE plan (total ≤ 0): activated immediately → success        │
│  • PAID plan: server creates a Razorpay order + a PENDING        │
│    Payment row; returns key/order_id/amount to the SPA           │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 3: RAZORPAY CHECKOUT (hosted modal)                        │
│  • checkout.js opens; user pays by UPI / Card / Net Banking      │
│  • On dismiss / failure → cancel-order marks the pending failed  │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 4: VERIFY  (POST /subscription/verify-payment)             │
│  • Server verifies the payment signature (RAZORPAY_SECRET)       │
│  • On success → ACTIVATE (idempotent)                            │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 5: ACTIVATE (transaction)                                   │
│  • Payment → success                                             │
│  • Client → plan_id, plan_type=paid, status=active, expires_at   │
│  • Client-admin permissions reset & regranted per the plan's     │
│    modules (full/limited/is_default)                             │
│  • Downstream (branch/employee) permissions pruned               │
│  • Branches beyond the plan limit deactivated (tokens revoked)   │
│  • Invoice PDF emailed (after commit)                            │
└───────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│  STEP 6: OPERATE & MANAGE                                          │
│  • Client works within the plan; payment appears in history      │
│  • Super-admin: view/record payments, resend invoices, remind    │
│  • On expiry → client-admin sent to My Plan; branch user to      │
│    /plan-blocked until renewed                                    │
└───────────────────────────────────────────────────────────────────┘

  ALT PATH (disabled locally): Razorpay WEBHOOK → same activation,
  but the webhook secret is blank so this path is inactive.
```

### 3.2 Free vs paid
| | Free plan (total ≤ 0) | Paid plan |
|---|---|---|
| Order | Pending Payment auto-marked success | Razorpay order created |
| Checkout | Skipped | Razorpay hosted modal |
| Activation | Immediate | After signature verification |

### 3.3 Manual (back-office) payment
Super-admin records a payment (client, plan, amount, GST, discount, total auto-computed, method, status). Choosing **Success** generates and emails the invoice PDF. This does not run the checkout/activation flow — it is a bookkeeping entry.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Screen: Revenue & Payments (`Payments.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Revenue & Payments                     [Export]  [+ Record Payment]│
├───────────────────────────────────────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────┐     │
│  │ Total  │ │ Trans- │ │Success │ │ Failed │ │ Refunded   │     │
│  │Revenue │ │ actions│ │        │ │        │ │ ₹…         │     │
│  └────────┘ └────────┘ └────────┘ └────────┘ └────────────┘     │
├───────────────────────────────────────────────────────────────────┤
│  [Search txn/invoice/client/plan]   [All|success|pending|failed|…]│
│  ┌───────────────────────────────────────────────────────────────┐│
│  │Sr│Invoice│Client│Plan│Method│Amount│Txn ID│Status│Valid…│Act ││
│  └───────────────────────────────────────────────────────────────┘│
│  Actions: View · Invoice PDF (success) · Reminder (SA) · Delete(SA)│
└───────────────────────────────────────────────────────────────────┘
```
KPI cards: Total Revenue, Transactions, Success, Failed, Refunded. Filters: free-text search + status pills. Export (super-admin) builds an XLSX. Record-Payment modal auto-computes `total = amount + gst − discount`.

### 4.2 Screen: My Plan / Checkout (`PlanSelection.tsx`)
Plan carousel with a billing-cycle toggle, current-plan pill (or expired alert), a "Suggested" highlight, the branch-keep modal, and a payment modal (Order Summary → method tiles → Razorpay → success receipt with Transaction ID / Amount / Plan / Valid Until).

### 4.3 Screen: Client Payments (`ClientPayments.tsx`)
Per-client history reached from the Clients grid — KPI (Total Paid / Pending / Transactions / Last Payment) + a table (date, plan, amount, GST, total, method, txn id, status).

### 4.4 Invoice / receipt
- **Invoice PDF** (success only): opens `/api/payments/{id}/invoice/view?token=<token>` in a new tab.
- **Checkout receipt**: an in-app success block (not a file) after verification.
- **No refund UI** — refunded status is display/back-office only.

---

## 5. BUSINESS RULES

| # | Rule | Behaviour |
|---|---|---|
| 1 | GST | 18% applied on the checkout amount |
| 2 | Cycle pricing | month ×1, quarter ×3, year ×12; yearly discount on year |
| 3 | Free plan | total ≤ 0 activates immediately (no checkout) |
| 4 | Signature | Checkout payment signature verified before activation |
| 5 | Idempotency | Verify / cancel / webhook are idempotent; webhook row-locks the payment |
| 6 | Amount integrity | Webhook rejects activation if gateway amount ≠ stored total |
| 7 | Activation | Sets client plan fields, regrants admin permissions, prunes downstream, enforces branch limit |
| 8 | Branch shrink | Downgrade requires selecting branches to keep; extras deactivated |
| 9 | Invoice | Numbered PDF generated + emailed on success |
| 10 | Authorization | View gated to super-admin (any) or client-admin (own); record/delete/reminder super-admin only |
| 11 | Expiry | Expired/missing plan walls client-admin to My Plan, branch user to /plan-blocked |
| 12 | Webhook | Disabled locally (blank secret); checkout verify path is authoritative |

---

## 6. STATUS MODELS

### 6.1 Payment status
| Status | Meaning | Colour |
|---|---|---|
| pending | Order created, not yet paid | amber |
| success | Verified & activated | green |
| failed | Verification failed / user cancelled | red |
| refunded | Refunded (back-office) | blue |

(`expired` exists in the migration comment but is not written by code.)

### 6.2 Client plan state (on `clients`)
`plan_id` + `plan_type` (`free`/`paid`) + `plan_expires_at` + `status` — updated at activation. There is no separate Subscription record.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Webhook | Disabled locally (blank `RAZORPAY_WEBHOOK_SECRET`); activation via checkout verify only |
| Webhook activation | If ever enabled, its path skips branch-limit enforcement + downstream permission pruning that checkout performs |
| Free plan | Activation still sets `plan_type = paid` (no path resets to `free`) |
| GST | Hardcoded 18% on checkout; manual recording accepts any GST |
| Refunds | No refund action in the UI (display only) |
| Invoice links | Public routes authenticated by a `?token=` query param |
| Payments update | The REST `PUT/PATCH /payments/{id}` route has no backing method |

---

*Related documents: PAYMENT_TECHNICAL_DOCUMENTATION.md · PAYMENT_CODE_WALKTHROUGH.md · PAYMENT_API_DOCUMENTATION.md*
