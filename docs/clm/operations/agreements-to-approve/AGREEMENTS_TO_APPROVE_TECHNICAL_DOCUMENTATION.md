# AGREEMENTS TO APPROVE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · Without Shipment ID → **Agreements To Approve**

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
One list endpoint — `CtcContractController::toApproveIndex()` — plus the three approver write actions (`approve`, `reject`, `clarify`) and the round-builder `approvalRoundsShaped()`. It has **no table of its own**: it is an `approver_emails`-filtered projection of `ctc_contracts`, reshaped **from the version history** rather than from the row's current columns.

That is the architectural distinction from the sibling lists:

| Method | Built from | Screen |
|---|---|---|
| `index()` | the row's current columns | Case to Case Contracts |
| `sentIndex()` | the row's current columns | Agreements We Sent |
| **`toApproveIndex()`** | **the `versions[]` audit trail** | **Agreements To Approve** |

### 1.2 High-Level Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  CLIENT                                                               │
│  pages/clm/operations/ClmAgreementsToApprovePage.tsx                  │
│    tabs(pending|approved|rejected|clarification) ← MY status          │
│    approver list · clarification thread + ask box ·                   │
│    VersionHistoryModal · AgreementTimelineModal                       │
│    subscribes to CtcApprovalUpdated                                   │
└──────────────────────────────┬───────────────────────────────────────┘
        GET  /api/clm/ctc-contracts/to-approve
        POST /api/clm/ctc-contracts/{id}/approve | /reject | /clarify
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  APPLICATION — CtcContractController                                  │
│   toApproveIndex()                                                    │
│     whereJsonContains('approver_emails', $email)                      │
│       OR primary_approver_email = $email                              │
│     → flatMap(approvalRoundsShaped) → unique('id') → latest round only│
│                                                                       │
│   approvalRoundsShaped()  walks versions[] into rounds;               │
│                           the OPEN round reflects MY decision         │
│   myApproverStatus()      my slot's status, by email                  │
│   approverList()          everyone's decision, for display            │
│   approve() reject() clarify()   ← 403 when not a named approver      │
└──────────────────────────────┬───────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DATA — ctc_contracts (no table of its own)                           │
│    approver_emails[] (queryable) · approvers[] · versions[] ·         │
│    clarifications[] · approval_status · rejection_reason              │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/CtcContractController.php
    toApproveIndex() · approvalRoundsShaped() · myApproverStatus() ·
    approverList() · shapeApprove() · approve() · reject() · clarify()
app/Support/CtcAuditTime.php
app/Events/CtcApprovalUpdated.php
resources/js/pages/clm/operations/ClmAgreementsToApprovePage.tsx
resources/js/pages/clm/operations/clmCtcModals.tsx
resources/js/pages/clm/operations/clmOpsData.ts     (the AtaContract type)
```
No migration — see [case-to-case](../case-to-case/CASE_TO_CASE_TECHNICAL_DOCUMENTATION.md) for the `ctc_contracts` schema.

---

## 2. TECHNOLOGY STACK

| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · **PostgreSQL JSON containment** (`whereJsonContains`) · Sanctum |
| Realtime | Laravel Reverb — `CtcApprovalUpdated` |
| Frontend | React 19 · TS · violet operations theme (`useOpsTheme`) |

---

## 3. DATA MODEL (the columns this screen depends on)

| Column | Role here |
|---|---|
| **`approver_emails`** (json) | **The filter.** A flat array of lower-cased emails, denormalised from `approvers[]` at create time purely so this list can be queried with a JSON containment check |
| `primary_approver_email` | Legacy fallback for rows created before the approver array existed |
| `approvers` (json) | `[{name, email, role, mandatory, status, acted_at}]` — the per-approver decisions |
| **`versions`** (json) | **The row source.** Rounds are derived from the `status` field of each entry |
| `clarifications` (json) | The shared thread, attached to every round |
| `approval_status` | Resolves the open round when you have not acted yet |
| `rejection_reason` | Fallback reason on legacy rows |

---

## 4. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get ('/clm/ctc-contracts/to-approve',   [CtcContractController::class,'toApproveIndex']);
    Route::post('/clm/ctc-contracts/{id}/approve', [… 'approve'])->whereNumber('id');
    Route::post('/clm/ctc-contracts/{id}/reject',  [… 'reject'])->whereNumber('id');
    Route::post('/clm/ctc-contracts/{id}/clarify', [… 'clarify'])->whereNumber('id');
});
```
`/to-approve` is declared **before** the generic `/{id}` route. Full detail in **AGREEMENTS_TO_APPROVE_API_DOCUMENTATION.md**.

