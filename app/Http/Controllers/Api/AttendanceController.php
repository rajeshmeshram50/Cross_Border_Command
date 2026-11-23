<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\Module;
use App\Models\Permission;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AttendanceController extends Controller
{
    private const MATCH_THRESHOLD = 0.55;
    private const DESCRIPTOR_LEN  = 128;

    private const MODULE_SLUG = 'hr.attendance';

    private const DISPLAY_TZ = 'Asia/Kolkata';

    private static function todayLocal(): string
    {
        return now(self::DISPLAY_TZ)->toDateString();
    }

    private const KNOWN_LABELS = ['Check In', 'Check Out'];

    public function today(Request $request)
    {
        $employee = $this->callerEmployee($request);
        $row = Attendance::with('punches')
            ->where('employee_id', $employee->id)
            ->whereDate('attendance_date', self::todayLocal())
            ->first();

        if ($row) $row->setRelation('employee', $employee);
        $cutoffRow = $row ?: (new Attendance(['attendance_date' => self::todayLocal()]))->setRelation('employee', $employee);
        return response()->json([
            'date'     => self::todayLocal(),
            'employee' => [
                'id'              => $employee->id,
                'emp_code'        => $employee->emp_code,
                'name'            => $employee->display_name,
                'face_registered' => !empty($employee->face_descriptor) && $employee->face_registered_at !== null,
            ],
            'record'   => $row,
            'next_direction' => $row ? $row->next_direction : 'in',
            'allowed_labels' => self::KNOWN_LABELS,

            'auto_cutoff_at' => \Carbon\Carbon::createFromTimestamp(
                $cutoffRow->autoCheckoutCutoffTs(self::todayLocal()), self::DISPLAY_TZ
            )->toIso8601String(),

            'overtime_applicable' => $employee->overtimeApplicable(),
            'shift_end_at'        => \Carbon\Carbon::createFromTimestamp(
                $cutoffRow->shiftEndTs(self::todayLocal()), self::DISPLAY_TZ
            )->toIso8601String(),
            'overtime_seconds'    => $row ? $row->overtimeSecondsForDay() : 0,
        ]);
    }

    public function my(Request $request)
    {
        $employee = $this->callerEmployee($request);

        $q = Attendance::with(['punches', 'employee.branch:id,shifts'])
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

    public function import(Request $request, \App\Services\EsslAttendanceImporter $importer)
    {
        $user = $request->user();
        if (!$user->isSuperAdmin() && $user->user_type !== 'client_admin') {
            abort(403, 'Only administrators can import attendance.');
        }

        $data = $request->validate([
            'file'               => 'nullable|file|max:5120',
            'punches'            => 'nullable|array',
            'punches.*.user_id'  => 'required_with:punches|string',
            'punches.*.punched_at' => 'required_with:punches|string',
            'device_terminal_id' => 'nullable|integer',
            'branch_id'          => 'nullable|integer',
            'timezone'           => 'nullable|timezone',
        ]);

        $clientId = $user->client_id ?: $request->integer('client_id') ?: null;
        abort_if(!$clientId, 422, 'A client must be resolved to import attendance.');

        $branchId = $request->filled('branch_id') ? (int) $request->input('branch_id') : null;
        $serial   = 'CSV-IMPORT';
        $tz       = $data['timezone'] ?? 'Asia/Kolkata';

        if (!empty($data['device_terminal_id'])) {
            $terminal = \App\Models\DeviceTerminal::where('client_id', $clientId)
                ->findOrFail($data['device_terminal_id']);
            $branchId = $terminal->branch_id;
            $serial   = (string) $terminal->serial;
            $tz       = $terminal->timezone ?: $tz;
        }

        if ($request->hasFile('file')) {
            $rows = $this->parseUploadedPunches((string) $request->file('file')->get());
        } else {
            $rows = array_map(fn ($p) => [
                'user_id'    => (string) ($p['user_id'] ?? ''),
                'punched_at' => (string) ($p['punched_at'] ?? ''),
                'status'     => (string) ($p['status'] ?? ''),
            ], $data['punches'] ?? []);
        }

        if (empty($rows)) {
            return response()->json(['message' => 'No punch rows found. Expected tab/comma-delimited: UserID, DateTime, Status.'], 422);
        }

        $summary = $importer->importRows($rows, $clientId, $branchId, $serial, $tz);

        return response()->json(['data' => $summary]);
    }

    private function parseUploadedPunches(string $body): array
    {
        $rows = [];
        foreach (preg_split('/\r\n|\r|\n/', trim($body)) as $line) {
            if (trim($line) === '') continue;
            $f = str_contains($line, "\t") ? explode("\t", $line) : explode(',', $line);
            if (count($f) < 2) continue;
            $when = trim($f[1]);
            if (!preg_match('/\d/', $when) || !preg_match('/[-:\/]/', $when)) continue;
            $rows[] = [
                'user_id'    => trim($f[0]),
                'punched_at' => $when,
                'status'     => isset($f[2]) ? trim($f[2]) : '',
            ];
        }
        return $rows;
    }

    public function employeeSummary(Request $request, string $employeeId)
    {
        $user = $request->user();
        if (!$user) abort(401, 'Unauthenticated');

        if (ctype_digit($employeeId)) {
            $emp = Employee::withTrashed()->find((int) $employeeId);
        } else {
            $q = Employee::withTrashed()->where('emp_code', $employeeId);
            if ($user->user_type !== 'super_admin') {
                $q->where(function ($w) use ($user) {
                    $w->whereNull('client_id')->orWhere('client_id', $user->client_id);
                });
            }

            $emp = (clone $q)->where('user_id', $user->id)->first()
                ?: $q->orderBy('id')->first();

            if (!$emp) {
                $emp = Employee::withTrashed()->where('emp_code', $employeeId)
                    ->where('user_id', $user->id)
                    ->first()
                    ?: Employee::withTrashed()->where('emp_code', $employeeId)->orderBy('id')->first();
            }
        }
        if (!$emp) abort(404, 'Employee not found.');

        $isSelf = Employee::withTrashed()->where('id', $emp->id)->where('user_id', $user->id)->exists();
        $sameTenant = (int) $emp->client_id === (int) $user->client_id;

        $isAdminLogin = in_array($user->user_type, ['client_admin', 'client_user', 'branch_user'], true);
        $isPermittedStaff = $user->user_type === 'employee' && $this->hasAttendanceViewPermission($user);

        if (!$isSelf && $user->user_type !== 'super_admin' && !(
            ($isAdminLogin || $isPermittedStaff) && $sameTenant
        )) {
            abort(403, 'You do not have access to this employee.');
        }

        $monthQ = (string) $request->query('month', now(self::DISPLAY_TZ)->format('Y-m'));
        if (!preg_match('/^\d{4}-\d{2}$/', $monthQ)) $monthQ = now(self::DISPLAY_TZ)->format('Y-m');
        $start = \Carbon\Carbon::createFromFormat('Y-m-d', $monthQ . '-01')->startOfMonth();
        $end   = (clone $start)->endOfMonth();

        $today = Attendance::with('punches')
            ->where('employee_id', $emp->id)
            ->whereDate('attendance_date', self::todayLocal())
            ->first();

        $history = Attendance::with('punches')
            ->where('employee_id', $emp->id)
            ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])
            ->orderByDesc('attendance_date')
            ->get();

        [$shiftStart, $shiftEnd] = $emp->resolveShiftWindow();
        $shiftStart = $shiftStart ?: '09:30';
        $shiftEnd   = $shiftEnd   ?: '18:30';
        $todayStr = self::todayLocal();
        $present  = 0; $late = 0; $missingBio = 0; $leaveDays = 0;
        foreach ($history as $row) {
            $row->setRelation('employee', $emp);
            [$rowShiftStart] = $row->shiftWindow();
            $rowShiftStart = $rowShiftStart ?: $shiftStart;
            $status = (string) ($row->status ?? '');
            $rowIso = \Carbon\Carbon::parse($row->attendance_date)->toDateString();
            if (strcasecmp($status, 'Present') === 0)  $present++;
            if (strcasecmp($status, 'Late') === 0)     { $late++; $present++; }

            if (strcasecmp($status, 'Missing In') === 0 || strcasecmp($status, 'Missing Out') === 0) {
                $missingBio++;
            } elseif ($rowIso < $todayStr && $row->check_in_at && !$row->check_out_at) {
                $missingBio++;
            }

            $firstIn = $row->check_in_at;
            if ($firstIn && strcasecmp($status, 'Present') === 0) {
                $localIn = $firstIn->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i');
                if ($this->minutesBetween($rowShiftStart, $localIn) > Attendance::LATE_GRACE_MINUTES) $late++;
            }
        }

        $empHolidayMap = $this->holidayDatesForGroups(
            array_filter([$emp->holiday_group_id]),
            (clone $start), (clone $end),
            $emp->client_id, $emp->branch_id,
        );
        $empHolidaySet = $empHolidayMap[$emp->holiday_group_id ?? self::HOLIDAY_COMPANY_KEY]
            ?? $empHolidayMap[self::HOLIDAY_COMPANY_KEY] ?? [];

        $weeklyOffLabel = (string) ($emp->weekly_off ?? '');
        $approvedLeaves = \App\Models\LeaveRequest::query()
            ->where('employee_id', $emp->id)
            ->where('status', 'Approved')
            ->whereDate('from_date', '<=', $end->toDateString())
            ->whereDate('to_date', '>=', $start->toDateString())
            ->get(['from_date', 'to_date', 'leave_type_id', 'day_type']);
        $paidByType = \App\Models\Masters\LeaveTypes::whereIn('id', $approvedLeaves->pluck('leave_type_id')->filter()->unique()->all())
            ->pluck('paid_unpaid', 'id');
        $leaveDaySet = [];
        foreach ($approvedLeaves as $lv) {
            $paid    = strcasecmp((string) ($paidByType[$lv->leave_type_id] ?? 'Paid'), 'Unpaid') === 0 ? 'Unpaid' : 'Paid';
            $portion = in_array($lv->day_type, ['first_half', 'second_half'], true) ? $lv->day_type : 'full';
            $fromC = \Carbon\Carbon::parse($lv->from_date);
            $toC   = \Carbon\Carbon::parse($lv->to_date);
            $cursor = $fromC->lt($start) ? $start->copy() : $fromC->copy();
            $till   = $toC->gt($end)     ? $end->copy()   : $toC->copy();
            for ($c = $cursor->copy(); $c->lte($till); $c->addDay()) {
                $iso = $c->toDateString();
                if (isset($leaveDaySet[$iso])) continue;
                if (\App\Support\WeekOff::isOff($weeklyOffLabel, $c)) continue;
                if (isset($empHolidaySet[$iso])) continue;
                $leaveDaySet[$iso] = ['paid' => $paid, 'portion' => $portion];
            }
        }
        $leaveDays = count($leaveDaySet);

        $empExit = $emp->exit;
        $lastWorkingIso = ($empExit && $empExit->rehired_at === null && $empExit->last_working_day)
            ? $empExit->last_working_day->toDateString()
            : null;
        if ($lastWorkingIso === null && !$empExit && $emp->deleted_at) {
            $lastWorkingIso = $emp->deleted_at->toDateString();
        }

        return response()->json([
            'employee' => [
                'id'              => $emp->id,
                'emp_code'        => $emp->emp_code,
                'name'            => $emp->display_name,
                'face_registered' => !empty($emp->face_descriptor) && $emp->face_registered_at !== null,
                'shift_start'     => $shiftStart,
                'shift_end'       => $shiftEnd,
                'date_of_joining' => $this->joiningIso($emp),
                'attendance_from' => $this->attendanceStartIso($emp),
                'owes_attendance' => $this->owesAttendance($emp),
                'last_working_day' => $lastWorkingIso,
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
            'shift'            => (string) ($emp->shift ?: '—'),
            'shift_start'      => $shiftStart,
            'shift_end'        => $shiftEnd,
            'weekly_off'       => (string) ($emp->weekly_off ?? ''),
            'weekly_off_dates' => (object) \App\Support\WeekOff::datesInRange(
                (string) ($emp->weekly_off ?? ''),
                $start->copy(),
                $end->copy(),
            ),
            'expected_minutes' => $this->expectedMinutesFromWindow($shiftStart, $shiftEnd),
            'logs'             => $this->buildHistoryLogs(
                $history,
                $emp,
                $shiftStart,
                $this->expectedMinutesFromWindow($shiftStart, $shiftEnd),
                (string) ($emp->weekly_off ?? ''),
                $start->toDateString(),
                $end->toDateString(),
                $empHolidaySet,
                $leaveDaySet,
                $this->joiningIso($emp)
            ),
            'date_of_joining'  => $this->joiningIso($emp),
            'attendance_from'  => $this->attendanceStartIso($emp),
            'owes_attendance'  => $this->owesAttendance($emp),
        ]);
    }

    private function hasAttendanceViewPermission($user): bool
    {
        $moduleId = Module::where('slug', self::MODULE_SLUG)->value('id');

        return (bool) $moduleId && Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where('can_view', true)
            ->exists();
    }

    private function authorizeAttendanceView(Request $request): void
    {
        $user = $request->user();
        if (!$user) abort(401, 'Unauthenticated');
        if ($user->user_type !== 'employee') return;

        if (!$this->hasAttendanceViewPermission($user)) abort(403, 'Access Denied');
    }

    private function isBranchPinned($user): bool
    {
        return in_array($user->user_type, ['branch_user', 'employee'], true);
    }

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401, 'Unauthenticated');
        $this->authorizeAttendanceView($request);

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
            if ($this->isBranchPinned($user)) {
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

    private static function displayShiftWindow($row, ?string $empStart, ?string $empEnd): array
    {
        if (!$row) return [$empStart, $empEnd];
        [$s, $e] = $row->shiftWindow();
        if (trim((string) ($row->shift_name ?? '')) !== '') return [$s, $e];
        return [$s ?: $empStart, $e ?: $empEnd];
    }

    public function dailyView(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401, 'Unauthenticated');
        $this->authorizeAttendanceView($request);

        $date = (string) $request->query('date', self::todayLocal());
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            $date = self::todayLocal();
        }
        if ($date > self::todayLocal()) {
            $date = self::todayLocal();
        }
        $dateC      = \Carbon\Carbon::parse($date);
        $monthStart = (clone $dateC)->startOfMonth()->toDateString();
        $monthEnd   = (clone $dateC)->endOfMonth()->toDateString();
        $histStart  = (clone $dateC)->subDays(89)->toDateString();

        $todayStr   = self::todayLocal();
        $selMonthEnd = (clone $dateC)->endOfMonth()->toDateString();
        $histEnd    = $selMonthEnd < $todayStr ? $selMonthEnd : $todayStr;
        $histEndC   = \Carbon\Carbon::parse($histEnd);

        $includeExited = $request->boolean('include_exited');

        $empQ = Employee::withTrashed()
            ->where('attendance_tracking', true)
            ->where(function ($q) use ($date, $includeExited) {
                $q->where(function ($active) {
                    $active->where('status', 'Active')->whereNull('deleted_at');
                })->orWhereHas('exit', function ($x) use ($date) {
                    $x->whereNull('rehired_at')
                      ->whereNotNull('last_working_day')
                      ->whereDate('last_working_day', '>=', $date);
                })->orWhere(function ($audit) use ($includeExited) {
                    if (!$includeExited) {
                        $audit->whereRaw('1 = 0');
                        return;
                    }
                    $audit->whereHas('exit', fn ($x) => $x->whereNull('rehired_at'))
                          ->orWhereNotNull('deleted_at');
                })->orWhere(function ($removed) use ($date) {
                    $removed->whereNotNull('deleted_at')
                            ->whereDate('deleted_at', '>=', $date)
                            ->whereDoesntHave('exit');
                });
            })
            ->where(function ($q) use ($date) {
                $q->whereNull('date_of_joining')->orWhereDate('date_of_joining', '<=', $date);
            })
            ->where('onboarding_stage_completed', '>=', 6)
            ->with([
                'department:id,name',
                'designation:id,name',
                'reportingManager:id,first_name,last_name,display_name',
                'reportingManagerUser:id,name',
                'branch:id,shifts',
                'exit:id,employee_id,last_working_day,rehired_at,exit_case_status',
            ])
            ->orderBy('display_name');

        if ($user->user_type !== 'super_admin') {
            $empQ->where('client_id', $user->client_id);
            $branchFilter = $request->integer('branch_id') ?: null;

            $isSubBranchUser = $this->isBranchPinned($user);
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

        $onlyEmployeeId = $request->integer('employee_id') ?: null;
        $detailMode     = $onlyEmployeeId !== null;
        if ($detailMode) {
            $empQ->where('id', $onlyEmployeeId);
        }

        $employees = $empQ->get();
        if ($employees->isEmpty()) {
            return response()->json([]);
        }

        $empIds = $employees->pluck('id')->all();

        $dailyRows = Attendance::with('punches')
            ->whereIn('employee_id', $empIds)
            ->whereDate('attendance_date', $date)
            ->get()
            ->keyBy('employee_id');

        $monthRows = Attendance::whereIn('employee_id', $empIds)
            ->whereBetween('attendance_date', [$monthStart, $monthEnd])
            ->get([
                'employee_id', 'attendance_date', 'status', 'check_in_at', 'check_out_at',
                'shift_name', 'shift_start', 'shift_end',
            ])
            ->groupBy('employee_id');

        $historyRows = $detailMode
            ? Attendance::with('punches')
                ->whereIn('employee_id', $empIds)
                ->whereBetween('attendance_date', [$histStart, $histEnd])
                ->orderByDesc('attendance_date')
                ->get()
                ->groupBy('employee_id')
            : collect();

        $holidayGroupIds = $employees->pluck('holiday_group_id')->filter()->unique()->values()->all();
        $holidayScopeClient = $employees->first()?->client_id;
        $holidayScopeBranch = $employees->pluck('branch_id')->filter()->unique()->count() === 1
            ? $employees->pluck('branch_id')->filter()->first()
            : null;
        $holidayByGroup  = $detailMode
            ? $this->holidayDatesForGroups(
                $holidayGroupIds, (clone $dateC)->startOfMonth(), (clone $dateC)->endOfMonth(),
                $holidayScopeClient, $holidayScopeBranch,
            )
            : [];
        $holidayByGroupLog = $this->holidayDatesForGroups(
            $holidayGroupIds, \Carbon\Carbon::parse($histStart), $histEndC->copy(),
            $holidayScopeClient, $holidayScopeBranch,
        );

        $calendarHolidayEnd = (clone $dateC)->endOfMonth()->addYear();
        $holidayByGroupCal  = $detailMode
            ? $this->holidayDatesForGroups(
                $holidayGroupIds, \Carbon\Carbon::parse($histStart), $calendarHolidayEnd,
                $holidayScopeClient, $holidayScopeBranch,
            )
            : [];

        $monthEndC = (clone $dateC)->endOfMonth();
        $mtdEndC   = $histEndC->copy();

        $defaultShiftStart = '09:30';
        $defaultShiftEnd   = '18:30';

        $pendingCorrections = [];
        $empIdsForCorrection = $employees->pluck('id')->filter()->all();
        if ($empIdsForCorrection) {
            $pendingCorrections = DB::table('attendance_regularizations')
                ->whereIn('employee_id', $empIdsForCorrection)
                ->whereDate('regularization_date', $date)
                ->where('status', 'Pending')
                ->orderByDesc('id')
                ->get(['id', 'employee_id', 'regularization_date', 'type', 'reason', 'created_at'])
                ->keyBy('employee_id')
                ->all();
        }

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

        $monthStartC = (clone $dateC)->startOfMonth();
        $leaveDaysByEmp = [];
        if ($detailMode && !empty($empIdsForLeave)) {
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

        $leaveLogByEmp = [];
        if ($detailMode && !empty($empIdsForLeave)) {
            $logStartC = \Carbon\Carbon::parse($histStart);
            $logLeaves = \App\Models\LeaveRequest::query()
                ->whereIn('employee_id', $empIdsForLeave)
                ->where('status', 'Approved')
                ->whereDate('from_date', '<=', $histEnd)
                ->whereDate('to_date', '>=', $histStart)
                ->get(['employee_id', 'from_date', 'to_date', 'leave_type_id', 'day_type']);
            $paidByTypeLog = \App\Models\Masters\LeaveTypes::whereIn(
                'id', $logLeaves->pluck('leave_type_id')->filter()->unique()->all()
            )->pluck('paid_unpaid', 'id');
            foreach ($logLeaves as $lv) {
                $paid    = strcasecmp((string) ($paidByTypeLog[$lv->leave_type_id] ?? 'Paid'), 'Unpaid') === 0 ? 'Unpaid' : 'Paid';
                $portion = in_array($lv->day_type, ['first_half', 'second_half'], true) ? $lv->day_type : 'full';
                $fromC = \Carbon\Carbon::parse($lv->from_date);
                $toC   = \Carbon\Carbon::parse($lv->to_date);
                $c     = $fromC->lt($logStartC) ? $logStartC->copy() : $fromC->copy();
                $till  = $toC->gt($histEndC) ? $histEndC->copy() : $toC->copy();
                for ($d = $c->copy(); $d->lte($till); $d->addDay()) {
                    $iso = $d->toDateString();
                    if (isset($leaveLogByEmp[(int) $lv->employee_id][$iso])) continue;
                    $leaveLogByEmp[(int) $lv->employee_id][$iso] = ['paid' => $paid, 'portion' => $portion];
                }
            }
        }

        $out = $employees->map(function (Employee $emp) use ($dailyRows, $monthRows, $historyRows, $detailMode, $date, $histStart, $histEnd, $defaultShiftStart, $defaultShiftEnd, $holidayByGroup, $holidayByGroupLog, $holidayByGroupCal, $calendarHolidayEnd, $mtdEndC, $dateC, $onLeaveSet, $leaveDaysByEmp, $leaveLogByEmp, $pendingCorrections) {
            [$parsedStart, $parsedEnd] = $emp->resolveShiftWindow();
            $shiftStart = $parsedStart ?: $defaultShiftStart;
            $shiftEnd   = $parsedEnd   ?: $defaultShiftEnd;
            $expectedMinutes = $this->expectedMinutesFromWindow($shiftStart, $shiftEnd);
            $weeklyOffLabel  = (string) ($emp->weekly_off ?? '');
            $isWeeklyOff     = \App\Support\WeekOff::isOff($weeklyOffLabel, $dateC);

            $today    = $dailyRows->get($emp->id);
            if ($today) $today->setRelation('employee', $emp);
            $todayPunches = $today ? $today->punches->sortBy('punched_at')->values() : collect();

            $joinIso     = $this->joiningIso($emp);
            $logHolidaySet = $holidayByGroupLog[$emp->holiday_group_id ?? self::HOLIDAY_COMPANY_KEY]
                ?? $holidayByGroupLog[self::HOLIDAY_COMPANY_KEY] ?? [];
            $statusToday = $this->resolveDayStatus(
                $today, $isWeeklyOff, $shiftStart, $date, isset($logHolidaySet[$date]),
            );
            $startIso = $joinIso ?? $this->attendanceStartIso($emp);
            if ($startIso !== null && $date < $startIso && !$today) {
                $statusToday = 'Not Joined';
            }
            if (!$this->owesAttendance($emp) && !$today) {
                $statusToday = 'Not Joined';
            }
            $exitIso = $emp->exit && !$emp->exit->rehired_at && $emp->exit->last_working_day
                ? \Carbon\Carbon::parse($emp->exit->last_working_day)->toDateString()
                : null;

            $exitCompleted = $emp->exit
                && !$emp->exit->rehired_at
                && (string) ($emp->exit->exit_case_status ?? 'Open') === 'Closed';

            $hasLeft     = $exitCompleted || ($emp->deleted_at !== null);
            $exitedOnIso = $hasLeft ? ($exitIso ?? $emp->deleted_at?->toDateString()) : null;
            $noticeUntil = (!$hasLeft && $exitIso !== null) ? $exitIso : null;

            if ($exitIso !== null && $date > $exitIso && !$today && $hasLeft) {
                $statusToday = 'Exited';
            }

            if (isset($onLeaveSet[$emp->id]) && strcasecmp($statusToday, 'Absent') === 0) {
                $statusToday = 'Leave';
            }
            $firstIn     = $today?->check_in_at ? $today->check_in_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i') : null;
            $lastOut     = $today?->check_out_at ? $today->check_out_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i') : null;
            $workedSecs  = $today ? (int) $today->total_worked_seconds : 0;
            $workedMins  = (int) floor($workedSecs / 60);

            $workedCompletedSecs = $today ? (int) $today->completedWorkedSeconds() : 0;
            $openInAt  = null;
            $cutoffRow = $today ?: (new Attendance(['attendance_date' => $date]))->setRelation('employee', $emp);
            $autoCutoffAt = \Carbon\Carbon::createFromTimestamp(
                $cutoffRow->autoCheckoutCutoffTs($date), self::DISPLAY_TZ
            )->toIso8601String();
            $otApplicable = $emp->overtimeApplicable();
            $shiftEndAt   = \Carbon\Carbon::createFromTimestamp(
                $cutoffRow->shiftEndTs($date), self::DISPLAY_TZ
            )->toIso8601String();
            $overtimeSecs = $today ? $today->overtimeSecondsForDay() : 0;
            $lastPunch = $todayPunches->last();
            if ($lastPunch && $lastPunch->direction === 'in' && $lastPunch->punched_at) {
                $openInAt = $lastPunch->punched_at->toIso8601String();
            }

            $lateByMinutes = 0;
            $dayShiftStart = ($today ? $today->shiftWindow()[0] : null) ?: $shiftStart;
            if ($firstIn && $dayShiftStart) {
                $diff = $this->minutesBetween($dayShiftStart, $firstIn);
                if ($diff > 0) $lateByMinutes = $diff;
            }

            $mRows = $monthRows->get($emp->id, collect());
            $presentDays = 0; $lateMarks = 0; $missingPunch = 0;
            $mByIso = [];
            foreach ($mRows as $r) {
                $mByIso[\Carbon\Carbon::parse($r->attendance_date)->toDateString()] = $r;
                $st = strtolower((string) $r->status);
                if ($this->workedARestDay($st, $r)) {
                    $st = 'present';
                }
                if (in_array($st, ['present', 'late', 'on duty', 'work from home', 'corrected', 'half day'], true)) {
                    $presentDays++;
                }
                if ($st === 'late') $lateMarks++;
                if ($st === 'missing in' || $st === 'missing out') {
                    $missingPunch++;
                } elseif ($r->check_in_at && !$r->check_out_at
                    && \Carbon\Carbon::parse($r->attendance_date)->toDateString() < self::todayLocal()) {
                    $missingPunch++;
                }
                $rowShiftStart = $r->shiftWindow()[0] ?: $shiftStart;
                if ($r->check_in_at && $rowShiftStart) {
                    $localIn = $r->check_in_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i');
                    $late = $this->minutesBetween($rowShiftStart, $localIn);
                    if ($late > Attendance::LATE_GRACE_MINUTES && $st === 'present') $lateMarks++;
                }
            }

            $compliancePct = null;
            if ($detailMode) {
            $holidaySet  = $holidayByGroup[$emp->holiday_group_id ?? self::HOLIDAY_COMPANY_KEY]
                ?? $holidayByGroup[self::HOLIDAY_COMPANY_KEY] ?? [];
            $joinDate    = $emp->date_of_joining ? \Carbon\Carbon::parse($emp->date_of_joining) : null;
            $tracked     = $this->trackedWorkingDays(
                (clone $dateC)->startOfMonth(), $mtdEndC, $joinDate, $weeklyOffLabel, $holidaySet, $mByIso,
                $leaveDaysByEmp[$emp->id] ?? []
            );
            $compliancePct = $tracked === 0
                ? null
                : (int) round(min(100, max(0, $presentDays / $tracked * 100)));
            }

            $logs = [];
            if ($detailMode) {
                $hRows = $historyRows->get($emp->id, collect());
                $logs  = $this->buildHistoryLogs(
                    $hRows, $emp, $shiftStart, $expectedMinutes, $weeklyOffLabel, $histStart, $histEnd,
                    $holidayByGroupLog[$emp->holiday_group_id ?? self::HOLIDAY_COMPANY_KEY]
                        ?? $holidayByGroupLog[self::HOLIDAY_COMPANY_KEY] ?? [],
                    $leaveLogByEmp[$emp->id] ?? [],
                    $joinIso,
                    $exitIso,
                );
            }

            return [
                'id'                => $emp->id,
                'empCode'           => (string) ($emp->emp_code ?? ''),
                'name'              => (string) ($emp->display_name ?? trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''))),
                'initials'          => $this->initials((string) ($emp->display_name ?? '')),
                'accent'            => '',
                'department'        => $emp->department?->name ?? '—',
                'designation'       => $emp->designation?->name ?? '—',
                'managerName'       => $this->managerDisplayName($emp),
                'dateOfJoining'     => $joinIso,
                'exitedOn'          => $exitedOnIso,
                'noticeUntil'       => $noticeUntil,
                'employedUntil'     => $exitIso,
                'shift'             => ($today?->shiftNameForDay())
                    ?: (string) ($emp->shift ?? 'General (09:30 – 18:30)'),
                'shiftStart'        => self::displayShiftWindow($today, $shiftStart, $shiftEnd)[0],
                'shiftEnd'          => self::displayShiftWindow($today, $shiftStart, $shiftEnd)[1],
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
                'overtimeApplicable'=> $otApplicable,
                'shiftEndAt'        => $shiftEndAt,
                'overtimeSeconds'   => $overtimeSecs,
                'expectedMinutes'   => $expectedMinutes,
                'lateByMinutes'     => $lateByMinutes,
                'lateGraceMinutes'  => Attendance::LATE_GRACE_MINUTES,
                'punches'           => $detailMode ? $this->renderPunches($todayPunches) : [],
                'presentDays'       => $presentDays,
                'lateMarks'         => $lateMarks,
                'missingPunch'      => $missingPunch,
                'compliancePct'     => $compliancePct,
                'logs'              => $logs,
                'holidays'          => $detailMode
                    ? (object) ($holidayByGroupCal[$emp->holiday_group_id ?? self::HOLIDAY_COMPANY_KEY]
                        ?? $holidayByGroupCal[self::HOLIDAY_COMPANY_KEY] ?? [])
                    : (object) [],
                'weeklyOffDates'    => $detailMode
                    ? (object) \App\Support\WeekOff::datesInRange(
                        (string) ($emp->weekly_off ?? ''),
                        \Carbon\Carbon::parse($histStart),
                        $calendarHolidayEnd,
                    )
                    : (object) [],
                'correction'        => (function () use ($pendingCorrections, $emp, $date) {
                    $c = $pendingCorrections[$emp->id] ?? null;
                    if (!$c) return null;
                    return [
                        'id'       => (string) $c->id,
                        'date'     => $date,
                        'type'     => (string) ($c->type ?? 'Correction'),
                        'reason'   => (string) ($c->reason ?? ''),
                        'status'   => 'Pending',
                        'raisedAt' => (string) ($c->created_at ?? ''),
                    ];
                })(),
            ];
        })->values();

        return response()->json($out);
    }

    private function expectedMinutesFromWindow(?string $start, ?string $end): int
    {
        if (!$start || !$end) return 540;
        $diff = $this->minutesBetween($start, $end);
        if ($diff <= 0) $diff += 24 * 60;
        return $diff;
    }

    private function minutesBetween(string $from, string $to): int
    {
        [$fh, $fm] = array_map('intval', explode(':', $from));
        [$th, $tm] = array_map('intval', explode(':', $to));
        return ($th * 60 + $tm) - ($fh * 60 + $fm);
    }

    public const HOLIDAY_COMPANY_KEY = 0;

    private function holidayDatesForGroups(
        array $groupIds,
        \Carbon\Carbon $start,
        \Carbon\Carbon $end,
        ?int $clientId = null,
        ?int $branchId = null,
    ): array {
        if (!\Illuminate\Support\Facades\Schema::hasTable('holidays')) {
            return [];
        }

        $rows = DB::table('holidays')
            ->whereNull('deleted_at')
            ->where(function ($q) use ($groupIds, $clientId, $branchId) {
                $q->where(function ($w) use ($clientId, $branchId) {
                    $w->whereNull('holiday_group_id');
                    if ($clientId) $w->where('client_id', $clientId);
                    if ($branchId) {
                        $w->where(fn ($b) => $b->whereNull('branch_id')->orWhere('branch_id', $branchId));
                    }
                });
                if (!empty($groupIds)) {
                    $q->orWhereIn('holiday_group_id', $groupIds);
                }
            })
            ->get(['holiday_group_id', 'name', 'date', 'is_recurring']);

        $map = [];
        $company = [];
        foreach ($rows as $r) {
            if (!$r->date) continue;
            $src  = \Carbon\Carbon::parse($r->date);
            $name = $r->name ?: 'Holiday';

            $dates = [];
            if ($r->is_recurring) {
                for ($yr = $start->year; $yr <= $end->year; $yr++) {
                    if (!checkdate($src->month, $src->day, $yr)) continue;
                    $dates[] = \Carbon\Carbon::create($yr, $src->month, $src->day);
                }
            } else {
                $dates[] = $src;
            }

            foreach ($dates as $d) {
                if ($d->lt($start) || $d->gt($end)) continue;
                $iso = $d->toDateString();
                if ($r->holiday_group_id === null) {
                    $company[$iso] = $name;
                } else {
                    $map[$r->holiday_group_id][$iso] = $name;
                }
            }
        }

        foreach ($groupIds as $gid) {
            if ($gid === null) continue;
            $map[$gid] = ($map[$gid] ?? []) + $company;
        }
        $map[self::HOLIDAY_COMPANY_KEY] = $company;

        return $map;
    }

    private function trackedWorkingDays(
        \Carbon\Carbon $monthStart,
        \Carbon\Carbon $mtdEnd,
        ?\Carbon\Carbon $joinDate,
        ?string $weeklyOffLabel,
        array $holidaySet,
        array $mByIso,
        array $leaveDaySet = []
    ): int {
        $tracked = 0;
        $cursor  = $monthStart->copy();
        while ($cursor->lte($mtdEnd)) {
            $iso = $cursor->toDateString();

            if ($joinDate && $cursor->lt($joinDate->copy()->startOfDay())) {
                $cursor->addDay();
                continue;
            }

            $isWeeklyOff = \App\Support\WeekOff::isOff($weeklyOffLabel, $cursor);
            $isHoliday   = isset($holidaySet[$iso]);
            $st          = strtolower((string) ($mByIso[$iso]->status ?? ''));
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

    private function workedARestDay(?string $status, ?Attendance $row): bool
    {
        return \App\Support\AttendanceDayStatus::workedARestDay($status, $row);
    }

    private function resolveDayStatus(
        ?Attendance $row,
        bool $weeklyOff,
        ?string $shiftStart,
        string $date,
        bool $isHoliday = false,
    ): string {
        return \App\Support\AttendanceDayStatus::resolve(
            $row, $weeklyOff, $shiftStart, $date, $isHoliday,
        );
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

    private function joiningIso(Employee $emp): ?string
    {
        return $emp->date_of_joining
            ? \Carbon\Carbon::parse($emp->date_of_joining)->toDateString()
            : null;
    }

    private function attendanceStartIso(Employee $emp): ?string
    {
        $join = $this->joiningIso($emp);
        if ($join !== null) return $join;

        return $emp->created_at
            ? $emp->created_at->copy()->setTimezone(self::DISPLAY_TZ)->toDateString()
            : null;
    }

    private function owesAttendance(Employee $emp): bool
    {
        return (int) ($emp->onboarding_stage_completed ?? 0) >= 6;
    }

    private function managerDisplayName(Employee $emp): string
    {
        $mgr  = $emp->reportingManager;
        $name = $mgr
            ? trim((string) ($mgr->display_name ?: trim(((string) $mgr->first_name) . ' ' . ((string) $mgr->last_name))))
            : '';
        if ($name === '' && $emp->reporting_manager_user_id) {
            $name = trim((string) ($emp->reportingManagerUser?->name ?? ''));
        }
        return $name !== '' ? $name : '—';
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
        foreach ($out as &$row) unset($row['_outTs']);
        return $out;
    }

    private function buildHistoryLogs($rows, Employee $emp, ?string $shiftStart, int $expectedMinutes, ?string $weeklyOffLabel, string $from, string $to, array $holidaySet = [], array $leaveDaySet = [], ?string $joinIso = null, ?string $exitIso = null): array
    {
        $byIso = [];
        foreach ($rows as $r) {
            $iso = \Carbon\Carbon::parse($r->attendance_date)->toDateString();

            $r->setRelation('employee', $emp);
            $byIso[$iso] = $r;
        }

        $shift = (string) ($emp->shift ?: '—');

        $shiftEndLabel = $emp->resolveShiftWindow()[1] ?: '18:30';
        $todayLocal = self::todayLocal();

        $startIso = $joinIso ?? $this->attendanceStartIso($emp);
        $owes     = $this->owesAttendance($emp);
        $out = [];

        $cursor = \Carbon\Carbon::parse($to);
        $start  = \Carbon\Carbon::parse($from);
        while ($cursor->greaterThanOrEqualTo($start)) {
            $iso = $cursor->toDateString();

            if ($iso > $todayLocal) { $cursor->subDay(); continue; }

            if ($startIso !== null && $iso < $startIso && !isset($byIso[$iso])) { $cursor->subDay(); continue; }
            if (!$owes && !isset($byIso[$iso])) { $cursor->subDay(); continue; }
            if ($exitIso !== null && $iso > $exitIso && !isset($byIso[$iso])) { $cursor->subDay(); continue; }
            $r   = $byIso[$iso] ?? null;
            $isWO = \App\Support\WeekOff::isOff($weeklyOffLabel, $cursor);
            $isHoliday = isset($holidaySet[$iso]);
            $isFuture = $iso > $todayLocal;

            if ($r) {
                $status  = $r->status ?: ($isWO ? 'Weekly Off' : 'Absent');
                $workedRestDay = $this->workedARestDay($status, $r);
                if ($workedRestDay) $status = 'Present';

                $firstIn = $r->check_in_at  ? $r->check_in_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i')  : '—';
                $lastOut = $r->check_out_at ? $r->check_out_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i') : '—';
                $worked  = (int) floor(((int) $r->total_worked_seconds) / 60);
                $rowShift = $r->shiftWindow()[0] ?: $shiftStart;
                if (strcasecmp($status, 'Present') === 0 && $firstIn !== '—' && $rowShift
                    && $this->minutesBetween($rowShift, $firstIn) > Attendance::LATE_GRACE_MINUTES) {
                    $status = 'Late';
                }
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
                        $segments[] = ['start' => round($openIn, 6), 'end' => round($hf, 6)];
                        $openIn = null;
                    }
                }
                if ($openIn !== null) {
                    $nowLocal = \Carbon\Carbon::now(self::DISPLAY_TZ);
                    $endHf = $iso === $todayLocal
                        ? max($openIn, $nowLocal->hour + $nowLocal->minute / 60)
                        : $openIn;
                    $segments[] = [
                        'start' => round($openIn, 6),
                        'end'   => round($endHf, 6),
                        'open'  => true,
                    ];
                }
            } else {
                $status  = $isFuture ? 'Absent' : ($isWO ? 'Weekly Off' : 'Absent');
                $firstIn = '—';
                $lastOut = '—';
                $worked  = 0;
                $segments = [];
            }

            $holidayName = $isHoliday && is_string($holidaySet[$iso] ?? null)
                ? $holidaySet[$iso]
                : null;

            if ($isHoliday && in_array(strtolower((string) $status), ['absent', 'weekly off'], true)) {
                $status = 'Holiday';
            }

            $leaveInfo   = $leaveDaySet[$iso] ?? null;
            $leaveKind   = null;
            $leavePortion = null;
            if ($leaveInfo) {
                $leaveKind    = strcasecmp((string) ($leaveInfo['paid'] ?? 'Paid'), 'Unpaid') === 0 ? 'Unpaid' : 'Paid';
                $leavePortion = (string) ($leaveInfo['portion'] ?? 'full');

                if (in_array(strtolower((string) $status), ['absent', 'leave'], true)) {
                    $status = $leaveKind === 'Unpaid' ? 'Unpaid Leave' : 'Paid Leave';
                }
            }

            $dayOpen = (bool) ($r && $r->check_in_at && !$r->check_out_at);

            $deviation = '—';
            if ($worked !== 0 && !$dayOpen) {
                $diff = $worked - $expectedMinutes;
                $sign = $diff < 0 ? '-' : '+';
                $mag  = abs($diff);
                $deviation = sprintf('%s%dh %02dm', $sign, intdiv($mag, 60), $mag % 60);
            }

            $lateMin = 0;
            $lateShift = ($r ? $r->shiftWindow()[0] : null) ?: $shiftStart;
            if ($firstIn !== '—' && $lateShift) {
                $lateMin = max(0, $this->minutesBetween($lateShift, $firstIn));
            }

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
                'shift'            => ($r?->shiftNameForDay()) ?: $shift,
                'shiftStart'       => self::displayShiftWindow($r, $shiftStart, $shiftEndLabel)[0],
                'shiftEnd'         => self::displayShiftWindow($r, $shiftStart, $shiftEndLabel)[1],
                'firstIn'          => $firstIn,
                'lastOut'          => $lastOut,
                'worked'           => $dayOpen ? 'In Progress' : ($worked === 0 ? '—' : sprintf('%dh %02dm', intdiv($worked, 60), $worked % 60)),
                'dayOpen'          => $dayOpen,
                'deviation'        => $deviation,
                'exception'        => in_array(strtolower($status), ['late', 'half day', 'absent', 'corrected', 'missing in', 'missing out'], true) ? $status : null,
                'leaveKind'        => $leaveKind,
                'leavePortion'     => $leavePortion,
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
            'descriptor.*' => 'required|numeric|between:-5,5',
            'label'        => 'nullable|string|max:50',
            'lat'          => 'nullable|numeric|between:-90,90',
            'lng'          => 'nullable|numeric|between:-180,180',
        ]);

        $employee = $this->callerEmployee($request);

        if ($employee->isDisabled()) {
            return response()->json([
                'message'  => 'Your employee record is not active. Please contact HR.',
                'inactive' => true,
            ], 422);
        }

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
            $punchService = app(\App\Services\AttendancePunchService::class);

            $attendance = $punchService->findOrCreateDay($employee, $today);

            $nextDir = $punchService->nextDirection($attendance);

            if ($expected !== $nextDir) {
                return response()->json([
                    'message'        => $nextDir === 'in'
                        ? 'You need to clock IN next, not OUT — your last punch was a clock-out.'
                        : 'You need to clock OUT next, not IN — you are already clocked in.',
                    'matched'        => true,
                    'next_direction' => $nextDir,
                ], 422);
            }

            $label = trim((string) ($data['label'] ?? ''));
            if ($label === '') {
                $label = $nextDir === 'in' ? 'Check In' : 'Check Out';
            }

            $punch = $punchService->appendPunch($attendance, $employee, [
                'punched_at'     => now(),
                'direction'      => $nextDir,
                'label'          => $label,
                'method'         => 'face',
                'match_distance' => round($distance, 4),
                'ip'             => $request->ip(),
                'lat'            => $data['lat'] ?? null,
                'lng'            => $data['lng'] ?? null,
            ]);

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
        app(\App\Services\AttendancePunchService::class)->recomputeSummary($attendance);
    }

    private function callerEmployee(Request $request): Employee
    {
        $user = $request->user();
        if (!$user) abort(401, 'Unauthenticated');
        $row = Employee::find($user->employee_id);
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
