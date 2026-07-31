# CASE TO CASE CONTRACTS (CTC) — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · Without Shipment ID → **Case to Case Contracts**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces the lifecycle in order: create → approve/reject/clarify/respond → resubmit → send for signing → record signature → repository, then the read model (counterparty refresh, shapes, timezone) and version download.
File: [CtcContractController.php](../../../../app/Http/Controllers/Api/CtcContractController.php).

---

## 1. CREATE (`store`)

```php
if (!$user->client_id) → 403 'No tenant context'

$data = validate([ title(required), agreement_type, org_name, org_short_code,
                   org_state, org_country, counterparties[], eff_date, end_date,
                   auto_renewal, renewal_type, content, header_config[], footer_config[],
                   approvers[], days_to_approve, reminder_days ]);

$this->assertCounterpartyCategories($data['counterparties'] ?? []);   // 422 on mismatch

/* Each approver carries its own decision so the contract only counts as approved once
 * EVERY selected approver has approved (see approve()). `status` starts 'pending';
 * `acted_at` stamps when they decide. */
$approvers = collect($data['approvers'] ?? [])->map(fn($a) => [
    'name'=>…, 'email'=>strtolower($a['email'] ?? ''), 'role'=>…,
    'mandatory'=>(bool)…, 'status'=>'pending', 'acted_at'=>null,
])->values();
$primary = $approvers->first();

$row = DB::transaction(function () use (…) {
    /* Per-BRANCH sequential code under a client row lock (same locking as Quotation/PI).
     * Branch-scoped so each branch restarts at CTC-001 instead of continuing the
     * client-wide tally — a fresh branch's first agreement is CTC-001, not CTC-007.
     * withTrashed() keeps the count gap-free across soft-deletes. Client-level creators
     * (branch_id null) share the unassigned-branch sequence. */
    DB::table('clients')->where('id',$user->client_id)->lockForUpdate()->first();
    $seq = CtcContract::withTrashed()->where('client_id',$cid)
             ->when($user->branch_id, fn($q)=>$q->where('branch_id',$user->branch_id),
                                      fn($q)=>$q->whereNull('branch_id'))->count() + 1;
    $code = sprintf('CTC-%03d', $seq);

    $v1 = [[ 'v'=>1,
             'label'=>'Agreement drafted & submitted for internal review',
             'status'=>'Under Review',
             'date'=>now()->format('d M Y H:i'),      // ← UTC; converted on read
             'by'=>$user->name, 'content'=>$data['content'] ?? null ]];

    return CtcContract::create([ …,
        'approvers'       => $approvers->all(),
        'approver_emails' => $approvers->pluck('email')->filter()->values()->all(),  // queryable
        'clarifications'  => [], 'versions' => $v1,
        'stage'           => 2,             // submitted → straight to Internal Review
        'approval_status' => 'pending',
        'status'          => 'inprogress',
        'submitted_at'    => now(),
        'primary_approver_name'/'primary_approver_email' => $primary,   // legacy slot
    ]);
});

$this->broadcastApproval($row);
→ 201 { data: shapeList($row), code: $row->code }
```

### `assertCounterpartyCategories(?array $cps)`
```php
/* Enforce the CTC counterparty category rule SERVER-SIDE (the client filter is a
 * convenience only): the Customer and the Consignee on one agreement must share ONE
 * category — both Domestic (India) or both International. Supplier is exempt (may be
 * either), and "Our Organisation" is not a counterparty. Throws 422 on mismatch. */
foreach ($rows as $cp) {
    $label = $this->cpRoleLabel($cp);                       // from source_type / role
    if ($label === '') {                                     // fall back to the display badge
        $badge = strtolower($cp['badge'] ?? '');
        if (str_contains($badge,'consignee')) $label = 'Consignee';
        elseif (str_contains($badge,'buyer') || str_contains($badge,'customer')) $label = 'Customer';
    }
    …
}
if ($customer === null || $consignee === null) return;       // the rule needs BOTH
if ($this->cpIsDomestic($customer) !== $this->cpIsDomestic($consignee))
    throw ValidationException::withMessages(['counterparties' =>
        "Customer and Consignee must be in the same category. Customer is {$custCat} but Consignee is {$consCat}."]);

// cpIsDomestic(): strtolower(trim($cp['country'])) === 'india'
```

---

