# DIAGNOSIS & RESOLUTION CENTER — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → CLM Command Center → **Diagnosis & Resolution Center**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
`ClmDiagnosisResolutionController` — ~130 lines, **two endpoints, no table**. It is the clearest example in CLM of composition over duplication: the two heavy profile controllers are **method-injected** and called in-process, and their payloads are re-emitted verbatim under `buyer` and `supplier`.

The controller's own docblock states the rationale:

> *"A read-only 'command center' that combines the Buyer, Supplier and Case-to-Case compliance views into a single payload so the SPA can render its three diagnosis sub-tabs from one round-trip. The heavy aggregation (segment rules → required-doc union → upload progress → agreements) is reused verbatim from the existing profile controllers — they already scope by client_id / branch_id through `forUser()`, so tenant isolation is inherited and there is no duplicated query logic to drift."*
>
> *"`escalate()` records a Resolution Center escalation against a blocked record (audit log + success ack); there is no Notification model yet, so the notify-via channels are accepted but only logged."*

### 1.2 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                               │
│  pages/clm/command-center/ClmDiagnosisResolutionPage.tsx              │
│    sub-tabs: Buyer · Supplier · Case to Case                          │
│    escalation form (reference · target · issue · priority · message)  │
└──────────────────────────────┬───────────────────────────────────────┘
        GET  /api/clm/diagnosis-resolution
        POST /api/clm/diagnosis-resolution/escalate
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  APPLICATION — ClmDiagnosisResolutionController                       │
│                                                                       │
│   index(Request, ClmBuyerProfileController $buyer,                    │
│                  ClmSupplierProfileController $supplier)              │
│        ├── $buyer->index($request)     ← METHOD INJECTION, in-process │
│        ├── $supplier->index($request)  ← not an HTTP call             │
│        └── $this->ctcRows($clientId)                                  │
│                                                                       │
│   escalate(Request)  → validate → Log::info → 200 ack                 │
│                        (NO persistence — there is no escalations table)│
│                                                                       │
│   helpers: ctcRows · primaryCounterparty · normaliseRole · listStatus │
└──────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DATA                                                                 │
│    (buyer / supplier blocks: whatever those controllers read —        │
│     13 and 11 tables respectively)                                    │
│    ctc_contracts  ← the only table this controller queries directly   │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/ClmDiagnosisResolutionController.php   ← the whole module
app/Http/Controllers/Api/ClmBuyerProfileController.php          (injected)
app/Http/Controllers/Api/ClmSupplierProfileController.php       (injected)
app/Models/CtcContract.php
resources/js/pages/clm/command-center/ClmDiagnosisResolutionPage.tsx
```
**No migration.** The module creates no tables — including, notably, no escalations table.

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL · Sanctum |
| Composition | Laravel **method injection** — the two profile controllers are resolved from the container and invoked directly |
| Logging | `Illuminate\Support\Facades\Log` — the only persistence `escalate()` performs |
| Frontend | React 19 · TS · shared CLM command-center shell |

---

## 3. DATA MODEL

| Source | Read how |
|---|---|
| **Buyer block** | `ClmBuyerProfileController::index()` — 13 tables, 6 collections |
| **Supplier block** | `ClmSupplierProfileController::index()` — 11 tables, 10 collections |
| **CTC block** | `ctc_contracts`, selecting only `id, code, title, counterparties, stage, status, approval_status` |

The controller declares no models of its own beyond `CtcContract`.

---

## 4. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get ('/clm/diagnosis-resolution',          [ClmDiagnosisResolutionController::class,'index']);
    Route::post('/clm/diagnosis-resolution/escalate', [ClmDiagnosisResolutionController::class,'escalate']);
});
```
`index()` takes **no query parameters**. Full detail in **DIAGNOSIS_RESOLUTION_API_DOCUMENTATION.md**.

---

## 5. CONTROLLER ANALYSIS

### `index()` — composition by method injection
```php
public function index(
    Request $request,
    ClmBuyerProfileController $buyer,
    ClmSupplierProfileController $supplier
): JsonResponse {
    $user = $request->user(); if (!$user) abort(401);

    $buyerData    = $buyer->index($request)->getData(true)['data'] ?? [];
    $supplierData = $supplier->index($request)->getData(true)['data'] ?? [];

    return response()->json(['status' => true, 'data' => [
        'buyer'    => $buyerData,
        'supplier' => $supplierData,
        'ctc'      => $this->ctcRows((int) ($user->client_id ?? 0)),
    ]]);
}
```

Laravel resolves both controllers from the service container and injects them as method arguments. `index()` is then called **in-process** — no HTTP round-trip, no route dispatch, no middleware re-run. The `$request` is passed straight through, so the same user, the same `branch_id` and the same scoping apply.

Consequences worth knowing:
- Any scoping change in either profile controller **propagates here automatically**.
- Any performance cost in either controller is paid here too — and both are the heaviest reads in CLM.
- `getData(true)['data'] ?? []` degrades to an empty array rather than throwing if a profile controller returns an unexpected shape.

