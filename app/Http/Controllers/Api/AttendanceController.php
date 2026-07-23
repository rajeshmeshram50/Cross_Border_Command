<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\AttendancePunch;
use App\Models\Branch;  
use App\Models\Employee;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;


class AttendanceController extends Controller
{
    private const MATCH_THRESHOLD = 0.55;
    private const DESCRIPTOR_LEN  = 128;

   
    private const DISPLAY_TZ = 'Asia/Kolkata';

   
    private static function todayLocal(): string
    {
        return now(self::DISPLAY_TZ)->toDateString();
    }

    
    private const KNOWN_LABELS = [
        'Check In', 'Step Out', 'Step In', 'Lunch Out', 'Lunch In',
        'Meeting', 'Check Out',
    ];

    public function today(Request $request)
    {
        $employee = $this->callerEmployee($request);
        $row = Attendance::with('punches')
            ->where('employee_id', $employee->id)
            ->whereDate('attendance_date', self::todayLocal())
            ->first();
        return response()->json([
            'date'     => self::todayLocal(),
            'employee' => [
                'id'              => $employee->id,
                'emp_code'        => $employee->emp_code,
                'name'            => $employee->display_name,
                'face_registered' => !empty($employee->face_descriptor) && $employee->face_registered_at !== null,
            ],
            'record'   => $row,
            // Convenience flags so the SPA doesn't have to derive them.
            'next_direction' => $row ? $row->next_direction : 'in',
            'allowed_labels' => self::KNOWN_LABELS,
        ]);
    }

   
    public function my(Request $request)
    {
        $employee = $this->callerEmployee($request);
        $q = Attendance::with('punches')
            ->where('employee_id', $employee->id)
            ->orderByDesc('attendance_date');
        if ($from = $request->query('from')) $q->whereDate('attendance_date', '>=', $from);
        if ($to   = $request->query('to'))   $q->whereDate('attendance_date', '<=', $to);
        return response()->json($q->paginate((int) $request->query('per_page', 30)));
    }

    public function faceClockIn(Request $request)
    {
        return $this->facePunch($request, expected: 'in');
    }

