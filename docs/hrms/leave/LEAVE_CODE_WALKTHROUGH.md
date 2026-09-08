# LEAVE MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Leave
>
> Follows a leave request from the drawer to the payslip, method by method.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |
| 2.0 | 2026-09-08 | System | Rewritten against the current controllers: the full guard sequence in `store()`, chain snapshotting with HR stripped, `computeLeaveDays` + `SandwichPolicy`, `setStatus` and the notice extension, the `/approvals` two-pass scope, plan locking and clone, payroll propagation. |

---

## 0. HOW TO READ

Each section names the method and what it actually does, including the reasons recorded in the source. Line references drift; method names are stable.

```
app/Http/Controllers/Api/LeaveRequestController.php   (2,006)
app/Http/Controllers/Api/LeavePlanController.php      (1,152)
app/Support/SandwichPolicy.php · WeekOff.php
app/Support/NoticePeriodGuard.php · ProbationGuard.php · OnboardingGuard.php
```

---

## 1. THE POLICY SIDE — building a plan

### `LeavePlanController::store()` / `update()`

A plan carries a name, a calendar year and a year start (`from_month_type` = `Calendar` or `If Joining`). `assertUniquePlanName()` compares `LOWER(plan_name)` within the (client, branch) tuple, so "Staff Plan" and "staff plan" collide.

### `assignTypes()` — replace-or-append

The payload is a flat array of leave-type ids. Ids already attached are **kept with their config intact**, new ids are inserted with empty config, and ids missing from the payload are detached. That is what the "Assign Leave Types" multi-select means: the modal posts the full desired set, not a diff.

### `saveTypeConfig()` — the wizard's per-section save

Three things here are easy to get wrong and are all deliberate.

**1. The full config is persisted from the raw input, not from `validated()`.**

```php
$row->config_json = $request->input('config');
```

`validated()` returns only keys that *have* rules. The rules cover `accrual.*` and `yearEnd.carryForwardCap`, so using `$data['config']` would silently drop `leaveApp`, `approval`, `probation` and `noticePeriod` on every save. Bounds were already enforced by the `validate()` call above, so taking the raw input is safe.

**2. `is_setup` flips only on the finalising save.**

```php
if ($request->boolean('finalize', true)) { $row->is_setup = true; }
```