---

## 5. CONTROLLER ANALYSIS

### `toApproveIndex()`
```php
$email = strtolower((string) $user->email);

$rows = CtcContract::where('client_id', $user->client_id)
    ->where(function ($w) use ($email) {
        $w->whereJsonContains('approver_emails', $email)      // the denormalised array
          ->orWhere('primary_approver_email', $email);        // legacy single slot
    })
    ->orderByDesc('id')->get()
    ->flatMap(fn ($c) => $this->approvalRoundsShaped($c, $user->name ?? '', $user->email ?? ''))
    // One row per CTC — keep only the LATEST round (rounds come back newest-first,
    // so the first occurrence of each code is the latest).
    ->unique('id')
    ->values();
```

Three things to note:
1. **No branch filter** — being named an approver is what matters, not which branch raised the contract.
2. `approver_emails` exists solely to make this query possible; `approvers[]` is an array of objects and cannot be searched with containment.
3. `flatMap` → `unique('id')` is how "all rounds" collapses to "the latest round per contract".

### `approvalRoundsShaped($c, $approverName, $approverEmail)`
```php
/* Each approval round derived from the version audit, NEWEST FIRST. A round opens on
 * every "Under Review" submission (initial draft + resubmissions) and closes on the
 * approver's Rejected / Approved decision — so a draft that was rejected, revised and
 * approved yields THREE persistent entries (Rejected → Pending → Approved) instead of a
 * single row whose status keeps flipping. */

foreach ($c->versions as $v) {
    switch ($v['status']) {
        case 'Under Review':  // a round OPENS
            if ($cur) $rounds[] = $cur;
            $cur = ['status'=>'pending', 'date'=>$v['date'], 'reason'=>null];
            break;
        case 'Rejected':      // a round CLOSES
            $rounds[] = merge($cur, ['status'=>'rejected', 'date'=>…,
                                     'reason'=>$v['reason'] ?? reasonFromLabel($v['label'])]);
            $cur = null;
            break;
        case 'Approved':      // a round CLOSES
            $rounds[] = merge($cur, ['status'=>'approved', 'date'=>…, 'reason'=>null]);
            $cur = null;
            break;
        // 'Sent for Signing' / 'Signed' are POST-approval — ignored here.
        // 'Approving' (a partial approval) is deliberately NOT a round status,
        //   so a partial approval does not close the round early.
    }
}
```

Note `reasonFromLabel()`: rejection labels are written as `"Rejected by X — <reason>"`, so the reason can be recovered from the label with `/—\s*(.+)$/u` when the structured `reason` key is absent on an older entry.

### The open round is personal
```php
if ($cur) {
    /* Open round — reflect THIS approver's own decision first (personal inbox view):
     * once they've approved their slot the row moves to their Approved tab even while
     * other approvers are still pending. Otherwise surface a live clarification state,
     * else stay pending. */
    $mine = $this->myApproverStatus($c, $approverEmail);
    if      ($mine === 'approved')                    $cur['status'] = 'approved';
    elseif  ($mine === 'rejected')                    $cur['status'] = 'rejected';
    elseif  ($c->approval_status === 'clarification') $cur['status'] = 'clarification';
    $rounds[] = $cur;
}
```

**This is the module's defining behaviour**: the row's `status` is the viewer's own decision, not the contract's.

### Legacy fallback
```php
if (empty($rounds)) {            // legacy rows with no version audit
    $shaped = $this->shapeApprove($c, $approverName);
    $mine   = $this->myApproverStatus($c, $approverEmail);
    if ($mine === 'approved') $shaped['status'] = 'approved';
    elseif ($mine === 'rejected') $shaped['status'] = 'rejected';
    return [$shaped];
}
```

### The final projection
```php
return collect(array_reverse($rounds))->map(fn ($r) => [
    'id'        => $c->code,   'dbId' => $c->id,   'title' => $c->title,
    'date'      => $r['date'] ? $this->istStr($r['date'])
                              : $this->fmt($c->submitted_at ?: $c->created_at),
    'createdBy' => $c->created_by_name ?: '—',
    'approver'  => $c->primary_approver_name ?: $approverName,
    'approvers' => $this->approverList($c),          // everyone's decision, for display
    'status'    => $r['status'],                      // ← MY status
    /* Keep the full clarification history visible ACROSS rounds (it was only surfaced
     * while the round itself sat in 'clarification', so it looked deleted once the
     * agreement moved on — the data was never lost). */
    'clarifications' => $this->istEntries($c->clarifications ?? []),
    'expDate'   => $this->fmt($c->end_date),
    'rejReason' => $r['reason'] ?? null,
])->all();
```
`array_reverse` is what makes the rounds newest-first, which in turn makes `unique('id')` keep the latest.

