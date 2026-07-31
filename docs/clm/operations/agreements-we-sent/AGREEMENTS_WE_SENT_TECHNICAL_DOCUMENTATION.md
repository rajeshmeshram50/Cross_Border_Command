# AGREEMENTS WE SENT — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · Without Shipment ID → **Agreements We Sent**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
One endpoint — `CtcContractController::sentIndex()` — plus the response shaper `shapeSent()` and the write action `respond()`. It has **no table of its own**: it is a `created_by`-filtered projection of `ctc_contracts`, shaped for the sender.

The three CTC screens are one controller with three list methods and three shapers:

| Method | Shaper | Screen |
|---|---|---|
| `index()` | `shapeList()` | Case to Case Contracts |
| **`sentIndex()`** | **`shapeSent()`** | **Agreements We Sent** |
| `toApproveIndex()` | `approvalRoundsShaped()` | Agreements To Approve |

### 1.2 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                               │
│  pages/clm/operations/ClmAgreementsSentPage.tsx                       │
│    tabs(all|pending|clarify|approved|rejected) · search ·             │
│    approver list · clarification thread + reply box ·                 │
│    VersionHistoryModal · AgreementTimelineModal                       │
│    subscribes to the CtcApprovalUpdated broadcast                     │
└──────────────────────────────┬───────────────────────────────────────┘
        GET  /api/clm/ctc-contracts/sent
        POST /api/clm/ctc-contracts/{id}/respond
        POST /api/clm/ctc-contracts/{id}/resubmit
        POST /api/clm/ctc-contracts/{id}/send-for-signing
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  APPLICATION — CtcContractController                                  │
│    sentIndex()  where created_by = me, id DESC → shapeSent()          │
│    shapeSent()  + approvalProgress() + istEntries()                   │
│    respond()    fills the newest unanswered clarification             │
│    resubmit() · sendForSigning()   (shared with Case to Case)         │
└──────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DATA — ctc_contracts  (no table of its own)                          │
│    created_by · approvers[] · approver_emails[] · clarifications[] ·  │
│    approval_status · rejection_reason · versions[]                    │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/CtcContractController.php
    sentIndex() · shapeSent() · approvalProgress() · respond()
    (+ the shared helpers: cpNames, cpNamesLabeled, fmt, istEntries)
app/Support/CtcAuditTime.php
app/Events/CtcApprovalUpdated.php
resources/js/pages/clm/operations/ClmAgreementsSentPage.tsx
resources/js/pages/clm/operations/clmCtcModals.tsx
resources/js/pages/clm/operations/clmOpsData.ts       (the AwsContract type)
```
No migration — see [case-to-case](../case-to-case/CASE_TO_CASE_TECHNICAL_DOCUMENTATION.md) for the `ctc_contracts` schema.

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (JSON columns) · Sanctum |
| Realtime | Laravel Reverb — `CtcApprovalUpdated` |
| Frontend | React 19 · TS · violet operations theme (`useOpsTheme`) |

---

## 3. DATA MODEL (the columns this screen depends on)

| Column | Role here |
|---|---|
| `created_by` | **The filter** — the list is `where('created_by', $user->id)` |
| `approvers` (json) | `[{name, email, role, mandatory, status, acted_at}]` → the approver panel and the count |
| `approval_status` | Drives both `approval` and `status` in the response |
| `clarifications` (json) | `[{query, by, date, response, response_date, resolved}]` → the thread |
| `rejection_reason` | The blocking objection banner |
| `primary_approver_name` | The single-name `approver` column |
| `counterparties` (json) | Refreshed live, then role-labelled |
| `submitted_at` / `created_at` | The sent date |
| `eff_date` / `end_date` | Effective / expiry columns |

---

## 4. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get ('/clm/ctc-contracts/sent',               [CtcContractController::class,'sentIndex']);
    Route::post('/clm/ctc-contracts/{id}/respond',       [… 'respond'])->whereNumber('id');
    Route::post('/clm/ctc-contracts/{id}/resubmit',      [… 'resubmit'])->whereNumber('id');
    Route::post('/clm/ctc-contracts/{id}/send-for-signing', [… 'sendForSigning'])->whereNumber('id');
});
```
`/sent` is declared **before** the generic `/{id}` route. Full detail in **AGREEMENTS_WE_SENT_API_DOCUMENTATION.md**.

---

## 5. CONTROLLER ANALYSIS

### `sentIndex()`
```php
$rows = CtcContract::where('client_id', $user->client_id)
    ->where('created_by', $user->id)          // ← the ONLY additional filter
    ->orderByDesc('id')->get()
    ->map(fn ($c) => $this->shapeSent($c));
```
Note what is **absent**: no branch filter. `index()` applies one (`$user->branch_id ?: $request->branch_id`); `sentIndex()` deliberately does not, because your own contracts are yours regardless of which branch they were raised under.

