<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\AttendancePunch;
use App\Models\Branch;
use App\Models\Employee;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Attendance — face-driven punch ledger for the signed-in employee plus the
 * tenant-scoped read endpoint for HR.
 *
 * Multi-punch model:
 *   - Each tap of the camera writes a row to `attendance_punches`.
 *   - Direction strictly alternates (system-enforced, not client-trusted):
 *     first punch is always 'in', subsequent punches flip on every tap.
 *   - The parent `attendances` row holds first-in / last-out as a denormalised
 *     summary for cheap list reads; the actual timeline is the punches.
 *
 * Labels — the SPA passes one of:
 *   Check In, Step Out, Step In, Lunch Out, Lunch In, Meeting, Check Out
 * Free-text is accepted (varchar in DB) so a custom label like "Site visit"
 * still records without a schema change.
 *
 * Match threshold is 0.55 (face-api default 0.6, tightened slightly for
 * attendance) and lives server-side so a malicious client can't skip the
 * compare by sending a hand-crafted "always-match" body.
 */
class AttendanceController extends Controller
{
    private const MATCH_THRESHOLD = 0.55;
    private const DESCRIPTOR_LEN  = 128;

    /**
     * Timezone used when surfacing punch times to the SPA. The app stores
     * UTC (Laravel default) so a face-punch at 10:48 AM IST lands in the
     * DB as 05:18 UTC. Formatting with Carbon's default tz then echoes
     * 05:18 back to HR, which looks like a 5h-30m time-travel bug. We
     * convert every displayed time to this tz before formatting so the
     * branch dashboard matches the wall-clock the employee saw.
     *
     * Single-region SaaS today; if you ever sell across tz boundaries,
     * promote this to a per-client setting.
     */
    private const DISPLAY_TZ = 'Asia/Kolkata';

    /**
     * "Today" as a YYYY-MM-DD string in the display timezone — used as the
     * business date for attendance_date columns and as the default value for
     * /today, /daily-view, etc. Without this, a 1 AM IST punch (= 19:30 UTC
     * previous day) lands on the wrong calendar day because Laravel's
     * config('app.timezone') is UTC.
     */
    private static function todayLocal(): string
    {
        return now(self::DISPLAY_TZ)->toDateString();
    }

    /** Whitelist of well-known activity labels. Anything not in this list is
     *  still allowed (saved verbatim) so HR can record one-off activities,
     *  but the SPA picks from this set so the colour mapping stays stable. */
    private const KNOWN_LABELS = [
        'Check In', 'Step Out', 'Step In', 'Lunch Out', 'Lunch In',
        'Meeting', 'Check Out',
    ];

    /* ─────────────────────────────────────────────────────────────────
     *  EMPLOYEE-FACING ENDPOINTS
     * ───────────────────────────────────────────────────────────────── */

    /**
     * Today's attendance row for the signed-in employee, with the full punch
     * timeline. Used by the SPA's /clock-in page to render the timeline +
     * decide whether the next action is Clock In or Clock Out.
     */
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

    /**
     * Employee's own attendance history. Eager-loads punches so the
     * day-by-day list can render the full timeline without N+1 queries.
     */
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

