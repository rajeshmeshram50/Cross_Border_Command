# DIAGNOSIS & RESOLUTION CENTER — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → CLM Command Center → **Diagnosis & Resolution Center**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: the composed read (method injection) → the CTC block → the four-bucket status → the role badge → escalation.
File: [ClmDiagnosisResolutionController.php](../../../../app/Http/Controllers/Api/ClmDiagnosisResolutionController.php) — the whole module is ~130 lines.

---

## 1. THE DESIGN (from the class docblock)

```php
/**
 * CLM Command Center → Diagnosis & Resolution Center.
 *
 * A read-only "command center" that combines the Buyer, Supplier and Case-to-Case
 * compliance views into a single payload so the SPA can render its three diagnosis
 * sub-tabs from one round-trip. The heavy aggregation (segment rules → required-doc
 * union → upload progress → agreements) is reused verbatim from the existing profile
 * controllers — they already scope by client_id / branch_id through `forUser()`, so
 * tenant isolation is inherited and there is no duplicated query logic to drift.
 *
 * `escalate()` records a Resolution Center escalation against a blocked record (audit
 * log + success ack); there is no Notification model yet, so the notify-via channels
 * are accepted but only logged.
 */
```

Two commitments are made here, and both are load-bearing:
1. **No duplicated aggregation** — hence method injection rather than copied queries.
2. **Escalation is a log line** — the docblock says so explicitly.

---

## 2. THE COMPOSED READ (`index`)

```php
public function index(
    Request $request,
    ClmBuyerProfileController $buyer,          // ← resolved from the container
    ClmSupplierProfileController $supplier     // ← by Laravel method injection
): JsonResponse {
    $user = $request->user(); if (!$user) abort(401);

    $buyerData    = $buyer->index($request)->getData(true)['data'] ?? [];
    $supplierData = $supplier->index($request)->getData(true)['data'] ?? [];
    //              ^^^^^^^^^^^^^^^^^^^^^^^^ an IN-PROCESS PHP call.
    //              Not an HTTP request: no route dispatch, no middleware re-run.
    //              The SAME $request is passed through, so the same user, the same
    //              branch_id and the same scoping apply.

    return response()->json(['status' => true, 'data' => [
        'buyer'    => $buyerData,
        'supplier' => $supplierData,
        'ctc'      => $this->ctcRows((int) ($user->client_id ?? 0)),
    ]]);
}
```

### What method injection buys — and costs
| | Effect |
|---|---|
| ✅ | A scoping change in either profile controller propagates here **automatically** |
| ✅ | The maths can never drift between this screen and the profile screens |
| ✅ | `?? []` degrades gracefully if a controller returns an unexpected shape |
| ⚠ | This endpoint pays the cost of **both** of CLM's heaviest reads on every call |
| ⚠ | Neither profile controller accepts filters, so nothing can be narrowed here either |

`getData(true)` converts the `JsonResponse` back to an associative array; `['data']` unwraps the standard envelope so the block is re-emitted **verbatim** — which is why the frontend can reuse the profile screens' row components unchanged.

---

## 3. THE CTC BLOCK (`ctcRows`)

```php
/**
 * Case-to-Case contract rows for the diagnosis sub-tab: code, title, the
 * primary counterparty + its role badge, and the list-bucket status.
 */
private function ctcRows(int $clientId): array
{
    if (!$clientId) return [];

    return CtcContract::where('client_id', $clientId)
        ->orderByDesc('id')
        ->get(['id', 'code', 'title', 'counterparties', 'stage', 'status', 'approval_status'])
        //     ^^^ only SEVEN columns — the versions / approvers / clarifications JSON
        //         blobs are deliberately NOT loaded
        ->map(function (CtcContract $c) {
            $cp = $this->primaryCounterparty($c);
            return [
                'id'           => $c->code,       // ← the CODE, not the numeric id
                'ctc'          => $c->code,       //   (both keys carry the same value)
                'title'        => $c->title ?: '—',
                'counterparty' => $cp['name'],
                'role'         => $cp['role'],
                'status'       => $this->listStatus($c),
            ];
        })
        ->all();
}
```

Note `id` is the **code** (`CTC-004`), not the primary key — so a consumer wanting to open the contract needs to resolve it by code, unlike the CTC screens which ship `dbId`.

---

## 4. THE FOUR-BUCKET STATUS (`listStatus`)

```php
/** Approval lifecycle → CTC-list bucket (mirrors CtcContractController). */
private function listStatus(CtcContract $c): string
{
    if ($c->approval_status === 'rejected')        return 'rejected';
    if ($c->approval_status === 'clarification')   return 'clarify';      // ← EXTRA
    if ($c->stage >= 4 || $c->status === 'signed') return 'signed';
    return 'inprogress';
}
```

Side by side with the original it claims to mirror:

```php
// CtcContractController::listStatus() — THREE buckets
if ($c->approval_status === 'rejected')        return 'rejected';
if ($c->stage >= 4 || $c->status === 'signed') return 'signed';
return 'inprogress';                            // ← clarification lands HERE
```

| `approval_status` | Case to Case list | **Diagnosis Center** |
|---|---|---|
| `rejected` | `rejected` | `rejected` |
| **`clarification`** | `inprogress` | **`clarify`** |
| `approved` / `pending` | `inprogress` | `inprogress` |
| stage ≥ 4 / signed | `signed` | `signed` |

The docblock's "mirrors" is imprecise — it is a **superset**. Surfacing "waiting on a question" as its own bucket is exactly what a triage screen is for.

---

## 5. THE COUNTERPARTY BADGE

