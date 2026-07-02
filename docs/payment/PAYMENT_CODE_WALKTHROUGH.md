# PAYMENT / BILLING MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · Billing → Payments (Razorpay)
> A guided, execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS DOCUMENT
Follows the checkout → activation flow in execution order, plus back-office (manual record, invoice, reminder). Line numbers reference the live source and may drift. Legend: `→` a call · `⇒` a return.

Primary files: `SubscriptionController.php`, `PaymentController.php`, `RazorpayWebhookController.php`, `RazorpayService.php`, `Payment.php`, `PlanSelection.tsx`, `Payments.tsx`.

---

## 1. CHECKOUT — STEP 1: CREATE ORDER

### 1.1 Frontend (`PlanSelection.tsx`)
```tsx
// re-entrancy guard before the first await (prevents double orders)
if (paySubmittingRef.current) return; paySubmittingRef.current = true;
const orderRes = await api.post('/subscription/create-order', {
  plan_id: selectedPlan.id, payment_method: paymentMethod,   // upi | card | net_banking
  billing_cycle: billingCycle,                                // month | quarter | year
  kept_branch_ids: keptBranchIds.length ? keptBranchIds : undefined,
});
if (orderRes.data.free) { /* already activated server-side */ setPaymentStep('success'); return; }
await loadRazorpayCheckout();   // lazy-injects checkout.js (memoised)
```

### 1.2 Backend (`SubscriptionController::createOrder`, 59)
```php
$data = $request->validate([
  'plan_id' => 'required|exists:plans,id',
  'payment_method' => 'required|in:upi,card,net_banking',
  'billing_cycle' => 'required|in:month,quarter,year',
  'kept_branch_ids' => 'nullable|array', 'kept_branch_ids.*' => 'integer|exists:branches,id',
]);
if (!$user->client_id) abort(403, 'Only client admins can subscribe');

$kept = $this->resolveKeptBranchIds($client, $plan, $data['kept_branch_ids'] ?? null);
// if downgrade needs a selection → 422 { requires_branch_selection, max_branches, current_branch_count }

[$amount, $gst, $total, $validUntil] = $this->computePricing($plan, $data['billing_cycle']);
// amount = price × {month:1,quarter:3,year:12}; year applies yearly_discount; gst = round(amount*0.18,2); total = amount+gst

if ($total <= 0) {                                   // FREE plan fast-path
    $payment = $this->createPendingPayment(... status forced 'success' ...);
    $this->activatePlan($payment, $plan, $client, $user);
    return response()->json(['free' => true, 'message' => 'Free plan activated', 'txn_id' => ..., 'total' => 0, 'valid_until' => $validUntil]);
}

$order = $razorpay->createOrder($total, $receipt, $notes);   // → paise; 502 on failure
$payment = $this->createPendingPayment($client,$plan,..., order_id: $order['id'], status:'pending');
return response()->json([
  'free' => false, 'key' => $razorpay->key(), 'order_id' => $order['id'],
  'amount' => $order['amount'], 'currency' => 'INR', 'payment_db_id' => $payment->id,
  'plan_name' => $plan->name, 'billing_cycle' => ..., 'total' => $total,
  'prefill' => ['name'=>..., 'email'=>..., 'contact'=>...], 'org_name' => $client->org_name,
]);
```

`createPendingPayment` (289): inserts a Payment with `txn_id='PENDING-'+random`, `order_id` (Razorpay id or `FREE-…`), `currency='INR'`, `gateway='razorpay'`, `invoice_number='INV-'+date+random`, `processed_by=user.id`, `gateway_response` holding the order id (+ kept branches).

---

## 2. CHECKOUT — STEP 2: RAZORPAY MODAL & VERIFY

### 2.1 Frontend opens the hosted modal
```tsx
const rzp = new window.Razorpay({
  key, amount, currency, order_id, name: org_name, description: plan_name,
  prefill, theme: { color: '#405189' }, method: /* per paymentMethod */,
  handler: async (resp) => {                              // on success
    const v = await api.post('/subscription/verify-payment', {
      razorpay_order_id: resp.razorpay_order_id,
      razorpay_payment_id: resp.razorpay_payment_id,
      razorpay_signature: resp.razorpay_signature,
    });
    setTxnResult(v.data); setPaymentStep('success');
  },
  modal: { ondismiss: () => api.post('/subscription/cancel-order', { razorpay_order_id, reason: 'user_cancelled' }) },
});
rzp.on('payment.failed', (e) => api.post('/subscription/cancel-order', { razorpay_order_id, reason: e.error?.description }));
rzp.open();
```