    public function faceClockOut(Request $request)
    {
        return $this->facePunch($request, expected: 'out');
    }

  
    public function employeeSummary(Request $request, string $employeeId)
    {
        $user = $request->user();
        if (!$user) abort(401, 'Unauthenticated');

        // Route param can be either the DB id (numeric) OR the emp_code
        // (e.g. "EMP-001") since the SPA's EmployeeProfile URL slug is the
        // emp_code. emp_code is unique PER TENANT, not globally, so two
        // employees in different tenants can both have "EMP-001" — without
        // scoping the lookup we'd silently pick whichever has the lower id
        // and then 403 against the viewer when the access check fails on
        // the wrong row. Scope to the user's tenant (super_admin sees any).
        if (ctype_digit($employeeId)) {
            $emp = Employee::find((int) $employeeId);
        } else {
            $q = Employee::where('emp_code', $employeeId);
            if ($user->user_type !== 'super_admin') {
                $q->where(function ($w) use ($user) {
                    $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
                });
            }
            $emp = $q->first();
            // If a tenant-scoped lookup found nothing, fall back to a global
            // lookup so the self-path (employee viewing their OWN profile via
            // /profile, which uses their emp_code) still works even when the
            // row's client_id is null but the user has a client_id set.
            if (!$emp) {
                $emp = Employee::where('emp_code', $employeeId)->first();
            }
        }
        if (!$emp) abort(404, 'Employee not found.');

        // Access check — self OR admin in same tenant OR super_admin.
        $isSelf = Employee::where('id', $emp->id)->where('user_id', $user->id)->exists();
        // A14: strict tenant match. The self-path is already covered by $isSelf,
        // so a null client_id must NOT count as "same tenant" for admins (that
        // let any tenant read a client-less employee's attendance).
        $sameTenant = (int) $emp->client_id === (int) $user->client_id;
        if (!$isSelf && $user->user_type !== 'super_admin' && !(
            in_array($user->user_type, ['client_admin', 'client_user', 'branch_user'], true) && $sameTenant
        )) {
            abort(403, 'You do not have access to this employee.');
        }

        // Month window — defaults to the LOCAL current month. Without this,
        // the first 5.5 hours of every IST month would render the previous
        // month (Laravel's now() is UTC) so an employee opening their
        // profile at 4 AM IST on the 1st saw the previous month's data.
        $monthQ = (string) $request->query('month', now(self::DISPLAY_TZ)->format('Y-m'));
        if (!preg_match('/^\d{4}-\d{2}$/', $monthQ)) $monthQ = now(self::DISPLAY_TZ)->format('Y-m');
        $start = \Carbon\Carbon::createFromFormat('Y-m-d', $monthQ . '-01')->startOfMonth();
        $end   = (clone $start)->endOfMonth();

        // Today's row with punches — drives the Today card on the profile.
        $today = Attendance::with('punches')
            ->where('employee_id', $emp->id)
            ->whereDate('attendance_date', self::todayLocal())
            ->first();

        // Month history — every day in window, ordered most-recent-first.
        $history = Attendance::with('punches')
            ->where('employee_id', $emp->id)
            ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])
            ->orderByDesc('attendance_date')
            ->get();

        // Stats — derived from history. The late heuristic compares the
        // first-in punch (converted from UTC to the display TZ) against the
        // employee's shift start, falling back to 09:30 when the shift
        // string has no parseable time pair. Without the tz conversion the
        // comparison ran against UTC time and never flagged anyone late.
        [$shiftStart, $shiftEnd] = $this->parseShiftWindow((string) ($emp->shift ?? ''));
        $shiftStart = $shiftStart ?: '09:30';
        $shiftEnd   = $shiftEnd   ?: '18:30';
        $todayStr = self::todayLocal();
        $present  = 0; $late = 0; $missingBio = 0; $leaveDays = 0;
        foreach ($history as $row) {
            $status = (string) ($row->status ?? '');
            $rowIso = \Carbon\Carbon::parse($row->attendance_date)->toDateString();
            if (strcasecmp($status, 'Present') === 0)  $present++;
            if (strcasecmp($status, 'Late') === 0)     { $late++; $present++; } // late still counts as present
            // Leave days are counted from approved LeaveRequests below (bug #18):
            // the attendance table doesn't store a 'Leave' status row, so this
            // raw check always yielded 0 even when the employee was on approved
            // leave. The daily view overlays 'Leave' at read time — mirror that.
            if (strcasecmp($status, 'Missing In') === 0 || strcasecmp($status, 'Missing Out') === 0) {
                $missingBio++;
            } elseif ($rowIso < $todayStr && $row->check_in_at && !$row->check_out_at) {
                // Clocked in on a past day but never clocked out → missing punch.
                $missingBio++;
            }
            // Heuristic late check on top of stored status. Must match the
            // 10-min grace used by resolveDayStatus() — using a raw string
            // compare here (`$localIn > $shiftStart`) was a bug: it counted
            // anyone clocked in even one minute past shift_start as late,
            // contradicting the documented heuristic and double-counting
            // employees the read-time promotion already marked Late.
            $firstIn = $row->check_in_at;
            if ($firstIn && strcasecmp($status, 'Present') === 0) {
                $localIn = $firstIn->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i');
                if ($this->minutesBetween($shiftStart, $localIn) > 10) $late++;
            }
        }

        // Holidays for this employee's group across the log window (the month),
        // so holiday days surface as "Holiday" in the Log + Calendar.
        $empHolidaySet = $emp->holiday_group_id
            ? ($this->holidayDatesForGroups([$emp->holiday_group_id], (clone $start), (clone $end))[$emp->holiday_group_id] ?? [])
            : [];

        // Total Leaves KPI (bug #18) — count the working days in the month window
        // covered by an APPROVED leave request. Weekly-offs and holidays are
        // excluded so a leave spanning a weekend doesn't inflate the count,
        // matching the daily-view overlay (which only turns an "Absent" day into
        // "Leave"). Distinct-day set guards against overlapping requests.
        $weeklyOffSet = $this->parseWeeklyOff((string) ($emp->weekly_off ?? ''));
        $approvedLeaves = \App\Models\LeaveRequest::query()
            ->where('employee_id', $emp->id)
            ->where('status', 'Approved')
            ->whereDate('from_date', '<=', $end->toDateString())
            ->whereDate('to_date', '>=', $start->toDateString())
            ->get(['from_date', 'to_date', 'leave_type_id']);
        // Paid vs Unpaid per leave type (master_leave_types.paid_unpaid) so the
        // Attendance Log can label each leave day "Paid Leave" / "Unpaid Leave".
        $paidByType = \App\Models\Masters\LeaveTypes::whereIn('id', $approvedLeaves->pluck('leave_type_id')->filter()->unique()->all())
            ->pluck('paid_unpaid', 'id');
        // $leaveDaySet[iso] = 'Paid' | 'Unpaid' — drives both the KPI count and
        // the per-day leave overlay in buildHistoryLogs().
        $leaveDaySet = [];
        foreach ($approvedLeaves as $lv) {
            $paid = strcasecmp((string) ($paidByType[$lv->leave_type_id] ?? 'Paid'), 'Unpaid') === 0 ? 'Unpaid' : 'Paid';
            $fromC = \Carbon\Carbon::parse($lv->from_date);
            $toC   = \Carbon\Carbon::parse($lv->to_date);
            $cursor = $fromC->lt($start) ? $start->copy() : $fromC->copy();
            $till   = $toC->gt($end)     ? $end->copy()   : $toC->copy();
            for ($c = $cursor->copy(); $c->lte($till); $c->addDay()) {
                $iso = $c->toDateString();
                if (isset($leaveDaySet[$iso])) continue;
                if (isset($weeklyOffSet[$c->dayOfWeek])) continue; // weekend isn't a leave day
                if (isset($empHolidaySet[$iso])) continue;         // holiday isn't a leave day
                $leaveDaySet[$iso] = $paid;
            }
        }
        $leaveDays = count($leaveDaySet);

        return response()->json([
            'employee' => [
                'id'              => $emp->id,
                'emp_code'        => $emp->emp_code,
                'name'            => $emp->display_name,
                'face_registered' => !empty($emp->face_descriptor) && $emp->face_registered_at !== null,
                'shift_start'     => $shiftStart,
                'shift_end'       => $shiftEnd,
            ],
            'month' => $monthQ,
            'stats' => [
                'present_days'      => $present,
                'late_marks'        => $late,
                'missing_biometric' => $missingBio,
                'total_leaves'      => $leaveDays,
            ],
            'today'   => $today,
            'history' => $history,
            // Rich per-day logs (same shape the HR Attendance "Logs & Requests"
            // view consumes) so the employee profile can render the identical
            // visual-bar / effective-gross / arrival / calendar UI.
            'shift'            => (string) ($emp->shift ?: '—'),
            'shift_start'      => $shiftStart,
            'shift_end'        => $shiftEnd,
            'weekly_off'       => (string) ($emp->weekly_off ?? ''),
            'expected_minutes' => $this->expectedMinutesFromWindow($shiftStart, $shiftEnd),
            'logs'             => $this->buildHistoryLogs(
                $history,
                $emp,
                $shiftStart,
                $this->expectedMinutesFromWindow($shiftStart, $shiftEnd),
                $this->parseWeeklyOff((string) ($emp->weekly_off ?? '')),
                $start->toDateString(),
                $end->toDateString(),
                $empHolidaySet,
                $leaveDaySet
            ),
        ]);
    }

   

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401, 'Unauthenticated');
        if ($user->user_type === 'employee') abort(403, 'Use /api/attendance/my for your own records.');

        $q = Attendance::with([
            'punches',
            'employee:id,display_name,emp_code,department_id',
            'employee.department:id,name',
            'branch:id,name',
        ])
            ->orderByDesc('attendance_date')
            ->orderByDesc('check_in_at');

        if ($user->user_type !== 'super_admin') {
            $q->where('client_id', $user->client_id);
            // A13: a branch user is HARD-pinned to their own branch — pin
            // first, so passing a sibling branch_id can't leak other branches'
            // attendance. Only client admins may use the filter (every branch
            // is an isolated peer).
            if ($user->user_type === 'branch_user') {
                $q->where('branch_id', $user->branch_id);
            } else {
                $branchFilter = $request->integer('branch_id') ?: null;
                if ($branchFilter !== null) {
                    $belongs = Branch::where('id', $branchFilter)
                        ->where('client_id', $user->client_id)
                        ->exists();
                    if ($belongs) $q->where('branch_id', $branchFilter);
                }
            }
        } elseif ($branchFilter = $request->integer('branch_id') ?: null) {
            $q->where('branch_id', $branchFilter);
        }

        // A17: validate date filters so a malformed value returns 422 instead of
        // silently passing junk to whereDate and yielding a confusing empty list.
        $request->validate([
            'date' => ['nullable', 'date'],
            'from' => ['nullable', 'date'],
            'to'   => ['nullable', 'date', 'after_or_equal:from'],
        ]);

        if ($date   = $request->query('date'))        $q->whereDate('attendance_date', $date);
        if ($from   = $request->query('from'))        $q->whereDate('attendance_date', '>=', $from);
        if ($to     = $request->query('to'))          $q->whereDate('attendance_date', '<=', $to);
        if ($eid    = $request->query('employee_id')) $q->where('employee_id', (int) $eid);
        if ($status = $request->query('status'))      $q->where('status', $status);

        return response()->json($q->paginate((int) $request->query('per_page', 50)));
    }

    
    public function dailyView(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401, 'Unauthenticated');
        if ($user->user_type === 'employee') abort(403, 'Use /api/attendance/my for your own records.');

        $date = (string) $request->query('date', self::todayLocal());
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = self::todayLocal();
        }
        $dateC      = \Carbon\Carbon::parse($date);
        $monthStart = (clone $dateC)->startOfMonth()->toDateString();
        $monthEnd   = (clone $dateC)->endOfMonth()->toDateString();
        // 90-day log window so the month range pills (THIS MONTH + previous
        // 6 months on the SPA) actually have data to filter against — and so
        // the Calendar tab can light up cells in any of those months without
        // a separate refetch.
        $histStart  = (clone $dateC)->subDays(89)->toDateString();

        // ── 1) Resolve which employees the caller is allowed to see ──
        $empQ = Employee::query()
            ->where('attendance_tracking', true)
            ->where('status', 'Active')
            // Only fully-onboarded employees belong in the Attendance Sheet.
            // An employee still mid-onboarding (onboarding_stage_completed < 6)
            // has no settled org context yet and must not be available for
            // attendance marking until HR finishes onboarding (stage 6). Mirrors
            // the "onboarded_only" gate used by managers() / Exit Management.
            ->where('onboarding_stage_completed', '>=', 6)
            ->with([
                'department:id,name',
                'designation:id,name',
                'reportingManager:id,first_name,last_name,display_name',
            ])
            ->orderBy('display_name');

        if ($user->user_type !== 'super_admin') {
            $empQ->where('client_id', $user->client_id);
            $branchFilter = $request->integer('branch_id') ?: null;

            // A branch_user is always pinned to their own branch — doesn't
            // matter what `branch_id` query param they send. A bad
            // (cross-tenant) value used to fall through and surface every
            // employee in the client, which leaked rows across branches.
            // Only client admins can switch branches within the tenant.
            $isSubBranchUser = $user->user_type === 'branch_user';
            if ($isSubBranchUser) {
                $empQ->where('branch_id', $user->branch_id);
            } elseif ($branchFilter !== null) {
                $belongs = Branch::where('id', $branchFilter)
                    ->where('client_id', $user->client_id)
                    ->exists();
                if ($belongs) $empQ->where('branch_id', $branchFilter);
            }
        } elseif ($branchFilter = $request->integer('branch_id') ?: null) {
            $empQ->where('branch_id', $branchFilter);
        }

        $employees = $empQ->get();
        if ($employees->isEmpty()) {
            return response()->json([]);
        }

        $empIds = $employees->pluck('id')->all();

        // ── 2) Load attendance for selected date + MTD + last 30 days ──
        $dailyRows = Attendance::with('punches')
            ->whereIn('employee_id', $empIds)
            ->whereDate('attendance_date', $date)
            ->get()
            ->keyBy('employee_id');

        $monthRows = Attendance::whereIn('employee_id', $empIds)
            ->whereBetween('attendance_date', [$monthStart, $monthEnd])
            ->get(['employee_id', 'attendance_date', 'status', 'check_in_at', 'check_out_at'])
            ->groupBy('employee_id');

        $historyRows = Attendance::with('punches')
            ->whereIn('employee_id', $empIds)
            ->whereBetween('attendance_date', [$histStart, $date])
            ->orderByDesc('attendance_date')
            ->get()
            ->groupBy('employee_id');

        // ── 2b) Preload company holidays so compliance can exclude them ──
        // Compliance is "present days ÷ working days elapsed this month".
        // A working day is any calendar day that is NOT a weekly-off and NOT
        // a company holiday from the employee's holiday group. Holidays are
        // loaded once per request (keyed by group) to avoid an N+1.
        $holidayGroupIds = $employees->pluck('holiday_group_id')->filter()->unique()->values()->all();
        $holidayByGroup  = $this->holidayDatesForGroups($holidayGroupIds, (clone $dateC)->startOfMonth(), (clone $dateC)->endOfMonth());
        // Wider holiday set covering the full 90-day Log / Calendar window, so
        // holidays outside the current month still surface in the log/calendar.
        $holidayByGroupLog = $this->holidayDatesForGroups($holidayGroupIds, \Carbon\Carbon::parse($histStart), (clone $dateC));

        // Denominator window end = month-to-date: never count days in the
        // future toward "absent". For a fully-past month this is the month
        // end; for the current month it stops at today.
        $monthEndC = (clone $dateC)->endOfMonth();
        $todayC    = \Carbon\Carbon::parse(self::todayLocal());
        $mtdEndC   = $monthEndC->lte($todayC) ? $monthEndC : $todayC;

        // ── 3) Compose per-employee payload in the shape the SPA expects ──
        // Default office window used when an employee's `shift` string has
        // no parseable time pair (e.g. just "General Shift"). Late-by-minutes
        // and the historic late heuristic both fall back to this so the KPIs
        // stay meaningful even when shift data is incomplete.
        $defaultShiftStart = '09:30';
        $defaultShiftEnd   = '18:30';

        // Approved-leave overlay — an employee with an approved leave covering
        // the selected date should read "Leave", not "Absent", even though they
        // have no attendance row for the day. (Bug: on-leave employees showed
        // Absent in the list and Today's Record.)
        $onLeaveSet = [];
        $empIdsForLeave = $employees->pluck('id')->filter()->all();
        if (!empty($empIdsForLeave)) {
            $leaveEmpIds = \App\Models\LeaveRequest::query()
                ->whereIn('employee_id', $empIdsForLeave)
                ->where('status', 'Approved')
                ->whereDate('from_date', '<=', $date)
                ->whereDate('to_date', '>=', $date)
                ->pluck('employee_id')->all();
            foreach ($leaveEmpIds as $lid) $onLeaveSet[(int) $lid] = true;
        }

        // Approved-leave days across the WHOLE month, keyed employee → ISO-day
        // set. The compliance denominator must exclude these (a sanctioned
        // absence neither helps nor hurts the score) — but leaves aren't stored
        // in the attendance table, so trackedWorkingDays could never "see" them
        // and counted them as expected working days, understating compliance
        // (bug #20). Precompute once here to avoid an N+1 in the map.
        $monthStartC = (clone $dateC)->startOfMonth();
        $leaveDaysByEmp = [];
        if (!empty($empIdsForLeave)) {
            $mLeaves = \App\Models\LeaveRequest::query()
                ->whereIn('employee_id', $empIdsForLeave)
                ->where('status', 'Approved')
                ->whereDate('from_date', '<=', $monthEndC->toDateString())
                ->whereDate('to_date', '>=', $monthStartC->toDateString())
                ->get(['employee_id', 'from_date', 'to_date']);
            foreach ($mLeaves as $lv) {
                $fromC = \Carbon\Carbon::parse($lv->from_date);
                $toC   = \Carbon\Carbon::parse($lv->to_date);
                $c   = $fromC->lt($monthStartC) ? $monthStartC->copy() : $fromC->copy();
                $end = $toC->gt($monthEndC)     ? $monthEndC->copy()   : $toC->copy();
                for ($d = $c->copy(); $d->lte($end); $d->addDay()) {
                    $leaveDaysByEmp[(int) $lv->employee_id][$d->toDateString()] = true;
                }
            }
        }

        $out = $employees->map(function (Employee $emp) use ($dailyRows, $monthRows, $historyRows, $date, $histStart, $defaultShiftStart, $defaultShiftEnd, $holidayByGroup, $holidayByGroupLog, $mtdEndC, $dateC, $onLeaveSet, $leaveDaysByEmp) {
            [$parsedStart, $parsedEnd] = $this->parseShiftWindow((string) ($emp->shift ?? ''));
            $shiftStart = $parsedStart ?: $defaultShiftStart;
            $shiftEnd   = $parsedEnd   ?: $defaultShiftEnd;
            $expectedMinutes = $this->expectedMinutesFromWindow($shiftStart, $shiftEnd);
            $weeklyOffSet    = $this->parseWeeklyOff((string) ($emp->weekly_off ?? ''));
            $isWeeklyOff     = isset($weeklyOffSet[\Carbon\Carbon::parse($date)->dayOfWeek]);

            $today    = $dailyRows->get($emp->id);
            $todayPunches = $today ? $today->punches->sortBy('punched_at')->values() : collect();

            // Determine status for the selected date.
            $statusToday = $this->resolveDayStatus($today, $isWeeklyOff, $shiftStart, $date);
            // Approved leave wins over an "Absent" reading (no attendance row).
            if (isset($onLeaveSet[$emp->id]) && strcasecmp($statusToday, 'Absent') === 0) {
                $statusToday = 'Leave';
            }
            $firstIn     = $today?->check_in_at ? $today->check_in_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i') : null;
            $lastOut     = $today?->check_out_at ? $today->check_out_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i') : null;
            // Full worked total (completed pairs + any open pair auto-closed at
            // 9 PM) — used for static / past-day display.
            $workedSecs  = $today ? (int) $today->total_worked_seconds : 0;
            $workedMins  = (int) floor($workedSecs / 60);

            // Live-tick inputs. For an OPEN day (clocked-in, not yet out) the SPA
            // re-derives the running total each second as:
            //     completedSeconds + (min(now, autoCutoff) − openInAt)
            // so the WORKED figure ticks up to a 9 PM auto-checkout and then
            // freezes — matching the employee's own Clock-In screen. Past days
            // have no open punch, so the SPA just shows $workedSecs (already
            // capped at 9 PM by the model).
            $workedCompletedSecs = $today ? (int) $today->completedWorkedSeconds() : 0;
            $openInAt  = null;
            $autoCutoffAt = \Carbon\Carbon::parse($date . ' 21:00:00', self::DISPLAY_TZ)->toIso8601String();
            $lastPunch = $todayPunches->last();
            if ($lastPunch && $lastPunch->direction === 'in' && $lastPunch->punched_at) {
                $openInAt = $lastPunch->punched_at->toIso8601String();
            }

            $lateByMinutes = 0;
            if ($firstIn && $shiftStart) {
                $diff = $this->minutesBetween($shiftStart, $firstIn);
                if ($diff > 0) $lateByMinutes = $diff;
            }

            // KPIs — month-to-date
            $mRows = $monthRows->get($emp->id, collect());
            $presentDays = 0; $lateMarks = 0; $missingPunch = 0;
            $mByIso = [];
            foreach ($mRows as $r) {
                $mByIso[\Carbon\Carbon::parse($r->attendance_date)->toDateString()] = $r;
                $st = strtolower((string) $r->status);
                if (in_array($st, ['present', 'late', 'on duty', 'work from home', 'corrected', 'half day'], true)) {
                    $presentDays++;
                }
                if ($st === 'late' || $st === 'half day') $lateMarks++;
                if ($st === 'missing in' || $st === 'missing out') {
                    $missingPunch++;
                } elseif ($r->check_in_at && !$r->check_out_at
                    && \Carbon\Carbon::parse($r->attendance_date)->toDateString() < self::todayLocal()) {
                    // Clocked in on a past day but never clocked out → missing punch.
                    $missingPunch++;
                }
                // Heuristic late on top of stored status — shift_start is in
                // local time, so the punch timestamp must be converted from
                // UTC before comparing.
                if ($r->check_in_at && $shiftStart) {
                    $localIn = $r->check_in_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i');
                    $late = $this->minutesBetween($shiftStart, $localIn);
                    if ($late > 10 && $st === 'present') $lateMarks++;
                }
            }

            // Compliance = present days ÷ working days ELAPSED this month.
            // The denominator must walk the calendar — NOT just the days that
            // happen to have an attendance row — otherwise an employee who
            // punched a single day reads 1/1 = 100 % while every absent
            // working day (which has no row at all) is silently ignored.
            // Sanctioned days (weekly-off, company holiday, approved leave),
            // future days, and days before the employee joined are excluded
            // from the denominator so they neither help nor hurt the score.
            $holidaySet  = $holidayByGroup[$emp->holiday_group_id] ?? [];
            $joinDate    = $emp->date_of_joining ? \Carbon\Carbon::parse($emp->date_of_joining) : null;
            $tracked     = $this->trackedWorkingDays(
                (clone $dateC)->startOfMonth(), $mtdEndC, $joinDate, $weeklyOffSet, $holidaySet, $mByIso,
                $leaveDaysByEmp[$emp->id] ?? []
            );
            $compliancePct = $tracked === 0
                ? 100
                : (int) round(min(100, max(0, $presentDays / $tracked * 100)));

            // 90-day log — covers EVERY day in the window so the calendar
            // and the month range pills paint a full picture, not just the
            // days the employee happened to punch.
            $hRows = $historyRows->get($emp->id, collect());
            $logs = $this->buildHistoryLogs($hRows, $emp, $shiftStart, $expectedMinutes, $weeklyOffSet, $histStart, $date, $holidayByGroupLog[$emp->holiday_group_id] ?? []);

            return [
                'id'                => $emp->id,
                'empCode'           => (string) ($emp->emp_code ?? ''),
                'name'              => (string) ($emp->display_name ?? trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''))),
                'initials'          => $this->initials((string) ($emp->display_name ?? '')),
                'accent'            => '',                            // SPA picks colour from index
                'department'        => $emp->department?->name ?? '—',
                'designation'       => $emp->designation?->name ?? '—',
                'managerName'       => $emp->reportingManager?->display_name
                    ?? trim((string) ($emp->reportingManager?->first_name ?? '') . ' ' . (string) ($emp->reportingManager?->last_name ?? ''))
                    ?: '—',
                // Default office hours fall back to 09:30 – 18:30 (9 h
                // working window). Employees with a parseable shift string
                // like "General (09:00 – 18:00)" override this — handled
                // up-front via $shiftStart / $shiftEnd defaulting.
                'shift'             => (string) ($emp->shift ?? 'General (09:30 – 18:30)'),
                'shiftStart'        => $shiftStart,
                'shiftEnd'          => $shiftEnd,
                'weeklyOff'         => (string) ($emp->weekly_off ?? 'Sun'),
                'attendanceNumber'  => (string) ($emp->attendance_number ?? ''),
                'status'            => $statusToday,
                'firstIn'           => $firstIn,
                'lastOut'           => $lastOut,
                'workedMinutes'     => $workedMins,
                'workedSeconds'     => $workedSecs,
                'workedCompletedSeconds' => $workedCompletedSecs,
                'openInAt'          => $openInAt,
                'autoCutoffAt'      => $autoCutoffAt,
                'expectedMinutes'   => $expectedMinutes,
                'lateByMinutes'     => $lateByMinutes,
                'punches'           => $this->renderPunches($todayPunches),
                'presentDays'       => $presentDays,
                'lateMarks'         => $lateMarks,
                'missingPunch'      => $missingPunch,
                'compliancePct'     => $compliancePct,
                'logs'              => $logs,
            ];
        })->values();

        return response()->json($out);
    }

    private function parseShiftWindow(string $shift): array
    {
        if ($shift === '') return [null, null];
        if (preg_match('/(\d{1,2}:\d{2})\s*[–\-]\s*(\d{1,2}:\d{2})/u', $shift, $m)) {
            return [$m[1], $m[2]];
        }
        return [null, null];
    }

    /** Expected minutes between two HH:MM strings — wraps midnight for night shifts. */
    private function expectedMinutesFromWindow(?string $start, ?string $end): int
    {
        if (!$start || !$end) return 540; // default 9h
        $diff = $this->minutesBetween($start, $end);
        if ($diff <= 0) $diff += 24 * 60;
        return $diff;
    }

    /** Minutes from $from ("HH:MM") to $to ("HH:MM"); negative if $to earlier. */
    private function minutesBetween(string $from, string $to): int
    {
        [$fh, $fm] = array_map('intval', explode(':', $from));
        [$th, $tm] = array_map('intval', explode(':', $to));
        return ($th * 60 + $tm) - ($fh * 60 + $fm);
    }

    /**
     * Company holidays for the given holiday groups that fall inside [$start,$end].
     * Returns [holiday_group_id => [Y-m-d => true]]. Recurring holidays are
     * re-anchored to the window's year. Mirrors PayrollService::holidayAggregates
     * so attendance compliance and payroll agree on what a holiday is.
     */
    private function holidayDatesForGroups(array $groupIds, \Carbon\Carbon $start, \Carbon\Carbon $end): array
    {
        if (empty($groupIds) || !\Illuminate\Support\Facades\Schema::hasTable('holidays')) {
            return [];
        }
        $rows = DB::table('holidays')
            ->whereIn('holiday_group_id', $groupIds)
            ->whereNull('deleted_at')
            ->get(['holiday_group_id', 'name', 'date', 'is_recurring']);

        // Value is the holiday NAME (not just `true`) so the Attendance Log can
        // label the day with which holiday it is. All readers use isset(), so a
        // non-empty string is still truthy for the "is this a holiday?" checks.
        $map = [];
        foreach ($rows as $r) {
            if (!$r->date) continue;
            $d = \Carbon\Carbon::parse($r->date);
            if ($r->is_recurring) {
                $d = \Carbon\Carbon::create($start->year, $d->month, $d->day);
            }
            if ($d->lt($start) || $d->gt($end)) continue;
            $map[$r->holiday_group_id][$d->toDateString()] = $r->name ?: 'Holiday';
        }
        return $map;
    }

    /**
     * Count the working days that have ELAPSED in [$monthStart, $mtdEnd] for an
     * employee — the compliance denominator. A day counts only when it is NOT a
     * weekly-off, NOT a company holiday, NOT a sanctioned-leave day (per the
     * stored attendance status), and the employee had already joined. This walks
     * the calendar so absent days (which carry no attendance row) are counted.
     */
    private function trackedWorkingDays(
        \Carbon\Carbon $monthStart,
        \Carbon\Carbon $mtdEnd,
        ?\Carbon\Carbon $joinDate,
        array $weeklyOffSet,
        array $holidaySet,
        array $mByIso,
        array $leaveDaySet = []
    ): int {
        $tracked = 0;
        $cursor  = $monthStart->copy();
        while ($cursor->lte($mtdEnd)) {
            $iso = $cursor->toDateString();

            // Day predates the employee's joining → not theirs to attend.
            if ($joinDate && $cursor->lt($joinDate->copy()->startOfDay())) {
                $cursor->addDay();
                continue;
            }

            $isWeeklyOff = isset($weeklyOffSet[$cursor->dayOfWeek]);
            $isHoliday   = isset($holidaySet[$iso]);
            $st          = strtolower((string) ($mByIso[$iso]->status ?? ''));
            // Approved leave is sanctioned — exclude via the precomputed leave-day
            // set (leaves aren't stored as an attendance status), plus the legacy
            // status-string check for any row that does carry a leave/holiday
            // status. (bug #20)
            $isSanctioned = isset($leaveDaySet[$iso])
                || str_contains($st, 'leave') || str_contains($st, 'holiday')
                || str_contains($st, 'week off') || $st === 'weekly off';

            if (!$isWeeklyOff && !$isHoliday && !$isSanctioned) {
                $tracked++;
            }
            $cursor->addDay();
        }
        return $tracked;
    }

   
    private function parseWeeklyOff(string $label): array
    {
        $map = ['sun' => 0, 'mon' => 1, 'tue' => 2, 'wed' => 3, 'thu' => 4, 'fri' => 5, 'sat' => 6];
        $set = [];
        foreach (preg_split('/[\s,]+/', strtolower($label)) as $tok) {
            $key = substr($tok, 0, 3);
            if (isset($map[$key])) $set[$map[$key]] = true;
        }
        if (empty($set)) {
            $set[0] = true; // Sunday fallback
        }
        return $set;
    }

   
    private function resolveDayStatus(?Attendance $row, bool $weeklyOff, ?string $shiftStart, string $date): string
    {
        if ($row && !empty($row->status)) {
            $stored = (string) $row->status;
            // Auto-promote Present → Late based on the local first-in. 10-min
            // grace matches the heuristic used by the MTD late-marks loop.
            if (strcasecmp($stored, 'Present') === 0 && $row->check_in_at && $shiftStart) {
                $localIn = $row->check_in_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i');
                $late = $this->minutesBetween($shiftStart, $localIn);
                if ($late > 10) return 'Late';
            }
            return $stored;
        }
        if ($weeklyOff) return 'Weekly Off';
        // Future dates with no attendance row default to Absent rather than
        // pretending the day is already "Present". The SPA's date picker
        // shouldn't be in the future in practice, but if the user navigates
        // there we don't want to claim attendance that hasn't happened.
        return 'Absent';
    }

   
    private function initials(string $name): string
    {
        $name = trim($name);
        if ($name === '') return '?';
        $parts = preg_split('/\s+/', $name);
        $first = mb_substr($parts[0] ?? '', 0, 1);
        $second = count($parts) > 1 ? mb_substr($parts[count($parts) - 1], 0, 1) : '';
        return strtoupper($first . $second);
    }

    
    private function renderPunches($punches): array
    {
        $out = [];
        $lastIn = null;
        foreach ($punches as $p) {
            $whenUtc = $p->punched_at;
            if (!$whenUtc) continue;
            $when = $whenUtc->copy()->setTimezone(self::DISPLAY_TZ);
            $time = $when->format('h:i A');
            $type = $p->direction === 'out' ? 'out' : 'in';
            $source = match ((string) $p->method) {
                'face'    => 'BIOMETRIC',
                'manual'  => 'MANUAL',
                'auto'    => 'WEB',
                default   => 'WEB',
            };
            $label = $p->label ?: ($type === 'in' ? 'Check In' : 'Check Out');
            $entry = [
                'time'   => $time,
                'type'   => $type,
                'source' => $source,
                'label'  => $label,
            ];
            if ($type === 'out' && $lastIn) {
                $minutes = max(0, (int) round(($when->getTimestamp() - $lastIn->getTimestamp()) / 60));
                $entry['worked'] = sprintf('%dh %02dm', intdiv($minutes, 60), $minutes % 60);
            }
            if ($type === 'in' && !empty($out)) {
                $prev = $out[count($out) - 1];
                if (isset($prev['_outTs']) && $prev['_outTs'] > 0) {
                    $breakMin = max(0, (int) round(($when->getTimestamp() - $prev['_outTs']) / 60));
                    $entry['breakAfter'] = sprintf('%dh %02dm', intdiv($breakMin, 60), $breakMin % 60);
                }
            }
            if ($type === 'out') $entry['_outTs'] = $when->getTimestamp();
            $out[] = $entry;
            if ($type === 'in') $lastIn = $when; else $lastIn = null;
        }
        // Strip the internal timestamp hint we used for break computation.
        foreach ($out as &$row) unset($row['_outTs']);
        return $out;
    }

  
    private function buildHistoryLogs($rows, Employee $emp, ?string $shiftStart, int $expectedMinutes, array $weeklyOffSet, string $from, string $to, array $holidaySet = [], array $leaveDaySet = []): array
    {
        // Index real Attendance rows by ISO date for O(1) lookup as we
        // walk through the window day-by-day.
        $byIso = [];
        foreach ($rows as $r) {
            $iso = \Carbon\Carbon::parse($r->attendance_date)->toDateString();
            $byIso[$iso] = $r;
        }

        $shift = (string) ($emp->shift ?: '—');
        $todayLocal = self::todayLocal();
        $out = [];
        // Walk newest-first so the table opens on the most recent day —
        // matches the user's expectation (and what the Logs table page-
        // ordering relied on previously).
        $cursor = \Carbon\Carbon::parse($to);
        $start  = \Carbon\Carbon::parse($from);
        while ($cursor->greaterThanOrEqualTo($start)) {
            $iso = $cursor->toDateString();
            // Future days haven't happened yet — never list them in the log
            // (bug #23). The window runs to end-of-month, so the current month
            // would otherwise emit synthesised 'Absent' rows for days still to
            // come. The calendar flags future cells on its own, so hiding them
            // from the log list is safe.
            if ($iso > $todayLocal) { $cursor->subDay(); continue; }
            $r   = $byIso[$iso] ?? null;
            $isWO = isset($weeklyOffSet[$cursor->dayOfWeek]);
            $isHoliday = isset($holidaySet[$iso]);
            $isFuture = $iso > $todayLocal;

            if ($r) {
                $status  = $r->status ?: ($isWO ? 'Weekly Off' : 'Absent');
                $firstIn = $r->check_in_at  ? $r->check_in_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i')  : '—';
                $lastOut = $r->check_out_at ? $r->check_out_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i') : '—';
                $worked  = (int) floor(((int) $r->total_worked_seconds) / 60);
                // Promote Present → Late when first-in is significantly
                // after shift start (mirrors resolveDayStatus()). The
                // face-clock flow always writes 'Present' on first punch
                // and doesn't know about shifts, so the heuristic has to
                // run at read time.
                if (strcasecmp($status, 'Present') === 0 && $firstIn !== '—' && $shiftStart
                    && $this->minutesBetween($shiftStart, $firstIn) > 10) {
                    $status = 'Late';
                }
                // Missing checkout: a PAST day with a check-in but no check-out
                // is a missing punch (the face-clock flow leaves status as
                // Present/Late). Today is exempt — the person may still be in.
                if (!$isFuture && $iso < $todayLocal
                    && $r->check_in_at && !$r->check_out_at
                    && in_array(strtolower($status), ['present', 'late'], true)) {
                    $status = 'Missing Out';
                    $lastOut = '—';
                }

                $segments = [];
                $pairs = $r->punches?->sortBy('punched_at')->values() ?? collect();
                $openIn = null;
                foreach ($pairs as $p) {
                    $tsUtc = $p->punched_at;
                    if (!$tsUtc) continue;
                    $ts = $tsUtc->copy()->setTimezone(self::DISPLAY_TZ);
                    $hf = $ts->hour + $ts->minute / 60;
                    if ($p->direction === 'in') {
                        $openIn = $hf;
                    } elseif ($p->direction === 'out' && $openIn !== null) {
                        $segments[] = ['start' => round($openIn, 2), 'end' => round($hf, 2)];
                        $openIn = null;
                    }
                }
            } else {
                // No Attendance row for this day — synthesise it.
                $status  = $isFuture ? 'Absent' : ($isWO ? 'Weekly Off' : 'Absent');
                $firstIn = '—';
                $lastOut = '—';
                $worked  = 0;
                $segments = [];
            }

            // Company holiday for THIS employee's holiday group → surface it as
            // "Holiday" in the Attendance Log + Calendar, unless the day already
            // carries a productive status (the employee actually punched in on
            // it, e.g. worked a holiday — keep that).
            $holidayName = null;
            if ($isHoliday && in_array(strtolower((string) $status), ['absent', 'weekly off'], true)) {
                $status = 'Holiday';
                // holidaySet value is the holiday's name (see holidayDatesForGroups).
                $holidayName = is_string($holidaySet[$iso] ?? null) ? $holidaySet[$iso] : null;
            }

            // Approved leave for THIS day → surface it as "Paid Leave" / "Unpaid
            // Leave" instead of a blank "No Time Entries Logged" Absent day
            // (QA #30). Only overrides a plain Absent reading: a day the employee
            // actually punched keeps its real status, and Weekly-Off / Holiday
            // days were already excluded when $leaveDaySet was built.
            if (strcasecmp((string) $status, 'Absent') === 0 && isset($leaveDaySet[$iso])) {
                $status = strcasecmp((string) $leaveDaySet[$iso], 'Unpaid') === 0 ? 'Unpaid Leave' : 'Paid Leave';
            }

            // Signed deviation (sub-hour shortfalls were printing "+0h 30m"
            // before — intdiv() truncates toward zero so a negative diff
            // smaller than an hour lost its sign).
            $deviation = '—';
            if ($worked !== 0) {
                $diff = $worked - $expectedMinutes;
                $sign = $diff < 0 ? '-' : '+';
                $mag  = abs($diff);
                $deviation = sprintf('%s%dh %02dm', $sign, intdiv($mag, 60), $mag % 60);
            }

            $lateMin = 0;
            if ($firstIn !== '—' && $shiftStart) {
                $lateMin = max(0, $this->minutesBetween($shiftStart, $firstIn));
            }

            // Gross = the full first-in → last-out span (includes breaks);
            // effective ($worked) is only the time inside in/out segments. The
            // difference is the Break Taken column (bug #22). Previously gross
            // was set equal to effective, so break always read 0. Clamp gross
            // to be at least effective so break can never go negative.
            $grossMin = $worked;
            if ($r && $r->check_in_at && $r->check_out_at) {
                $span = (int) floor(abs($r->check_out_at->diffInSeconds($r->check_in_at)) / 60);
                if ($span > $grossMin) $grossMin = $span;
            }

            $out[] = [
                'iso'              => $iso,
                'date'             => $cursor->format('d M Y'),
                'weekday'          => $cursor->format('D'),
                'status'           => $status,
                'holidayName'      => $holidayName,
                'shift'            => $shift,
                'firstIn'          => $firstIn,
                'lastOut'          => $lastOut,
                'worked'           => $worked === 0 ? '—' : sprintf('%dh %02dm', intdiv($worked, 60), $worked % 60),
                'deviation'        => $deviation,
                'exception'        => in_array(strtolower($status), ['late', 'half day', 'absent', 'corrected', 'missing in', 'missing out'], true) ? $status : null,
                'workSegments'     => $segments,
                'effectiveMinutes' => $worked,
                'grossMinutes'     => $grossMin,
                'expectedMinutes'  => $expectedMinutes,
                'lateMinutes'      => $lateMin,
            ];

            $cursor->subDay();
        }
        return $out;
    }

  
    private function facePunch(Request $request, string $expected)
    {
        $data = $request->validate([
            'descriptor'   => 'required|array|size:' . self::DESCRIPTOR_LEN,
            // A7: face-api descriptors are normalised floats (~[-1,1]); bound them
            // generously so crafted extreme/garbage vectors are rejected up front.
            'descriptor.*' => 'required|numeric|between:-5,5',
            'label'        => 'nullable|string|max:50',
            'lat'          => 'nullable|numeric|between:-90,90',
            'lng'          => 'nullable|numeric|between:-180,180',
        ]);

        $employee = $this->callerEmployee($request);

        // Attendance cannot be marked before the employee's joining date (bug
        // #19). Covers both clock-in and clock-out since they share facePunch().
        if ($employee->date_of_joining) {
            $joinDate = \Carbon\Carbon::parse($employee->date_of_joining)->toDateString();
            if (self::todayLocal() < $joinDate) {
                return response()->json([
                    'message' => 'Attendance cannot be marked before your joining date ('
                        . \Carbon\Carbon::parse($employee->date_of_joining)->format('d M Y') . ').',
                    'before_joining' => true,
                ], 422);
            }
        }

        if (empty($employee->face_descriptor) || $employee->face_registered_at === null) {
            return response()->json([
                'message'      => 'You have not enrolled your face yet. Please complete face registration from your profile first.',
                'need_enroll'  => true,
            ], 422);
        }

        $captured = array_map(static fn ($v) => (float) $v, $data['descriptor']);
        $distance = self::euclideanDistance($captured, $employee->face_descriptor);
        if ($distance > self::MATCH_THRESHOLD) {
            return response()->json([
                'message'   => 'Face did not match the enrolled record. Please try again with better lighting and ensure your full face is visible.',
                'distance'  => round($distance, 4),
                'threshold' => self::MATCH_THRESHOLD,
                'matched'   => false,
            ], 422);
        }

        return DB::transaction(function () use ($request, $employee, $distance, $data, $expected) {
            $today = self::todayLocal();

            // Lock the day's row so a double-tap on the SPA can't race two
            // punches into the same direction.
            $attendance = Attendance::where('employee_id', $employee->id)
                ->whereDate('attendance_date', $today)
                ->lockForUpdate()
                ->first();

            if (!$attendance) {
                $attendance = Attendance::create([
                    'client_id'       => $employee->client_id,
                    'branch_id'       => $employee->branch_id,
                    'user_id'         => $employee->user_id,
                    'employee_id'     => $employee->id,
                    'attendance_date' => $today,
                    'status'          => 'Present',
                ]);
            }

            // Resolve the actual next direction from history (server-truth).
            $lastPunch = AttendancePunch::where('attendance_id', $attendance->id)
                ->orderByDesc('punched_at')->first();
            $nextDir = !$lastPunch ? 'in' : ($lastPunch->direction === 'in' ? 'out' : 'in');

            if ($expected !== $nextDir) {
                return response()->json([
                    'message'        => $nextDir === 'in'
                        ? 'You need to clock IN next, not OUT — your last punch was a clock-out.'
                        : 'You need to clock OUT next, not IN — you are already clocked in.',
                    'matched'        => true,
                    'next_direction' => $nextDir,
                ], 422);
            }

            // Default the label by direction if the SPA didn't pick one.
            $label = trim((string) ($data['label'] ?? ''));
            if ($label === '') {
                if ($nextDir === 'in') {
                    $label = $lastPunch ? 'Step In' : 'Check In';
                } else {
                    $label = 'Step Out';
                }
            }

            $now = now();
            $punch = AttendancePunch::create([
                'attendance_id'  => $attendance->id,
                'employee_id'    => $employee->id,
                'punched_at'     => $now,
                'direction'      => $nextDir,
                'label'          => $label,
                'method'         => 'face',
                'match_distance' => round($distance, 4),
                'ip'             => $request->ip(),
                'lat'            => $data['lat'] ?? null,
                'lng'            => $data['lng'] ?? null,
            ]);

            // Recompute the daily summary on the parent row so list views
            // (HR, dashboards, reports) stay fast — no need to join punches.
            $this->recomputeSummary($attendance);

            $attendance->load('punches');
            return response()->json([
                'message'        => $nextDir === 'in' ? 'Clocked in successfully.' : 'Clocked out successfully.',
                'matched'        => true,
                'distance'       => round($distance, 4),
                'punch'          => $punch,
                'record'         => $attendance,
                'next_direction' => $attendance->next_direction,
            ]);
        });
    }

 
    private function recomputeSummary(Attendance $attendance): void
    {
        $firstIn  = AttendancePunch::where('attendance_id', $attendance->id)
            ->where('direction', 'in')
            ->orderBy('punched_at')->first();
        $lastOut  = AttendancePunch::where('attendance_id', $attendance->id)
            ->where('direction', 'out')
            ->orderByDesc('punched_at')->first();

        $attendance->update([
            'check_in_at'              => $firstIn?->punched_at,
            'check_in_method'          => $firstIn?->method,
            'check_in_match_distance'  => $firstIn?->match_distance,
            'check_in_ip'              => $firstIn?->ip,
            'check_in_lat'             => $firstIn?->lat,
            'check_in_lng'             => $firstIn?->lng,
            'check_out_at'             => $lastOut?->punched_at,
            'check_out_method'         => $lastOut?->method,
            'check_out_match_distance' => $lastOut?->match_distance,
            'check_out_ip'             => $lastOut?->ip,
            'check_out_lat'            => $lastOut?->lat,
            'check_out_lng'            => $lastOut?->lng,
        ]);
    }

    

    private function callerEmployee(Request $request): Employee
    {
        $user = $request->user();
        if (!$user) abort(401, 'Unauthenticated');
        $row = Employee::where('user_id', $user->id)->first();
        if (!$row) abort(404, 'No employee record linked to this account.');
        return $row;
    }

    private static function euclideanDistance(array $a, array $b): float
    {
        $sum = 0.0;
        $n = count($a);
        for ($i = 0; $i < $n; $i++) {
            $diff = (float) $a[$i] - (float) $b[$i];
            $sum += $diff * $diff;
        }
        return sqrt($sum);
    }
}