    /**
     * Summary view for a specific employee's profile page. Aggregates:
     *   - today's row + punches (so the Today card renders immediately)
     *   - month stats (present, late, missing, leave)
     *   - paginated history for the selected month (?month=YYYY-MM)
     *
     * Authorisation:
     *   - the employee viewing their OWN profile is allowed
     *   - super_admin can see anyone
     *   - client_admin / client_user / branch_user can see anyone in the same
     *     tenant (mirrors the rules used by FaceBiometricController and the
     *     EmployeeController scope helpers)
     */
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
        [$shiftStart, ] = $this->parseShiftWindow((string) ($emp->shift ?? ''));
        $shiftStart = $shiftStart ?: '09:30';
        $present  = 0; $late = 0; $missingBio = 0; $leaveDays = 0;
        foreach ($history as $row) {
            $status = (string) ($row->status ?? '');
            if (strcasecmp($status, 'Present') === 0)  $present++;
            if (strcasecmp($status, 'Late') === 0)     { $late++; $present++; } // late still counts as present
            if (strcasecmp($status, 'Leave') === 0)    $leaveDays++;
            if (strcasecmp($status, 'Missing In') === 0 || strcasecmp($status, 'Missing Out') === 0) {
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

        return response()->json([
            'employee' => [
                'id'              => $emp->id,
                'emp_code'        => $emp->emp_code,
                'name'            => $emp->display_name,
                'face_registered' => !empty($emp->face_descriptor) && $emp->face_registered_at !== null,
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
        ]);
    }

    /* ─────────────────────────────────────────────────────────────────
     *  HR / ADMIN-FACING ENDPOINT
     * ───────────────────────────────────────────────────────────────── */

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

    /**
     * Daily View endpoint for the HR Attendance page.
     *
     * Returns every attendance-tracked employee under the current user's
     * scope, hydrated with: today's status (or any past day via `?date=`),
     * today's punch timeline, month-to-date KPIs (present / late / missing /
     * compliance %), and a 30-day history log for the right-side table.
     *
     * Tenant scoping mirrors AttendanceController::index() — branch_user is
     * pinned to their own branch, super_admin sees all, and a `?branch_id=`
     * filter is honoured (for client admins) when it belongs to the caller's
     * tenant.
     *
     * Shape returned is intentionally aligned with the AttendanceEmployee
     * type in resources/js/pages/hrms/HrAttendance.tsx so the SPA can
     * consume the payload directly without a translation layer.
     */
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

        // ── 3) Compose per-employee payload in the shape the SPA expects ──
        // Default office window used when an employee's `shift` string has
        // no parseable time pair (e.g. just "General Shift"). Late-by-minutes
        // and the historic late heuristic both fall back to this so the KPIs
        // stay meaningful even when shift data is incomplete.
        $defaultShiftStart = '09:30';
        $defaultShiftEnd   = '18:30';
        $out = $employees->map(function (Employee $emp) use ($dailyRows, $monthRows, $historyRows, $date, $histStart, $defaultShiftStart, $defaultShiftEnd) {
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
            $firstIn     = $today?->check_in_at ? $today->check_in_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i') : null;
            $lastOut     = $today?->check_out_at ? $today->check_out_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i') : null;
            $workedSecs  = $today ? (int) $today->total_worked_seconds : 0;
            $workedMins  = (int) floor($workedSecs / 60);

            $lateByMinutes = 0;
            if ($firstIn && $shiftStart) {
                $diff = $this->minutesBetween($shiftStart, $firstIn);
                if ($diff > 0) $lateByMinutes = $diff;
            }

            // KPIs — month-to-date
            $mRows = $monthRows->get($emp->id, collect());
            $presentDays = 0; $lateMarks = 0; $missingPunch = 0; $tracked = 0;
            foreach ($mRows as $r) {
                $st = strtolower((string) $r->status);
                if (in_array($st, ['present', 'late', 'on duty', 'work from home', 'corrected', 'half day'], true)) {
                    $presentDays++;
                }
                if ($st === 'late' || $st === 'half day') $lateMarks++;
                if ($st === 'missing in' || $st === 'missing out') $missingPunch++;
                // Heuristic late on top of stored status — shift_start is in
                // local time, so the punch timestamp must be converted from
                // UTC before comparing.
                if ($r->check_in_at && $shiftStart) {
                    $localIn = $r->check_in_at->copy()->setTimezone(self::DISPLAY_TZ)->format('H:i');
                    $late = $this->minutesBetween($shiftStart, $localIn);
                    if ($late > 10 && $st === 'present') $lateMarks++;
                }
                // A22: sanctioned days (Leave / Holiday / Weekly Off) are NOT
                // non-compliant absences — keep them out of the denominator so
                // compliance % isn't unfairly dragged down by approved leave.
                $isSanctioned = str_contains($st, 'leave') || str_contains($st, 'holiday')
                    || str_contains($st, 'week off') || $st === 'weekly off';
                if (!$isSanctioned) $tracked++;
            }
            // Compliance = share of MTD attendance days the employee was
            // actually marked Present (or a present-equivalent status).
            // Missing-punch days naturally drag this down because they're
            // in `tracked` but NOT in `presentDays`. The old formula
            // `(present - missing) / tracked` double-counted absences and
            // reported e.g. 60 % when someone hit 4 of 5 days.
            $compliancePct = $tracked === 0
                ? 100
                : (int) round(min(100, max(0, $presentDays / $tracked * 100)));

            // 90-day log — covers EVERY day in the window so the calendar
            // and the month range pills paint a full picture, not just the
            // days the employee happened to punch.
            $hRows = $historyRows->get($emp->id, collect());
            $logs = $this->buildHistoryLogs($hRows, $emp, $shiftStart, $expectedMinutes, $weeklyOffSet, $histStart, $date);

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

    /* ─────────────────────────────────────────────────────────────────
     *  DAILY-VIEW HELPERS
     * ───────────────────────────────────────────────────────────────── */

    /**
     * Parse a shift string like "General (09:00 – 18:00)" or "Night (21:00 -
     * 06:00)" into ["09:00", "18:00"]. Returns [null, null] when no parse.
     * Accepts both en-dash and hyphen separators.
     */
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
     * Decompose a weekly-off label like "Sun" or "Sat, Sun" into a set of
     * Carbon dayOfWeek integers (Sun = 0 .. Sat = 6). When the label is
     * unparseable (empty, "Week Off Policy", "—", etc.) we default to
     * **Sunday only** — that's the most common Indian work-week and keeps
     * the calendar from showing every weekend as Absent.
     */
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

    /**
     * Resolve the day-level status string surfaced to the SPA.
     *
     * The face-clock flow always writes status='Present' on the first punch
     * (it doesn't know the shift schedule), so we have to promote it to
     * 'Late' here when the actual first-in is significantly after the
     * employee's shift start. Without this every late arriver still showed
     * a green Present pill — the late minutes were known but the label
     * was lying.
     */
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

    /** Two-letter initials from a display name. */
    private function initials(string $name): string
    {
        $name = trim($name);
        if ($name === '') return '?';
        $parts = preg_split('/\s+/', $name);
        $first = mb_substr($parts[0] ?? '', 0, 1);
        $second = count($parts) > 1 ? mb_substr($parts[count($parts) - 1], 0, 1) : '';
        return strtoupper($first . $second);
    }

    /** Map AttendancePunch rows to the PunchEvent shape the SPA renders. */
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

    /**
     * Build the Logs & Requests history rows for the entire [from, to]
     * window (inclusive), one row per day. Days with an Attendance row use
     * its real status/punches; days WITHOUT a row are synthesised as
     * "Weekly Off" (if the day matches the weekly_off set) or "Absent".
     *
     * Filling in every day is what makes the month range pills (APR / MAR
     * / FEB / …) and the Calendar tab actually useful — without it the
     * table only shows the handful of days the employee happened to
     * punch, and absences look identical to "no data".
     */
    private function buildHistoryLogs($rows, Employee $emp, ?string $shiftStart, int $expectedMinutes, array $weeklyOffSet, string $from, string $to): array
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
            $r   = $byIso[$iso] ?? null;
            $isWO = isset($weeklyOffSet[$cursor->dayOfWeek]);
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

            $out[] = [
                'iso'              => $iso,
                'date'             => $cursor->format('d M Y'),
                'weekday'          => $cursor->format('D'),
                'status'           => $status,
                'shift'            => $shift,
                'firstIn'          => $firstIn,
                'lastOut'          => $lastOut,
                'worked'           => $worked === 0 ? '—' : sprintf('%dh %02dm', intdiv($worked, 60), $worked % 60),
                'deviation'        => $deviation,
                'exception'        => in_array(strtolower($status), ['late', 'half day', 'absent', 'corrected'], true) ? $status : null,
                'workSegments'     => $segments,
                'effectiveMinutes' => $worked,
                'grossMinutes'     => $worked,
                'expectedMinutes'  => $expectedMinutes,
                'lateMinutes'      => $lateMin,
            ];

            $cursor->subDay();
        }
        return $out;
    }

    /* ─────────────────────────────────────────────────────────────────
     *  CORE — face punch
     * ───────────────────────────────────────────────────────────────── */

    /**
     * Verify the face, then write a single punch and recompute the daily
     * summary. `expected` is the direction the SPA SAYS this is — we don't
     * blindly trust it; we look at the last punch and verify the expected
     * direction matches the next valid one. Mismatch = 422 so the user can't
     * accidentally clock in twice in a row.
     */
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

    /**
     * Refresh `check_in_at` / `check_out_at` on the parent Attendance row
     * from the punch ledger. Keeps the cheap "first in / last out" denorm
     * accurate even after edits / deletions on punches.
     */
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

    /* ─────────────────────────────────────────────────────────────────
     *  HELPERS
     * ───────────────────────────────────────────────────────────────── */

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
