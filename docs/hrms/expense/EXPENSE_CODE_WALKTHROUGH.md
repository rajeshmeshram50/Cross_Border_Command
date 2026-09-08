# EXPENSE MANAGEMENT MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Expense Management
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |
| 2.0 | 2026-09-08 | System | Settlement, batch payment, company-advance settlement, returns, reimbursement, recovery ledger. Corrected file limits, the no-manager path and bimonthly recovery. |

---

## 0. HOW TO READ

Traces run in execution order: **raise → manager stage → HR stage → sanction → pay → (advances) settle / return / reimburse → payroll recovery**.

Files: `ExpenseClaimController.php`, `AdvanceRequestController.php`, `PayrollService.php`, `OnboardingGuard.php`, `HrExpenseManagement.tsx`, `ExpenseSettlementModal.tsx`, `ExpenseTab.tsx`.

Code below is condensed to the decisions that matter — guard order, the rules, and why each exists.

---

## 1. RAISE A CLAIM

### `ExpenseClaimController::store()`

```php
// 1. WHOSE claim. A request-supplied employee_id is NOT trusted for ordinary
//    users: resolveEmployeeId() returns any numeric id verbatim, so a stale SPA
//    value would resolve to someone else and trip a confusing "not your record".
if ($user->user_type === 'super_admin') {
    $employeeId = $this->resolveEmployeeId($request->employee_id, $request->employee_code, $user)
                  ?: $this->currentEmployeeId($user);
} else {
    $employeeId = $this->currentEmployeeId($user) ?: $this->resolveEmployeeId(...);
}
if (!$employeeId)                          abort(422, 'No linked Employee record…');
if (!$employee = Employee::find($employeeId)) abort(404);
if (!super_admin && $employee->user_id !== $user->id)
    abort(403, 'You can only file claims for your own employee record.');

// 2. Raise-time gates — both reachable because /profile stays open mid-onboarding.
OnboardingGuard::assertComplete($employee, 'raise an expense claim', $isSelf);   // 422
if ($employee->date_of_joining > today())  return 422;                          // CBC #32

// 3. CRLF fold — multipart serialises textarea newlines as \r\n, so a purpose the
//    user typed within the on-screen 500 arrives longer and trips max:500 (QA #89).
$request->merge(['purpose' => str_replace("\r\n", "\n", $request->purpose)]);

$data = $request->validate([
  'title'          => 'required|max:255',
  'amount'         => 'required|numeric|min:0|max:9999999999999.99',   // fits decimal(18,2)
  'expense_date'   => 'required|date|before_or_equal:today|after_or_equal:'.now()->subDays(30),
  'payment_method' => 'required|max:64',                               // finance reconciles on it
  'purpose'        => 'nullable|max:500',                              // CBC #57 layout
  'files'          => 'required|array|min:1',
  'files.*'        => 'file|max:2048|mimes:pdf,jpg,jpeg,png',          // 2 MB EACH
  'reimbursement_for_advance_id' => 'nullable|integer',
]);

// 4. Whole-claim ceiling — keeps the multipart POST under PHP's post_max_size,
//    which otherwise fails as an opaque "Post data too long".
if ($totalBytes > 5 * 1024 * 1024) throw ValidationException(['files' => ['…keep the claim under 5 MB.']]);

// 5. Optional reimbursement linkage. Invalid linkage is IGNORED (a normal claim is
//    created) rather than rejected; a valid one caps the amount at the balance.
$valid = $adv && $adv->employee_id === $employee->id && $adv->employee_settled_at
      && $adv->settle_type === 'reimburse' && !$adv->settle_reimbursement_claim_id;

// 6. Manager stage ALWAYS starts pending — see §2.
DB::transaction(fn () => ExpenseClaim::create($data + [
    'claim_no'      => $this->nextClaimNo(...),   // EXP-#### under lockForUpdate
    'employee_name' => $employee->display_name,   // snapshot: survives employee delete
    'status' => 'pending', 'manager_status' => 'pending', 'hr_status' => 'pending',
]));   // 201
```

> **Why the transaction wraps code allocation:** `nextClaimNo()` takes a `lockForUpdate`, and a lock only holds inside a transaction. Without it two concurrent submitters in one tenant compute the same `EXP-####`.