## 2. APPROVE (`approve`) — the all-must-approve rule

```php
$row   = CtcContract::where('client_id',$cid)->findOrFail($id);
$email = strtolower($user->email);
$approvers = array_values($row->approvers ?? []);

// Legacy / no approver list → a single approval approves outright.
if (empty($approvers)) {
    $row->approval_status = 'approved'; $row->rejection_reason = null;
    pushVersion('Approved by …', 'Approved'); save; broadcast; return;
}

// Stamp THIS approver's decision (match by email; fall back to the primary slot).
foreach ($approvers as &$a)
    if (strtolower($a['email'] ?? '') === $email && $email !== '') {
        $a['status'] = 'approved'; $a['acted_at'] = now()->format('d M Y H:i'); $matched = true;
    }
if (!$matched && strtolower($row->primary_approver_email) === $email) { $approvers[0] … }
if (!$matched) → 403 'You are not an approver for this agreement.'

$row->approvers = $approvers;
$total    = count($approvers);
$approved = count where status === 'approved';

if ($approved >= $total) {
    // Everyone has approved → the contract is approved (stays at Stage 2; the sender
    // then chooses "Send for Signing & Negotiation").
    $row->approval_status = 'approved'; $row->rejection_reason = null;
    pushVersion("Approved by all {$total} approver(s)", 'Approved');
} else {
    // Still waiting on others → keep the round open. The audit note uses a NON-ROUND
    // status so approvalRoundsShaped() doesn't close it early.
    $row->approval_status = 'pending';
    pushVersion("{$name} approved ({$approved} of {$total}) — awaiting remaining approvers",
                'Approving');          // ← 'Approving', deliberately not 'Approved'
}
save; broadcastApproval; → shapeApprove($row->fresh(), $user->name)
```

---

## 3. REJECT · CLARIFY · RESPOND

```php
reject($id): validate(['reason'=>'required|max:1000']);
    stamp this approver 'rejected' + acted_at;
    /* One rejection blocks the whole agreement — record which approver declined, then
     * flip the contract to rejected. Rejected → the sender can revise & resubmit
     * (multiple times), so the row stays WORKABLE (status 'inprogress'); only
     * approval_status flips. */
    $row->approval_status = 'rejected';
    $row->status          = 'inprogress';        // ← NOT 'rejected'
    $row->rejection_reason = $data['reason'];
    pushVersion("Rejected by … — {$reason}", 'Rejected', …, ['reason'=>$reason]);

clarify($id): validate(['query'=>'required|max:2000']);
    // Stamp the raising approver so the SHARED thread can attribute each remark —
    // any of the contract's approvers may add to the same thread.
    $thread[] = ['query'=>…, 'by'=>$user->name ?: 'Approver',
                 'date'=>now()->format('d M Y H:i'), 'response'=>'', 'resolved'=>false];
    update(['approval_status'=>'clarification', 'clarifications'=>$thread]);

respond($id):  // the SENDER answers the latest OPEN clarification
    for ($i = count($thread)-1; $i >= 0; $i--)
        if (empty($thread[$i]['response'])) {
            $thread[$i]['response'] = $data['response'];
            // Stamp WHEN the sender answered — distinct from the request's `date` so the
            // review timeline shows the real answer time instead of reusing the
            // "Clarification Requested" timestamp.
            $thread[$i]['response_date'] = now()->format('d M Y H:i');
            break;
        }
    update(['clarifications'=>$thread]);  → shapeSent()
```

---

## 4. RESUBMIT

```php
/* POST /clm/ctc-contracts/{id}/resubmit
 * Revise the draft and re-send for internal review — used both after an INTERNAL
 * REJECTION and after a COUNTERPARTY DECLINED the e-sign. Either way the contract
 * re-enters Stage 2 approval (a decline cannot go straight back to Zoho), so any live
 * signing request is CLEARED. Repeatable. */
validate([ content?, title?, agreement_type?, header_config?, footer_config?,
           counterparties?, … ]);   // full-edit fields present on "Update & Send for
                                    // Approval"; absent on the lighter resubmit
$label = $wasDeclined
    ? 'Draft revised after counterparty decline & resubmitted for internal review'
    : 'Revised draft resubmitted for internal review';
pushVersion($label, 'Under Review', $user->name);
save; broadcastApproval;
```

---

