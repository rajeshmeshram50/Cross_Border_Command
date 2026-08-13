<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\AttendancePunch;
use App\Models\AttendanceRegularization;
use App\Models\Employee;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;

/**
 * Attendance regularization workflow — an employee asks to correct a past
 * day's attendance (adjust punches, or exempt the day from penalty policy),
 * which is routed to the reporting manager / HR for approval.
 *
 * The approval model mirrors LeaveRequestController but is deliberately
 * simpler: a single Reporting-Manager level (HR/admin may act from the HR
 * Attendance screen). There is no leave-plan / quota machinery here.
 *
 * Tenant safety: every single-row endpoint passes through findScopedOrFail so
 * a user in client X can't read or act on a request belonging to client Y.
 */
class AttendanceRegularizationController extends Controller
{
    /** Tenant-facing timezone used to resolve "today" for date guards. The app
     *  runs in UTC; attendance dates are entered/read in IST. */
    private const DISPLAY_TZ = 'Asia/Kolkata';

    private const ADMIN_TYPES = ['super_admin', 'client_admin', 'branch_user'];

    // ─────────────────────────────────────────────────────────────────────
    // Index — regularization history for an employee
    // ─────────────────────────────────────────────────────────────────────
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        // Admin/HR can open any employee's profile, so accept an explicit
        // employee_id; otherwise fall back to the caller's own employee row.
        $employeeId = $request->integer('employee_id') ?: null;
        if (!$employeeId) {
            $own = Employee::where('user_id', $user->id)->first();
            if (!$own) return response()->json(['data' => []]);
            $employeeId = $own->id;
        }

        // Tenant guard — a null client_id on the employee must NOT bypass it.
        if ($user->user_type !== 'super_admin' && $user->client_id) {
            $targetClientId = Employee::where('id', $employeeId)->value('client_id');
            if ((int) $targetClientId !== (int) $user->client_id) {
                abort(404);
            }
        }

        $q = AttendanceRegularization::query()
            ->where('employee_id', $employeeId)
            ->with(['approver:id,name'])
            ->orderByDesc('regularization_date')
            ->orderByDesc('id');
        if ($status = $request->input('status')) {
            $q->where('status', $status);
        }

