# AGREEMENTS WE SENT — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · Without Shipment ID → **Agreements We Sent**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: the list query → the sender's shaper → the approval count → responding to a clarification → the sender's other two actions.
File: [CtcContractController.php](../../../../app/Http/Controllers/Api/CtcContractController.php) — methods `sentIndex()`, `shapeSent()`, `approvalProgress()`, `respond()`.

---

## 1. THE LIST (`sentIndex`)

```php
/* ── Agreements We Sent (mine) ── */
public function sentIndex(Request $request)
{
    $user = $request->user(); if (!$user) abort(401);

    $rows = CtcContract::where('client_id', $user->client_id)
        ->where('created_by', $user->id)          // ← the ONLY additional filter
        ->orderByDesc('id')->get()
        ->map(fn ($c) => $this->shapeSent($c));

    return response()->json(['status'=>true, 'data'=>$rows]);
}
```

Compare with the sibling lists:

```php
// index() — Case to Case Contracts: BRANCH-FILTERED
$branchFilter = ($user->branch_id ?: null) ?: ($request->integer('branch_id') ?: null);
CtcContract::where('client_id',…)->when($branchFilter, fn($q)=>$q->where('branch_id',$branchFilter))

// sentIndex() — NO branch filter at all
// toApproveIndex() — filtered by approver_emails JSON containment
```

The missing branch predicate is deliberate: your own contracts are yours regardless of which branch they were raised under.

---

## 2. THE SENDER'S SHAPER (`shapeSent`)

```php
/** Agreements We Sent row. */
private function shapeSent(CtcContract $c): array
{
    $statusMap = ['approved'      => 'approved',
                  'rejected'      => 'rejected',
                  'clarification' => 'clarify',      // ← only `status` keeps this distinct
                  'pending'       => 'pending'];

    // headline verdict — clarification is FOLDED INTO pending
    $approval = $c->approval_status === 'clarification'
        ? 'pending'
        : ($c->approval_status ?: 'pending');

    [$approvedCount, $approverCount] = $this->approvalProgress($c);

    return [
        'id'        => $c->code,          'dbId'  => $c->id,
        'title'     => $c->title,
        'cp'        => $this->cpNames($c)        ?: ['—'],   // plain names
        'cpLabeled' => $this->cpNamesLabeled($c) ?: ['—'],   // "Royal Cashews (Customer)"
        'org'       => $c->org_name ?: '—',
        'date'      => $this->fmt($c->submitted_at ?: $c->created_at),
        'effDate'   => $this->fmt($c->eff_date),
        'endDate'   => $this->fmt($c->end_date),
        'createdBy' => $c->created_by_name ?: '—',
        'approver'  => $c->primary_approver_name ?: '—',     // SINGLE-name column only

        'approval'  => $approval,                             // pending|approved|rejected
        'status'    => $statusMap[$c->approval_status] ?? 'pending',  // …|clarify (tab bucket)

        'approvers'      => $this->istEntries($c->approvers ?? []),       // UTC → IST
        'approvedCount'  => $approvedCount,
        'approverCount'  => $approverCount,
        'clarifications' => $this->istEntries($c->clarifications ?? []),  // UTC → IST
        'rejReason'      => $c->rejection_reason,
        'expDate'        => $this->fmt($c->end_date),
    ];
}
```

### The two status fields
| Field | `approval_status = 'clarification'` | Answers |
|---|---|---|
| `approval` | → **`pending`** | *Is the contract decided?* |
| `status` | → **`clarify`** | *Which tab does it belong in?* |

A consumer that needs to know a clarification is open **must** read `status` — `approval` will say `pending`.

### Counterparty labelling
```php
/* Same as cpNames() but each name is suffixed with its entity type — "Royal Cashews
 * (Customer)" — so the +N counterparty popover tells the user whether a company is the
 * Customer, Consignee or Supplier (a company can appear as more than one role on the
 * same agreement). */
cpNamesLabeled($c) → resolveCounterparties($c) refreshed from the live masters,
                     then each name suffixed via cpRoleLabel()
```

---

## 3. THE APPROVAL COUNT (`approvalProgress`)

```php
/** Approval progress: [approvedCount, totalApprovers]. */
private function approvalProgress(CtcContract $c): array
{
    $approvers = array_values($c->approvers ?? []);
    $total     = count($approvers);
    $approved  = collect($approvers)
                   ->filter(fn ($a) => (($a['status'] ?? 'pending')) === 'approved')
                   ->count();
    return [$approved, $total];
}
```

This is the number the sender actually cares about, because the contract only flips to `approved` when `$approved >= $total` — see `approve()`:

```php
if ($approved >= $total) {
    $row->approval_status = 'approved';
    pushVersion("Approved by all {$total} approver(s)", 'Approved');
} else {
    $row->approval_status = 'pending';
    pushVersion("{$name} approved ({$approved} of {$total}) — awaiting remaining approvers",
                'Approving');
}
```

---

## 4. RESPONDING TO A CLARIFICATION (`respond`)