### `ctcRows(int $clientId)`
```php
/* Case-to-Case contract rows for the diagnosis sub-tab: code, title, the primary
 * counterparty + its role badge, and the list-bucket status. */
if (!$clientId) return [];

return CtcContract::where('client_id', $clientId)
    ->orderByDesc('id')
    ->get(['id','code','title','counterparties','stage','status','approval_status'])
    ->map(fn (CtcContract $c) => [
        'id'           => $c->code,          // ← the CODE, not the numeric id
        'ctc'          => $c->code,
        'title'        => $c->title ?: '—',
        'counterparty' => $this->primaryCounterparty($c)['name'],
        'role'         => $this->primaryCounterparty($c)['role'],
        'status'       => $this->listStatus($c),
    ])->all();
```
Only seven columns are selected — the JSON `versions`, `approvers` and `clarifications` blobs are deliberately not loaded.

### `listStatus()` — the four-bucket mapping
```php
/** Approval lifecycle → CTC-list bucket (mirrors CtcContractController). */
private function listStatus(CtcContract $c): string
{
    if ($c->approval_status === 'rejected')        return 'rejected';
    if ($c->approval_status === 'clarification')   return 'clarify';   // ← EXTRA bucket
    if ($c->stage >= 4 || $c->status === 'signed') return 'signed';
    return 'inprogress';
}
```
The docblock says "mirrors `CtcContractController`", but it is a **superset**: the Case-to-Case list has no `clarify` bucket and folds clarification into `inprogress`. Surfacing it separately is the point of a triage screen.

### `primaryCounterparty()` and `normaliseRole()`
```php
/** First counterparty's display name + normalised role badge. */
$first = ($c->counterparties ?? [])[0] ?? [];
return ['name' => $first['name'] ?? '—' ?: '—',
        'role' => $this->normaliseRole($first['badge'] ?? $first['source_type'] ?? '')];

/** Map a stored badge / source_type to one of Buyer | Supplier | Partner. */
$r = mb_strtolower(trim($raw));
if (str_contains($r,'buy')  || $r === 'customer') return 'Buyer';
if (str_contains($r,'supp') || $r === 'vendor')   return 'Supplier';
return 'Partner';
```
This is a **coarser** mapping than `CtcContractController::cpRoleLabel()`, which distinguishes Customer / Consignee / Supplier. Here a consignee falls through to **Partner**. Counterparties are also read from the **stored snapshot** — this controller does not run the live-master refresh that the Case-to-Case screen does.

### `escalate()`
```php
$data = $request->validate([
    'reference'    => ['required','string','max:120'],
    'escalate_to'  => ['required','string','max:120'],
    'issue_type'   => ['required','string','max:120'],
    'priority'     => ['required','string','in:critical,high,medium,low'],
    'message'      => ['required','string','max:5000'],
    'notify_via'   => ['nullable','array'],
    'notify_via.*' => ['string','max:40'],
]);

Log::info('CLM escalation raised', ['client_id'=>…, 'by'=>$user->id] + $data);

return response()->json([
    'status'  => true,
    'message' => 'Escalation recorded and the target has been notified.',
]);
```

**Nothing is persisted beyond the log line.** There is no escalations table, no notification record and no delivery over the `notify_via` channels. The success message asserting the target "has been notified" is currently aspirational — worth knowing before promising it to a user.

---

## 6. FRONTEND

`ClmDiagnosisResolutionPage.tsx` renders the three sub-tabs from the single payload and mounts the escalation form on a selected row. Because the buyer and supplier blocks are byte-identical to the profile endpoints' payloads, the page reuses the same row components.

---

## 7. INTEGRATIONS

| Integration | How |
|---|---|
| **Customer Profile** | Method-injected; its `data` becomes the `buyer` block |
| **Supplier Profile** | Method-injected; its `data` becomes the `supplier` block |
| **Case-to-Case** | Direct `ctc_contracts` query with the four-bucket status |
| **Regulatory Defense File** | Uses the **same** injection pattern over the same two controllers |
| **Evidence Vault** | The eventual drill-down for a blocked document |

---

## 8. SECURITY & CAVEATS

1. Tenant isolation is **inherited**, not re-implemented: the injected controllers apply `forUser()` and `client_id` scoping to the same `$request`.
2. `ctcRows()` is `client_id`-scoped but **not** branch-scoped — consistent with `CtcContractController`'s own lookups.
3. `escalate()` is validated but **not persisted** — the audit log is the only record. Do not treat a 200 as proof anything was delivered.
4. `notify_via` values are accepted and logged but never used to send anything.
5. `escalate()` does not verify that `reference` points at a real record.
6. Calling both profile controllers means this endpoint carries the cost of **both** of CLM's heaviest reads, with no pagination or cache.
7. Counterparties come from the stored snapshot — no live-master refresh, unlike the Case-to-Case screen.

---

## 9. METRICS

| Metric | Value |
|---|---|
| Controller | 1 (`ClmDiagnosisResolutionController`, ~130 lines) |
| Own tables | 0 (**including no escalations table**) |
| Tables queried directly | 1 (`ctc_contracts`, 7 columns) |
| Tables read transitively | ~20, via the two injected controllers |
| Endpoints | 2 (1 GET, 1 POST) |
| Output blocks | 3 (`buyer`, `supplier`, `ctc`) |
| CTC status buckets | **4** (`rejected` · `clarify` · `signed` · `inprogress`) |
| Permission slug | `clm.diagnosis_resolution` |
| Escalation persistence | **log line only** |
| Test coverage | none automated |

---

*Related documents: DIAGNOSIS_RESOLUTION_FUNCTIONAL_DOCUMENTATION.md · DIAGNOSIS_RESOLUTION_CODE_WALKTHROUGH.md · DIAGNOSIS_RESOLUTION_API_DOCUMENTATION.md*