```php
/** First counterparty's display name + normalised role badge. */
private function primaryCounterparty(CtcContract $c): array
{
    $cps   = is_array($c->counterparties) ? $c->counterparties : [];
    $first = $cps[0] ?? [];                                  // ← the FIRST entry only
    return [
        'name' => (string) ($first['name'] ?? '—') ?: '—',
        'role' => $this->normaliseRole((string) ($first['badge'] ?? $first['source_type'] ?? '')),
    ];
}

/** Map a stored badge / source_type to one of Buyer | Supplier | Partner. */
private function normaliseRole(string $raw): string
{
    $r = mb_strtolower(trim($raw));
    if (str_contains($r, 'buy')  || $r === 'customer') return 'Buyer';
    if (str_contains($r, 'supp') || $r === 'vendor')   return 'Supplier';
    return 'Partner';
}
```

Compare with the Case-to-Case screen's richer mapping:

```php
// CtcContractController::cpRoleLabel()
if (str_contains($type,'consignee'))                     return 'Consignee';
if (str_contains($type,'supplier') || 'vendor')          return 'Supplier';
if (str_contains($type,'customer') || 'buyer')           return 'Customer';
return '';
```

| Counterparty | Case to Case | **Diagnosis Center** |
|---|---|---|
| Customer | `Customer` | `Buyer` |
| **Consignee** | `Consignee` | **`Partner`** ← falls through |
| Supplier | `Supplier` | `Supplier` |

Also note: `primaryCounterparty()` reads the **stored snapshot**. It does not call `resolveCounterparties()`, so a counterparty renamed in the Customer master will still show its old name here — unlike on the Case-to-Case screen, which refreshes from the live masters on every read.

---

## 6. ESCALATION (`escalate`)

```php
/**
 * Record a Resolution Center escalation for a blocked record. Returns an
 * ack; persistence is limited to an audit log line until a dedicated
 * escalations / notifications store lands.
 */
public function escalate(Request $request): JsonResponse
{
    $user = $request->user(); if (!$user) abort(401);

    $data = $request->validate([
        'reference'    => ['required', 'string', 'max:120'],
        'escalate_to'  => ['required', 'string', 'max:120'],
        'issue_type'   => ['required', 'string', 'max:120'],
        'priority'     => ['required', 'string', 'in:critical,high,medium,low'],
        'message'      => ['required', 'string', 'max:5000'],
        'notify_via'   => ['nullable', 'array'],
        'notify_via.*' => ['string', 'max:40'],
    ]);

    Log::info('CLM escalation raised', [
        'client_id' => $user->client_id,
        'by'        => $user->id,
    ] + $data);

    return response()->json([
        'status'  => true,
        'message' => 'Escalation recorded and the target has been notified.',
    ]);
}
```

**What actually happens:** validation, one `Log::info` line, a 200. That is the whole implementation.

**What does not happen:**
- No row is written — there is no escalations table.
- No notification is created.
- Nothing is sent over any `notify_via` channel.
- `reference` is not checked against a real record.

The returned message — *"the target has been notified"* — is currently aspirational. A 200 from this endpoint is **not** evidence that anyone was told.

---

## 7. THE SAME PATTERN NEXT DOOR

`ClmRegulatoryDefenseFileController` uses the identical injection technique over the identical pair of controllers:

```php
public function index(Request $request,
                      ClmBuyerProfileController $buyer,
                      ClmSupplierProfileController $supplier): JsonResponse
{
    $b = $buyer->index($request)->getData(true)['data'] ?? [];
    $s = $supplier->index($request)->getData(true)['data'] ?? [];
    return response()->json(['status'=>true, 'data'=>[
        'with_shipment'    => $this->withShipment($b, $cid),
        'without_shipment' => $this->withoutShipment($s),
        'case_to_case'     => $this->caseToCase($cid),
    ]]);
}
```

The difference: Diagnosis re-emits the profile blocks **verbatim**, while the RDF **reshapes** them into shipment-linked and procurement-wise rows.

---

## 8. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Method injection + in-process call | `index` | One aggregation, several screens, zero drift |
| `getData(true)['data'] ?? []` | `index` | Unwraps the envelope; degrades safely |
| Verbatim re-emission | `index` | The SPA reuses the profile screens' row components |
| Seven-column select | `ctcRows` | Avoids loading the heavy JSON blobs |
| Four-bucket status | `listStatus` | A triage screen must surface "waiting on a question" |
| Coarse role badge | `normaliseRole` | Buyer / Supplier / Partner is enough for triage |
| Stored counterparty snapshot | `primaryCounterparty` | No live-master refresh on this screen |
| Validate-then-log | `escalate` | Placeholder until an escalations store lands |

---

## 9. NOTES & CAVEATS

- **`escalate()` persists nothing but a log line**, despite a success message claiming the target was notified.
- `notify_via` is accepted and logged but never used to deliver anything.
- `ctcRows()` returns the contract **code** as `id`, not the numeric primary key.
- Counterparties are read from the stored snapshot — no live refresh.
- Consignees are badged **Partner** on this screen.
- Only the **first** counterparty is shown.
- `ctcRows()` is `client_id`-scoped but not branch-scoped.
- This endpoint carries the cost of **both** profile aggregations — the two heaviest reads in CLM — with no filters, pagination or cache.
- DB is PostgreSQL.

---

*Related documents: DIAGNOSIS_RESOLUTION_FUNCTIONAL_DOCUMENTATION.md · DIAGNOSIS_RESOLUTION_TECHNICAL_DOCUMENTATION.md · DIAGNOSIS_RESOLUTION_API_DOCUMENTATION.md*