```php
/** Sender responds to the latest open clarification. */
public function respond(Request $request, int $id)
{
    $user = $request->user(); if (!$user) abort(401);
    $row  = CtcContract::where('client_id', $user->client_id)->findOrFail($id);
    //                  ^^^^^^^^^^^^^^^^^^^^ tenant-scoped ONLY — see §7

    $data = $request->validate(['response' => 'required|string|max:2000']);

    $thread = $row->clarifications ?? [];
    for ($i = count($thread) - 1; $i >= 0; $i--) {      // walk NEWEST first
        if (empty($thread[$i]['response'])) {
            $thread[$i]['response'] = $data['response'];
            /* Stamp WHEN the sender answered — distinct from the request's `date` so the
             * review timeline shows the real answer time instead of reusing the
             * "Clarification Requested" timestamp. */
            $thread[$i]['response_date'] = now()->format('d M Y H:i');   // UTC
            break;                                       // ← only ONE entry per call
        }
    }

    $row->update(['clarifications' => $thread]);
    $this->broadcastApproval($row->fresh());             // Reverb → the approver's screen
    return response()->json(['status'=>true, 'data'=>$this->shapeSent($row->fresh())]);
    //                                              ^^^^^^^^^^^^^^ the SENT shape —
    //                                              respond() is the only write that uses it
}
```

The thread entry ends up carrying **two** timestamps:
```json
{ "query": "Which entity signs on the consignee side?",
  "by": "Parth Shah",
  "date": "21 Jul 2026 11:30",            // when the question was raised
  "response": "Royal Logistics FZE — their MD signs.",
  "response_date": "21 Jul 2026 16:05",   // when the sender answered
  "resolved": false }
```

Note the counterpart, `clarify()`, is the **approver's** action and stamps `by` so a shared thread can attribute each remark:
```php
$thread[] = ['query'=>…, 'by'=>$user->name ?: 'Approver',
             'date'=>now()->format('d M Y H:i'), 'response'=>'', 'resolved'=>false];
$row->update(['approval_status'=>'clarification', 'clarifications'=>$thread]);
```

---

## 5. THE SENDER'S OTHER TWO ACTIONS

Both are shared with the Case to Case screen; see that walkthrough for the annotated code.

```php
resubmit($id):
    /* Revise the draft and re-send for internal review — used both after an INTERNAL
     * REJECTION and after a COUNTERPARTY DECLINED the e-sign. Either way the contract
     * re-enters Stage 2 approval (a decline cannot go straight back to Zoho), so any
     * live signing request is CLEARED. Repeatable. */
    pushVersion($wasDeclined
        ? 'Draft revised after counterparty decline & resubmitted for internal review'
        : 'Revised draft resubmitted for internal review', 'Under Review');
    → returns the raw row (not shapeSent)

sendForSigning($id):
    if ($row->approval_status !== 'approved')
        → 422 'Agreement must be approved before sending for signing.'
    $row->stage = 3;  signing_recipients stored with signed:false
    pushVersion('Agreement sent to counterparty for signature & negotiation', 'Sent for Signing');
```

---

## 6. TIMEZONE

```php
istEntries($arr) → CtcAuditTime::entries($arr)
// converts the `date` / `acted_at` fields inside versions, clarifications and approvers
// from stored UTC to Asia/Kolkata
```
`shapeSent()` runs it over **both** `approvers` and `clarifications`, so every timestamp the sender sees is already IST. The helper is centralised because `ClmSignatureController::ctcSignatureStatus()` feeds the same Review Timeline (CBC-574).

---

## 7. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| `created_by` filter, no branch filter | `sentIndex` | Your contracts are yours across branches |
| Two status fields | `shapeSent` | `approval` = decided?, `status` = which tab |
| `clarification` folded into `pending` | `$approval` | It is not a verdict |
| Counterparties role-labelled | `cpNamesLabeled` | One company can hold several roles |
| Live counterparty refresh | `resolveCounterparties` | Master edits flow through |
| `approvedCount / approverCount` | `approvalProgress` | All-must-approve makes the ratio meaningful |
| Newest-unanswered-only response | `respond` | Keeps the thread linear |
| Separate `response_date` | `respond` | The timeline needs the real answer time |
| `shapeSent()` returned by `respond()` | `respond` | The caller is always the sender |
| Deferred, guarded broadcast | `broadcastApproval` | Realtime is best-effort |

---

## 8. NOTES & CAVEATS

- **`respond()` is tenant-scoped only** — it does not verify that the caller is the contract's `created_by`. The UI only surfaces it on your own rows, but the endpoint itself would accept a call from any user in the tenant.
- `sentIndex()` applies **no branch filter**, unlike `index()`.
- `approver` in the response is the **primary** approver; the full list is `approvers[]`.
- Only the newest unanswered clarification can be answered; there is no out-of-order reply.
- `days_to_approve` / `reminder_days` are stored but no scheduler chases approvers.
- A sent contract cannot be withdrawn from approval — only revised and resubmitted.
- DB is PostgreSQL; `approvers`, `clarifications` and `versions` are real JSON columns.

---

*Related documents: AGREEMENTS_WE_SENT_FUNCTIONAL_DOCUMENTATION.md · AGREEMENTS_WE_SENT_TECHNICAL_DOCUMENTATION.md · AGREEMENTS_WE_SENT_API_DOCUMENTATION.md*