The wizard posts once per section. Without this, a single-type plan would count as complete after section 1 and `assertPlanEditable()` would then 422-reject sections 2..N even though their data saved (bug #63). `finalize` defaults to `true` so a direct API caller still completes the type in one call.

**3. A clone's editable window closes here.**

```php
if ($plan->unlocked && $this->isPlanSetupComplete($plan->id)) {
    $plan->unlocked = false; $plan->save();
}
```

Without it a clone stays `unlocked` forever and its Setup buttons never become the Locked indicator (bug #61).

**Bounded numerics.** `yearlyQuota` 0..365, `attendanceDaysWorked` 0..31 (and only when `mode` is `attendance` — otherwise a stale value from that mode blocks the save after switching, bug #73), `employeeOverdraft.days` 0..365, `carryForwardCap` 0..365. Each has a custom message; `min:0` rather than `min:1` throughout so a section that does not carry the key still passes.

### `assertPlanEditable()` — the lock

```php
if (!$plan->unlocked && $this->isPlanSetupComplete($plan->id)) {
    abort(422, 'This leave plan is fully set up and locked. To change it, clone it into a new plan and edit that.');
}
```

`isPlanSetupComplete()` is `total > 0 && configured === total` over the pivot. Assigning employees, cloning and make-default stay allowed — the lock guards the *policy*, not the roster, because in-flight requests carry the rules they were raised under and reprising a live plan would desynchronise them.

### `clone()`

```php
$copy = $source->replicate(['is_default']);
$copy->unlocked = true;      // born editable
```

Types and their config are copied; **employees are not**. The `unlocked` override is the whole reason cloning works as "edit a completed plan".

### `destroy()`

```php
if ($plan->is_default) abort(422, 'Cannot delete the default leave plan. …');
$active = DB::table('leave_requests')->where('leave_plan_id', $plan->id)
    ->whereIn('status', ['Pending','Approved'])->count();
if ($active > 0) abort(422, "Cannot delete this plan — {$active} active … request(s) still reference it.");
```

LV-25: deleting would strand those requests with a dangling `leave_plan_id` and unassign their employees mid-cycle. Only when clear does it cascade both pivots and delete inside a transaction.

---

## 2. RAISING A REQUEST — `LeaveRequestController::store()`

The longest method in the module (~360 lines) and almost all of it is refusals. In order:

### 2.1 Validation

`leave_type_id` is not merely `exists` — it is scoped:

```php
Rule::exists('master_leave_types','id')->where(function ($q) use ($user) {
    if ($user->user_type === 'super_admin') return;
    $q->whereNull('client_id')->orWhere('client_id', $user->client_id);
})
```

LV-23: any tenant's type id would otherwise be accepted.

`to_date` is capped at `now()->addYear()` (LV-09) so a stray far-future request cannot lock quota for years. Free text is bounded (LV-22): `reason` 2000, handover/tasks 5000, `attachment_path` 1024.

One subtlety worth its own comment in the source:

```php
'notify' => ['nullable','array'],
'notify.employee_ids' => ['nullable','array'],
'notify.employee_ids.*' => ['integer','exists:employees,id'],
```

`validated()` returns only keys with rules. `'notify' => ['array']` alone let the array through **but stripped `employee_ids` out of it** — the request stored `notify => []` and no colleague was ever CC'd (QA #117). The inner keys need their own rules.

### 2.2 Who is this for

Explicit `employee_id` (admin filing on behalf) or the caller's own employee row. Then three gates:

```php
if ($user->client_id && (int)$employee->client_id !== (int)$user->client_id) abort(403);   // tenant
$isAdmin = in_array($user->user_type, ['super_admin','client_admin'], true);
$isSelf  = (int)($employee->user_id ?? 0) === (int)$user->id;
if (!$isAdmin && !$isSelf) abort(403, 'You can only raise a leave request for yourself.');
```

Note the middle line: **branch users cannot file on behalf.** They can view others' leave but not raise it, matching the hidden "Request Leave" button on another employee's profile.

### 2.3 The three shared guards

```php
OnboardingGuard::assertComplete($employee, 'raise a leave request', $isSelf);  // CBC #84
ProbationGuard::assertCanRaiseLeave($employee, $isSelf);
NoticePeriodGuard::assertLeaveAllowed($employee, LeaveTypes::find($data['leave_type_id']), $isSelf);
```

All three are keyed on the **target** employee, so an admin filing on their behalf is blocked too. Each takes `$isSelf` purely to phrase the message in the right voice ("You are on probation" vs "This employee is on probation").

`NoticePeriodGuard` treats a type as unpaid when **either** `paid_unpaid = 'Unpaid'` or the category is `Unpaid Leave` — either is enough.

### 2.4 Date guards

```php
$todayStr = now(self::DISPLAY_TZ)->toDateString();   // Asia/Kolkata
```

This is load-bearing. The app runs in UTC, so `now()->toDateString()` reports **yesterday** for the first 5.5 hours of every IST day and would let a stale date through.

| Guard | Rule |
|---|---|
| Past | `from_date < today` refused for everyone — backdated leave bypasses the entire point of the workflow |
| Joining date | `from_date < date_of_joining` refused (CBC #85); skipped when DOJ is unset |
| Same day | Self-service applying for **today** may take only the second half, single day |
| Half-day span | `day_type !== 'full'` must be a single calendar day — rejects "first_half across 5 days" rather than silently billing 5 full days |

### 2.5 Overlap

Two ranges overlap when each starts on or before the other ends:

```php
->where('from_date','<=',$to)->where('to_date','>=',$from)
->whereIn('status',['Pending','Approved'])
```

With one carve-out (LV-08): a half-day does **not** conflict with the opposite half on the same single day — AM + PM filed as two requests is a valid full day.

### 2.6 Plan and type resolution

```php
$planId = DB::table('leave_plan_employees')->where('employee_id',$employee->id)->value('leave_plan_id');
if (!$planId && is_numeric($employee->leave_plan)) $planId = (int) $employee->leave_plan;
```

The pivot first, then the column the onboarding wizard stamps — both assignment paths must work. No plan, or a type not attached to it, is a 422 pointing at HR.

### 2.7 Balance and cap

```php
$quotaDays = (float) ($accrual['yearlyQuota'] ?? 0);
$overdraft = !empty($accrual['employeeOverdraft']['enabled']) ? (float)($accrual['employeeOverdraft']['days'] ?? 0) : 0.0;
$usedDays  = LeaveRequest::…->whereIn('status',['Approved','Pending'])->sum('days');
$available = max(0.0, ($quotaDays + $overdraft) - $usedDays);
```

**Pending counts.** Without it a user could stack several over-quota requests before any was acted on. The check gates against the **full annual entitlement available from day one** — no monthly vesting — which is what the profile's "Available" figure shows.

The monthly cap (Bug 60) is separate and applies **even to unlimited types**, because capping monthly usage is the whole point of it. A request is attributed to the calendar month it *starts* in.

A long comment marks what is gone: periodic accrual (`accrual.mode === 'periodic'`) was removed from the leave-type setup (#102), and its enforcement was removed with it rather than left running against config rows that still carry the key. Leaving it would have blocked leave by a rule HR can no longer see or switch off — the balance reading "12 available" while the request 422'd at 1/month, quoting a dropdown that no longer exists.

### 2.8 Chain snapshot and create

```php
$chain = $this->snapshotApprovalChain($employee, $planId, $data['leave_type_id'], $days);
$startLevel = $this->firstActionableLevel($chain, 1);
$autoApproved = $startLevel > count($chain) && count($chain) > 0;
```

An auto-approved request is created `Approved` with the comment *"Auto-approved — every chain level was skipped by rule"*, and **both** notifications fire — submission and decision — otherwise the requester waits for an approval email that will never come.

---

## 3. THE APPROVAL CHAIN

### `snapshotApprovalChain()`

Reads `approval` out of the plan-type `config_json` and accepts two shapes:

```php
approval.chain = [{kind, role, user_id, …}, …]     // new
approval.required + approval.approverRole          // legacy → wrapped as one level
```

No saved config at all → default to a single `reporting_manager` level.

Then **HR is stripped**:

```php
$rawChain = array_values(array_filter($rawChain, function ($r) {
    $kind = $r['approver_kind'] ?? ($r['kind'] ?? null);
    $role = strtolower((string)($r['approver_role'] ?? ($r['role'] ?? '')));
    return !($kind === 'role' && $role === 'hr');
}));
if (empty($rawChain)) $rawChain = [['approver_kind' => 'reporting_manager']];
```

HR is view-only by product decision, so even a leave type whose stored config still carries a legacy RM → HR chain ends at the reporting manager. If filtering empties the chain (a legacy HR-only config), it falls back to the reporting manager rather than producing an unapprovable request.

Each level is then frozen with `level`, `approver_kind`, `approver_role`, resolved `approver_user_id` / `approver_employee_id`, `skip_if`, `status`, and empty `acted_by` / `acted_at` / `comment`. A level whose resolved approver no longer exists is marked `Skipped` with a reason, so the chain never stalls on a dead entry.

### `evaluateSkipRule()`

```php
days_lt · days_lte · days_gt · days_gte   // compared against ctx.days
```

Evaluated **once, at submission**, against the computed day count — so the outcome is part of the snapshot and cannot change later.

### `firstActionableLevel()`

Walks forward past every non-`Pending` level. This is what collapses a 3-level chain with a skipped middle level from 1 → 3, both at snapshot time and after each approval.

### `canActOnLevel()`

Public — `MyTeamController`'s approvals inbox calls it, so the two queues cannot drift apart. True when the level names the user's id, names their employee id, or is role/kind-based and they fill that role:

- `role = hr` → `branch_user` or `client_admin`
- `role = branch_admin` → `branch_user`
- `role = reporting_manager` or `kind = reporting_manager` → their employee id equals the requester's `reporting_manager_id`

---

## 4. DECIDING — `setStatus()`

Shared by `approve()` and `reject()`.

```php
if ($row->status !== 'Pending') abort(422, "Leave request is already {$row->status}.");
```

### The hierarchy gate

```php
$isSuperOverride  = $user->user_type === 'super_admin';
$isApproverForLevel = $this->canActOnLevel($user, $chain, $level - 1, $row);
$isHr = in_array($user->user_type, ['client_admin','branch_user'], true);
$hrCanActRmAway = $isHr && $this->isReportingManagerUnavailable($row);
if (!$isApproverForLevel && !$isSuperOverride && !$hrCanActRmAway) abort(403, '…');
```

This mirrors the per-row `can_act_now` flag the `/approvals` list already exposes, so the API can no longer be used to bypass the manager with a direct call. The **deadlock escape** (Bug 55) lets HR act when the manager is on approved leave, disabled, or unassigned.

### No self-approval

```php
if ($next === 'Approved' && $ownEmployeeId && (int)$row->employee_id === $ownEmployeeId)
    abort(403, 'You cannot approve your own leave request.');
```

LV-11. Rejecting your own is harmless and is handled by `/cancel` anyway.

### Rejection is terminal

```php
for ($i = $level; $i < count($chain); $i++) {
    if (!in_array($chain[$i]['status'] ?? 'Pending', ['Approved','Rejected'], true))
        $chain[$i]['status'] = 'Skipped';
}
```

Without this a later level (e.g. HR) kept showing Pending on a request that was already rejected.

### Approval advances or finalises

`firstActionableLevel($chain, $level + 1)`; past the end means terminal `Approved`.

### After a terminal decision

```php
if ($row->status === 'Approved') {
    $noticeDays = NoticePeriodGuard::applyExtension($row, Employee::find($row->employee_id));
}
$this->notifyForDecision(...);
if (in_array($row->status, ['Approved','Rejected'], true)) $this->propagateToPayroll($row->employee_id);
```

The extension runs **only on the terminal Approved state**, never on an intermediate level. The response carries `notice_extension` so the approver is told the exit date moved rather than discovering it later on the exit screen.

### `propagateToPayroll()`

```php
try { app(PayrollService::class)->recomputeEmployeePayslips((int)$employeeId); }
catch (\Throwable $e) { Log::warning('Leave→payroll propagation failed', [...]); }
```

Best-effort — a payroll hiccup must never block a leave decision — but **logged** (LV-29), because a silent leave/payroll divergence is otherwise undiagnosable.

---

## 5. CANCELLING — `cancel()`

Only the requester or HR, and only while `Pending`. Then:

```php
NoticePeriodGuard::revertExtension($row, Employee::find($row->employee_id));
$this->notifyForCancellation($row);
$this->propagateToPayroll($row->employee_id);
```

The revert is defensive: a Pending request never had an extension, but this is the single cancellation path, so guarding here keeps it correct if approved leave ever becomes cancellable — otherwise an approve → cancel cycle could ratchet the exit date outward.

---

## 6. SIZING A LEAVE — `computeLeaveDays()`

```php
if ($dayType !== 'full' && $from->isSameDay($to)) return 0.5;
```

Then the working-day count, where an off day is a weekly-off **or** a holiday:

```php
$isOff = fn (Carbon $d) => WeekOff::isOff($weeklyOffLabel, $d) || isset($holidaySet[$d->toDateString()]);
```

`WeekOff::isOff()` is the single answer to "is this date an off day?" across the app — it understands nth-Saturday patterns that a plain day-of-week set never could. A duplicate parser that lived here (and another in `AttendanceController`) is gone.

### The padded holiday window

```php
$pad = SandwichPolicy::LOOKAROUND_DAYS;          // 15
$holidaySet = $this->holidayDatesInRange($employee, $from->subDays($pad), $to->addDays($pad));
```

The sandwich scan steps outside the request on both sides. A holiday just beyond the edge is part of the run being tested; loading only `[from, to]` would make that day look like a working day and silently break the flanking test.

### `holidayDatesInRange()`

Resolves **company-wide holidays (no group; client must match exactly, branch match-or-null) plus the employee's own group** — deliberately identical to `PayrollService::holidayDateSet()`. It takes the `Employee` rather than a group id precisely so the company-wide half can be resolved; keyed on a group id it could only ever answer half the question, and an employee with no group got nothing.

The comment records why it is unconditional: a company holiday carries no group (QA #93), so gating the lookup on the employee having one meant an ungrouped employee had every holiday charged against their leave here while payroll credited it as paid. **The two sizing sites have to read the same calendar.**

### The sandwich addition

```php
if (!$sandwichWaived && SandwichPolicy::appliesTo($employee)) {
    $approved = SandwichPolicy::approvedLeaveDates((int)$employee->id, $padFrom, $padTo, $ignoreRequestId);
    $isLeave = fn (Carbon $d) => (inside this request's range) || isset($approved[$d->toDateString()]);
    $total += count(SandwichPolicy::chargeableOffDays($from, $to, $isOff, $isLeave));
}
```

"On leave" means this request's own days **or** any other approved leave — the two halves of a sandwich are routinely filed apart.

---

## 7. `App\Support\SandwichPolicy`

```
Fri     Sat     Sun     Mon
LEAVE   off     off     LEAVE     -> Sat + Sun charged too  (4 days)
LEAVE   off     off     present   -> Sat + Sun free         (1 day)
```

| Aspect | Implementation |
|---|---|
| Switch | Per **branch** — `branches.sandwich_policy`, memoised in `$branchSwitchCache`; every employee posted there is covered, joiners included |
| Deployed ahead of migration | `Schema::hasColumn` check returns false rather than throwing |
| Scope | Every leave type — the trigger is the shape of the calendar, not the kind of leave |
| `LOOKAROUND_DAYS = 15` | How far either side the scanner looks, **and** the safety cap on expanding a run of off-days so a misconfigured weekly-off cannot loop forever |

**Which request pays.** The two leave days can live in separate requests, and the off-days between them then belong to neither range. The rule:

> a run of off-days is charged to the leave that covers the day **immediately after** the run.

That is deterministic and cannot double-charge — exactly one leave can hold the day after any given run — and it means the sandwich is detected when the *closing* leave is applied for, which is the only moment it can be known.

**Why the maths lives in `App\Support`.** Leave days are sized independently by `LeaveRequestController` at raise time and by `PayrollService` at payslip time. If only one knew about sandwiching, the screen would show 3 days while the salary deducted 5.

---

## 8. WAIVING A SANDWICH — `sandwichWaiver()`

```php
if (!in_array($user->user_type, ['super_admin','client_admin','branch_user'], true))
    abort(403, 'Only HR or an administrator can waive the sandwich policy.');
if (!SandwichPolicy::appliesTo($employee))
    abort(422, "This employee's branch does not run the sandwich leave policy.");
```

Inside a transaction the leave is **re-sized** by re-running `computeLeaveDays()` with `$sandwichWaived` set and its own id excluded from the "other approved leave" lookup (its dates are added back by the function itself). The four `sandwich_*` columns are then written, and the response reports `days_before` / `days_after`.

Then, **outside** the transaction:

```php
$this->propagateToPayroll($row->employee_id);
```

The source records why this was added: this was the one leave mutation that did not recompute. `PayrollService::leaveAggregates()` reads `sandwich_waived` and drops the sandwiched off-days from loss of pay — so the flag flipped and the money did not. The row on screen said "excused" while the payslip beside it still deducted the days, until somebody happened to re-run the whole cycle. It matters more now that the switch is offered inside the payroll run modal itself, where re-running is the very next step and the figures are read before it.

Passing `waived: false` re-applies the policy and clears all four columns — the operation is symmetric.

---

## 9. THE APPROVALS QUEUE — `approvals()`

The most intricate read in the module, because "what may this user see" cannot be expressed in SQL alone.

### Scope

```php
$isAdminScope = in_array($user->user_type, ['super_admin','client_admin','branch_user'], true);
```

Admin scope sees the tenant. Everyone else gets a **wide SQL pre-filter** — own requests, requests from their direct reports, `approved_by = me`, or a text match on the JSON chain — and is then narrowed by a **precise PHP pass** through `canActOnLevel()`. `approval_chain` is JSON, so per-level matching cannot be done reliably in SQL across PG and MySQL.

The JSON match uses trailing terminators:

```php
'%"approver_user_id":' . $uid . ',%'   // and '}%', plus space-padded variants
```

Without them user 5 would match `"approver_user_id":50` and every user whose id prefixes another's would see cross-row matches.

### Branch scoping

```php
$branchId = $request->integer('branch_id') ?: null;
if ($user->user_type === 'branch_user' && $user->branch_id) $branchId = (int) $user->branch_id;
```

A branch user's own branch is **forced**, not merely defaulted — the Axios interceptor omits `branch_id` when the switcher is on "All branches", which previously let a branch user see every sibling branch's requests. Client-level roles keep honouring the switcher.

### Filters, moved server-side

`search` (name/code), `leave_type`, `department`, `payroll`, `on_leave_on`. The comment explains the move: they used to run in the browser over the whole downloaded set, which stops working once the list is paged — filtering a page filters 10 rows out of 1,004 and reports "3 results" for a filter matching 300. A filter and a page size cannot both live on the client.

`payroll = Unpaid` is deliberately two conditions — `paid_unpaid = 'Unpaid'` **or** category `Unpaid Leave` — because the client derived it the same way, and the two definitions have to agree or a row lands in one bucket here and the other there.

### Tab counts

```php
if ($request->boolean('with_counts') && $isAdminScope) { /* clone BEFORE the status clause */ }
```

Counts are taken from a copy of the query with every filter applied **except** status — which is what a tab strip means: "how many would I see if I clicked this one, under the filters I already have". The status clause is therefore added last.

### Paging

Opt-in via `per_page` (clamped 1..200). The two scopes page differently, and that asymmetry is the point:

- **Admin scope** applies no post-fetch filtering, so the database does both the count and the slice.
- **Non-admin scope** must count and slice the **permission-filtered collection**. Slicing in SQL before the filter would give page 1 three rows and page 2 none.

Non-admin counts come off that same filtered collection, so a manager's queue counts what a manager can actually act on.

---

## 10. BALANCES — `employeeBalances()`

Tenant-guarded first (IDOR: any authenticated user could otherwise enumerate `employeeId` and read another tenant's ledger). Plan resolved pivot-first, employee-column second. No plan → an empty, well-formed payload rather than an error.

The ledger is built as a single opening grant plus deductions:

```php
$yearStart = self::planYearStart($planRow->from_month, $planRow->calendar_year);
$balance = $quota;
$transactions[] = ['date' => …, 'change' => "+ 12", 'reason' => 'Annual leave quota granted for the year.', 'kind' => 'accrual'];
```

`extra` (the overdraft) is surfaced as its own breakdown line — yearly + extra = total allowance — and does **not** inflate the accrued quota. Pending requests appear in the request list but do not move the running balance, even though they *do* count against `available` in the raise-time check.

> `accrualEvents()` and `accruedToDate()` sit just above this method, still implementing periodic/monthly vesting. **Nothing calls them** — not this controller, not the frontend. They are leftovers of the removed accrual mode.

---

## 11. NOTES & CAVEATS

| # | Note |
|---|---|
| 1 | `yearEnd.carryForwardCap` is validated and stored on every save but **read by nothing** — there is no year-end process |
| 2 | `probation` and `noticePeriod` config sections are likewise stored and unused; the live rules come from `ProbationGuard` / `NoticePeriodGuard` reading the employee record |
| 3 | `SETUP_SECTIONS` in `HrLeavePlans.tsx` lists only Accrual / Leave Application / Approval, so the other three section components are unreachable |
| 4 | `accrualEvents()` / `accruedToDate()` are dead code |
| 5 | `accrual.attendanceDaysWorked` is bounds-validated but nothing accrues from attendance |
| 6 | `master_leave_types.gender_restriction` and `is_sick_medical` are never checked when applying |
| 7 | `attachment_path` is a client-supplied string; this module has no upload endpoint and never verifies the path |
| 8 | Non-admin `/approvals` filters in PHP after the fetch, so a large tenant pulls a wide set into memory before slicing |
| 9 | Notifications are best-effort inside try/catch — a failed send is invisible to the actor |
| 10 | `leave_requests` has no soft deletes; a cancelled request stays on the record permanently |
| 11 | Only the past-date guard uses IST (`DISPLAY_TZ`); other comparisons use server time (UTC) |
| 12 | `index()` (the employee's own history) is not paginated |
| 13 | The chain pre-filter uses `ilike` on a JSON column — Postgres-specific as written |

---

*Related documents: LEAVE_FUNCTIONAL_DOCUMENTATION.md · LEAVE_TECHNICAL_DOCUMENTATION.md · LEAVE_API_DOCUMENTATION.md*
