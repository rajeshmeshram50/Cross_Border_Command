# Razorpay Payment Integration — Cross Border Command

End-to-end developer & QA documentation for the Razorpay payment + plan-subscription flow.

---

## Table of contents

1. [What this integration does](#1-what-this-integration-does)
2. [High-level architecture](#2-high-level-architecture)
3. [Prerequisites checklist (what YOU need)](#3-prerequisites-checklist-what-you-need)
4. [Setup — local development](#4-setup--local-development)
5. [Files added or changed](#5-files-added-or-changed)
6. [API reference](#6-api-reference)
7. [End-to-end payment flow (sequence)](#7-end-to-end-payment-flow-sequence)
8. [Frontend implementation](#8-frontend-implementation)
9. [Webhook setup](#9-webhook-setup)
10. [Test cards / UPI / netbanking values](#10-test-cards--upi--netbanking-values)
11. [QA test scenarios](#11-qa-test-scenarios)
12. [Going live (test → production)](#12-going-live-test--production)
13. [Troubleshooting](#13-troubleshooting)
14. [Security checklist](#14-security-checklist)
15. [Not implemented yet (future scope)](#15-not-implemented-yet-future-scope)

---

## 1. What this integration does

When a client admin chooses a plan in the **Plan Selection** page, the app:

1. Calculates the price (with billing cycle multiplier + yearly discount + 18% GST).
2. Creates a Razorpay Order on Razorpay's servers.
3. Opens Razorpay's hosted checkout modal in the browser.
4. After the user pays, verifies the cryptographic signature returned by Razorpay.
5. Marks the local `payments` row as `success`, activates the client's plan, sets module permissions.
6. (Optional) Receives an asynchronous webhook from Razorpay as a safety net for cases where the browser disconnects mid-payment.

**Free plans (price = 0)** bypass Razorpay entirely and are activated immediately.

---

## 2. High-level architecture

```
┌─────────────┐   1.create-order    ┌──────────────┐  2. Order API   ┌──────────┐
│  React SPA  │ ─────────────────▶  │   Laravel    │ ──────────────▶ │ Razorpay │
│             │                     │   Backend    │                 │   API    │
│ PlanSelect  │ ◀───────────────    │              │ ◀─────────────  │          │
└─────┬───────┘  3. order_id+key   └──────┬───────┘                  └────┬─────┘
      │                                    │                               │
      │ 4. open Razorpay checkout.js       │                               │
      ▼                                    │                               │
┌─────────────┐                            │                               │
│  Razorpay   │  5. user pays              │                               │
│  Checkout   │ ◀──────────────────────────┼───────────────────────────────┤
│   (modal)   │                            │                               │
└─────┬───────┘                            │                               │
      │ 6. {payment_id, order_id, sig}     │                               │
      ▼                                    │                               │
┌─────────────┐  7. verify-payment   ┌──────────────┐                      │
│  React SPA  │ ─────────────────▶   │   Laravel    │                      │
│             │ ◀─────────────────   │              │                      │
└─────────────┘  8. plan activated   └──────────────┘                      │
                                            ▲                              │
                                            │ 9. webhook (async safety)    │
                                            └──────────────────────────────┘
```

**Key design choices**

- Razorpay key is **never hard-coded in the frontend**. The backend returns it inside the `create-order` response, so a key rotation requires only a `.env` change.
- `verify-payment` is **idempotent** — calling it twice returns the same success result without double-activating.
- The webhook handler is **idempotent** too — if it arrives before the browser-side verify, it activates; if after, it's a no-op.
- Razorpay payment IDs (e.g. `pay_xxx`) are stored in `payments.txn_id`, Razorpay order IDs (`order_xxx`) in `payments.order_id`, full Razorpay response in `payments.gateway_response` (JSON).

---

## 3. Prerequisites checklist (what YOU need)

### A. Razorpay account
- [ ] Razorpay account created at razorpay.com
- [ ] Email + phone verified (OTP)
- [ ] Test mode active (works without KYC)
- [ ] Live mode active (requires KYC — see [section 12](#12-going-live-test--production))

### B. API credentials (from Razorpay Dashboard → Settings → API Keys)
- [ ] Test **Key ID** (`rzp_test_xxx`)
- [ ] Test **Key Secret**
- [ ] Live **Key ID** (`rzp_live_xxx`) — only after KYC
- [ ] Live **Key Secret**

### C. Webhook (optional in dev, required in production)
- [ ] Public HTTPS URL where Razorpay can reach your server
- [ ] Webhook secret (you choose this string when creating the webhook)

### D. Server / dev environment
- [ ] PHP 8.2+ with `curl`, `openssl`, `mbstring`, `json` extensions enabled
- [ ] Composer
- [ ] Node.js 18+ and npm
- [ ] MySQL/MariaDB (or whatever the app's `DB_CONNECTION` is set to)

### E. Compliance pages on your public site (Razorpay reviews these before activating live mode)
- [ ] Terms & Conditions
- [ ] Privacy Policy
- [ ] Refund / Cancellation Policy
- [ ] Contact Us (email + phone + address)
- [ ] Pricing page

---

## 4. Setup — local development

### Step 1 — Install the Razorpay PHP SDK (already done)

```bash
composer require razorpay/razorpay
```

The package is already in [composer.json](composer.json) — no action needed unless you cloned fresh.

### Step 2 — Add credentials to `.env`

```env
RAZORPAY_KEY=rzp_test_xxxxxxxxxxxxxx
RAZORPAY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=
VITE_RAZORPAY_KEY="${RAZORPAY_KEY}"
```

`RAZORPAY_WEBHOOK_SECRET` may be left blank in development if you're not using webhooks.

`VITE_RAZORPAY_KEY` is exposed to the frontend bundle. It's safe — Razorpay keys are public-by-design (the secret is what matters). It is currently **not** read by the frontend (the backend returns the key in `create-order` response), but it is reserved for future use.

### Step 3 — Clear config cache

```bash
php artisan config:clear
php artisan route:clear
```

### Step 4 — Verify routes are registered

```bash
php artisan route:list --path=subscription
php artisan route:list --path=razorpay
```

You should see:

```
POST  api/subscription/create-order
POST  api/subscription/verify-payment
GET   api/subscription/plans
GET   api/subscription/status
POST  api/razorpay/webhook
```

### Step 5 — Smoke-test the API connection

```bash
php artisan tinker
```

```php
$svc = new App\Services\RazorpayService();
$order = $svc->createOrder(100.00, 'test_' . time(), ['source' => 'cli']);
echo $order['id'];   // should print order_xxxxxxxxxxxx
```

If this prints an `order_xxx` ID, your keys + cURL/SSL are working. If it errors, see [Troubleshooting](#13-troubleshooting).

### Step 6 — Build the frontend

```bash
npm install      # only if node_modules missing
npm run dev      # development with HMR
# or
npm run build    # production build
```

### Step 7 — Open the app

1. Log in as a client admin (a user whose `client_id` is set).
2. Go to the **Plan Selection** page.
3. Pick a plan → click "Choose Plan" → click "Pay" → Razorpay modal should appear.
4. Use a [test card](#10-test-cards--upi--netbanking-values) to complete the payment.

---

## 5. Files added or changed

### Backend

| File | Status | Purpose |
|---|---|---|
| [.env.example](.env.example) | modified | Added 4 Razorpay env keys |
| [config/services.php](config/services.php) | modified | Added `razorpay` config block |
| [app/Services/RazorpayService.php](app/Services/RazorpayService.php) | **new** | Wraps Razorpay PHP SDK (createOrder, verify signatures) |
| [app/Http/Controllers/Api/SubscriptionController.php](app/Http/Controllers/Api/SubscriptionController.php) | modified | Removed dummy `subscribe()`, added `createOrder()` + `verifyPayment()` |
| [app/Http/Controllers/Api/RazorpayWebhookController.php](app/Http/Controllers/Api/RazorpayWebhookController.php) | **new** | Public webhook receiver (signature-verified, idempotent) |
| [routes/api.php](routes/api.php) | modified | Added 3 routes (2 auth, 1 public webhook) |

### Frontend

| File | Status | Purpose |
|---|---|---|
| [resources/views/welcome.blade.php](resources/views/welcome.blade.php) | modified | Loads `https://checkout.razorpay.com/v1/checkout.js` |
| [resources/js/pages/PlanSelection.tsx](resources/js/pages/PlanSelection.tsx) | modified | Replaced dummy `handlePay()` with real `create-order` → Razorpay checkout → `verify-payment` flow |

### Database

**No schema change needed.** All required columns already exist on `payments`:

- `order_id` — stores Razorpay's `order_xxx`
- `txn_id` — stores Razorpay's `pay_xxx` after verification
- `gateway` — set to `'razorpay'`
- `gateway_response` — JSON column storing the full Razorpay response
- `status` — `pending` → `success` / `failed`

---

## 6. API reference

### `POST /api/subscription/create-order`

Auth: `Bearer` (Sanctum). Caller must have `client_id` (i.e. be a client admin).

**Request**
```json
{
  "plan_id": 3,
  "billing_cycle": "month",        // "month" | "quarter" | "year"
  "payment_method": "upi"          // "upi" | "card" | "net_banking"
}
```

**Response — paid plan**
```json
{
  "free": false,
  "key": "rzp_test_ShdJZ7O0XONYlR",
  "order_id": "order_ShdhI3wZgOX0Zo",
  "amount": 589820,                  // in paise
  "currency": "INR",
  "payment_db_id": 42,
  "plan_name": "Pro",
  "billing_cycle": "month",
  "total": 5898.20,
  "prefill": {
    "name": "Rahul",
    "email": "rahul@acme.com",
    "contact": "9999999999"
  },
  "org_name": "Acme Corp"
}
```

**Response — free plan (price = 0)**
```json
{
  "free": true,
  "message": "Free plan activated",
  "txn_id": "PENDING-XXXXXXXXXX",
  "plan": "Starter",
  "total": 0,
  "valid_until": "2026-05-25"
}
```

**Errors**
- `403` — caller has no `client_id`
- `404` — `plan_id` not found
- `502` — Razorpay API call failed (network / invalid keys)

---

### `POST /api/subscription/verify-payment`

Auth: `Bearer`.

**Request** — these three fields come from Razorpay checkout's `handler` callback.
```json
{
  "razorpay_order_id": "order_ShdhI3wZgOX0Zo",
  "razorpay_payment_id": "pay_ShdjK8qWzZxY",
  "razorpay_signature": "abc123def456..."
}
```

**Response (success)**
```json
{
  "message": "Plan activated successfully",
  "txn_id": "pay_ShdjK8qWzZxY",
  "plan": "Pro",
  "total": 5898.20,
  "valid_until": "2026-05-25"
}
```

**Errors**
- `404` — order ID has no matching local Payment row
- `403` — Payment row belongs to a different client
- `400` — signature mismatch (Payment row is marked `failed`)

**Idempotency**: if the payment is already `success` (e.g. webhook beat us to it), the endpoint returns success without re-activating.

---

### `POST /api/razorpay/webhook`

Auth: **none** (public). Verifies `X-Razorpay-Signature` header against `RAZORPAY_WEBHOOK_SECRET`.

**Events handled**
- `payment.captured` → mark Payment success, activate plan
- `order.paid` → same as above
- `payment.failed` → mark Payment `failed`

**Idempotent** — won't re-activate if the Payment is already `success` or `refunded`.

Returns `200 {ok: true}` for every recognized event (Razorpay retries on non-2xx).

---

## 7. End-to-end payment flow (sequence)

```
USER                 BROWSER                  LARAVEL                    RAZORPAY
 │  click "Pay"        │                         │                            │
 ├────────────────────▶│ POST /create-order      │                            │
 │                     ├────────────────────────▶│ orders.create()            │
 │                     │                         ├───────────────────────────▶│
 │                     │                         │◀───────────────────────────┤
 │                     │                         │ order_xxx                  │
 │                     │                         │ insert Payment(pending)    │
 │                     │◀────────────────────────┤                            │
 │                     │ {key, order_id, ...}    │                            │
 │                     │ Razorpay(...).open()    │                            │
 │                     │────────── popup ───────────────────────────────────▶│
 │ enter card/UPI     │                         │                            │
 ├──────────────────── │ ─────── modal ─────────────────────────────────────▶│
 │                     │                         │                            │ charge card
 │                     │◀──────── handler() ────────────────────────────────│
 │                     │ {payment_id, order_id, signature}                    │
 │                     ├────────────────────────▶│ POST /verify-payment       │
 │                     │                         │ verify HMAC                │
 │                     │                         │ update Payment(success)    │
 │                     │                         │ update Client(plan_id...)  │
 │                     │                         │ create Permissions         │
 │                     │◀────────────────────────┤                            │
 │ "success" modal     │ {message, txn_id, ...}  │                            │
 │                     │                         │◀───────────────────────────┤
 │                     │                         │ webhook payment.captured   │
 │                     │                         │ already success → no-op    │
 │                     │                         │                            │
```

---

## 8. Frontend implementation

### Razorpay checkout.js loaded globally

[resources/views/welcome.blade.php](resources/views/welcome.blade.php):
```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

Loads once, makes `window.Razorpay` available everywhere.

### handlePay flow in [resources/js/pages/PlanSelection.tsx](resources/js/pages/PlanSelection.tsx)

```ts
// 1. Ask backend to create an order
const orderRes = await api.post('/subscription/create-order', {
  plan_id, billing_cycle, payment_method,
});

// 2. Free plan? Done.
if (orderRes.data.free) { showSuccess(); return; }

// 3. Open Razorpay modal
const rzp = new (window as any).Razorpay({
  key: orderRes.data.key,
  amount: orderRes.data.amount,
  currency: orderRes.data.currency,
  order_id: orderRes.data.order_id,
  name: orderRes.data.org_name,
  description: `${orderRes.data.plan_name} Plan`,
  prefill: orderRes.data.prefill,
  theme: { color: '#405189' },
  handler: async (response) => {
    // 4. Verify on backend
    const verify = await api.post('/subscription/verify-payment', {
      razorpay_order_id: response.razorpay_order_id,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature,
    });
    showSuccess(verify.data);
  },
  modal: { ondismiss: () => showCancelled() },
});
rzp.on('payment.failed', (resp) => showFailure(resp.error.description));
rzp.open();
```

### Pre-selected payment method

The user's choice (UPI/Card/Netbanking) is passed to Razorpay's `method` option, restricting the modal to that single method. To allow the user to pick inside Razorpay's modal too, remove the `method` block from the Razorpay options.

---

## 9. Webhook setup

Webhooks are a **safety net** — they ensure that if the user closes the browser between paying and our verify call, the plan still activates.

### Local development (with ngrok)

1. Install ngrok and run:
   ```bash
   ngrok http 80          # if Apache on port 80
   ```
2. Copy the HTTPS URL (e.g. `https://a1b2.ngrok.io`).
3. Razorpay Dashboard → **Settings → Webhooks → + Add New Webhook**
   - **URL**: `https://a1b2.ngrok.io/api/razorpay/webhook`
   - **Secret**: any random string (e.g. `whsec_dev_2026`)
   - **Active events**: `payment.captured`, `payment.failed`, `order.paid`
4. Copy that secret into `.env`:
   ```env
   RAZORPAY_WEBHOOK_SECRET=whsec_dev_2026
   ```
5. `php artisan config:clear`

### Production

Same flow, but the URL is your real public domain:
```
https://api.your-domain.com/api/razorpay/webhook
```

### Verifying webhooks work

In Razorpay Dashboard → Webhooks → click your webhook → "Test Webhook" — sends a sample event. Check `storage/logs/laravel.log` for any signature errors.

### Webhook IPs (firewall whitelisting)

If your server has IP-based firewall rules, whitelist Razorpay's webhook IPs published at: razorpay.com/docs/webhooks/

---

## 10. Test cards / UPI / netbanking values

Only valid in **test mode** (with `rzp_test_*` keys).

### Card
| Field | Value |
|---|---|
| Number | `4111 1111 1111 1111` (Visa) — also `5267 3181 8797 5449` (Mastercard) |
| Expiry | Any future date — e.g. `12/30` |
| CVV | Any 3 digits — e.g. `123` |
| OTP | `1234` (always works in test mode) |
| Name | Any |

To force a **failure**: use `4000 0000 0000 0002`.

### UPI
| Value | Result |
|---|---|
| `success@razorpay` | Payment succeeds |
| `failure@razorpay` | Payment fails |

### Netbanking
Pick any bank in the modal — Razorpay's test page shows a "Success" / "Failure" button. Click whichever you want to test.

### Wallets
Pick any wallet (e.g. Mobikwik) → "Success" / "Failure" button.

Full reference: razorpay.com/docs/payments/payments/test-card-details/

---

## 11. QA test scenarios

### Happy paths
- [ ] **Card success** — Buy any paid plan with test card → toast shows success → Payments page shows row with `status=success`, `txn_id` starts with `pay_`.
- [ ] **UPI success** — Same, but with `success@razorpay`.
- [ ] **Netbanking success** — Same, but pick netbanking → click Success on Razorpay's test page.
- [ ] **Free plan** — Pick Starter (₹0) → activates immediately, no Razorpay modal opens.
- [ ] **Yearly billing with discount** — Pick yearly cycle on a plan with `yearly_discount` → final amount in Razorpay matches discounted total in modal.
- [ ] **Quarterly billing** — Total = monthly price × 3 + GST.

### Failure paths
- [ ] **Card failure** — `4000 0000 0000 0002` → toast shows "Payment Failed" → Payment row marked `failed`.
- [ ] **UPI failure** — `failure@razorpay` → same.
- [ ] **User cancels** — Open Razorpay modal → close it (X or Esc) → toast "Payment Cancelled" → Payment row stays `pending`.
- [ ] **Network drop during create-order** — Disconnect WiFi → click Pay → toast "Could not start payment".

### Multi-tenant guards
- [ ] **Super admin blocked** — Log in as super admin (no `client_id`) → call create-order → returns `403`.
- [ ] **Wrong client verify** — User of Client A tries to verify a payment belonging to Client B → returns `403`.

### Idempotency
- [ ] **Verify twice** — Trigger the verify call twice with the same data → second call returns success without creating duplicate state.
- [ ] **Webhook + verify race** — If webhook arrives first, the user's verify call still returns success.

### Plan activation side-effects
- [ ] After successful payment, `clients.plan_id` updates to the new plan.
- [ ] `clients.plan_expires_at` matches `payments.valid_until`.
- [ ] `clients.plan_type` becomes `'paid'` (`'free'` for free plans).
- [ ] User's `permissions` table rows match the new plan's modules.
- [ ] Logout + login → user sees only the modules included in the new plan.

### Webhook (with ngrok)
- [ ] Make a payment → webhook fires → Razorpay Dashboard → Webhooks shows `200 OK`.
- [ ] Send a test event with **wrong** signature (modify `RAZORPAY_WEBHOOK_SECRET` temporarily) → endpoint returns `400`.

---

## 12. Going live (test → production)

### Razorpay side
1. Complete KYC in Razorpay Dashboard (PAN, GST if applicable, bank account, business proofs, signatory ID, cancelled cheque).
2. Submit website URL — Razorpay reviews your compliance pages (T&C, Privacy, Refund Policy, Contact, Pricing).
3. Once approved, switch the toggle in the dashboard to **Live mode** and generate Live API Keys.

### App side
1. In `.env` (production server), replace test keys with live keys:
   ```env
   RAZORPAY_KEY=rzp_live_xxxxxxxxxxxxxx
   RAZORPAY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
   RAZORPAY_WEBHOOK_SECRET=<live-webhook-secret>
   VITE_RAZORPAY_KEY="${RAZORPAY_KEY}"
   ```
2. Re-build the frontend so the new `VITE_RAZORPAY_KEY` is bundled (currently the FE reads the key from the API response, but rebuild anyway):
   ```bash
   npm run build
   ```
3. Clear caches:
   ```bash
   php artisan config:clear
   php artisan route:clear
   ```
4. Re-create webhook in Razorpay Live Dashboard pointing at `https://your-prod-domain.com/api/razorpay/webhook` with a **new secret** (do not reuse the test secret).
5. Run a real ₹1 transaction to verify everything end-to-end. Refund yourself afterwards.

### Production environment requirements
- **HTTPS** — Razorpay refuses to load checkout on non-HTTPS pages.
- Valid SSL cert (no self-signed).
- Server clock in sync (NTP) — signature verification can fail with skew.
- Logs going somewhere monitored (`storage/logs/laravel.log` or a log aggregator) so failed webhooks are noticed.

---

## 13. Troubleshooting

### "Razorpay credentials are not configured"
The service can't read `RAZORPAY_KEY` or `RAZORPAY_SECRET` from env.

```bash
php artisan config:clear
php artisan tinker
>>> config('services.razorpay.key')
```
Should print your key. If it prints `null`, the `.env` value isn't being read — check spelling and that there's no `config:cache` lock from a previous deploy.

### `cURL error 60: SSL certificate problem`
Common on XAMPP / Windows. Fix:
1. Download `cacert.pem` from curl.se/ca/cacert.pem
2. Place at `C:\xampp\php\extras\ssl\cacert.pem`
3. In `php.ini`, set:
   ```ini
   curl.cainfo = "C:\xampp\php\extras\ssl\cacert.pem"
   openssl.cafile = "C:\xampp\php\extras\ssl\cacert.pem"
   ```
4. Restart Apache.

### Razorpay modal doesn't open
- Open browser DevTools → Console.
- If `window.Razorpay is not defined` → check that `welcome.blade.php` includes the `<script src=".../checkout.js">` and that the page actually loads it (Network tab).
- If `Razorpay is not a constructor` → the script failed to load (check Content-Security-Policy headers if any).

### "Payment signature verification failed"
- The secret in `.env` doesn't match the key. Check that `RAZORPAY_KEY` and `RAZORPAY_SECRET` are a matching pair from the same Razorpay account.
- The order was created with key A but verified with key B. After rotating keys, all in-flight orders fail this way — finish them with the old key or void them.

### Webhook returns 400 "Invalid signature"
- `RAZORPAY_WEBHOOK_SECRET` doesn't match what you set in Razorpay Dashboard.
- The dashboard URL still points to an old secret — re-save the webhook with the correct secret.

### Payment shows `pending` forever
The browser disconnected before the verify call. Either:
- The webhook will catch it (recommended — set up a webhook).
- Manually fetch the payment status from Razorpay Dashboard and update the row.

### "Only client admins can subscribe"
Caller has no `client_id` (e.g. super admin). Log in as a client admin user.

---

## 14. Security checklist

- [x] Razorpay secret never exposed to frontend.
- [x] Payment signature verified server-side using HMAC-SHA256 before activating any plan.
- [x] Webhook signature verified using the webhook secret before trusting any payload.
- [x] `verify-payment` checks that the Payment row's `client_id` matches the caller's `client_id`.
- [x] Idempotent — replaying a verify or webhook does not double-activate.
- [ ] Webhook secret stored securely in production env (not committed to git).
- [ ] HTTPS enforced on production.
- [ ] Razorpay keys rotated if ever leaked (Dashboard → Settings → API Keys → Regenerate).

---

## 15. Not implemented yet (future scope)

These are deliberately out of scope for the initial integration. Add when needed.

| Feature | Notes |
|---|---|
| **Auto-renewal / Razorpay Subscriptions** | Different API (`/subscriptions`). Requires creating a Plan in Razorpay too, plus a mandate flow. Use Razorpay Subscriptions for recurring billing. |
| **Refunds** | Razorpay supports full + partial refunds via `payments.refund()`. The `payments` table already has `refund_amount`, `refund_reason`, `refunded_at` columns. |
| **Failed-payment retry queue** | A scheduled job that retries `pending` payments older than X minutes. |
| **Dunning emails** | When `plan_expires_at` is approaching, email the client. `PlanReminderMail` already exists — wire to a daily scheduled command. |
| **Invoice email after payment** | `PaymentInvoiceMail` exists. Currently invoice PDFs are generated on-demand from the Payments page. Auto-email after success was disabled because the existing SMTP is slow (50s+). Move to a queue + faster transactional mail provider. |
| **Multi-currency** | Currently hard-coded to INR. Razorpay supports more currencies but require account-level enablement. |
| **Pro-rated upgrades** | Mid-cycle plan changes with credit calculation. |

---

## Appendix — Quick reference card

```
ENV:
  RAZORPAY_KEY              rzp_test_xxx (or rzp_live_xxx)
  RAZORPAY_SECRET           secret pair of the above
  RAZORPAY_WEBHOOK_SECRET   any string you choose, set in Razorpay dashboard too

ROUTES:
  POST /api/subscription/create-order      auth, returns Razorpay order
  POST /api/subscription/verify-payment    auth, verifies signature + activates
  POST /api/razorpay/webhook               public, signature-verified

SDK CALLS (in app/Services/RazorpayService.php):
  $svc->createOrder($amountRupees, $receipt, $notes)
  $svc->verifyPaymentSignature($orderId, $paymentId, $signature)
  $svc->verifyWebhookSignature($payload, $signature)

DB COLUMNS USED:
  payments.order_id          → Razorpay order_xxx
  payments.txn_id            → Razorpay pay_xxx (after verification)
  payments.gateway           → 'razorpay'
  payments.gateway_response  → JSON of full Razorpay response
  payments.status            → 'pending' → 'success' | 'failed'

TEST CARD:
  4111 1111 1111 1111 / 12/30 / CVV 123 / OTP 1234
```