### 2.2 Backend verify (`SubscriptionController::verifyPayment`, 191)
```php
$data = $request->validate([
  'razorpay_order_id'=>'required|string','razorpay_payment_id'=>'required|string','razorpay_signature'=>'required|string',
]);
$payment = Payment::where('order_id', $data['razorpay_order_id'])->firstOrFail();   // 404
if ($payment->client_id !== $user->client_id) abort(403);
if ($payment->status === 'success') return /* idempotent */;

$ok = $razorpay->verifyPaymentSignature($data['razorpay_order_id'], $data['razorpay_payment_id'], $data['razorpay_signature']);
if (!$ok) { $payment->update(['status'=>'failed', 'gateway_response'=>[...'verify_error']]); return response()->json([...], 400); }

$payment->update(['txn_id'=>$data['razorpay_payment_id'], 'gateway_response'=>[...signature, verified_at]]);
$this->activatePlan($payment, $plan, $client, $user);
return response()->json(['message'=>'Plan activated successfully','txn_id'=>..., 'plan'=>..., 'total'=>..., 'valid_until'=>...]);
```

### 2.3 Signature check (`RazorpayService::verifyPaymentSignature`, 48)
```php
try { $this->api->utility->verifyPaymentSignature([
        'razorpay_order_id'=>$orderId, 'razorpay_payment_id'=>$paymentId, 'razorpay_signature'=>$signature]);
      return true;
} catch (SignatureVerificationError $e) { return false; }   // uses RAZORPAY_SECRET (set → active)
```

---

## 3. ACTIVATION (the core transaction)

### `SubscriptionController::activatePlan()` (325)
```php
DB::transaction(function () use ($payment, $plan, $client, $user) {
    $payment->update(['status' => 'success']);

    // 1. client subscription state
    $client->update([
        'plan_id' => $plan->id, 'plan_type' => 'paid',           // note: even free plans → 'paid'
        'status' => 'active', 'plan_expires_at' => $payment->valid_until,
    ]);

    // 2. reset & regrant the client-admin's permissions per the plan's modules
    Permission::where('user_id', $user->id)->delete();
    foreach (Module::where('is_active', true)->get() as $module) {
        $pm = $plan->planModules->firstWhere('module_id', $module->id);
        $included = $pm && in_array($pm->access_level, ['full','limited']);
        if (!$included && !$module->is_default) continue;
        $full = ($pm && $pm->access_level === 'full') || $module->is_default;
        DB::table('permissions')->insert([
            'user_id'=>$user->id, 'client_id'=>$client->id, 'module_id'=>$module->id,
            'can_view'=>true,                                  // always
            'can_add'=>$full, 'can_edit'=>$full,
            'can_delete'=>$full && $pm?->access_level==='full', /* full-only actions */ ...,
        ]);
    }

    // 3. downgrade hygiene
    $this->cascadePruneDownstreamPermissions($client->id, $user->id);   // strip branch/employee flags admin lost
    $this->enforceBranchLimit($client, $plan, $kept);                   // deactivate extra branches + revoke tokens
});
// 4. invoice AFTER commit (SMTP failure can't roll back a paid subscription)
$this->invoiceMailer->sendForPayment($payment->fresh());
```

`enforceBranchLimit` (448): keeps `kept_branch_ids` (or oldest-N by `created_at`) within `plan.max_branches`, sets the rest `status='inactive'`, and deletes their users' `personal_access_tokens` (forced logout).

---

## 4. CANCEL (dismiss / failure)

### `SubscriptionController::cancelOrder()` (155)
```php
$payment = Payment::where('order_id', $request->razorpay_order_id)->first();
if (!$payment) return response()->json(['ok' => true]);            // no-op
if ($payment->client_id !== $user->client_id) abort(403);
if (in_array($payment->status, ['success','refunded','failed'])) return /* idempotent */;
$payment->update(['status' => 'failed', 'gateway_response' => [... 'cancelled_at', 'cancel_reason']]);
return response()->json(['ok' => true, 'status' => 'failed']);
```

---

## 5. THE WEBHOOK (disabled locally)

### `RazorpayWebhookController::handle()` (23)
```php
$sig = $request->header('X-Razorpay-Signature'); $payload = $request->getContent();
if (!$razorpay->verifyWebhookSignature($payload, $sig)) return response('Invalid signature', 400);
//   ^ verifyWebhookSignature returns FALSE when RAZORPAY_WEBHOOK_SECRET is blank → every call 400s locally

$payment = Payment::where('order_id', $orderId)->lockForUpdate()->first();   // inside DB::transaction
if (in_array($payment->status, ['success','refunded'])) return /* idempotent */;

// amount-tampering defence
if (in_array($event, ['payment.captured','order.paid']) && $entity['amount'] !== round($payment->total*100))
    return response()->json(['ok'=>true, 'note'=>'amount mismatch']);   // ack but DON'T activate

// on captured/paid → activateFromWebhook(); on payment.failed → status='failed'
return response()->json(['ok' => true]);   // always 200 to stop retries
```
> `activateFromWebhook` (123) mirrors `activatePlan` (mark success → update client → reset+regrant admin permissions) but **omits** `cascadePruneDownstreamPermissions` and `enforceBranchLimit`. Since the secret is blank, this path is inert in this environment.