        return response()->json(['data' => $q->get()]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Store — employee submits a regularization request
    // ─────────────────────────────────────────────────────────────────────
    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'employee_id'        => ['nullable', 'integer', 'exists:employees,id'],
            'regularization_date' => ['required', 'date'],
            'mode'               => ['required', Rule::in(['adjust', 'exempt'])],
            'type'               => ['nullable', 'string', 'max:100'],
            'work_locations'     => ['nullable', 'array'],
            'work_locations.*'   => ['string', 'max:120'],
            'punches'            => ['nullable', 'array'],
            'punches.*.in'       => ['nullable', 'string', 'max:8'],
            'punches.*.out'      => ['nullable', 'string', 'max:8'],
            'reason'             => ['required', 'string', 'max:2000'],
        ]);

        // Resolve target employee — explicit id (admin filing on behalf) or
        // the signed-in user's own employee row.
        $employee = null;
        if (!empty($data['employee_id'])) {
            $employee = Employee::find($data['employee_id']);
        }
        if (!$employee) {
            $employee = Employee::where('user_id', $user->id)->first();
        }
        if (!$employee) {
            abort(422, 'Could not resolve target employee for this regularization request.');
        }

        // Tenant guard on the resolved employee.
        if ($user->user_type !== 'super_admin'
            && $user->client_id
            && (int) $employee->client_id !== (int) $user->client_id) {
            abort(403, 'You cannot file a regularization for an employee outside your tenant.');
        }

        // Self-service rule — an employee regularizes their OWN attendance.
        // Filing on behalf of someone else is an HR/admin capability. Use the
        // shared ADMIN_TYPES (which includes branch_user) so this matches the
        // index / approve / cancel checks — a branch-level HR admin could
        // otherwise view and approve regularizations but not create one on
        // behalf of an employee, getting "You can only raise a regularization
        // request for yourself" (bug #15).
        $isAdmin = in_array($user->user_type, self::ADMIN_TYPES, true);
        if (!$isAdmin && (int) ($employee->user_id ?? 0) !== (int) $user->id) {
            abort(403, 'You can only raise a regularization request for yourself.');
        }

        // Date guard — regularization is for a PAST or current day, never a
        // future one (you can't correct attendance that hasn't happened).
        $todayStr = now(self::DISPLAY_TZ)->toDateString();
        $dateStr  = Carbon::parse($data['regularization_date'])->toDateString();
        if ($dateStr > $todayStr) {
            abort(422, 'You cannot regularize a future date. Pick today or a past day.');
        }

        // Payroll gate — once the month's payroll is paid (period locked), its
        // attendance is closed. Filing here would raise a request that can never
        // legitimately be applied, so it is refused at the door.
        if ($this->payrollLocked($employee, $dateStr)) {
            abort(422, 'Payroll for ' . Carbon::parse($dateStr)->format('F Y')
                . ' is already processed and locked — attendance for this month can no longer be regularized.'
                . ' Ask HR to post an adjustment in the next payroll cycle.');
        }

        // For an "adjust" request at least one usable punch entry is required.
        $punches = [];
        foreach (($data['punches'] ?? []) as $p) {
            $in  = trim((string) ($p['in'] ?? ''));
            $out = trim((string) ($p['out'] ?? ''));
            if ($in === '' && $out === '') continue;
            $punches[] = ['in' => $in ?: null, 'out' => $out ?: null];
        }
        if ($data['mode'] === 'adjust' && empty($punches)) {
            abort(422, 'Add at least one punch entry (an in or out time) to adjust the attendance log.');
        }

        // One open request per (employee, date) — block stacking duplicates.
        $dup = AttendanceRegularization::where('employee_id', $employee->id)
            ->where('regularization_date', $dateStr)
            ->where('status', 'Pending')
            ->first();
        if ($dup) {
            abort(422, "There is already a Pending regularization request for {$dateStr}. Act on it before raising another.");
        }

        // Link the day's attendance row when one exists.
        $attendanceId = Attendance::where('employee_id', $employee->id)
            ->whereDate('attendance_date', $dateStr)
            ->value('id');

        // Snapshot the RM-only approval chain. A self-loop / missing manager
        // collapses to auto-approved (no one left to act).
        $chain = $this->snapshotApprovalChain($employee);
        $startLevel = $this->firstActionableLevel($chain, 1);
        $autoApproved = count($chain) > 0 && $startLevel > count($chain);

        $row = AttendanceRegularization::create([
            'client_id'              => $employee->client_id,
            'branch_id'              => $employee->branch_id,
            'employee_id'            => $employee->id,
            'attendance_id'          => $attendanceId,
            'regularization_date'    => $dateStr,
            'mode'                   => $data['mode'],
            'type'                   => $data['type'] ?? ($data['mode'] === 'exempt' ? 'On Duty (OD)' : 'Forgot to Punch'),
            'work_locations'         => array_values($data['work_locations'] ?? []),
            'punches'                => $punches,
            'reason'                 => $data['reason'],
            'status'                 => $autoApproved ? 'Approved' : 'Pending',
            'approval_chain'         => $chain,
            'current_approval_level' => $startLevel,
            'approved_at'            => $autoApproved ? now() : null,
            'approver_comment'       => $autoApproved ? 'Auto-approved — no reporting manager assigned to act' : null,
            'created_by'             => $user->id,
        ]);

        // If it auto-approved (no reporting manager to act), apply the punch
        // adjustment to the attendance ledger right away.
        if ($autoApproved) {
            $this->applyApprovedAdjustment($row);
        }

        // Resolve the ACTUAL pending approver so the client shows a truthful
        // "Routed to X" toast instead of guessing from the org chart (bug #29).
        // The chain is RM-based; whoever the RM resolves to (often the Branch
        // User / HR) is the real approver — name them, don't assume.
        $pendingApprover = null;
        if (!$autoApproved) {
            $lvl = $chain[$startLevel - 1] ?? null;
            if ($lvl) {
                $name = null;
                if (!empty($lvl['approver_employee_id'])) {
                    $ap = Employee::find($lvl['approver_employee_id']);
                    $name = $ap?->display_name ?: trim(($ap?->first_name ?? '') . ' ' . ($ap?->last_name ?? '')) ?: null;
                } elseif (!empty($lvl['approver_user_id'])) {
                    $name = \App\Models\User::find($lvl['approver_user_id'])?->name;
                }
                $pendingApprover = ['name' => $name, 'role' => $lvl['approver_role'] ?? 'Reporting Manager'];
            }
        }

        $payload = $row->load('approver:id,name')->toArray();
        $payload['auto_approved']         = $autoApproved;
        $payload['pending_approver_label'] = $pendingApprover;

        return response()->json(['data' => $payload], 201);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Show — single request with the relations the review modal needs
    // ─────────────────────────────────────────────────────────────────────
    public function show(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $this->findScopedOrFail($id, $user);
        $row = AttendanceRegularization::with([
            'employee:id,emp_code,first_name,last_name,display_name,department_id,designation_id,reporting_manager_id,email',
            'employee.department:id,name',
            'employee.designation:id,name',
            'employee.reportingManager:id,first_name,last_name,display_name,email',
            'approver:id,name',
            'creator:id,name',
        ])->findOrFail($id);

        return response()->json(['data' => $row]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Approvals queue — pending requests the signed-in user can act on
    // ─────────────────────────────────────────────────────────────────────
    public function approvals(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $status = $request->input('status', 'Pending');
        $q = AttendanceRegularization::query()
            ->with([
                'employee:id,emp_code,first_name,last_name,display_name,department_id,reporting_manager_id,reporting_manager_user_id,branch_id,client_id',
                'employee.department:id,name',
                'employee.reportingManager:id,first_name,middle_name,last_name,display_name',
                'employee.reportingManagerUser:id,name',
            ])
            ->orderByDesc('created_at');

        if ($status && $status !== 'All') {
            $q->where('status', $status);
        }

        $isAdminScope = in_array($user->user_type, self::ADMIN_TYPES, true);
        $myEmployeeId = null;
        if (!$isAdminScope) {
            $myEmployeeId = Employee::where('user_id', $user->id)->value('id');
            if (!$myEmployeeId) {
                return response()->json(['data' => []]);
            }
            // My own requests, plus requests by anyone who reports to me.
            $q->where(function ($w) use ($myEmployeeId) {
                $w->where('employee_id', $myEmployeeId)
                  ->orWhereIn('employee_id', function ($sub) use ($myEmployeeId) {
                      $sub->select('id')->from('employees')->where('reporting_manager_id', $myEmployeeId);
                  });
            });
            if ($user->client_id) $q->where('client_id', $user->client_id);
        } elseif ($user->user_type !== 'super_admin' && $user->client_id) {
            $q->where('client_id', $user->client_id);
        }

        if ($branchId = $request->integer('branch_id')) {
            $q->where('branch_id', $branchId);
        }
        if ($search = trim((string) $request->input('search', ''))) {
            $like = '%' . $search . '%';
            $q->whereIn('employee_id', function ($sub) use ($like) {
                $sub->select('id')->from('employees')
                    ->where(function ($w) use ($like) {
                        $w->where('first_name', 'ilike', $like)
                          ->orWhere('last_name', 'ilike', $like)
                          ->orWhere('display_name', 'ilike', $like)
                          ->orWhere('emp_code', 'ilike', $like);
                    });
            });
        }

        $rows = $q->get();

        // Per-row "can the viewer act on this RIGHT NOW?" flag — Pending AND
        // (admin scope OR the requester's reporting manager). This is what the
        // UI uses to show Approve/Reject vs. a View-only row.
        $rows->each(function (AttendanceRegularization $row) use ($user, $isAdminScope) {
            $row->can_act_now = $row->status === 'Pending'
                && ($isAdminScope || $this->isReportingManager($user, $row));
        });

        $this->attachOriginalPunches($rows);

        return response()->json(['data' => $rows]);
    }

    /**
     * Give every row the "before" side of its correction.
     *
     * An APPROVED row already carries the frozen snapshot taken the moment its
     * punches were replaced. A PENDING one has none yet — and that is exactly
     * when the approver needs it, because the list otherwise shows only the
     * times being asked for, with nothing to compare them against. So for
     * pending rows we read the day's punches live.
     *
     * One query for the whole page rather than one per row.
     */
    private function attachOriginalPunches($rows): void
    {
        $pending = $rows->filter(fn ($r) => empty($r->original_punches));
        if ($pending->isEmpty()) {
            $rows->each(fn ($r) => $r->original_display = $r->original_summary);
            return;
        }

        // (employee_id, date) pairs still needing a live read.
        $empIds = $pending->pluck('employee_id')->unique()->values()->all();
        $dates  = $pending->map(fn ($r) => Carbon::parse((string) $r->regularization_date)->toDateString())
            ->unique()->values()->all();

        $punchesByKey = [];
        AttendancePunch::query()
            ->join('attendances', 'attendances.id', '=', 'attendance_punches.attendance_id')
            ->whereIn('attendances.employee_id', $empIds ?: [0])
            ->whereIn('attendances.attendance_date', $dates ?: ['1970-01-01'])
            ->whereNull('attendance_punches.deleted_at')
            ->orderBy('attendance_punches.punched_at')
            ->get([
                'attendances.employee_id',
                'attendances.attendance_date',
                'attendance_punches.punched_at',
                'attendance_punches.direction',
                'attendance_punches.label',
                'attendance_punches.method',
            ])
            ->each(function ($p) use (&$punchesByKey) {
                $key = $p->employee_id . '|' . Carbon::parse($p->attendance_date)->toDateString();
                $punchesByKey[$key][] = [
                    'time'      => Carbon::parse($p->punched_at, 'UTC')
                                        ->setTimezone(self::DISPLAY_TZ)->format('H:i'),
                    'direction' => $p->direction,
                    'label'     => $p->label,
                    'method'    => $p->method,
                ];
            });

        $rows->each(function (AttendanceRegularization $row) use ($punchesByKey) {
            if (!empty($row->original_punches)) {
                $row->original_display = $row->original_summary;
                return;
            }
            $key  = $row->employee_id . '|' . Carbon::parse((string) $row->regularization_date)->toDateString();
            $live = $punchesByKey[$key] ?? [];
            $row->original_punches_live = $live;

            $firstIn = collect($live)->firstWhere('direction', 'in')['time'] ?? null;
            $lastOut = collect($live)->where('direction', 'out')->last()['time'] ?? null;
            $row->original_display = $live
                ? (($firstIn ?? '—') . ' – ' . ($lastOut ?? '—'))
                : 'No punches (absent)';
        });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Approve / Reject / Cancel
    // ─────────────────────────────────────────────────────────────────────
    public function approve(Request $request, int $id)
    {
        return $this->setStatus($request, $id, 'Approved');
    }

    public function reject(Request $request, int $id)
    {
        return $this->setStatus($request, $id, 'Rejected');
    }

    public function cancel(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = $this->findScopedOrFail($id, $user);

        // Only the requester (or HR/admin) can cancel a pending request.
        $isOwner = Employee::where('id', $row->employee_id)->where('user_id', $user->id)->exists();
        if (!$isOwner && !in_array($user->user_type, self::ADMIN_TYPES, true)) {
            abort(403, 'You can only cancel your own regularization requests.');
        }
        if ($row->status !== 'Pending') {
            abort(422, 'Only Pending requests can be cancelled.');
        }
        $row->status = 'Cancelled';
        $row->save();

        return response()->json(['data' => $row]);
    }

    private function setStatus(Request $request, int $id, string $next)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = $this->findScopedOrFail($id, $user);
        if ($row->status !== 'Pending') {
            abort(422, "Regularization request is already {$row->status}.");
        }
        $data = $request->validate([
            'comment' => ['nullable', 'string', 'max:2000'],
        ]);

        // Authorization — the requester's reporting manager, or HR/admin scope.
        $isAdminScope = in_array($user->user_type, self::ADMIN_TYPES, true);
        if (!$isAdminScope && !$this->isReportingManager($user, $row)) {
            abort(403, 'You cannot act on this regularization request — only the reporting manager or HR can.');
        }

        // No one may APPROVE their own request — not even via the admin scope.
        $ownEmployeeId = (int) (Employee::where('user_id', $user->id)->value('id') ?? 0);
        if ($next === 'Approved' && $ownEmployeeId && (int) $row->employee_id === $ownEmployeeId) {
            abort(403, 'You cannot approve your own regularization request.');
        }

        /* Payroll gate, re-checked at DECISION time.
         *
         * The store() gate is not enough: a request filed on the 30th while the
         * cycle was open can sit in the approver's queue until after payroll has
         * been paid. Approving it then would rewrite the punches behind a paid
         * payslip. Approval is blocked; REJECTING remains allowed so the stale
         * request can still be cleared out of the queue. */
        if ($next === 'Approved') {
            $emp = Employee::find($row->employee_id);
            $dStr = $row->regularization_date instanceof \Carbon\CarbonInterface
                ? $row->regularization_date->toDateString()
                : Carbon::parse((string) $row->regularization_date)->toDateString();
            if ($emp && $this->payrollLocked($emp, $dStr)) {
                abort(422, 'Payroll for ' . Carbon::parse($dStr)->format('F Y')
                    . ' has been processed and locked since this request was raised — it can no longer be approved.'
                    . ' Reject it and post an adjustment in the next payroll cycle.');
            }
        }

        // Record the decision on the current chain entry.
        $chain = $row->approval_chain ?? [];
        $level = max(1, (int) ($row->current_approval_level ?? 1));
        if (isset($chain[$level - 1])) {
            $chain[$level - 1]['status']   = $next;
            $chain[$level - 1]['acted_by'] = $user->id;
            $chain[$level - 1]['acted_at'] = now()->toISOString();
            $chain[$level - 1]['comment']  = $data['comment'] ?? null;
        }

        if ($next === 'Rejected') {
            for ($i = $level; $i < count($chain); $i++) {
                $st = $chain[$i]['status'] ?? 'Pending';
                if (!in_array($st, ['Approved', 'Rejected'], true)) {
                    $chain[$i]['status'] = 'Skipped';
                }
            }
            $row->approval_chain   = $chain;
            $row->status           = 'Rejected';
            $row->approved_by      = $user->id;
            $row->approved_at      = now();
            $row->approver_comment = $data['comment'] ?? null;
        } else {
            $row->approval_chain = $chain;
            $nextLevel = $this->firstActionableLevel($chain, $level + 1);
            if ($nextLevel > count($chain)) {
                $row->status           = 'Approved';
                $row->approved_by      = $user->id;
                $row->approved_at      = now();
                $row->approver_comment = $data['comment'] ?? null;
            } else {
                $row->current_approval_level = $nextLevel;
            }
        }
        $row->save();

        // On final approval, write the corrected punches into the attendance
        // ledger (adjust mode only; exempt requests change no punches).
        if ($row->status === 'Approved') {
            $this->applyApprovedAdjustment($row);
        }

        return response()->json(['data' => $row->fresh('approver:id,name')]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Apply an approved adjustment to the attendance ledger
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Write an approved "adjust" regularization into attendance_punches.
     *
     * The regularization modal prefills the day's existing punches, so the
     * approved `punches` array is the FULL intended timeline for the day — we
     * therefore REPLACE the day's punches with this corrected set (creating the
     * daily Attendance row first if the day was absent). Times are entered as
     * IST wall-clock (HH:MM) and stored UTC, matching how face punches are
     * saved (the app runs in UTC and converts to IST on read).
     *
     * "exempt" requests change no punches — they only flag the day as approved
     * for penalty exemption, which is recorded by the request's own status.
     *
     * Best-effort: a failure here is logged but never rolls back the approval
     * decision itself (the request is already Approved and visible).
     */
    /**
     * Is the payroll cycle covering this employee's date already LOCKED (fully
     * disbursed)? A locked cycle's payslips are immutable — Rule 14/15 sends the
     * money side to the next cycle as an adjustment — so rewriting the punches
     * behind it would leave attendance and a paid payslip permanently
     * disagreeing, with no way to reconcile them. Regularization is therefore
     * closed for that month at both ends: filing and approving.
     *
     * A client-wide cycle (branch_id NULL) pays this employee too, so a locked
     * one counts exactly as their own branch's would. An employee with NO
     * branch is only ever covered by that client-wide cycle — matching every
     * branch's period for them would block corrections because some OTHER
     * branch had closed its payroll.
     */
    private function payrollLocked(Employee $employee, string $dateStr): bool
    {
        $when = Carbon::parse($dateStr);
        $bId  = $employee->branch_id;

        return \App\Models\PayrollPeriod::query()
            ->where('client_id', $employee->client_id)
            ->where(fn ($w) => $bId
                ? $w->where('branch_id', $bId)->orWhereNull('branch_id')
                : $w->whereNull('branch_id'))
            ->where('month', (int) $when->month)
            ->where('year', (int) $when->year)
            ->where('status', 'locked')
            ->exists();
    }

    /**
     * Write an approved "exempt" regularization into the attendance ledger.
     *
     * An exemption (On Duty, client visit, work from home) has no punches by
     * definition — the employee genuinely wasn't at the device. Until now the
     * approval was recorded on the request and nowhere else, and NOTHING reads
     * the request: payroll aggregates the `attendances` rows. So an approved OD
     * day still counted as Absent, cost a day of LOP, and an approved late-
     * coming exemption still carried its late mark. The approval was decoration.
     *
     * The engine already credits the 'On Duty' and 'Work From Home' attendance
     * statuses as a full present day, and neither is eligible for the late-mark
     * promotion — so the fix is to stamp the day with the status the exemption
     * type means, not to invent a parallel mechanism in payroll.
     *
     * Punches are deliberately left alone: if the employee did punch and is
     * merely being excused for arriving late, that timeline stays true.
     */
    private function applyApprovedExemption(AttendanceRegularization $row, Employee $employee, string $dateStr): void
    {
        // Which credited status does this exemption mean? WFH is its own status;
        // everything else (On Duty, client visit, official work) is On Duty.
        $type   = strtolower(trim((string) ($row->type ?? '')));
        $status = (str_contains($type, 'work from home') || str_contains($type, 'wfh'))
            ? 'Work From Home'
            : 'On Duty';

        $attendance = Attendance::where('employee_id', $employee->id)
            ->whereDate('attendance_date', $dateStr)
            ->lockForUpdate()
            ->first();

        if (!$attendance) {
            $attendance = Attendance::create([
                'client_id'       => $employee->client_id,
                'branch_id'       => $employee->branch_id,
                'user_id'         => $employee->user_id,
                'employee_id'     => $employee->id,
                'attendance_date' => $dateStr,
                'status'          => $status,
            ]);
        } else {
            // Record what the day looked like before the exemption, once, so the
            // approver's decision stays auditable (mirrors the punch snapshot on
            // the adjust path).
            if (empty($row->original_summary)) {
                $row->forceFill(['original_summary' => 'Status was: ' . ($attendance->status ?: '—')])->save();
            }
            $attendance->update(['status' => $status]);
        }

        if ((int) $row->attendance_id !== (int) $attendance->id) {
            $row->forceFill(['attendance_id' => $attendance->id])->save();
        }
    }

    private function applyApprovedAdjustment(AttendanceRegularization $row): void
    {
        $isExempt = $row->mode === 'exempt';
        $punches  = is_array($row->punches) ? $row->punches : [];
        if (!$isExempt && ($row->mode !== 'adjust' || empty($punches))) return;

        $employee = Employee::find($row->employee_id);
        if (!$employee) return;

        $dateStr = $row->regularization_date instanceof \Carbon\CarbonInterface
            ? $row->regularization_date->toDateString()
            : Carbon::parse((string) $row->regularization_date)->toDateString();

        // Last line of defence. The filing and approval gates both ran earlier;
        // payroll could still have been disbursed in the gap between the
        // approval check and this write (and the auto-approve path reaches here
        // straight from store()). Writing is the irreversible part, so it
        // re-checks rather than trusting the earlier answer.
        if ($this->payrollLocked($employee, $dateStr)) {
            Log::warning('[regularization] apply skipped — payroll locked for the period', [
                'request_id' => $row->id, 'employee_id' => $employee->id, 'date' => $dateStr,
            ]);
            return;
        }

        // An exemption stamps the day's status and touches no punches, so it
        // takes its own short path and then shares the payslip refresh below.
        if ($isExempt) {
            try {
                DB::transaction(fn () => $this->applyApprovedExemption($row, $employee, $dateStr));
            } catch (\Throwable $e) {
                Log::warning('[regularization] apply-exemption failed', [
                    'request_id' => $row->id,
                    'error'      => $e->getMessage(),
                ]);
                return;
            }
            $this->refreshPayslipsAfterApply($row, (int) $employee->id);
            return;
        }

        try {
            DB::transaction(function () use ($row, $employee, $dateStr, $punches) {
                // Find or create the day's attendance row (absent days have none).
                $attendance = Attendance::where('employee_id', $employee->id)
                    ->whereDate('attendance_date', $dateStr)
                    ->lockForUpdate()
                    ->first();
                if (!$attendance) {
                    $attendance = Attendance::create([
                        'client_id'       => $employee->client_id,
                        'branch_id'       => $employee->branch_id,
                        'user_id'         => $employee->user_id,
                        'employee_id'     => $employee->id,
                        'attendance_date' => $dateStr,
                        'status'          => 'Present',
                    ]);
                }

                /* Snapshot the day BEFORE it is overwritten.
                 *
                 * The delete below is what makes the original biometric log
                 * disappear from the timeline ("pichla time log nikal jata
                 * hai"). The rows survive as soft-deletes, but nothing reads
                 * them back, so the corrected day looks like it was always
                 * punched that way. Capturing the originals on the REQUEST
                 * keeps the correction auditable — and lets the approver see
                 * what they are actually changing.
                 *
                 * Only captured once: re-approving (or a retry) must not
                 * overwrite the true original with an already-corrected set. */
                if (empty($row->original_punches)) {
                    $existing = AttendancePunch::where('attendance_id', $attendance->id)
                        ->orderBy('punched_at')->get();
                    $snapshot = $existing->map(fn ($p) => [
                        'time'      => Carbon::parse($p->punched_at, 'UTC')
                                            ->setTimezone(self::DISPLAY_TZ)->format('H:i'),
                        'direction' => $p->direction,
                        'label'     => $p->label,
                        'method'    => $p->method,
                    ])->values()->all();

                    $firstInT = collect($snapshot)->firstWhere('direction', 'in')['time'] ?? null;
                    $lastOutT = collect($snapshot)->where('direction', 'out')->last()['time'] ?? null;

                    $row->forceFill([
                        'original_punches' => $snapshot,
                        'original_summary' => $snapshot
                            ? trim(($firstInT ?? '—') . ' – ' . ($lastOutT ?? '—'))
                            : 'No punches (absent)',
                    ])->save();
                }

                // Replace the day's punches with the approved corrected set.
                AttendancePunch::where('attendance_id', $attendance->id)->delete();

                // Flatten {in,out} pairs into discrete, time-ordered events.
                $events = [];
                foreach ($punches as $p) {
                    foreach (['in', 'out'] as $dir) {
                        $t = trim((string) ($p[$dir] ?? ''));
                        if ($t === '' || !preg_match('/^\d{1,2}:\d{2}$/', $t)) continue;
                        $events[] = [
                            'ts'  => Carbon::parse("$dateStr $t", self::DISPLAY_TZ)->setTimezone('UTC'),
                            'dir' => $dir,
                        ];
                    }
                }
                usort($events, fn ($a, $b) => $a['ts']->getTimestamp() <=> $b['ts']->getTimestamp());

                // Index of the chronologically last "out" → labelled Check Out.
                $lastOutIdx = -1;
                foreach ($events as $i => $e) {
                    if ($e['dir'] === 'out') $lastOutIdx = $i;
                }

                $seq = 0;
                $lastDir = null;
                foreach ($events as $i => $e) {
                    // Enforce strict in→out alternation — skip a punch that
                    // repeats the previous direction (defensive; the modal pairs
                    // in/out so this is rare).
                    if ($lastDir !== null && $e['dir'] === $lastDir) continue;

                    $label = $e['dir'] === 'in'
                        ? ($seq === 0 ? 'Check In' : 'Step In')
                        : ($i === $lastOutIdx ? 'Check Out' : 'Step Out');

                    AttendancePunch::create([
                        'attendance_id' => $attendance->id,
                        'employee_id'   => $employee->id,
                        'punched_at'    => $e['ts'],
                        'direction'     => $e['dir'],
                        'label'         => $label,
                        'method'        => 'manual',
                        'notes'         => "Regularized (request #{$row->id})",
                    ]);
                    $lastDir = $e['dir'];
                    $seq++;
                }

                // Recompute the parent daily summary so list views / dashboards
                // reflect the correction without re-joining punches.
                $firstIn = AttendancePunch::where('attendance_id', $attendance->id)
                    ->where('direction', 'in')->orderBy('punched_at')->first();
                $lastOut = AttendancePunch::where('attendance_id', $attendance->id)
                    ->where('direction', 'out')->orderByDesc('punched_at')->first();
                $attendance->update([
                    'check_in_at'      => $firstIn?->punched_at,
                    'check_in_method'  => $firstIn?->method,
                    'check_out_at'     => $lastOut?->punched_at,
                    'check_out_method' => $lastOut?->method,
                    'status'           => 'Present',
                ]);

                // Link the request to the (possibly newly created) day row.
                if ((int) $row->attendance_id !== (int) $attendance->id) {
                    $row->forceFill(['attendance_id' => $attendance->id])->save();
                }
            });
        } catch (\Throwable $e) {
            Log::warning('[regularization] apply-to-attendance failed', [
                'request_id' => $row->id,
                'error'      => $e->getMessage(),
            ]);
            return; // nothing was written — don't recompute payroll off a failed apply
        }

        $this->refreshPayslipsAfterApply($row, (int) $employee->id);
    }

    /**
     * The correction must reach the money, not just the timeline.
     *
     * Payslips in DRAFT / GENERATED runs are recomputed IN PLACE (same row,
     * recomputed columns), so a regularization approved after payroll was
     * generated but before it was approved/paid shows the corrected salary
     * without anyone re-running it, and without a second payslip appearing.
     * Approved/paid runs and locked periods are skipped by the service. (PAY-50)
     */
    private function refreshPayslipsAfterApply(AttendanceRegularization $row, int $employeeId): void
    {
        try {
            app(\App\Services\PayrollService::class)->recomputeEmployeePayslips($employeeId);
        } catch (\Throwable $e) {
            // Distinct message: the attendance correction DID land; only the
            // payslip refresh failed, and re-running payroll still fixes it.
            Log::warning('[regularization] payslip recompute after apply failed', [
                'request_id' => $row->id,
                'error'      => $e->getMessage(),
            ]);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Approvers — surfaces the resolved approval chain for a request
    // ─────────────────────────────────────────────────────────────────────
    public function approvers(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $row = $this->findScopedOrFail($id, $user);
        $chain = $row->approval_chain ?? [];

        $employeeIds = collect($chain)->pluck('approver_employee_id')->filter()->unique()->all();
        $employees = Employee::with('user:id,name,email')
            ->whereIn('id', $employeeIds)
            ->get()->keyBy('id');
        $userIds = collect($chain)->pluck('approver_user_id')->filter()->unique()->all();
        $users = \App\Models\User::whereIn('id', $userIds)->get(['id', 'name', 'email'])->keyBy('id');

        $out = [];
        foreach ($chain as $i => $entry) {
            $empId = $entry['approver_employee_id'] ?? null;
            $emp = $empId ? ($employees[$empId] ?? null) : null;
            $uId = $entry['approver_user_id'] ?? null;
            $u = $uId ? ($users[$uId] ?? null) : null;
            $name = $emp
                ? trim($emp->display_name ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? '')))
                : ($u ? trim((string) $u->name) : ($entry['approver_label'] ?? 'Unassigned'));
            $out[] = [
                'level'       => $entry['level'] ?? ($i + 1),
                'role'        => $entry['approver_role'] ?? 'Reporting Manager',
                'kind'        => $entry['approver_kind'] ?? 'reporting_manager',
                'employee_id' => $empId,
                'name'        => $name,
                'email'       => $emp?->email ?? $u?->email,
                'status'      => $entry['status'] ?? 'Pending',
                'acted_at'    => $entry['acted_at'] ?? null,
                'comment'     => $entry['comment'] ?? null,
                'is_current'  => ($i + 1) === (int) ($row->current_approval_level ?? 1)
                                 && $row->status === 'Pending',
            ];
        }

        return response()->json(['data' => $out]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Build the RM-only approval chain frozen onto a new request. Resolves the
     * requester's reporting manager (Employee row, or a login User for a
     * Client/Branch admin RM). A self-loop (RM === requester) or a missing
     * manager marks the level Skipped, so the request auto-approves rather than
     * stalling forever or letting the requester self-approve.
     */
    private function snapshotApprovalChain(Employee $employee): array
    {
        $resolvedEmpId  = $employee->reporting_manager_id;
        $resolvedUserId = null;
        if (!$resolvedEmpId) {
            $resolvedUserId = $employee->reporting_manager_user_id;
        }

        $skip = false;
        $skipReason = null;
        if ($resolvedEmpId && (int) $resolvedEmpId === (int) $employee->id) {
            $skip = true;
            $skipReason = 'Auto-skipped — approver resolves to the requester (self-loop)';
        } elseif ($resolvedUserId && (int) $resolvedUserId === (int) ($employee->user_id ?? 0)) {
            $skip = true;
            $skipReason = 'Auto-skipped — approver resolves to the requester (self-loop)';
        } elseif (!$resolvedEmpId && !$resolvedUserId) {
            $skip = true;
            $skipReason = 'Auto-skipped — no reporting manager assigned';
        } elseif ($resolvedEmpId && !Employee::where('id', $resolvedEmpId)->exists()) {
            $skip = true;
            $skipReason = "Auto-skipped — approver employee #{$resolvedEmpId} no longer exists";
        }

        return [[
            'level'                => 1,
            'approver_kind'        => 'reporting_manager',
            'approver_role'        => 'Reporting Manager',
            'approver_user_id'     => $resolvedUserId,
            'approver_employee_id' => $resolvedEmpId,
            'approver_label'       => null,
            'status'               => $skip ? 'Skipped' : 'Pending',
            'acted_by'             => null,
            'acted_at'             => null,
            'comment'              => $skipReason,
        ]];
    }

    /** Walk forward from `start` (1-based) past Skipped levels to the first
     *  Pending one; returns count+1 when the chain is fully resolved. */
    private function firstActionableLevel(array $chain, int $start): int
    {
        $i = max(1, $start);
        while ($i <= count($chain)) {
            if (($chain[$i - 1]['status'] ?? 'Pending') === 'Pending') return $i;
            $i++;
        }
        return count($chain) + 1;
    }

    /** Is the signed-in user the reporting manager of the request's employee?
     *  Matches both an Employee-row RM and a login-User RM (admin manager). */
    private function isReportingManager($user, AttendanceRegularization $row): bool
    {
        $emp = Employee::find($row->employee_id);
        if (!$emp) return false;
        if ($emp->reporting_manager_user_id && (int) $emp->reporting_manager_user_id === (int) $user->id) {
            return true;
        }
        if ($emp->reporting_manager_id) {
            $myEmpId = Employee::where('user_id', $user->id)->value('id');
            if ($myEmpId && (int) $emp->reporting_manager_id === (int) $myEmpId) return true;
        }
        return false;
    }

    /** Tenant scope guard for every single-row endpoint. */
    private function findScopedOrFail(int $id, $user): AttendanceRegularization
    {
        $row = AttendanceRegularization::findOrFail($id);
        if ($user->user_type !== 'super_admin'
            && $user->client_id
            && (int) $row->client_id !== (int) $user->client_id) {
            abort(404);
        }
        return $row;
    }
}