## 5. SIGNING LIFECYCLE

```php
sendForSigning($id):
    if ($row->approval_status !== 'approved')
        → 422 'Agreement must be approved before sending for signing.'
    validate([ recipients[] (name required, email/role/contact optional), days_to_sign 1..365 ]);
    $row->signing_recipients = recipients each { name, email(lower), role, contact,
                                                signed:false, signed_at:null };
    $row->stage  = 3;  $row->status = 'inprogress';
    pushVersion('Agreement sent to counterparty for signature & negotiation', 'Sent for Signing');

recordSignature($id):
    /* Mark one recipient (by index/email) signed, or all at once. When every recipient
     * has signed, a "signed by all parties" version is added. */
    validate([ index?, email?, all? ]);
    if (!count($recipients)) → 422 'No signing recipients to mark.'
    all → every unsigned recipient stamped;  index → that slot;  email → matching slots;
    else → 422 'Specify which recipient signed.'
    if (every recipient signed) { $row->cp_signed_date = now();
                                  pushVersion('Agreement signed by all parties','Signed'); }
    → { data, allSigned }

moveToRepository($id):
    /* All parties signed → store in the Final Contract Repository (Stage 4). */
    if (!$allSigned) → 422 'All parties must sign before moving to the repository.'
    $row->stage = 4;  $row->status = 'signed';
    if (!$row->cp_signed_date) $row->cp_signed_date = now();
    pushVersion('Agreement stored in final contract repository', 'Signed');
```

---

## 6. THE READ MODEL

### List bucket
```php
/** Approval lifecycle → CTC-list bucket. */
private function listStatus(CtcContract $c): string
{
    if ($c->approval_status === 'rejected')            return 'rejected';
    if ($c->stage >= 4 || $c->status === 'signed')     return 'signed';
    return 'inprogress';
}
```
> `ClmDiagnosisResolutionController` uses a **superset** of this: it also maps `approval_status === 'clarification'` to its own `clarify` bucket.

### Counterparty refresh
```php
/* Refresh each stored counterparty against its LIVE source record (Customer / Consignee
 * / Vendor) by source_type + source_id, so edits made in those masters flow through to
 * the agreement. Only the FACTUAL fields (name, country, phone, email) are overlaid; the
 * user-set `referred` alias, `badge`, and the `source_*` reference keys are PRESERVED as
 * stored. Manual / legacy entries without a source reference keep their snapshot. */
resolveCounterparties($c) → array_map(fn($cp) => $live ? array_merge($cp,$live) : $cp, $cps);

/* Resolve a party model from a stored source_id by: numeric PK → code column → the
 * numeric id embedded in a "PREFIX-NNN" display-fallback code. That last step matters
 * for consignees stored as "CN-014" whose consignee_code column is null (the code is the
 * id-based fallback the UI shows), which would otherwise fail to resolve and surface as
 * an empty / "Not Applicable" company name in Stage 2 and in {{consignee.*}}. */
resolvePartyRow($q, $id, $codeCol):
    if (is_numeric($id))              return $q->find($id);
    if ($row = $q->where($codeCol,$id)->first()) return $row;
    return preg_match('/(\d+)\s*$/', $id, $m) ? $q->find((int)$m[1]) : null;
```

### Counterparty display
```php
/* Same as cpNames() but each name is suffixed with its entity type — "Royal Cashews
 * (Customer)" — so the +N counterparty popover tells the user whether a company is the
 * Customer, Consignee or Supplier (a company can appear as more than one role on the
 * same agreement). */
cpRoleLabel($cp):  source_type/role contains 'consignee' → 'Consignee'
                                        'supplier'|'vendor' → 'Supplier'
                                        'customer'|'buyer'  → 'Customer'
```

### Timezone
```php
/* Display timezone — timestamps are stored UTC and converted on read (same convention
 * as AttendanceController::DISPLAY_TZ). */
private const DISPLAY_TZ = 'Asia/Kolkata';

/* Delegates to CtcAuditTime — ClmSignatureController::ctcSignatureStatus() feeds the
 * SAME Review Timeline as show(), and when each controller kept its own copy of this
 * logic only one got fixed, so the timeline's times shifted by 5:30 as the SPA's poll
 * switched endpoints (CBC-574). */
istStr($s)     → CtcAuditTime::str($s);
istEntries($a) → CtcAuditTime::entries($a);   // converts `date` / `acted_at` in
                                              // versions, clarifications, approvers
```