### `AdvanceRequestController::store()` — same shape, different rules

```php
'advance_type'   => 'required|in:Travel Advance,Salary Advance,Medical Advance,Loan,Other',
'amount'         => 'required|numeric|min:100|max:9999999999999.99',  // ₹1 advances → ₹0 EMIs (QA #135)
'used_for'       => 'required|in:self,company',                       // company = not recovered
'requested_date' => 'required|date|after_or_equal:today|before_or_equal:today',   // exactly today
'recovery_start' => 'required_if:used_for,self|after_or_equal:'.$firstOfNextMonth  // CBC #93
                    .'|before_or_equal:'.$oneYearOut,                              // CBC #157
'recovery_mode'  => 'required_if:used_for,self|in:emi,lumpsum,bimonthly',
'files'          => 'required|array|min:1',        // NOW MANDATORY (was optional in v1.0)
'files.*'        => 'file|max:2048|mimes:pdf,jpg,jpeg,png',

// Cross-field rules the validator can't express:
$minCycle = min(500.0, $amount);                   // ≥ ₹500 per instalment, or the whole amount
if ($perCycle < $minCycle)                    return 422;
if ($monthly_emi > $amount)                   return 422;   // instalment ≤ advance
if ($type === 'Other' && !$other)             abort(422);
// company distribution rows (request_items) must total the amount exactly
if (round($sum,2) !== round($amount,2))       return 422;

// A COMPANY advance stores no recovery at all — nulled on write regardless of input.
'recovery_start' => $isCompany ? null : …, 'recovery_mode' => $isCompany ? null : …,
```

---

## 2. MANAGER STAGE

### `managerAct()` (managerApprove / managerReject)

```php
$this->ensureTenantAccess($row, $user);
$myEmployeeId = $this->currentEmployeeId($user);

// (a) No self-approval, whoever you are.
if (!super_admin && (int) $row->employee_id === (int) $myEmployeeId)
    abort(403, 'You cannot approve your own expense claim — your reporting manager will approve it.');

// (b) The assigned manager acts. Where NO manager is assigned, the branch admin
//     is the de-facto reporting manager and needs HR-approve rights to act.
$isAssignedManager = (int) $row->manager_id === (int) $myEmployeeId;
if (!super_admin && !$isAssignedManager) {
    $row->manager_id === null
        ? $this->guardHrPermission($user, 'can_approve')
        : abort(403, 'You are not the assigned reporting manager for this claim.');
}
if ($row->manager_status !== 'pending') abort(409, 'already actioned by the manager');

// (c) A rejection must say why; an approval need not.
'comment' => [$verdict === 'rejected' ? 'required' : 'nullable', 'string', 'max:1000'];

$row->manager_status = $verdict;
$row->manager_acted_at = now();
$row->manager_acted_by = $user->id;      // names WHO acted — manager, branch admin, anyone
if ($verdict === 'rejected') $row->status = 'rejected';   // manager reject closes it
```

> **Changed since v1.0.** The old code auto-cleared the manager stage when an employee had no `reporting_manager_id`, producing a phantom "auto-approved · no reporting manager". That is gone: the stage always starts `pending` and a branch admin approves it explicitly from the Inbox, so the audit trail always has two real steps. Unassigned rows are routed to branch admins by `MyTeamController::approvals`.

---

## 3. HR / FINANCE STAGE

### `hrAct()` (hrApprove / hrReject)

```php
$this->guardHrPermission($user, 'can_approve');                  // hr.expense
if (!super_admin && $row->employee_id === $myEmployeeId) abort(403);       // no self-approval
if ($verdict === 'approved' && $row->manager_status !== 'approved')
    abort(409, 'Manager must approve this claim before HR / Finance can approve it.');
if ($row->hr_status !== 'pending') abort(409, 'already actioned by HR / Finance');

$data = $request->validate([
  'comment'             => [$verdict === 'rejected' ? 'required' : 'nullable', 'max:1000'],
  'deductions.*.amount' => 'required_with:deductions|numeric|min:0',
  'additions.*.amount'  => 'required_with:additions|numeric|min:0|max:100000',
]);

$row->hr_status = $verdict; $row->hr_user_id = $user->id; $row->hr_acted_at = now();
$row->status    = $verdict;                                      // HR = final word
```

