# PAYROLL MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Payroll
> A guided, file-by-file trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS DOCUMENT

This walkthrough follows the payroll lifecycle **in execution order**, showing the actual method chain for each step. Line numbers reference the live source and may drift as files grow; method names are stable.

Primary files:
- `app/Http/Controllers/Api/PayrollController.php` (HTTP layer)
- `app/Services/PayrollService.php` (compute engine)
- `app/Services/PayslipPdfService.php` (PDF)
- `resources/js/pages/hrms/HrPayroll.tsx` (dashboard)

Legend: `→` a call · `⇒` a return · **[Rule N]** the business rule enforced.

---

## 1. OPENING A CYCLE (dashboard load)

### 1.1 Frontend: `HrPayroll.tsx` mount

```tsx
// On mount
useEffect(() => {
  api.get('/payroll/cycles').then(res => {
    const list = res.data?.data ?? [];
    setRawCycles(list);
    // Default to the CURRENT year (fix #37): this year's active cycle →
    // current month → any active → newest.
    const curY = today.getFullYear();
    const curM = today.getMonth() + 1;
    const live =
      list.find(c => c.status === 'In Progress' && c.year === curY)
      ?? list.find(c => c.year === curY && c.month === curM)
      ?? list.find(c => c.status === 'In Progress')
      ?? list[list.length - 1];
    if (live?.year)  setSelectedYear(live.year);
    if (live?.month) setCycleKey(monthKey(live.year, live.month - 1));
  });
}, []);
```
Then `reloadCycle()` calls `GET /payroll?month=&year=` to load the cycle rows.

### 1.2 Backend: `PayrollController::cycles()` (137-174)

```php
public function cycles(Request $request)
{
    $ctx = $this->ctx($request);                       // tenant scope from the user
    $periods = PayrollPeriod::query()
        ->when($ctx['client_id'], fn($q) => $q->where('client_id', $ctx['client_id']))
        ->when($ctx['branch_id'], fn($q) => $q->where('branch_id', $ctx['branch_id']))
        ->get()->keyBy(fn($p) => $p->year . '-' . $p->month);

    // Batch-load the latest run per period in ONE query (avoids N+1)
    $latestRuns = PayrollRun::whereIn('payroll_period_id', $periods->pluck('id'))
        ->get()->groupBy('payroll_period_id')
        ->map(fn($g) => $g->sortByDesc('id')->first());

    $out = [];
    $cursor = now()->startOfMonth()->subMonths(11);    // trailing 13-month strip
    for ($i = 0; $i < 13; $i++) {
        $m = (int) $cursor->month; $y = (int) $cursor->year;
        $existing = $periods->get("$y-$m");
        $out[] = [
            'key'    => strtolower($cursor->format('M')) . '-' . $y,
            'label'  => $cursor->format('M Y'),
            'range'  => /* d M – d M */,
            'month'  => $m, 'year' => $y,
            'status' => $this->cycleDisplayStatus($existing, $cursor,
                          $existing ? $latestRuns->get($existing->id) : null),
        ];
        $cursor->addMonth();
    }
    return response()->json(['data' => $out]);
}
```

