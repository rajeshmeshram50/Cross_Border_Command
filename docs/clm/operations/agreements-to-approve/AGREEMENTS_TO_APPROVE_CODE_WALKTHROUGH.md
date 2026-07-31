# AGREEMENTS TO APPROVE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Operations · Without Shipment ID → **Agreements To Approve**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: the inbox query → building rounds from the version audit → the personal open round → the projection → approve / reject / clarify.
File: [CtcContractController.php](../../../../app/Http/Controllers/Api/CtcContractController.php) — methods `toApproveIndex()`, `approvalRoundsShaped()`, `myApproverStatus()`, `approverList()`, `approve()`, `reject()`, `clarify()`.

---

## 1. THE INBOX QUERY (`toApproveIndex`)

```php
/* ── Agreements To Approve (I'm an approver) ── */
public function toApproveIndex(Request $request)
{
    $user  = $request->user(); if (!$user) abort(401);
    $email = strtolower((string) $user->email);

    $rows = CtcContract::where('client_id', $user->client_id)
        ->where(function ($w) use ($email) {
            $w->whereJsonContains('approver_emails', $email)   // ← the denormalised array
              ->orWhere('primary_approver_email', $email);     // ← legacy single slot
        })
        ->orderByDesc('id')->get()
        ->flatMap(fn ($c) => $this->approvalRoundsShaped($c, $user->name ?? '', $user->email ?? ''))
        // One row per CTC — keep only the latest round (rounds come back newest-first,
        // so the first occurrence of each code is the latest).
        ->unique('id')
        ->values();

    return response()->json(['status'=>true, 'data'=>$rows->values()]);
}
```

Three design points:

1. **`approver_emails` exists for this query.** At `store()` time the approver array is flattened:
   ```php
   'approvers'       => $approvers->all(),                                   // objects
   'approver_emails' => $approvers->pluck('email')->filter()->values()->all(), // flat, queryable
   ```
   `whereJsonContains` cannot search an array of objects, hence the denormalised copy.
2. **No branch filter.** `index()` applies one; this list does not — being named an approver is what matters, not which branch raised the contract.
3. **`flatMap` → `unique('id')`.** `approvalRoundsShaped()` returns *every* round; the de-dup keeps the first occurrence, which (because rounds come back newest-first) is the latest.

---

## 2. BUILDING ROUNDS FROM THE VERSION AUDIT (`approvalRoundsShaped`)

```php
/* Each approval round derived from the version audit, newest first. A round opens on
 * every "Under Review" submission (initial draft + resubmissions) and closes on the
 * approver's Rejected / Approved decision — so a draft that was rejected, revised and
 * approved yields THREE persistent entries (Rejected → Pending → Approved) instead of a
 * single row whose status keeps flipping. */

$reasonFromLabel = fn(string $label) =>
    preg_match('/—\s*(.+)$/u', $label, $m) ? trim($m[1]) : null;
//  rejection labels are written "Rejected by X — <reason>", so the reason can be
//  recovered from the label when an older entry has no structured `reason` key

$rounds = [];  $cur = null;

foreach (array_values($c->versions ?? []) as $v) {
    $st = $v['status'] ?? '';

    if ($st === 'Under Review') {                    // ── a round OPENS
        if ($cur) $rounds[] = $cur;                  //    (flush an unclosed one)
        $cur = ['status'=>'pending', 'date'=>$v['date'] ?? null, 'reason'=>null];

    } elseif ($st === 'Rejected') {                  // ── a round CLOSES
        $entry = ['status'=>'rejected',
                  'date'  =>$v['date'] ?? ($cur['date'] ?? null),
                  'reason'=>$v['reason'] ?? $reasonFromLabel((string)($v['label'] ?? ''))];
        $rounds[] = $cur ? array_merge($cur, $entry) : $entry;
        $cur = null;

    } elseif ($st === 'Approved') {                  // ── a round CLOSES
        $entry = ['status'=>'approved',
                  'date'=>$v['date'] ?? ($cur['date'] ?? null), 'reason'=>null];
        $rounds[] = $cur ? array_merge($cur, $entry) : $entry;
        $cur = null;
    }
    // 'Sent for Signing' / 'Signed' are post-approval — ignored here.
}
```

### Which version statuses matter
| Version `status` | Effect on rounds |
|---|---|
| `Under Review` | **Opens** a round (initial draft + every resubmission) |
| `Approved` | **Closes** the round as approved |
| `Rejected` | **Closes** the round as rejected, carrying the reason |
| **`Approving`** | **Ignored** — this is the partial-approval note; treating it as a close would end the round early |
| `Sent for Signing` · `Signed` | Ignored — post-approval |