### `shapeSent()` — the sender's projection
```php
$statusMap = ['approved'=>'approved', 'rejected'=>'rejected',
              'clarification'=>'clarify', 'pending'=>'pending'];

// headline verdict: clarification is folded into pending
$approval = $c->approval_status === 'clarification' ? 'pending' : ($c->approval_status ?: 'pending');

[$approvedCount, $approverCount] = $this->approvalProgress($c);

return [
  'id'=>$c->code, 'dbId'=>$c->id, 'title'=>…,
  'cp'=>$this->cpNames($c) ?: ['—'],
  'cpLabeled'=>$this->cpNamesLabeled($c) ?: ['—'],     // "Name (Customer)"
  'org'=>…, 'date'=>fmt(submitted_at ?: created_at),
  'effDate'=>…, 'endDate'=>…, 'createdBy'=>…,
  'approver'=>$c->primary_approver_name ?: '—',        // the SINGLE-name column
  'approval'=>$approval,                                // pending|approved|rejected
  'status'=>$statusMap[$c->approval_status] ?? 'pending', // …|clarify  ← tab bucket
  'approvers'=>$this->istEntries($c->approvers ?? []),  // full list, IST-converted
  'approvedCount'=>$approvedCount, 'approverCount'=>$approverCount,
  'clarifications'=>$this->istEntries($c->clarifications ?? []),
  'rejReason'=>$c->rejection_reason,
  'expDate'=>fmt($c->end_date),
];
```

The **two status fields** are the shaper's distinctive feature: `approval` answers "is it decided?" while `status` answers "which tab does it belong in?" — and only the latter keeps `clarify` distinct.

### `approvalProgress()`
```php
/** Approval progress: [approvedCount, totalApprovers]. */
$total    = count($c->approvers ?? []);
$approved = count where ($a['status'] ?? 'pending') === 'approved';
return [$approved, $total];
```

### `respond()`
```php
validate(['response'=>'required|string|max:2000']);
for ($i = count($thread)-1; $i >= 0; $i--)
    if (empty($thread[$i]['response'])) {
        $thread[$i]['response'] = $data['response'];
        /* Stamp WHEN the sender answered — distinct from the request's `date` so the
         * review timeline shows the real answer time instead of reusing the
         * "Clarification Requested" timestamp. */
        $thread[$i]['response_date'] = now()->format('d M Y H:i');
        break;                                   // ← only the NEWEST unanswered entry
    }
$row->update(['clarifications'=>$thread]);
$this->broadcastApproval($row->fresh());
return shapeSent($row->fresh());                 // ← the SENT shape, not shapeApprove
```
`respond()` is the only write in the CTC flow that returns `shapeSent()` — because only the sender calls it.

---

## 6. FRONTEND — `ClmAgreementsSentPage.tsx`

- Tabs filter on the response's `status` field (which is why `clarify` is a bucket).
- The approver panel renders `approvers[]` with each entry's `status` and IST `acted_at`.
- The clarification panel renders `clarifications[]` and offers a reply box bound to the newest entry with an empty `response`.
- `rejReason` drives a rejection banner.
- Subscribes to `CtcApprovalUpdated` so an approver's decision refreshes the row without a reload.
- The SPA's `AwsContract` type maps 1:1 onto `shapeSent()`.

---

## 7. INTEGRATIONS

| Integration | How |
|---|---|
| **Case to Case Contracts** | Same table; contracts originate there |
| **Agreements To Approve** | The mirror screen — approvers act, this screen reflects |
| **Reverb** | `CtcApprovalUpdated` fires on approve/reject/clarify/respond |
| **Zoho Sign** | Once approved, `send-for-signing` (manual) or `ctc-send` (Zoho) moves the contract to Stage 3 |
| **CtcAuditTime** | Converts `approvers[].acted_at` and `clarifications[].date`/`response_date` from UTC to IST |

---

## 8. SECURITY & CAVEATS

1. The list is tenant-scoped **and** `created_by`-scoped, so it cannot leak another user's outbox.
2. `respond()` itself is only tenant-scoped (`where('client_id', …)->findOrFail()`) — it does **not** verify that the caller is the contract's creator. In practice the UI only exposes it on your own rows, but the endpoint would accept a call from any user in the tenant.
3. No branch filter is applied — deliberate, but it means a branch user sees their own contracts from any branch here.
4. `approval` collapses `clarification` into `pending`; consumers that need the distinction must read `status`.
5. `approver` is the **primary** approver only; the real list is `approvers[]`.
6. Only the newest unanswered clarification can be responded to.
7. All timestamps come back IST-converted via the shared `CtcAuditTime` helper.

---

## 9. METRICS

| Metric | Value |
|---|---|
| Endpoints | 1 list (+3 shared write actions) |
| Own tables | 0 |
| Shaper | `shapeSent()` — 17 fields |
| Filter | `created_by = auth user` |
| Branch filter | **none** |
| Status fields | 2 (`approval` headline, `status` tab bucket) |
| Permission slug | `clm.agreements_sent` |
| Realtime | `CtcApprovalUpdated` |
| Test coverage | none automated |

---

*Related documents: AGREEMENTS_WE_SENT_FUNCTIONAL_DOCUMENTATION.md · AGREEMENTS_WE_SENT_CODE_WALKTHROUGH.md · AGREEMENTS_WE_SENT_API_DOCUMENTATION.md*