---

## 6. BACK-OFFICE (PaymentController)

### 6.1 Record a manual payment (`store`, 86) — super-admin only
```php
if (!$user->isSuperAdmin()) abort(403);
$data = $request->validate([... client_id required|exists, amount, total required, method in [...], status in [pending,success,failed,refunded] ...]);
$payment = Payment::create($data + [
    'invoice_number' => 'INV-'.strtoupper(now()->format('ymdHis')),
    'processed_by' => $user->id,
]);
if ($payment->status === 'success') $this->invoiceMailer->sendForPayment($payment);
return response()->json(['message'=>'...', 'payment'=>$payment], 201);
```

### 6.2 List & stats (`index`/`stats`)
```php
// scoping: client_admin → own client_id; super_admin → all; else empty
$q = Payment::with(['client:id,org_name','plan:id,name,price','processedBy:id,name'])->whereHas('client');
if ($user->isClientAdmin()) $q->where('client_id', $user->client_id);
// search ilike on txn_id/order_id/invoice_number/client.org_name; filters status/from/to
```
`stats` aggregates: `total_revenue` (sum total where success), counts by status, `refund_amount`.

### 6.3 Invoice (`viewInvoice`/`downloadInvoice`, public + ?token=)
```php
// public routes — authenticate from the query token, then authorize
$user = $this->authenticateFromQuery($request);         // PersonalAccessToken::findToken(?token=)
$this->authorizeViewPayment($payment, $user);           // super any / client_admin own / else 403
$path = $this->ensureInvoicePdf($payment);              // InvoiceMailer::ensureInvoicePdf (404 if missing)
return response()->file($path);                          // or ->download() for /download
```

### 6.4 Authorization gate (`authorizeViewPayment`, 266)
```php
if ($user->isSuperAdmin()) return;                        // any
if ($user->isClientAdmin() && $payment->client_id === $user->client_id) return;   // own
abort(403);                                               // closed a prior any-authed-user data leak
```

### 6.5 Reminder (`sendReminder`, 158) — super-admin only
```php
if (!$user->isSuperAdmin()) abort(403);
if (!Settings::shouldSendMail('planExp')) abort(503);
if (!$clientEmail) return response()->json([...], 422);
Mail::to($orgEmail)->cc($adminEmail)->send(new PlanReminderMail($client, $payment));
```

---

## 7. FRONTEND — PAYMENTS LIST (`Payments.tsx`)

```tsx
const [payments] = useState<Payment[]>([]);
useEffect(() => {
  api.get('/payments', { params: { per_page: 9999 } }).then(r => setPayments(r.data.data));
  api.get('/payments/stats').then(r => setStats(r.data));
}, []);
// record: POST /payments  (total auto = max(0, amount + gst − discount) unless edited)
// delete (SA): DELETE /payments/{id}
// reminder (SA, success rows): POST /payments/{id}/send-reminder
// invoice: window.open(`/api/payments/${id}/invoice/view?token=${localStorage.cbc_token}`)
```
Status pill config: success=green, pending=amber, failed=red, refunded=blue.

---

## 8. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Two-step checkout | create-order → verify-payment | Standard Razorpay order/verify handshake |
| Idempotent activation | verify / cancel / webhook | Safe under retries / double-clicks |
| Re-entrancy guard | `paySubmittingRef` | Prevents duplicate orders on fast clicks |
| Amount-tampering defence | webhook paise compare | Reject forged captured amounts |
| Activation transaction | `activatePlan` | Client + permissions + branch limit atomically |
| Mail after commit | activation / store | SMTP failure never rolls back a paid subscription |
| Query-token auth | invoice PDF routes | Let PDFs open in a new tab without a Bearer header |
| Single view gate | `authorizeViewPayment` | One source of truth (closed a data leak) |

---

## 9. NOTES & CAVEATS

- **Webhook disabled** (blank secret) — checkout verify path is authoritative.
- **Webhook activation omits** branch-limit + downstream-prune.
- **Free plan** activation sets `plan_type='paid'` (no reset-to-free path).
- **GST hardcoded 18%** in `computePricing`; manual `store` accepts arbitrary GST.
- **`apiResource('payments')` exposes an update route with no method.**
- **Invoice routes are public** (query-token auth); **no refund UI**.
- **DB is PostgreSQL** — `gateway_response` is JSONB; search uses `ilike`.

---

*Related documents: PAYMENT_TECHNICAL_DOCUMENTATION.md · PAYMENT_FUNCTIONAL_DOCUMENTATION.md · PAYMENT_API_DOCUMENTATION.md*