**`cycleDisplayStatus()` (176-191):**
```php
if ($period) {
    if ($period->status === 'locked' || ($run && $run->status === 'paid')) return 'Completed';
    if ($period->status === 'processing' || ($run && in_array($run->status, ['generated','approved']))) return 'In Progress';
    if ($period->attendance_finalized) return 'In Progress';
}
if ($cursor->isFuture() && !$cursor->isSameMonth(now())) return 'Not Started';
return $period ? 'In Progress' : 'Not Started';
```
> **Historical bug (#37):** every empty past month returns `'Not Started'`, so the old frontend `find('In Progress' || 'Not Started')` matched the oldest month (a prior year). The current selection logic (§1.1) prefers the current year, fixing the default.

### 1.3 Backend: `PayrollController::index()` (293-314)

```php
public function index(Request $request)
{
    [$month, $year] = $this->resolveMonthYear($request);   // clamps + defaults now()
    $ctx = $this->ctx($request);
    $period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);
    $run    = $period->runs()->latest('id')->first();
    $slips  = $run ? $run->payslips()->get() : collect();
    return response()->json(['data' => [
        'period' => $this->serializePeriod($period, $run),
        'run'    => $run ? $this->serializeRun($run) : null,
        'rows'   => $slips->map(fn($s) => $this->serializePayslip($s))->all(),
        'counts' => $this->buildCounts($slips),
    ]]);
}
```

**`resolveOrCreatePeriod()` (PayrollService:50)** is race-safe:
```php
try {
    return PayrollPeriod::firstOrCreate(
        ['client_id' => $ctx['client_id'], 'branch_id' => $ctx['branch_id'],
         'month' => $month, 'year' => $year],
        ['label' => …, 'period_start' => …, 'period_end' => …,
         'working_days' => $this->defaultWorkingDays($start, $end), 'status' => 'open',
         'created_by' => $ctx['user_id']]
    );
} catch (QueryException $e) {           // lost the create race on the unique key
    $existing = PayrollPeriod::where([...])->first();
    if ($existing) return $existing;
    throw $e;
}
```

---

## 2. FINALIZING ATTENDANCE **[Rule 1]**

### 2.1 `PayrollController::finalizeAttendance()` (316-348)

```php
if (!$this->canManage($request->user())) return response()->json([...], 403);
[$month, $year] = $this->resolveMonthYear($request);
$ctx = $this->ctx($request);
if ($msg = $this->requireScope($ctx)) return $msg;              // 422 if no scope
$period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);
if ($resp = $this->guardPeriodStarted($period)) return $resp;   // 422 future cycle
if ($period->status === 'locked') return response()->json([...], 422);

$coverage = $this->payroll->attendanceCoverage($period);        // total / with / missing
$this->payroll->finalizeAttendance($period, $ctx['user_id']);
$this->audit($request, 'finalize_attendance', $period, "Attendance finalized for {$period->label}");

return response()->json([
    'message'  => "Attendance finalized." . ($coverage['missing'] > 0
                  ? " {$coverage['missing']} of {$coverage['total']} employees have no attendance this cycle." : ''),
    'coverage' => $coverage,
    'data'     => $this->serializePeriod($period->fresh(), ...),
]);
```

**`finalizeAttendance()` (PayrollService:376):**
```php
$period->forceFill([
    'attendance_finalized'    => true,
    'attendance_finalized_at' => now(),
    'attendance_finalized_by' => $userId,
])->save();
```

---

## 3. PRE-FLIGHT DRY-RUN

### 3.1 `PayrollController::preflight()` (382-426)

Read-only. If a run exists it reads its payslips; otherwise it dry-runs `eligibleEmployees()` + `computeForEmployee()` building **transient** Payslip objects (never persisted), then aggregates blocking/warning exceptions:

```php
foreach ($employees as $emp) {
    $attrs = $this->payroll->computeForEmployee($emp, $period, $nameCache, $exitMap);
    foreach ($attrs['exceptions'] as $ex) {
        if ($ex['type'] === 'blocking') { $issues[] = [...]; $blocked += $attrs['net_pay']; }
        elseif ($ex['type'] === 'warning') { $atRisk += $attrs['net_pay']; }
    }
}
return response()->json(['data' => [
    'attendance_finalized' => (bool) $period->attendance_finalized,
    'issues' => $issues, 'blocked_amount' => $blocked, 'at_risk_amount' => $atRisk,
]]);
```

---

## 4. RUNNING PAYROLL (generate) — the heart

### 4.1 `PayrollController::run()` (428-451)

```php
if (!$this->canManage($request->user())) return response()->json([...], 403);
[$month, $year] = $this->resolveMonthYear($request);
$ctx = $this->ctx($request);
if ($msg = $this->requireScope($ctx)) return $msg;
$period = $this->payroll->resolveOrCreatePeriod($ctx, $month, $year);
if ($resp = $this->guardPeriodStarted($period)) return $resp;
try {
    $run = $this->payroll->generate($period, $ctx);          // ← engine
} catch (RuntimeException $e) {
    return response()->json(['message' => $e->getMessage()], 422);  // Rule 1/14 failures
}
$this->audit($request, 'run_payroll', $run, "Payroll generated for {$period->label}");
return response()->json(['message' => 'Payroll generated.', 'data' => $this->serializeRun($run)]);
```

### 4.2 `PayrollService::generate()` (440-543) — annotated

```php
public function generate(PayrollPeriod $period, array $ctx): PayrollRun
{
    // [Rule 1] attendance must be finalized
    if (!$period->attendance_finalized)
        throw new RuntimeException('Finalize attendance before generating payroll.');
    // [Rule 14] a locked (paid) period is immutable
    if ($period->status === 'locked')
        throw new RuntimeException('This cycle is locked. Reopen it to make changes.');

    return DB::transaction(function () use ($period, $ctx) {
        // [Rule 13] row-lock the period to serialise concurrent runs
        $locked = PayrollPeriod::whereKey($period->id)->lockForUpdate()->first();

        $run = $locked->runs()->whereIn('status', ['draft','generated'])->latest('id')->first()
             ?? PayrollRun::create([... 'status' => 'draft', 'generated_by' => $ctx['user_id']]);

        // [Rule 13] regenerate → wipe previous payslips for this run
        $run->payslips()->forceDelete();

        $employees = $this->eligibleEmployees($locked);           // [Rule 7]
        $nameCache = $this->masterNameCaches();
        $exitMap   = $this->exitMap($employees->pluck('id')->all());

        // cross-level dedup: skip employees already paid in a sibling period
        // (same client + month + year, different period id)
        $paidElsewhere = Payslip::where(...)->pluck('employee_id')->flip();

        foreach ($employees as $emp) {
            if (isset($paidElsewhere[$emp->id])) continue;
            $attrs = $this->computeForEmployee($emp, $locked, $nameCache, $exitMap);
            $attrs['branch_id'] = $emp->branch_id ?: $locked->branch_id;   // real branch
            Payslip::create($attrs + ['payroll_run_id' => $run->id, ...]);
        }

        $this->refreshRunTotals($run);
        $run->forceFill(['status' => 'generated', 'generated_at' => now()])->save();
        $locked->forceFill(['status' => 'processing'])->save();
        return $run;
    });
}
```

### 4.3 `PayrollService::eligibleEmployees()` (390-421) **[Rule 7]**

```php
Employee::query()
    ->whereNotIn('status', ['Inactive','Resigned','Terminated'])
    ->where('onboarding_stage_completed', '>=', 6)
    ->when($period->client_id, fn($q) => $q->where('client_id', $period->client_id))
    ->when($period->branch_id, fn($q) => $q->where('branch_id', $period->branch_id))
    ->where(fn($q) => $q->whereNull('date_of_joining')
                        ->orWhere('date_of_joining', '<=', $period->period_end))
    ->get()
    // then drop anyone whose exit LWD < period_start
    ->reject(fn($e) => ($exit[$e->id] ?? null) && $exit[$e->id] < $period->period_start);
```

### 4.4 `PayrollService::computeForEmployee()` (545-841) — step by step

```php
// 0. default attribute array ($base) with every payslip column
// 1. [Rule 5] resolve structure + compensation
$structure = $this->activeStructure($employee, $period->period_end);
[$gross, $basic, $earnComp, $dedComp, $pfApp, $esiApp, $ptApp]
    = $this->resolveCompensation($employee, $structure, $exceptions);
if ($gross <= 0) {                       // no structure and no annual_salary
    return $base + ['status' => 'On Hold', 'hold_reason' => 'Missing salary structure', ...];
}

// 2. [Rule 6] mid-month join/exit proration (calendar-day basis)
$winStart = max($period->period_start, $employee->date_of_joining);
$winEnd   = min($period->period_end,   $exitMap[$employee->id] ?? $period->period_end);
$proration = min(1, ($winStart..$winEnd days) / ($period days));
$effectiveWorkingDays = round($period->working_days * $proration, 2);

// 3. [Rules 2,3] attendance + leave + holidays
$att   = $this->attendanceAggregates($employee->id, $winStart, $winEnd,
                                     $this->shiftStartOf($employee->shift));
$leave = $this->leaveAggregates($employee->id, $winStart, $winEnd);
$holidays = $this->holidayAggregates($employee, $winStart, $winEnd);
$lateLopDays = intdiv($att['late'], 3);                         // [Rule 2] 3 late = 1 LOP
$paidDays = min($effectiveWorkingDays, $att['present'] + $leave['paid'] + $holidays);
$lopDays  = max(0, $effectiveWorkingDays - $paidDays) + $lateLopDays;

// 4. Money — daily basis is TOTAL CALENDAR DAYS (÷30/31); LOP on BASIC only
$proratedGross = $gross * $proration;  $proratedBasic = $basic * $proration;
$lopAmount = min($proratedBasic, ($basic / $totalMonthDays) * $lopDays);
$earnedGross = $proratedGross - $lopAmount;
$earnedBasic = $proratedBasic - $lopAmount;
$earnedFactor = $proratedGross > 0 ? $earnedGross / $proratedGross : 0;

// 5. [Rule 8] PF, ESI, [Rule 9] PT, TDS
$pf = ($pfApp && $employee->pf_eligible && $this->isPfEligibleType($employee) && $earnedBasic > 0)
    ? min($earnedBasic, self::PF_WAGE_CEILING) * self::PF_RATE : 0;                    // 15000 × 12%
$esi = ($esiApp && $earnedGross > 0 && $earnedGross <= self::ESI_GROSS_LIMIT)
    ? $earnedGross * self::ESI_RATE : 0;                                               // 0.75%, ≤21000
$pt  = $ptApp && $earnedGross > 0 ? $this->professionalTax($employee, $earnedGross, $month) : 0;
$tds = $this->structureDeduction($dedComp, 'tds');            // structure line only, no slab engine

// 6. [Rules 4,10] approved OT / bonus  + one-off deduction adjustments
$ot    = $this->approvedOvertimeAmount($employee->id, $period);
$bonus = $this->approvedBonusAmount($employee->id, $period);
$otherAdj = $this->approvedDeductionAdjustments($employee->id, $period);

// 7. [Rule 11] advance recovery, capped so it never exceeds net-before-recovery
$advanceRec = min($this->advanceRecovery($employee->id, $period), $netBeforeRecovery);

// 8. net, floored at 0
$net = max(0, $earnedGross + $ot + $bonus - ($pf + $esi + $pt + $tds + $advanceRec + $other));

// 9. [Rule 12] bank gate + status
if (!$bankVerified) $exceptions[] = ['type' => 'blocking', 'reason' => 'Bank details missing/invalid'];
$status = hasBlocking ? 'On Hold' : (hasWarning ? 'Pending Review' : 'Ready');
$attSource = $att['rows'] === 0 ? 'Manual' : (flagged ? 'Review' : 'Biometric');
return $base merged with all computed columns;
```

### 4.5 `PayrollService::attendanceAggregates()` (969-1030)

This is the method behind the Biometric Input tab (bug #34 fix):

```php
$rows = DB::table('attendances')->where('employee_id', $employeeId)
    ->whereNull('deleted_at')
    ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])
    ->get(['status','check_in_at','check_out_at']);
$shiftStart = $shiftStart ?: '09:30';                          // default shift
foreach ($rows as $r) {
    $status = $r->status; $hasIn = !empty($r->check_in_at); $hasOut = !empty($r->check_out_at);
    // Present → Late when first-in > shift + 10 min (UTC → Asia/Kolkata)
    if (strcasecmp($status, 'Present') === 0 && $hasIn) {
        $localIn = Carbon::parse($r->check_in_at, 'UTC')->setTimezone(self::DISPLAY_TZ)->format('H:i');
        if ($this->minutesBetween($shiftStart, $localIn) > 10) $status = 'Late';
    }
    switch ($status) {
        case 'Present': case 'On Duty': case 'Work From Home': case 'Corrected': $present += 1; break;
        case 'Late':        $present += 1; $late++;    break;
        case 'Half Day':    $present += 0.5;           break;
        case 'Missing In': case 'Missing Out': $present += 1; $missing++; break;
    }
    // "missing punch" = a worked day with only one side of the pair
    if ($worked && ($hasIn xor $hasOut)) $missing++;
}
return ['present' => round($present, 2), 'late' => $late, 'missing' => $missing, 'rows' => $rows->count()];
```

### 4.6 `PayrollService::professionalTax()` (1132) **[Rule 9]**

```php
// Maharashtra slab (hardcoded)
if ($female)  return $gross <= 25000 ? 0 : 200;
if ($gross <= 7500)  return 0;
if ($gross <= 10000) return 175;
return $month === 2 ? 300 : 200;      // Feb ₹300 top-up for the ₹2,500 annual cap
```

---

## 5. APPROVING A RUN **[Rule 14]**

### `PayrollController::approve()` (453-467)

```php
if (!$this->canManage($request->user())) return response()->json([...], 403);
$run = $this->findRun($request);                   // run_id from body or query
if (!$run) abort(404);
if ($run->isLocked()) return response()->json(['message' => 'Already locked.'], 422);
if ($run->total_employees === 0) return response()->json(['message' => 'Nothing to approve.'], 422);
$old = $run->status;
$run->forceFill(['status' => 'approved', 'approved_by' => $uid, 'approved_at' => now()])->save();
$this->audit($request, 'approve_payroll', $run, "…", ['status' => $old], ['status' => 'approved']);
return response()->json(['message' => 'Payroll approved.', 'data' => $this->serializeRun($run)]);
```

---

## 6. DISBURSEMENT **[Rules 12, 13]**

### 6.1 `PayrollController::pay()` (479-516)

```php
if (!$this->canManage($request->user())) return response()->json([...], 403);
$run = $this->findRun($request);
if (!$run) abort(404);
if (!in_array($run->status, ['approved','paid'])) return response()->json([...], 422);
$result = $this->payroll->disburseRun($run, $request->user()->id);   // ['paid'=>, 'held'=>]
$this->audit($request, 'pay_payroll', $run, "…");
return response()->json(['message' => "…", 'data' => ['paid' => …, 'held' => …, 'run' => …]]);
```

### 6.2 `PayrollService::disburseRun()` (176-236)

```php
return DB::transaction(function () use ($run, $userId) {
    $run = PayrollRun::whereKey($run->id)->lockForUpdate()->first();   // row-lock
    $slips = $run->payslips()->get();
    if ($slips->isEmpty()) return ['paid' => 0, 'held' => 0];

    $paid = 0; $held = 0;
    foreach ($slips as $slip) {
        if ($slip->status === 'Paid') continue;
        if ($slip->net_pay <= 0) continue;
        // [Rule 12] re-validate LIVE employee bank at pay time
        $emp = Employee::find($slip->employee_id);
        $bankOk = preg_match('/^[A-Z]{4}0[A-Z0-9]{6}$/', $emp->ifsc_code)
               && preg_match('/^\d{6,18}$/', $emp->bank_account_number);
        $blocking = collect($slip->exceptions)->contains(fn($e) =>
                        $e['type'] === 'blocking' && !str_contains($e['reason'], 'Bank'));
        if ($bankOk && !$blocking) { $slip->update(['status' => 'Paid']); $paid++; }
        else                       { $slip->update(['status' => 'On Hold']); $held++; }
    }
    if ($held === 0) {                       // fully paid → lock the cycle
        $run->update(['status' => 'paid', 'paid_by' => $userId, 'paid_at' => now()]);
        $run->period->update(['status' => 'locked', 'locked_at' => now()]);
    } else {                                 // partial → stays approved / processing
        $run->update(['status' => 'approved']);
        $run->period->update(['status' => 'processing']);
    }
    $this->refreshRunTotals($run);
    return ['paid' => $paid, 'held' => $held];
});
```

The richer **prepare → approve → initiate** disbursement (mode selection, 3-level sign-off, bank file, batch ref) lives in `PayrollPaymentController` and persists to `payroll_payments`.

---

## 7. REOPENING A CYCLE **[Rule 15]**

### `PayrollService::reopen()` (88-128)

```php
DB::transaction(function () use ($period) {
    $run = $period->runs()->latest('id')->first();
    if ($run && $run->status !== 'paid') {
        $run->payslips()->forceDelete();
        PayrollPayment::where('payroll_run_id', $run->id)
            ->where('status', '!=', 'paid')->update(['status' => 'cancelled']);
        $run->forceFill(['status' => 'draft', 'total_employees' => 0,
            'employees_on_hold' => 0, 'total_gross' => 0, 'total_deductions' => 0,
            'total_net' => 0, 'approved_by' => null, 'approved_at' => null])->save();
    }
    $period->forceFill([
        'status' => 'open', 'attendance_finalized' => false,
        'attendance_finalized_at' => null, 'attendance_finalized_by' => null,
        'locked_at' => null,
    ])->save();
});
```
The controller (`reopen()` 352-379) guards first: a **paid** run or any **Paid** payslip is refused with 422 (double-payment protection).

---

## 8. PAYSLIP SERIALIZATION & PDF

### 8.1 `serializePayslip()` (PayrollController ~956-1010)

Maps the stored snapshot into the frontend contract. Key mappings (relevant to recent fixes):

```php
'attendance'  => (float) $p->paid_days,          // "paid days" (reused as Paid Days in exports)
'present'     => (float) $p->present_days,        // actual attendance (Att. column, fix #36)
'lateMarks'   => (int)   $p->late_marks,          // fix #34
'missingPunch'=> (int)   $p->missing_punches,     // fix #34
'mismatch'    => $p->missing_punches > 0 ? 'Missing punches'
                 : ($p->att_source === 'Review' ? 'Late marks' : null),
'attMismatch' => $p->att_source === 'Review',
'bankVerified'=> (bool)  $p->bank_verified,
```
> These are read from the **stored** payslip columns — a snapshot taken at generation time. A cycle generated before the compute fixes shows frozen values until regenerated (paid/locked runs can't be re-run).

### 8.2 `payslipPdf()` (618-646)

```php
$slip = Payslip::with('run:id,status')->find($id);
if (!$slip || !$this->ownsRow($slip, $user)) abort(404);
if ($user is employee && $slip->employee_id !== $ownId) abort(403);
if (in_array($slip->status, ['On Hold','Pending Review'])) return response()->json([...], 422);
$pdf = $this->pdf->render($slip);                        // PayslipPdfService (DomPDF)
return response($pdf, 200, ['Content-Type' => 'application/pdf',
    'Content-Disposition' => ($download ? 'attachment' : 'inline') . '; filename="…"']);
```

---

## 9. FULL & FINAL **[Rule 21]**

### `PayrollService::computeFnf()` (256-328)

```php
public function computeFnf(Employee $employee, array $opts = []): array
{
    $lwd = employee_exits.last_working_day ?? now();
    // final-month salary, adding back the deducted advance EMI (advance recovered once)
    $finalSalary = $this->computeForEmployee($employee, $finalPeriod);
    // leave encashment on BASIC per calendar day
    $encash = ($basic / $monthCalendarDays) * $opts['leave_encashment_days'];
    $additions  = $finalNet + $encash + approvedBonus + $opts['other_dues'];
    $deductions = outstandingAdvances + $opts['notice_recovery_amount'] + $opts['other_deductions'];
    return [/* full breakdown */];   // NOT persisted
}
```
The controller `fnf()` (521-563) requires an `employee_exits` record (422 otherwise), validates the four numeric `$opts` (query params), and returns `{ data: <settlement> }`.

---

## 10. FRONTEND ORCHESTRATION (`HrPayroll.tsx`)

### 10.1 Run → approve → pay handlers

```tsx
const runPayroll = async () => {
  if (!periodMeta?.attendance_finalized)
    await api.post('/payroll/finalize-attendance', { month, year });   // step 1
  await api.post('/payroll/run', { month, year });                      // step 3
  await reloadCycle();
  setRunOpen(true);   // show PayrollRunModal (pre-flight/success)
};

const proceedToPay = async () => {
  if (runMeta && !['approved','paid'].includes(runMeta.status))
    await api.post('/payroll/approve', { run_id: runMeta.id });         // step 5
  setPaymentRunId(runMeta.id);
  setPaymentOpen(true);   // PaymentDisbursementModal → POST /payroll/payment/*
};

const reopenPayroll = async () => {
  await api.post('/payroll/reopen', { month, year });                   // Rule 15
  await reloadCycle();
};
```

### 10.2 The "Att." column (fix #36)

```tsx
// Shows PRESENT days (attendance record), not paid_days, over working days
const wd = periodMeta?.working_days || 26;
const low = r.present < wd;
<span data-att={low ? 'low' : 'ok'}>{r.present}/{wd}</span>
```

### 10.3 Bank-details edit (fix #35) — `PayrollTab.tsx`

```tsx
await api.put(`/employees/${empDetail.id}/bank-details`, {
  salary_payment_mode, bank_name, bank_account_number,
  ifsc_code: ifsc.toUpperCase(), account_holder_name, bank_branch, bank_account_type,
});
setEmpDetail(prev => ({ ...prev, ...payload }));   // local merge, no refetch
```
Backend `EmployeeController::updateBankDetails()` allows the employee (self) or an HR user with `can_edit`, validates only the bank columns, and writes only those.

---

## 11. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Tenant scope from the user | `ctx()`, `eligibleEmployees()` | Never trust body `client_id` (Rule 20) |
| Row lock on the mutated aggregate | `generate()`, `disburseRun()` | Serialise concurrent runs / payments (Rule 13) |
| Snapshot compute columns | `Payslip` | Reproducibility; paid runs immutable |
| Best-effort audit | `audit()` → `activity_logs` | Never blocks the action (Rule 18) |
| Schema-guarded optional sources | overtime/bonus/holiday tables | Resolve to 0 if the table is absent |
| Structure versioning | `activeStructure()` | Drafts excluded; supersede not overwrite (Rule 19) |

---

## 12. RECENT FIX REFERENCE (2026-06/07)

| Bug | Area | Fix |
|---|---|---|
| #34 | Biometric Input late/missing showing 0 | `attendanceAggregates` computes Late/Missing; stored on payslip; `serializePayslip` maps them; stale runs backfilled |
| #35 | Bank details not editable | New `PUT /employees/{id}/bank-details` (self-or-can_edit) + edit modal in `PayrollTab` |
| #36 | Att. column showed paid days | Processing "Att." cell now uses `present` over working days |
| #37 | Year dropdown defaulted to prior year | Cycle-select effect prefers current year / active cycle |

---

*Related documents: PAYROLL_TECHNICAL_DOCUMENTATION.md · PAYROLL_FUNCTIONAL_DOCUMENTATION.md · PAYROLL_API_DOCUMENTATION.md*