### `myApproverStatus()` and `approverList()`
```php
myApproverStatus($c, $email):
    match by lower-cased email in approvers[] → its `status`
    fallback: primary_approver_email matches → approvers[0]['status']
    else null

approverList($c):
    /* Every approver on this contract with their individual decision — so the UI can
     * list all of them (Parth: approved, Vedant: approved) instead of only the static
     * primary approver. Falls back to the primary slot for legacy rows. */
    → [['name'=>…, 'status'=>…], …]
```

---

## 6. THE THREE WRITE ACTIONS

| Action | Guard | Effect |
|---|---|---|
| `approve()` | must be a named approver (email) else **403** | Stamps your slot; contract flips only at `approved >= total`; partial writes an `'Approving'` audit note |
| `reject()` | `reason` required (max 1000) | Stamps your slot; `approval_status = rejected`; **`status` stays `inprogress`** so the sender can revise |
| `clarify()` | `query` required (max 2000) | Appends to the shared thread stamped with your name; `approval_status = clarification` |

All three call `broadcastApproval()` and return `shapeApprove($row->fresh(), $user->name)`.

---

## 7. FRONTEND — `ClmAgreementsToApprovePage.tsx`

- Tabs filter on the response's `status` — i.e. **your** decision.
- The approver panel renders `approvers[]` so you can see who else has acted.
- The clarification panel renders the full thread and offers an "ask" box.
- `rejReason` drives the rejection banner on a rejected round.
- Subscribes to `CtcApprovalUpdated` for live refresh.
- The SPA's `AtaContract` type maps 1:1 onto this projection.

---

## 8. INTEGRATIONS

| Integration | How |
|---|---|
| **Agreements We Sent** | The mirror screen — your decision here changes the sender's X-of-Y there |
| **Case to Case Contracts** | Same table; contracts originate there |
| **Reverb** | `CtcApprovalUpdated` fires on every approver action |
| **CtcAuditTime** | Converts round dates, `approvers[].acted_at` and the clarification thread from UTC to IST |

---

## 9. SECURITY & CAVEATS

1. The list is tenant-scoped **and** approver-scoped, so it cannot leak a contract you are not an approver on.
2. `approve()` and `reject()` **re-verify** the approver by email and return **403** otherwise — the list filter is not the only guard.
3. `clarify()` does **not** re-verify approver membership — it is tenant-scoped only, so any user in the tenant could append to the thread if they called the endpoint directly.
4. **No branch filter** — being named an approver is what matters.
5. Authorisation is by **email**, so changing a user's email address silently detaches them from contracts that named the old one.
6. Round detection depends on the literal version `status` strings `'Under Review'`, `'Approved'`, `'Rejected'`. The partial-approval status `'Approving'` is deliberately outside that set; adding a new status string to `pushVersion()` without updating `approvalRoundsShaped()` would silently break round boundaries.
7. `whereJsonContains` requires PostgreSQL JSON containment — the query is not portable to a schema that stores `approver_emails` as text.
8. Only the latest round is listed; earlier rounds are reachable through Version History.

---

## 10. METRICS

| Metric | Value |
|---|---|
| Endpoints | 1 list + 3 write actions |
| Own tables | 0 |
| Row source | **`versions[]`**, not the row's current columns |
| Filter | `whereJsonContains('approver_emails', email)` OR legacy primary slot |
| Branch filter | **none** |
| Rows per contract | 1 (the latest round) |
| Round statuses | `pending` · `approved` · `rejected` · `clarification` |
| Permission slug | `clm.agreements_to_approve` |
| Realtime | `CtcApprovalUpdated` |
| Test coverage | none automated |

---

*Related documents: AGREEMENTS_TO_APPROVE_FUNCTIONAL_DOCUMENTATION.md · AGREEMENTS_TO_APPROVE_CODE_WALKTHROUGH.md · AGREEMENTS_TO_APPROVE_API_DOCUMENTATION.md*
