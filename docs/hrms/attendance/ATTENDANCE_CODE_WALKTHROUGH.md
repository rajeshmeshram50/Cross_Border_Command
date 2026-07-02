# ATTENDANCE MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Attendance
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: enrol → clock-in (facePunch) → status derivation → HR review → regularization → payroll. Files: `AttendanceController.php`, `FaceBiometricController.php`, `AttendanceRegularizationController.php`, `ClockIn.tsx`, `HrAttendance.tsx`. Legend: `→` a call · `⇒` a return.

---

## 1. FACE ENROLMENT

### `FaceBiometricController::register()`
```php
$data = $request->validate(['descriptor'=>'required|array|size:128','descriptor.*'=>'numeric',
                            'consent'=>'required|accepted','employee_id'=>'nullable']);
$emp = $this->resolveTarget($request);           // self / super / same-tenant
if ($emp->isDisabled()) return 422;
// dedup: scan OTHER enrolled faces in tenant; if any distance ≤ 0.50 → ValidationException (name conflict)
$emp->update(['face_descriptor'=>$data['descriptor'], 'face_registered_at'=>now(),
              'face_consent_given_at'=>$emp->face_consent_given_at ?? now(),
              'face_consent_revoked_at'=>null, 'biometric_status'=>'Registered']);
```
`status` never returns the raw descriptor; `revoke` nulls the descriptor + consent and anonymizes stored match distances.

---

## 2. CLOCK IN / OUT (the core write)

### `AttendanceController::facePunch(Request, $expected)`
```php
$data = $request->validate(['descriptor'=>'required|array|size:128','descriptor.*'=>'numeric|between:-5,5',
                            'label'=>'nullable|max:50','lat'=>'numeric','lng'=>'numeric']);
$emp = $this->callerEmployee();
if (empty($emp->face_descriptor) || !$emp->face_registered_at)
    return response()->json(['message'=>'…','need_enroll'=>true], 422);

$distance = $this->euclideanDistance($data['descriptor'], $emp->face_descriptor);
if ($distance > self::MATCH_THRESHOLD)           // 0.55
    return response()->json(['message'=>'Face not recognized','distance'=>$distance,'threshold'=>0.55,'matched'=>false], 422);

DB::transaction(function () use (...) {
    $day = Attendance::where('employee_id',$emp->id)->whereDate('attendance_date', $todayLocal)
                     ->lockForUpdate()->first()                 // serialize double-tap
           ?? Attendance::create([... 'status'=>'Present' ...]);
    $nextDir = $day->next_direction;                            // server truth from last punch
    if ($expected !== $nextDir)
        return response()->json(['message'=>"You must clock {$nextDir} next",'matched'=>true,'next_direction'=>$nextDir], 422);  // strict alternation

    $label = $data['label'] ?? ($expected==='in' ? ($firstPunch ? 'Check In' : 'Step In') : 'Step Out');
    AttendancePunch::create(['attendance_id'=>$day->id,'employee_id'=>$emp->id,'punched_at'=>now(),
        'direction'=>$expected,'label'=>$label,'method'=>'face','match_distance'=>$distance,'ip'=>..., 'lat'=>..., 'lng'=>...]);
    $this->recomputeSummary($day);                              // first-in / last-out onto parent
    return response()->json(['message'=>'…','matched'=>true,'distance'=>$distance,'punch'=>$punch,'record'=>$day,'next_direction'=>$day->next_direction]);
});
```

### Frontend (`ClockIn.tsx`)
```tsx
const today = await api.get('/attendance/today');   // → next_direction + allowed_labels
// capture descriptor via <FaceCapture/>; pick a quick-label chip valid for next_direction
await api.post(`/attendance/face/clock-${dir}`, { descriptor, label, lat, lng });
// handle need_enroll / matched:false / alternation errors
```

---

## 3. STATUS DERIVATION (read-time)

### `resolveDayStatus()` / `buildHistoryLogs()`
```php
$shiftStart = parseShiftWindow($emp->shift) ?? '09:30';        // default
$localIn = Carbon::parse($firstIn,'UTC')->setTimezone(self::DISPLAY_TZ)->format('H:i');
if (minutesBetween($shiftStart, $localIn) > 10) $status = 'Late';   // 10-min grace
// Missing In/Out when only one side of the pair exists; Weekly Off / Holiday / Absent fallbacks
```
Worked time uses an epoch-based sum, capped by `AUTO_CHECKOUT_HOUR = 21:00` for a forgotten Check Out.

---

## 4. HR DAILY-VIEW

### `AttendanceController::dailyView()`
```php
if ($user->user_type === 'employee') abort(403);
// eligible employees: attendance_tracking, status Active, onboarding_stage_completed >= 6
// branch_user hard-pinned to own branch; client_admin filterable; super_admin all
// per employee: firstIn/lastOut, workedMinutes, presentDays, lateMarks, missingPunch,
//   compliancePct = presentDays / trackedWorkingDays (excludes off/holiday/leave/pre-join/future)
return response()->json($rows);   // bare array
```

---

## 5. REGULARIZATION

### `AttendanceRegularizationController::store()` → `applyApprovedAdjustment()`
```php
// store: validate mode adjust/exempt, punches[], reason; guards (no future date, one Pending/day);
//   snapshot RM chain; auto-approve if RM missing/self-loop → applyApprovedAdjustment()
// approve/reject: setStatus() — must be Pending; RM or admin; NO self-approval;
//   on Approved (adjust) → applyApprovedAdjustment()

applyApprovedAdjustment():   // adjust mode only
  DB::transaction + lockForUpdate on the day row
  delete & REPLACE the day's punches with the approved set
  flatten {in,out} → time-ordered events (IST → UTC), enforce alternation, label them
  method='manual', note "Regularized (request #id)"; recomputeSummary; status='Present'
```

---

## 6. PAYROLL HANDOFF
`PayrollService::attendanceAggregates(employeeId, start, end)` reads `attendances` for the window, promotes Present→Late (>shift+10min, IST), derives missing punches (one-sided pair), and returns `present/late/missing/rows` → stored on the payslip (`late_marks`, `missing_punches`, `att_source`). See `docs/payroll/`.

---

## 7. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Euclidean face match | facePunch / register | 0.55 attend, 0.50 enroll/login |
| Day-row lock | facePunch / applyApprovedAdjustment | Serialize taps/corrections |
| Server-truth direction | next_direction | Strict alternation, no client trust |
| UTC store / IST read | everywhere | Consistent times |
| Read-time status | resolveDayStatus | No scheduler needed |
| Descriptor $hidden | Employee model | Never leak biometrics |

---

## 8. NOTES & CAVEATS
- No FaceBiometric table (descriptor on `employees`, `$hidden`).
- `attendance_regularizations` has no DB FKs.
- Attendance APIs are user-type/tenant gated (menu `hr.attendance` governs `can_view`).
- `AttendanceBackfillController` is a key-guarded one-off seeder (public `/tools/attendance-backfill`).
- DB is PostgreSQL.

---

*Related documents: ATTENDANCE_TECHNICAL_DOCUMENTATION.md · ATTENDANCE_FUNCTIONAL_DOCUMENTATION.md · ATTENDANCE_API_DOCUMENTATION.md*