### Append-only versions
```php
/** Append a content-snapshot version entry (append-only audit). */
pushVersion($c, $label, $status, $by, $content = null, $extra = []):
    $versions[] = array_merge([
        'v'=>count($versions)+1, 'label'=>…, 'status'=>…,
        'date'=>now()->format('d M Y H:i'), 'by'=>…,
        'content'=>$content !== null ? $content : $c->content,
    ], $extra);
```
Nothing is ever rewritten — which is what makes the audit trail trustworthy, and also why `versions` grows without bound on long contracts.

### Approval rounds
```php
/* Each approval round derived from the version audit, NEWEST FIRST. A round opens on
 * every "Under Review" submission (initial draft + resubmissions) and closes on the
 * approver's Rejected / Approved decision — so a draft that was rejected, revised and
 * approved yields THREE persistent entries (Rejected → Pending → Approved) instead of a
 * single row whose status keeps flipping. */
approvalRoundsShaped($c, $approverName, $approverEmail = '')
```
This is why partial approvals are logged with the status `'Approving'` rather than `'Approved'` — a round-closing status would end the round early.

---

## 7. REALTIME BROADCAST

```php
private function broadcastApproval(CtcContract $c): void
{
    app()->terminating(function () use ($c) {           // deferred until after the response
        try { broadcast(new CtcApprovalUpdated($c)); }
        catch (\Throwable $e) { report($e); }           // a Reverb outage never fails the request
    });
}
```
Fired by `store`, `approve`, `reject`, `clarify`, `respond` and `resubmit`.

---

## 8. VERSION DOWNLOAD

```php
downloadVersion($id, $v):
    /* Large agreements (200-300+ pages) blow past PHP's default 128M memory and 30s
     * execution cap while dompdf lays out every page, so the request 500s ("Could not
     * generate this version PDF"). Lift both for this render. */
    @ini_set('memory_limit','1024M'); @set_time_limit(300);

    $entry = collect($row->versions)->firstWhere('v', $v);   // 404 when absent
    → renders the snapshot's `content` through pdf.clm-signature-document
      (page shell + footer page numbers), or renderVersionDocx() for Word
```

---

## 9. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| `count()+1` with `withTrashed()` | code allocation | Soft deletes must not create gaps |
| Per-approver `status` + `acted_at` | `approve`/`reject` | X-of-Y progress survives reloads and is queryable |
| `'Approving'` for partial approvals | `approve` | A round-closing status would end the round early |
| Rejection keeps `status = inprogress` | `reject` | The sender must be able to revise and resubmit |
| `response_date` distinct from `date` | `respond` | The timeline shows the real answer time |
| Resubmit clears the signing request | `resubmit` | A decline can never go straight back to Zoho |
| Append-only `versions` | `pushVersion` | Trustworthy audit trail |
| `CtcAuditTime` centralised | `istStr`/`istEntries` | Two endpoints, one timeline (CBC-574) |
| Live counterparty overlay | `resolveCounterparties` | Master edits flow through; user aliases survive |
| Three-step party resolution | `resolvePartyRow` | Handles PK, code column and `PREFIX-NNN` fallbacks |
| Deferred, guarded broadcast | `broadcastApproval` | Realtime is best-effort |
| Raised memory/time for renders | `downloadVersion` | 300-page contracts otherwise 500 |

---

## 10. NOTES & CAVEATS

- Lookups are `where('client_id', …)->findOrFail()` — tenant-scoped but **not** branch-scoped or `MasterVisibility`-gated.
- Approval authorisation is by **email match**; there is no role or hierarchy routing.
- `days_to_approve`, `reminder_days` and `days_to_sign` are stored but **no scheduler enforces them**.
- `recordSignature` / `moveToRepository` are manual, sender-driven actions.
- `versions` grows without pruning.
- Audit timestamps are written UTC as formatted strings and parsed back on read — the format is part of the contract with `CtcAuditTime`.
- DB is PostgreSQL; all the rich fields are real JSON columns.

---

*Related documents: CASE_TO_CASE_FUNCTIONAL_DOCUMENTATION.md · CASE_TO_CASE_TECHNICAL_DOCUMENTATION.md · CASE_TO_CASE_API_DOCUMENTATION.md*