That is precisely why `approve()` writes `'Approving'` rather than `'Approved'` for a partial nod:
```php
} else {
    // Still waiting on others → keep the round open. The audit note uses a NON-ROUND
    // status so approvalRoundsShaped() doesn't close it early.
    pushVersion("{$name} approved ({$approved} of {$total}) — awaiting remaining approvers",
                'Approving');
}
```

---

## 3. THE OPEN ROUND IS **PERSONAL**

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

**This is the module's defining behaviour.** The row's `status` answers *"what did I decide?"*, not *"what is the contract waiting on?"*. The contract-wide X-of-Y lives on the sender's screen (`shapeSent()` → `approvedCount` / `approverCount`).

```php
private function myApproverStatus(CtcContract $c, string $email): ?string
{
    $email = strtolower(trim($email));
    if ($email === '') return null;
    foreach (array_values($c->approvers ?? []) as $a)
        if (strtolower($a['email'] ?? '') === $email) return $a['status'] ?? 'pending';
    // Legacy rows that only stored the primary approver slot.
    if (strtolower($c->primary_approver_email) === $email && isset($approvers[0]))
        return $approvers[0]['status'] ?? 'pending';
    return null;
}
```

---

## 4. THE LEGACY FALLBACK

```php
if (empty($rounds)) {                    // legacy rows w/o audit
    $shaped = $this->shapeApprove($c, $approverName);
    $mine   = $this->myApproverStatus($c, $approverEmail);
    if      ($mine === 'approved') $shaped['status'] = 'approved';
    elseif  ($mine === 'rejected') $shaped['status'] = 'rejected';
    return [$shaped];
}
```
Contracts predating the version audit still produce exactly one row, with the same personal-status override applied.

---

## 5. THE PROJECTION

```php
return collect(array_reverse($rounds))->map(fn ($r) => [
    'id'        => $c->code,
    'dbId'      => $c->id,
    'title'     => $c->title,
    'date'      => $r['date'] ? $this->istStr($r['date'])          // UTC → IST
                              : $this->fmt($c->submitted_at ?: $c->created_at),
    'createdBy' => $c->created_by_name ?: '—',
    'approver'  => $c->primary_approver_name ?: $approverName,
    'approvers' => $this->approverList($c),        // EVERYONE's decision, for display
    'status'    => $r['status'],                    // ← MY decision
    /* Keep the full clarification history visible across rounds (it was only surfaced
     * while the round itself sat in 'clarification', so it looked deleted once the
     * agreement moved on — the data was never lost). */
    'clarifications' => $this->istEntries($c->clarifications ?? []),
    'expDate'   => $this->fmt($c->end_date),
    'rejReason' => $r['reason'] ?? null,
])->all();
```

`array_reverse` makes the rounds newest-first, which is what lets `unique('id')` upstream keep the latest.

```php
/* Every approver on this contract with their individual decision — so the UI can list
 * all of them (Parth: approved, Vedant: approved) instead of only the static primary
 * approver. Falls back to the primary slot for legacy rows that never stored a list. */
private function approverList(CtcContract $c): array
{
    if (empty($approvers)) return $c->primary_approver_name
        ? [['name'=>$c->primary_approver_name, 'status'=>$c->approval_status ?: 'pending']] : [];
    return array_map(fn($a) => ['name'=>$a['name'] ?? '—', 'status'=>$a['status'] ?? 'pending'],
                     $approvers);
}
```

---

## 6. APPROVE

```php
$row   = CtcContract::where('client_id',$cid)->findOrFail($id);
$email = strtolower($user->email);
$approvers = array_values($row->approvers ?? []);

// Legacy / no approver list → single approval approves outright.
if (empty($approvers)) { approval_status = 'approved'; pushVersion(…,'Approved'); return; }

// Stamp THIS approver's decision (match by email; fall back to the primary slot).
foreach ($approvers as &$a)
    if (strtolower($a['email'] ?? '') === $email && $email !== '') {
        $a['status']   = 'approved';
        $a['acted_at'] = now()->format('d M Y H:i');     // UTC; converted on read
        $matched = true;
    }
if (!$matched && strtolower($row->primary_approver_email) === $email) { $approvers[0] … }
if (!$matched) → 403 'You are not an approver for this agreement.'      // ← re-verified

$total    = count($approvers);
$approved = count where status === 'approved';

if ($approved >= $total) {
    // Everyone has approved → the contract is approved (stays at Stage 2; the sender
    // then chooses "Send for Signing & Negotiation").
    $row->approval_status = 'approved';  $row->rejection_reason = null;
    pushVersion("Approved by all {$total} approver(s)", 'Approved');     // CLOSES the round
} else {
    $row->approval_status = 'pending';
    pushVersion("… approved ({$approved} of {$total}) — awaiting remaining approvers",
                'Approving');                                            // does NOT close it
}
save; broadcastApproval; → shapeApprove($row->fresh(), $user->name)
```