HR may set the deductions/additions here, so the net payable is fixed at approval rather than at first payment.

---

## 4. LISTING & SCOPE

### `index()`

```php
$scope = $request->query('scope', 'mine');            // anything unknown falls back to 'mine'
// mine: employee_id = resolved employee (or -1 so an unlinked user sees nothing)
// team: admins see the tenant; managers see transitive reports via
//       downstreamEmployeeIds() — a BFS over reporting_manager_id
// all:  guardHrPermission(can_view)
$this->applyTenantScope($q, $user, $branchFilter);
// claims also filter on q (claim no / title / employee), status, date_from, date_to

/* Two response shapes. Presence of page OR per_page switches to the envelope —
   older callers that expect a bare array are untouched. */
if ($request->filled('page') || $request->filled('per_page')) {
    $perPage = max(1, min(200, (int) $request->query('per_page') ?: 25));
    $p = $q->paginate($perPage, ['*'], 'page', $page);
    return ['data' => …, 'meta' => [...], 'summary' => $this->claimsSummary($base)];
}
return $q->get()->map(serialize);        // plain array
```

**`claimsSummary($base)` runs over EVERY matching claim, not the page.** Once the browser stops holding the full list it can no longer total the KPI tiles, tab badges or the spend-by-category rollup itself, and a second round trip for them would cost another request. It is one grouped query using Postgres `FILTER (WHERE …)` aggregates.

> `AdvanceRequestController::index()` has **no pagination** — it always returns the array.

---

## 5. SANCTION & PAY (expense claims)

### `setDeductions()` — fix the net payable without paying

```php
$this->guardHrPermission($user, 'can_approve');
if ($row->status !== 'approved')            abort(409, 'Approve it first.');
if ($row->sanctioned_amount !== null)       abort(409, 'The deduction is already locked.');

[$rows, $total, $err] = $this->normaliseAdjustments($items, 'deduction');
//   drops rows with amount ≤ 0; EVERY surviving row must carry a reason → 422

$sanctioned = round($row->amount - $deduction + $addition, 2);
if ($sanctioned <= 0.005) return 422;       // net payable must be > 0
```

### `settle()` — one installment, partial payments allowed

```php
$this->guardHrPermission($user, 'can_approve');
// No self-payment — the branch user records it.
if (!super_admin && $row->employee_id === $myEmp)
    abort(403, 'You cannot record a payment for your own claim…');
if ($row->status !== 'approved')                    abort(409);
if ($row->settlement_status === 'paid')             abort(409, 'already fully paid');

$firstPayment = $row->sanctioned_amount === null;   // deductions only apply on the first

$request->validate([
  'amount'       => 'required|numeric|min:0.01',
  'category_id'  => 'required|integer',
  'payment_type' => 'required|in:Cheque,UPI,PhonePe,Bank Transfer',
  'expense_type' => 'required|in:Goods,Service',
  'note'         => 'required|max:500',
  'proof'        => 'required|file|max:2048|mimes:pdf,jpg,jpeg,png',   // CBC #77, QA #100
]);

$remaining = round($sanctioned - $row->total_paid, 2);
if ($pay > $remaining + 0.005) return 422;          // never overpay
```

> **Why proof excludes office formats:** the picker used to accept a `.xlsx`, and a spreadsheet is not evidence that money moved (CBC #77). The 2 MB cap matches attachments and stays under PHP's upload limit, so a large file fails with a clear message rather than the cryptic "The proof failed to upload" (QA #100).

### `batchPay()` — one payment across many claims

```php
$request->validate([
  'claim_ids'        => 'required|array|min:1',
  'reference_number' => 'required|max:120',
  'proof'            => 'required|file|max:2048|mimes:pdf,jpg,jpeg,png,webp',   // QA #111
]);
// every id must belong to THIS employee, be approved, and be unpaid
if ($claims->count() !== count(array_unique($ids))) abort(422, 'Some selected claims were not found…');
foreach ($claims as $c) { ensureTenantAccess; if (!approved) abort(409); if (paid) abort(409); }

// Pay the REMAINING per claim, not the full amount — handles partially-paid rows (QA #114).
$remainingOf = fn ($c) => round(($c->sanctioned_amount ?? $c->amount) - $c->total_paid, 2);
// → one ExpenseBatchPayment parent + one ExpenseClaimPayment child per claim
```

---

## 6. COMPANY-ADVANCE SETTLEMENT

### `employeeSettle()` — the employee accounts for the spend

```php
if (!super_admin && $row->employee_id !== $myEmployeeId)
    abort(403, 'Only the employee who took this advance can settle it.');
if ($row->used_for !== 'company')      abort(409, 'Only a company-used advance needs settling.');
if ($row->settlement_status !== 'paid')abort(409, 'must be fully paid before it can be settled');
if ($row->employee_settled_at)         abort(409, 'already finalised and locked');

'items.*.amount' => 'required|numeric|min:0.01',   'items.*.reason' => 'required|max:500',
'items.*.method' => 'required|max:40',
'proofs.*'       => 'required|file|max:2048|mimes:pdf,jpg,jpeg,png,webp,doc,docx,xls,xlsx',
if (count($proofs) !== count($items)) return 422;   // proofs[] is index-aligned to items[]

// The declared target is captured on the FIRST save and then locked:
//   equal   → target == sanctioned
//   minimum → 0 < target < sanctioned   (employee returns the balance)
//   maximum → target > sanctioned       (company reimburses the excess)
if ($bad) return 422;   // 'The declared amount used does not match the chosen type.'
```

Settlement is **incremental** — bills accumulate over several saves and the advance only locks when `finalize` is sent. `settleApprove()` / `settleReject()` then record the branch admin's verdict (reject requires a comment; approve does not).

### `recordReturn()` — giving unused money back

```php
'mode' => 'required|in:direct,payroll',
// payroll mode additionally requires a schedule:
'recovery_start' => 'required|date|after_or_equal:'.$firstOfNextMonth,
'recovery_type'  => 'required|in:emi,lumpsum,bimonthly',

if ($row->settle_type !== 'return')            abort(409);
if ($row->settle_approval_status !== 'approved') abort(409, 'must be approved before the balance can be returned');
if ($balance <= 0)                             abort(409, 'There is nothing to return.');
```

Each direct payment lands in `settle_return_payments` and is confirmed one at a time by `approveReturnPayment()` / `rejectReturnPayment()`; `recomputeReturnComplete()` closes the return only once approved payments cover the balance.

### `raiseReimbursement()` — an over-spend becomes a claim

Creates a linked `EXP-####` for the excess, guarded so it can only run on a finalised, **approved**, over-spent advance, and only once (`settle_reimbursement_claim_id`).

---

## 7. PAYROLL RECOVERY

### `PayrollService::advanceRecovery($employeeId, $period, $cap)`

```php
// TWO streams per employee:
//   self   — repaying an advance they took           (recovery_*)
//   return — returning unused company money by payroll (settle_return_*)
$streams = [ …approved advances with recovery_start <= period_end… ];

// Oldest schedule first: when the cap can't cover everything, the longest-running
// advance has priority.
usort($streams, fn ($a, $b) => $a['start'] <=> $b['start'] ?: strcmp($a['stream'], $b['stream']));

foreach ($streams as $s) {
    $normalDue = $this->cycleDue(...);       // stateless — see below
    $arrears   = ledger(advance, stream)->latest()->carried  ?? 0;
    $due       = round(min($normalDue + $arrears, $outstanding), 2);
    $take      = round(min($due, $room), 2);           // $room = remaining FOI headroom
    ledger->upsert([... 'due' => $due, 'amount' => $take, 'carried' => $due - $take]);
    $room -= $take;
}
```

`cycleDue()` — the per-cycle instalment:

```php
$hasEmi = in_array($mode, ['emi','bimonthly']) && ($emi > 0 || $months > 0);
if (!$hasEmi) return $monthIndex === 0 ? $amount : 0.0;      // lumpsum: start month only
$per = $emi > 0 ? $emi : round($amount / max(1,$months), 2);
if ($mode === 'bimonthly') {
    if ($monthIndex % 2 !== 0) return 0.0;                   // OFF month
    return intdiv($monthIndex, 2) < $n ? $per : 0.0;
}
return $monthIndex < $n ? $per : 0.0;                        // plain monthly EMI
```

> **Corrected since v1.0:** bimonthly is genuinely every other month. v1.0 documented it as "not special-cased — behaves as lumpsum", which is no longer true.

**The cap.** The caller computes `$foiCap = round(max(0, $netBeforeRecovery) * 0.70, 2)` and passes it in. Exceeding it raises *"Advance recovery exceeded the 70% FOI headroom this cycle…"* on the payslip. Recovery can never drive net pay negative.

**The ledger is keyed `(advance, stream, year, month)` and upserted**, so re-running payroll for a month overwrites that month's row instead of double-recovering.

**Rule 11 — loans split out.** `recoveryKind()` sends any advance whose type contains "loan" to the payslip's `loan_recovery` column; everything else to `advance_recovery`.

In Full & Final the month's already-deducted EMI is added back (`net_pay + advance_recovery`) so the outstanding is recovered exactly once.

---

## 8. FILES & PROOFS

```php
downloadAttachment(): $this->authenticateFromQueryToken($request);   // ?token=
                      ensureTenantAccess($row, $user);
                      stream the file at [index] from the public disk
```

Seven such routes exist (claim receipts, claim payment proof, batch proof, advance attachments, advance payout proof, settlement bill proof, return proof). They sit **outside** the `auth:sanctum` group: they are opened as new-tab navigations that carry no `Authorization` header, and registering them inside the group returned a 500 (`Route [login] not defined`) instead of a 401.

Stored rows keep only `{name, size, path}` — the URL is rebuilt at `serialize()` time so it always points at the Laravel route rather than a raw `/storage` or Azure blob path.

---

## 9. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Two-stage approval | `managerAct` → `hrAct` | Manager then finance |
| No self-action | both act methods + `settle` | Nobody approves or pays their own money |
| Branch admin as de-facto manager | `managerAct` when `manager_id` is null | Explicit step, no phantom auto-approval |
| Row-locked codes in a transaction | `nextClaimNo` / `nextAdvanceNo` | Unique `EXP-`/`ADV-####` under concurrency |
| Trusted identity from the token | `store` | A stale request `employee_id` can't target another row |
| Raise-time gates | `OnboardingGuard`, joining date | Mid-onboarding `/profile` still shows the form |
| CRLF fold before length check | `store` | Multipart adds a char per line (QA #89) |
| Adjustments need reasons | `normaliseAdjustments` | Every deduction is auditable |
| Pay the remaining, not the total | `settle`, `batchPay` | Partially-paid claims don't double-pay (QA #114) |
| Server-side summary | `claimsSummary` | Paged list can't total itself |
| Arrears ledger, upserted | `advanceRecovery` | Lean months carry forward; re-runs don't double-count |
| Transitive reports (BFS) | `downstreamEmployeeIds` | Team scope |
| Employee-name snapshot | claims | Survive employee delete |

---

## 10. NOTES & CAVEATS

- **No DB FKs.** The two parent tables have no soft deletes; the three payment tables do.
- **Category limits are unenforced** by design (parity with advances).
- **The 70 % headroom at raise time is advisory** — `emiInfo()` reports it, `store()` does not enforce it. Payroll applies its own 70 % FOI cap.
- **Advance listing is not paginated**; expense claims are (opt-in).
- Receipts are mandatory for **both** claims and advances now.
- Two permission slugs: `hr.expense` (approvals, settlement) vs `master.expense_category` (category master).
- `recoverOnetime()` and its proof route are **disabled** — route commented out, client gated by `ONETIME_PAYOFF_ENABLED`.
- DB is PostgreSQL (`ilike`, `FILTER (WHERE …)` aggregates are used).

---

*Related documents: EXPENSE_TECHNICAL_DOCUMENTATION.md · EXPENSE_FUNCTIONAL_DOCUMENTATION.md · EXPENSE_API_DOCUMENTATION.md*