The list filter is **not** the only guard — `approve()` re-verifies membership and 403s otherwise.

---

## 7. REJECT

```php
validate(['reason' => 'required|string|max:1000']);

// stamp THIS approver 'rejected' + acted_at
/* One rejection blocks the whole agreement — record which approver declined, then flip
 * the contract to rejected. Rejected → sender can revise & resubmit (multiple times),
 * so the row stays WORKABLE (status 'inprogress'); only approval_status flips. */
$row->approval_status  = 'rejected';
$row->status           = 'inprogress';        // ← NOT 'rejected'
$row->rejection_reason = $data['reason'];
pushVersion('Rejected by ' . $user->name . ' — ' . $reason, 'Rejected', …, ['reason'=>$reason]);
//           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^ the label format
//           reasonFromLabel() parses reads back from
save; broadcastApproval; → shapeApprove(…)
```

---

## 8. CLARIFY

```php
validate(['query' => 'required|string|max:2000']);
$thread = $row->clarifications ?? [];
// Stamp the raising approver so the shared thread can attribute each remark —
// any of the contract's approvers may add to the same thread.
$thread[] = ['query'    => $data['query'],
             'by'       => $user->name ?: 'Approver',
             'date'     => now()->format('d M Y H:i'),
             'response' => '',
             'resolved' => false];
$row->update(['approval_status' => 'clarification', 'clarifications' => $thread]);
$this->broadcastApproval($row->fresh());
→ shapeApprove($row->fresh(), $user->name)
```

> Unlike `approve()` and `reject()`, **`clarify()` does not re-verify approver membership** — it is tenant-scoped only.

The sender's counterpart, `respond()`, fills the newest unanswered entry and stamps a separate `response_date`.

---

## 9. WORKED EXAMPLE — the three-round trail

A contract drafted, rejected, revised, then fully approved produces this `versions[]`:

| v | label | status | Round effect |
|---|---|---|---|
| 1 | Agreement drafted & submitted for internal review | `Under Review` | **opens** round A |
| 2 | Rejected by Parth Shah — Clause 7 conflicts… | `Rejected` | **closes** A as `rejected` (reason captured) |
| 3 | Revised draft resubmitted for internal review | `Under Review` | **opens** round B |
| 4 | Parth Shah approved (1 of 2) — awaiting remaining approvers | `Approving` | *ignored* — B stays open |
| 5 | Approved by all 2 approvers | `Approved` | **closes** B as `approved` |

`approvalRoundsShaped()` returns `[A(rejected), B(approved)]`, reversed to `[B, A]`. `unique('id')` keeps **B** — the latest round — so the inbox shows one row with status `approved`.

Had version 5 not yet been written, round B would be open, and its status would come from **your** slot: `approved` if you had already nodded, otherwise `pending` (or `clarification` if one were live).

---

## 10. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| `approver_emails` denormalised at create | `store` | `whereJsonContains` cannot search an array of objects |
| No branch filter | `toApproveIndex` | Being named an approver is what matters |
| `flatMap` → `unique('id')` | `toApproveIndex` | All rounds → the latest round per contract |
| Rounds derived from `versions[]` | `approvalRoundsShaped` | A rejected-then-approved history stays legible |
| `'Approving'` outside the round set | `approve` | A partial nod must not close the round |
| Open round reflects **my** decision | `approvalRoundsShaped` | Personal inbox semantics |
| Clarification history on **every** round | projection | It only *looked* deleted before |
| `reasonFromLabel()` | `approvalRoundsShaped` | Recovers reasons from older label-only entries |
| Membership re-verified in `approve`/`reject` | write actions | The list filter is not the only guard |
| Deferred, guarded broadcast | `broadcastApproval` | Realtime is best-effort |

---

## 11. NOTES & CAVEATS

- **`clarify()` does not re-verify approver membership** — it is tenant-scoped only.
- Authorisation is by **email**; changing a user's email detaches them from contracts naming the old one.
- Round detection depends on the literal version status strings; adding a new one to `pushVersion()` without updating `approvalRoundsShaped()` would silently break round boundaries.
- `whereJsonContains` relies on PostgreSQL JSON containment.
- Only the latest round is listed; earlier rounds are reachable through Version History.
- `days_to_approve` / `reminder_days` are stored but no scheduler chases approvers.
- All dates are IST-converted on read via `CtcAuditTime`.

---

*Related documents: AGREEMENTS_TO_APPROVE_FUNCTIONAL_DOCUMENTATION.md · AGREEMENTS_TO_APPROVE_TECHNICAL_DOCUMENTATION.md · AGREEMENTS_TO_APPROVE_API_DOCUMENTATION.md*
