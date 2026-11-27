<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\LeaveRequest;
use App\Models\Masters\LeaveTypes;
use App\Models\User;
use App\Notifications\LeaveRequestNotification;
use App\Support\NoticePeriodGuard;
use App\Support\OnboardingGuard;
use App\Support\ProbationGuard;
use Carbon\CarbonPeriod;
use Illuminate\Http\Request;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Illuminate\Validation\Rule;

class LeaveRequestController extends Controller
{
    private const DISPLAY_TZ = 'Asia/Kolkata';

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $employeeId = $request->integer('employee_id') ?: null;
        if (!$employeeId) {
            $own = Employee::find($user->employee_id);
            if (!$own) {
                return response()->json(['data' => []]);
            }
            $employeeId = $own->id;
        }

        if ($user->user_type !== 'super_admin' && $user->client_id) {
            $targetClientId = Employee::where('id', $employeeId)->value('client_id');
            if ((int) $targetClientId !== (int) $user->client_id) {
                abort(404);
            }
        }

        $status = $request->input('status');
        $q = LeaveRequest::query()
            ->where('employee_id', $employeeId)
            ->with([
                'leaveType:id,name,short_code,type,paid_unpaid',
                'leavePlan:id,plan_name',
                'coverPerson:id,first_name,last_name,display_name',
                'approver:id,name',
            ])
            ->orderByDesc('from_date');
        if ($status) $q->where('status', $status);

        return response()->json(['data' => $q->get()]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'employee_id' => ['nullable', 'integer', 'exists:employees,id'],
            'leave_type_id' => ['required', 'integer', Rule::exists('master_leave_types', 'id')->where(function ($q) use ($user) {
                if ($user->user_type === 'super_admin') return;
                $q->whereNull('client_id')->orWhere('client_id', $user->client_id);
            })],
            'from_date' => ['required', 'date'],
            'to_date' => ['required', 'date', 'after_or_equal:from_date', 'before_or_equal:' . now()->addYear()->toDateString()],
            'day_type' => ['nullable', Rule::in(['full', 'first_half', 'second_half'])],
            'reason' => ['nullable', 'string', 'max:2000'],
            'attachment_path' => ['nullable', 'string', 'max:1024'],
            'notify' => ['nullable', 'array'],
            'notify.employee_ids' => ['nullable', 'array'],
            'notify.employee_ids.*' => ['integer', 'exists:employees,id'],
            'handover_required' => ['nullable', 'boolean'],
            'cover_person_id' => ['nullable', 'integer', 'exists:employees,id'],
            'handover_notes' => ['nullable', 'string', 'max:5000'],
            'critical_tasks' => ['nullable', 'string', 'max:5000'],
            'avail_on_call' => ['nullable', 'boolean'],
            'emergency_number' => ['nullable', 'string', 'max:50'],
            'avail_note' => ['nullable', 'string', 'max:2000'],
        ]);

        $employee = null;
        if (!empty($data['employee_id'])) {
            $employee = Employee::find($data['employee_id']);
        }
        if (!$employee) {
            $employee = Employee::find($user->employee_id);
        }
        if (!$employee) {
            abort(422, 'Could not resolve target employee for this leave request.');
        }

        if ($user->user_type !== 'super_admin'
            && $user->client_id
            && (int) $employee->client_id !== (int) $user->client_id) {
            abort(403, 'You cannot file leave for an employee outside your tenant.');
        }

        $isAdmin = in_array($user->user_type, ['super_admin', 'client_admin'], true);
        $isSelf  = (int) ($employee->user_id ?? 0) === (int) $user->id;
        if (!$isAdmin && !$isSelf) {
            abort(403, 'You can only raise a leave request for yourself.');
        }

        OnboardingGuard::assertComplete($employee, 'raise a leave request', $isSelf);

        ProbationGuard::assertCanRaiseLeave($employee, $isSelf);

        NoticePeriodGuard::assertLeaveAllowed(
            $employee,
            LeaveTypes::find($data['leave_type_id']),
            $isSelf,
        );

        $todayStr = now(self::DISPLAY_TZ)->toDateString();
        $fromStr  = Carbon::parse($data['from_date'])->toDateString();

        if ($fromStr < $todayStr) {
            abort(422, 'You cannot apply for leave in the past. Pick a date from tomorrow onward.');
        }

        if ($employee->date_of_joining) {
            $dojStr = Carbon::parse($employee->date_of_joining)->toDateString();
            if ($fromStr < $dojStr) {
                abort(422, "You cannot apply for leave before your joining date ({$dojStr}).");
            }
        }

        $from = Carbon::parse($data['from_date']);
        $to = Carbon::parse($data['to_date']);
        $dayType = $data['day_type'] ?? 'full';

        if (!$isAdmin && $fromStr === $todayStr
            && !($dayType === 'second_half' && $from->isSameDay($to))) {
            abort(422, 'Leave for today can only be applied for the second half of the day.');
        }
        if ($dayType !== 'full' && !$from->isSameDay($to)) {
            abort(422, 'Half-day requests are only valid for a single calendar day. Please pick the same from/to date or switch day type to "Full Day".');
        }

        $overlapQuery = LeaveRequest::where('employee_id', $employee->id)
            ->whereIn('status', ['Pending', 'Approved'])
            ->where('from_date', '<=', $to->toDateString())
            ->where('to_date',   '>=', $from->toDateString());

        if ($dayType !== 'full' && $from->isSameDay($to)) {
            $opposite = $dayType === 'first_half' ? 'second_half' : 'first_half';
            $day = $from->toDateString();
            $overlapQuery->where(function ($w) use ($opposite, $day) {
                $w->where('day_type', '!=', $opposite)
                  ->orWhere('from_date', '!=', $day)
                  ->orWhere('to_date', '!=', $day);
            });
        }
        $overlap = $overlapQuery->first();
        if ($overlap) {
            abort(422, "You already have a {$overlap->status} leave request for {$overlap->from_date} → {$overlap->to_date}. Cancel it before applying for overlapping dates.");
        }

        if (!empty($data['cover_person_id'])) {
            $coverClientId = Employee::where('id', $data['cover_person_id'])->value('client_id');
            if ($coverClientId !== null && (int) $coverClientId !== (int) $employee->client_id) {
                abort(422, 'Cover person must be in the same tenant.');
            }
        }
        $notifyIds = is_array($data['notify']['employee_ids'] ?? null)
            ? array_values(array_filter(array_map('intval', $data['notify']['employee_ids']), fn($v) => $v > 0))
            : [];
        if (!empty($notifyIds)) {
            $crossTenant = Employee::whereIn('id', $notifyIds)
                ->where('client_id', '!=', $employee->client_id)
                ->exists();
            if ($crossTenant) {
                abort(422, 'Notify list contains employees outside your tenant.');
            }
        }

        $planId = DB::table('leave_plan_employees')
            ->where('employee_id', $employee->id)
            ->value('leave_plan_id');
        if (!$planId && is_numeric($employee->leave_plan)) {
            $planId = (int) $employee->leave_plan;
        }

        if (!$planId) {
            abort(422, 'You are not assigned to a leave plan yet. Please contact HR.');
        }
        $ptConfigRaw = DB::table('leave_plan_leave_types')
            ->where('leave_plan_id', $planId)
            ->where('leave_type_id', $data['leave_type_id'])
            ->value('config_json');
        if ($ptConfigRaw === null) {
            abort(422, 'The selected leave type is not part of your assigned leave plan.');
        }

        $ptConfig  = json_decode((string) $ptConfigRaw, true);
        $accrual   = (is_array($ptConfig) ? $ptConfig['accrual'] ?? [] : []);
        $unlimited = \App\Support\LeaveCarry::isUnlimitedYear((array) $accrual, \App\Support\LeaveYear::of($from));

        $leaveApp = (is_array($ptConfig) ? $ptConfig['leaveApp'] ?? [] : []);
        $days = $this->computeLeaveDays($from, $to, $dayType, $employee, null, false, true);

        if ($dayType !== 'full' && !(bool) ($ptConfig['leaveApp']['allowHalfDay'] ?? false)) {
            abort(422, 'This leave type does not allow half-day leave.');
        }
        if (!$unlimited) {
            $quotaDays = \App\Support\LeaveCarry::quotaForYear((array) $accrual, \App\Support\LeaveYear::of($from));
            $overdraft = !empty($accrual['employeeOverdraft']['enabled'])
                ? (float) ($accrual['employeeOverdraft']['days'] ?? 0)
                : 0.0;
            // Scope to THIS leave's calendar year — the quota is per year, so a
            // leave in one year must not be charged against another year's balance.
            $usedDays = (float) LeaveRequest::query()
                ->where('employee_id', $employee->id)
                ->where('leave_type_id', $data['leave_type_id'])
                ->whereIn('status', ['Approved', 'Pending'])
                ->whereYear('from_date', \App\Support\LeaveYear::of($from))
                ->sum('days');
            // Opening carry-forward from prior years (0 when the rule is reset).
            $carryIn = \App\Support\LeaveCarry::openingFor(
                (int) $employee->id, (int) $data['leave_type_id'], \App\Support\LeaveYear::of($from),
                (string) ($ptConfig['yearEnd']['carryForward'] ?? 'reset'),
                (float) ($ptConfig['yearEnd']['carryForwardCap'] ?? 0),
                (array) $accrual,
            );
            $available = max(0.0, ($quotaDays + $overdraft + $carryIn) - $usedDays);
            if ($days > $available) {
                $fmt = fn (float $n) => rtrim(rtrim(number_format($n, 2), '0'), '.');
                abort(422, "Not enough leave balance — only {$fmt($available)} day(s) available for this leave type, but you requested {$fmt($days)}.");
            }
        }

        $maxPerMonth = is_array($leaveApp['maxPerMonth'] ?? null) ? $leaveApp['maxPerMonth'] : [];
        $monthlyCap = (float) ($maxPerMonth['days'] ?? 0);
        if (!empty($maxPerMonth['enabled']) && $monthlyCap > 0) {
            $usedThisMonth = (float) LeaveRequest::query()
                ->where('employee_id', $employee->id)
                ->where('leave_type_id', $data['leave_type_id'])
                ->whereIn('status', ['Approved', 'Pending'])
                ->whereBetween('from_date', [
                    $from->copy()->startOfMonth()->toDateString(),
                    $from->copy()->endOfMonth()->toDateString(),
                ])
                ->sum('days');
            if ($usedThisMonth + $days > $monthlyCap) {
                $fmt = fn (float $n) => rtrim(rtrim(number_format($n, 2), '0'), '.');
                $remaining = max(0.0, $monthlyCap - $usedThisMonth);
                abort(422, "Monthly limit reached — this leave type allows at most {$fmt($monthlyCap)} day(s) per month. You've already used {$fmt($usedThisMonth)} this month, so only {$fmt($remaining)} more can be applied (you requested {$fmt($days)}).");
            }
        }

        $chain = $this->snapshotApprovalChain($employee, $planId, $data['leave_type_id'], $days);
        $startLevel = $this->firstActionableLevel($chain, 1);
        $autoApproved = $startLevel > count($chain) && count($chain) > 0;

        $row = LeaveRequest::create([
            'client_id' => $employee->client_id,
            'branch_id' => $employee->branch_id,
            'employee_id' => $employee->id,
            'leave_type_id' => $data['leave_type_id'],
            'leave_plan_id' => $planId,
            'from_date' => $from->toDateString(),
            'to_date' => $to->toDateString(),
            'days' => $days,
            'day_type' => $dayType,
            'reason' => $data['reason'] ?? null,
            'attachment_path' => $data['attachment_path'] ?? null,
            'notify' => $data['notify'] ?? null,
            'handover_required' => !empty($data['handover_required']),
            'cover_person_id' => $data['cover_person_id'] ?? null,
            'handover_notes' => $data['handover_notes'] ?? null,
            'critical_tasks' => $data['critical_tasks'] ?? null,
            'avail_on_call' => !empty($data['avail_on_call']),
            'emergency_number' => $data['emergency_number'] ?? null,
            'avail_note' => $data['avail_note'] ?? null,
            'status' => $autoApproved ? 'Approved' : 'Pending',
            'approval_chain' => $chain,
            'current_approval_level' => $startLevel,
            'approved_at' => $autoApproved ? now() : null,
            'approver_comment' => $autoApproved ? 'Auto-approved — every chain level was skipped by rule' : null,
            'created_by' => $user->id,
        ]);

        $this->notifyForSubmission($row, $employee);

        if ($autoApproved) {
            $this->notifyForDecision($row, $row->approver_comment);
        }

        return response()->json(['data' => $row->load(['leaveType:id,name,short_code', 'leavePlan:id,plan_name'])], 201);
    }

    public function colleagues(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $search = trim((string) $request->input('search', ''));
        $limit = max(1, min(20, (int) $request->integer('limit', 10)));

        $q = Employee::query()
            ->with(['designation:id,name'])
            ->where('status', 'Active');

        if ($user->user_type !== 'super_admin' && $user->client_id) {
            $q->where('client_id', $user->client_id);
        }

        if ($user->user_type !== 'super_admin') {
            $branchId = $user->branch_id ?: ($request->integer('branch_id') ?: null);
            if ($branchId) {
                $q->where('branch_id', $branchId);
            }
        }

        $selfId = $request->integer('employee_id')
            ?: $user->employee_id;
        if ($selfId) {
            $q->where('id', '!=', $selfId);
        }

        if ($search !== '') {
            $like = '%' . $search . '%';
            $q->where(function ($w) use ($like) {
                $w->where('display_name', 'ilike', $like)
                  ->orWhere('first_name', 'ilike', $like)
                  ->orWhere('last_name', 'ilike', $like)
                  ->orWhere('emp_code', 'ilike', $like)
                  ->orWhere('email', 'ilike', $like);
            });
        }

        $rows = $q->orderBy('first_name')->limit($limit)->get();

        $data = $rows->map(function ($e) {
            $name = trim($e->display_name ?: trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')));
            return [
                'id' => $e->id,
                'name' => $name,
                'emp_code' => $e->emp_code,
                'designation' => $e->designation?->name,
                'photo_url' => null,
            ];
        });

        return response()->json(['data' => $data]);
    }

    public function show(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $this->findScopedOrFail($id, $user);
        $row = LeaveRequest::with([
            'employee:id,emp_code,first_name,last_name,display_name,department_id,designation_id,reporting_manager_id,email',
            'employee.department:id,name',
            'employee.designation:id,name',
            'employee.reportingManager:id,first_name,last_name,display_name,email',
            'leaveType:id,name,short_code,type,paid_unpaid',
            'leavePlan:id,plan_name',
            'coverPerson:id,first_name,last_name,display_name,emp_code',
            'approver:id,name',
            'creator:id,name',
            'sandwichWaiver:id,name',
        ])->findOrFail($id);

        $employee = Employee::find($row->employee_id);
        $applies  = $employee && \App\Support\SandwichPolicy::appliesTo($employee);

        $sandwichDays = 0.0;
        if ($applies) {
            $from = Carbon::parse($row->from_date);
            $to   = Carbon::parse($row->to_date);
            $type = (string) ($row->day_type ?: 'full');
            $sandwichDays = $this->computeLeaveDays($from, $to, $type, $employee, $row->id, false)
                          - $this->computeLeaveDays($from, $to, $type, $employee, $row->id, true);
        }

        return response()->json([
            'data' => $row,
            'meta' => [
                'sandwich_applicable' => $applies,
                'sandwich_days'       => round($sandwichDays, 2),
            ],
        ]);
    }

    public function approvals(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $status = $request->input('status', 'Pending');
        $q = LeaveRequest::query()
            ->with([
                'employee:id,emp_code,first_name,last_name,display_name,department_id,reporting_manager_id,reporting_manager_user_id,branch_id,client_id',
                'employee.department:id,name',
                'employee.photoDocument:id,employee_id,document_key,file_path',
                'employee.reportingManager:id,first_name,middle_name,last_name,display_name',
                'employee.reportingManager.photoDocument:id,employee_id,document_key,file_path',
                'employee.reportingManagerUser:id,name',
                'leaveType:id,name,short_code,type,paid_unpaid',
            ])
            ->orderByDesc('created_at');

        $isAdminScope = $user->user_type === 'branch_user';
        $myEmployeeId = null;
        if (!$isAdminScope) {
            $myEmployeeId = $user->employee_id;
            if (!$myEmployeeId && !in_array($user->user_type, ['client_admin', 'client_user'], true)) {
                return response()->json(['data' => []]);
            }
            $uid  = (int) $user->id;
            $eid  = (int) $myEmployeeId;
            $q->where(function ($w) use ($myEmployeeId, $user, $uid, $eid) {
                if ($myEmployeeId) {
                    $w->where('employee_id', $myEmployeeId)
                      ->orWhereIn('employee_id', function ($sub) use ($myEmployeeId) {
                        $sub->select('id')->from('employees')->where('reporting_manager_id', $myEmployeeId);
                    });
                }
                $w->orWhere('approved_by', $user->id)
                  ->orWhere(function ($w2) use ($uid) {
                      $w2->where('approval_chain', 'ilike', '%"approver_user_id":' . $uid . ',%')
                         ->orWhere('approval_chain', 'ilike', '%"approver_user_id":' . $uid . '}%')
                         ->orWhere('approval_chain', 'ilike', '%"approver_user_id": ' . $uid . ',%')
                         ->orWhere('approval_chain', 'ilike', '%"approver_user_id": ' . $uid . '}%');
                  });
                if ($eid) {
                    $w->orWhere(function ($w2) use ($eid) {
                        $w2->where('approval_chain', 'ilike', '%"approver_employee_id":' . $eid . ',%')
                           ->orWhere('approval_chain', 'ilike', '%"approver_employee_id":' . $eid . '}%')
                           ->orWhere('approval_chain', 'ilike', '%"approver_employee_id": ' . $eid . ',%')
                           ->orWhere('approval_chain', 'ilike', '%"approver_employee_id": ' . $eid . '}%');
                    });
                }
            });
            if ($user->client_id) {
                $q->where('client_id', $user->client_id);
            }
        } elseif ($user->client_id) {
            $q->where('client_id', $user->client_id);
        }

        $branchId = $request->integer('branch_id') ?: null;
        if ($user->user_type === 'branch_user' && $user->branch_id) {
            $branchId = (int) $user->branch_id;
        }
        if ($branchId) {
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

        if ($lt = trim((string) $request->input('leave_type', ''))) {
            $q->whereHas('leaveType', fn ($t) => $t->where('name', $lt));
        }
        if ($dept = trim((string) $request->input('department', ''))) {
            $q->whereHas('employee.department', fn ($d) => $d->where('name', $dept));
        }
        if ($pay = trim((string) $request->input('payroll', ''))) {
            $isUnpaid = fn ($t) => $t->where(fn ($w) => $w
                ->where('paid_unpaid', 'Unpaid')->orWhere('type', 'Unpaid Leave'));
            $isPaid = fn ($t) => $t->where(fn ($w) => $w
                ->where('paid_unpaid', '!=', 'Unpaid')->orWhereNull('paid_unpaid'))
                ->where(fn ($w) => $w->where('type', '!=', 'Unpaid Leave')->orWhereNull('type'));
            $q->whereHas('leaveType', $pay === 'Unpaid' ? $isUnpaid : $isPaid);
        }

        if ($onDate = trim((string) $request->input('on_leave_on', ''))) {
            $q->whereDate('from_date', '<=', $onDate)
              ->whereDate('to_date', '>=', $onDate);
        }

        $counts = null;
        if ($request->boolean('with_counts') && $isAdminScope) {
            $byStatus = (clone $q)->reorder()
                ->select('status', DB::raw('count(*) as n'))
                ->groupBy('status')
                ->pluck('n', 'status');

            $counts = [
                'All'       => (int) $byStatus->sum(),
                'Pending'   => (int) ($byStatus['Pending']   ?? 0),
                'Approved'  => (int) ($byStatus['Approved']  ?? 0),
                'Rejected'  => (int) ($byStatus['Rejected']  ?? 0),
                'Cancelled' => (int) ($byStatus['Cancelled'] ?? 0),
            ];
        }

        $countQuery = ($request->boolean('with_counts') && !$isAdminScope)
            ? (clone $q)->reorder()
            : null;

        if ($status && $status !== 'All') {
            $q->where('status', $status);
        }

        $perPage = $request->filled('per_page')
            ? min(200, max(1, (int) $request->input('per_page')))
            : null;
        $page = max(1, (int) $request->input('page', 1));

        if ($perPage && $isAdminScope) {
            $total = (clone $q)->count();
            $rows  = $q->forPage($page, $perPage)->get();
        } else {
            $rows  = $q->get();
            $total = null;
        }

        $visibleToViewer = function (LeaveRequest $row) use ($user, $myEmployeeId) {
            if ((int) $row->employee_id === (int) $myEmployeeId) return true;
            $chain = is_array($row->approval_chain) ? $row->approval_chain : [];
            if ($row->status === 'Pending') {
                $idx = max(0, ((int) ($row->current_approval_level ?? 1)) - 1);
                return $this->canActOnLevel($user, $chain, $idx, $row);
            }
            foreach (array_keys($chain) as $i) {
                if ($this->canActOnLevel($user, $chain, $i, $row)) return true;
            }
            return (int) $row->approved_by === (int) $user->id;
        };

        if (!$isAdminScope) {
            $rows = $rows->filter($visibleToViewer)->values();
        }

        if ($total === null) {
            if ($request->boolean('with_counts') && $counts === null) {
                $countRows = $countQuery
                    ? $countQuery->get()->filter($visibleToViewer)->values()
                    : $rows;
                $byStatus = $countRows->countBy(fn (LeaveRequest $r) => (string) $r->status);
                $counts = [
                    'All'       => $countRows->count(),
                    'Pending'   => (int) ($byStatus['Pending']   ?? 0),
                    'Approved'  => (int) ($byStatus['Approved']  ?? 0),
                    'Rejected'  => (int) ($byStatus['Rejected']  ?? 0),
                    'Cancelled' => (int) ($byStatus['Cancelled'] ?? 0),
                ];
            }

            $total = $rows->count();
            if ($perPage) {
                $rows = $rows->slice(($page - 1) * $perPage, $perPage)->values();
            }
        }

        $isHrScope = in_array($user->user_type, ['client_admin', 'branch_user'], true);
        $rmAway = $this->rmUnavailableMap($rows);
        $rows->each(function (LeaveRequest $row) use ($user, $isHrScope, $rmAway) {
            $chain = is_array($row->approval_chain) ? $row->approval_chain : [];
            $idx = max(0, ((int) ($row->current_approval_level ?? 1)) - 1);
            $away = (bool) ($rmAway[$row->id] ?? false);

            $row->rm_unavailable = $away;

            $row->can_act_now = $row->status === 'Pending'
                && ($this->canActOnLevel($user, $chain, $idx, $row) || $isHrScope);
        });

        return response()->json(array_filter([
            'data'     => $rows,
            'total'    => $total,
            'page'     => $perPage ? $page : 1,
            'per_page' => $perPage ?? $total,
            'counts'   => $counts,
        ], fn ($v) => $v !== null));
    }

    public function approve(Request $request, int $id)
    {
        return $this->setStatus($request, $id, 'Approved');
    }

    public function reject(Request $request, int $id)
    {
        return $this->setStatus($request, $id, 'Rejected');
    }

    public function hrView(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = $this->findScopedOrFail($id, $user);

        $isHr = in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true);
        if ($isHr && $row->hr_viewed_at === null) {
            $row->hr_viewed_at = now();
            $row->hr_viewed_by = $user->id;
            $row->save();
        }

        return response()->json(['data' => $row]);
    }

    public function sandwichWaiver(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        if (!in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) {
            abort(403, 'Only HR or an administrator can waive the sandwich policy.');
        }

        $data = $request->validate([
            'waived' => 'required|boolean',
            'reason' => 'nullable|string|max:255',
        ]);

        $row = $this->findScopedOrFail($id, $user);
        $employee = Employee::find($row->employee_id);
        if (!$employee) abort(422, 'Leave has no employee on file.');

        if (!\App\Support\SandwichPolicy::appliesTo($employee)) {
            abort(422, "This employee's branch does not run the sandwich leave policy.");
        }

        $waived = (bool) $data['waived'];

        $response = DB::transaction(function () use ($row, $employee, $waived, $data, $user) {
            $before = (float) $row->days;

            $row->days = $this->computeLeaveDays(
                Carbon::parse($row->from_date),
                Carbon::parse($row->to_date),
                (string) ($row->day_type ?: 'full'),
                $employee,
                $row->id,
                $waived,
                true,
            );

            $row->sandwich_waived         = $waived;
            $row->sandwich_waived_by      = $waived ? $user->id : null;
            $row->sandwich_waived_at      = $waived ? now() : null;
            $row->sandwich_waiver_reason  = $waived ? ($data['reason'] ?? null) : null;
            $row->save();

            return response()->json([
                'data'         => $row->fresh(),
                'days_before'  => $before,
                'days_after'   => (float) $row->days,
                'message'      => $waived
                    ? 'Sandwich policy waived — leave re-sized to ' . (float) $row->days . ' day(s).'
                    : 'Sandwich policy re-applied — leave re-sized to ' . (float) $row->days . ' day(s).',
            ]);
        });

        $this->propagateToPayroll($row->employee_id);

        return $response;
    }

    public function cancel(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = $this->findScopedOrFail($id, $user);
        $isOwner = Employee::where('id', $row->employee_id)->where('user_id', $user->id)->exists();
        if (!$isOwner && !in_array($user->user_type, ['super_admin', 'client_admin', 'branch_user'], true)) {
            abort(403, 'You can only cancel your own leave requests.');
        }
        if ($row->status !== 'Pending') {
            abort(422, 'Only Pending requests can be cancelled.');
        }
        $row->status = 'Cancelled';
        $row->save();

        NoticePeriodGuard::revertExtension($row, Employee::find($row->employee_id));

        $this->notifyForCancellation($row);

        $this->propagateToPayroll($row->employee_id);

        return response()->json(['data' => $row]);
    }

    private function setStatus(Request $request, int $id, string $next)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $row = $this->findScopedOrFail($id, $user);
        if ($row->status !== 'Pending') {
            abort(422, "Leave request is already {$row->status}.");
        }
        $data = $request->validate([
            'comment' => ['nullable', 'string'],
        ]);

        $chain = $row->approval_chain ?? [];
        $level = max(1, (int) ($row->current_approval_level ?? 1));
        $isSuperOverride = $user->user_type === 'super_admin';
        $isApproverForLevel = $this->canActOnLevel($user, $chain, $level - 1, $row);
        $isHr = in_array($user->user_type, ['client_admin', 'branch_user'], true);
        if (!$isApproverForLevel && !$isSuperOverride && !$isHr) {
            abort(403, 'You cannot act on this leave request yet — it is awaiting approval from the reporting manager.');
        }

        $ownEmployeeId = (int) ($user->employee_id ?? 0);
        if ($next === 'Approved' && $ownEmployeeId && (int) $row->employee_id === $ownEmployeeId) {
            abort(403, 'You cannot approve your own leave request.');
        }

        if (isset($chain[$level - 1])) {
            $chain[$level - 1]['status'] = $next;
            $chain[$level - 1]['acted_by'] = $user->id;
            $chain[$level - 1]['acted_at'] = now()->toISOString();
            $chain[$level - 1]['comment'] = $data['comment'] ?? null;
        }
        $row->approval_chain = $chain;

        if ($next === 'Rejected') {
            for ($i = $level; $i < count($chain); $i++) {
                $st = $chain[$i]['status'] ?? 'Pending';
                if (!in_array($st, ['Approved', 'Rejected'], true)) {
                    $chain[$i]['status'] = 'Skipped';
                }
            }
            $row->approval_chain = $chain;
            $row->status = 'Rejected';
            $row->approved_by = $user->id;
            $row->approved_at = now();
            $row->approver_comment = $data['comment'] ?? null;
        } else {
            $nextLevel = $this->firstActionableLevel($chain, $level + 1);
            if ($nextLevel > count($chain)) {
                $row->status = 'Approved';
                $row->approved_by = $user->id;
                $row->approved_at = now();
                $row->approver_comment = $data['comment'] ?? null;
            } else {
                $row->current_approval_level = $nextLevel;
            }
        }
        $row->save();

        $noticeDays = 0;
        if ($row->status === 'Approved') {
            $noticeDays = NoticePeriodGuard::applyExtension($row, Employee::find($row->employee_id));
        }

        $this->notifyForDecision($row, $data['comment'] ?? null);

        if (in_array($row->status, ['Approved', 'Rejected'], true)) {
            $this->propagateToPayroll($row->employee_id);
        }

        return response()->json([
            'data' => $row->fresh(['leaveType:id,name,short_code']),
            'notice_extension' => $noticeDays > 0 ? [
                'days'             => $noticeDays,
                'last_working_day' => NoticePeriodGuard::lastWorkingDayLabel(Employee::find($row->employee_id)),
            ] : null,
        ]);
    }

    private function propagateToPayroll(?int $employeeId): void
    {
        if (!$employeeId) return;
        try {
            app(\App\Services\PayrollService::class)->recomputeEmployeePayslips((int) $employeeId);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Leave→payroll propagation failed', [
                'employee_id' => $employeeId,
                'error'       => $e->getMessage(),
            ]);
        }
    }

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
                'level' => $entry['level'] ?? ($i + 1),
                'role' => $entry['approver_role'] ?? ucfirst(str_replace('_', ' ', $entry['approver_kind'] ?? 'Approver')),
                'kind' => $entry['approver_kind'] ?? 'reporting_manager',
                'employee_id' => $empId,
                'name' => $name,
                'email' => $emp?->email ?? $u?->email,
                'status' => $entry['status'] ?? 'Pending',
                'acted_at' => $entry['acted_at'] ?? null,
                'comment' => $entry['comment'] ?? null,
                'is_current' => ($i + 1) === (int) ($row->current_approval_level ?? 1)
                                && $row->status === 'Pending',
            ];
        }

        if (empty($out)) {
            $employee = Employee::find($row->employee_id);
            if ($employee && $employee->reporting_manager_id) {
                $rm = Employee::find($employee->reporting_manager_id);
                if ($rm) {
                    $out[] = [
                        'level' => 1,
                        'role' => 'Reporting Manager',
                        'kind' => 'reporting_manager',
                        'employee_id' => $rm->id,
                        'name' => trim($rm->display_name ?: trim(($rm->first_name ?? '') . ' ' . ($rm->last_name ?? ''))),
                        'email' => $rm->email,
                        'status' => 'Pending',
                        'acted_at' => null,
                        'comment' => null,
                        'is_current' => true,
                    ];
                }
            }
        }

        return response()->json(['data' => $out]);
    }

    private function snapshotApprovalChain(Employee $employee, ?int $planId, int $leaveTypeId, float $days = 0): array
    {
        $rawChain = null;
        if ($planId) {
            $pivot = DB::table('leave_plan_leave_types')
                ->where('leave_plan_id', $planId)
                ->where('leave_type_id', $leaveTypeId)
                ->value('config_json');
            if ($pivot) {
                $cfg = is_string($pivot) ? json_decode($pivot, true) : $pivot;
                $approval = $cfg['approval'] ?? null;
                if (is_array($approval['chain'] ?? null) && count($approval['chain']) > 0) {
                    $rawChain = $approval['chain'];
                } elseif (!empty($approval['required']) && !empty($approval['approverRole'])) {
                    $rawChain = [['approver_kind' => 'role', 'approver_role' => $approval['approverRole']]];
                }
            }
        }
        if ($rawChain === null) {
            $rawChain = [
                ['approver_kind' => 'reporting_manager'],
            ];
        }

        $rawChain = array_values(array_filter($rawChain, function ($r) {
            $kind = $r['approver_kind'] ?? ($r['kind'] ?? null);
            $role = strtolower((string) ($r['approver_role'] ?? ($r['role'] ?? '')));
            return !($kind === 'role' && $role === 'hr');
        }));
        if (empty($rawChain)) {
            $rawChain = [['approver_kind' => 'reporting_manager']];
        }

        $chain = [];
        foreach ($rawChain as $i => $r) {
            $kind = $r['approver_kind'] ?? ($r['kind'] ?? 'reporting_manager');
            $role = $r['approver_role'] ?? ($r['role'] ?? null);
            $userId = $r['approver_user_id'] ?? ($r['user_id'] ?? null);
            $empIdOverride = $r['approver_employee_id'] ?? ($r['employee_id'] ?? null);

            $resolvedEmpId = $empIdOverride;
            $resolvedUserId = $userId;
            if (!$resolvedEmpId && $kind === 'reporting_manager') {
                $resolvedEmpId = $employee->reporting_manager_id;
                if (!$resolvedEmpId && !$resolvedUserId) {
                    $resolvedUserId = $employee->reporting_manager_user_id;
                }
            }

            $resolvedExists = $resolvedEmpId
                ? Employee::where('id', $resolvedEmpId)->exists()
                : true;

            $skipIf = $r['skip_if'] ?? null;
            $shouldSkip = $this->evaluateSkipRule($skipIf, ['days' => $days]);
            $skipReason = $shouldSkip ? 'Auto-skipped by rule' : null;

            $loopsToSelf = false;
            if (!$shouldSkip) {
                if ($kind === 'reporting_manager'
                    && $resolvedEmpId
                    && (int) $resolvedEmpId === (int) $employee->id
                ) {
                    $loopsToSelf = true;
                } elseif ($kind === 'role'
                    && strtolower((string) $role) === 'reporting_manager'
                    && $employee->reporting_manager_id
                    && (int) $employee->reporting_manager_id === (int) $employee->id
                ) {
                    $loopsToSelf = true;
                } elseif ($empIdOverride
                    && (int) $empIdOverride === (int) $employee->id
                ) {
                    $loopsToSelf = true;
                } elseif ($resolvedUserId
                    && (int) $resolvedUserId === (int) ($employee->user_id ?? 0)
                ) {
                    $loopsToSelf = true;
                }
            }
            if ($loopsToSelf) {
                $shouldSkip = true;
                $skipReason = 'Auto-skipped — approver resolves to the requester (self-loop)';
            } elseif (!$shouldSkip
                && $resolvedEmpId
                && !$resolvedExists
            ) {
                if ($kind === 'reporting_manager') {
                    $skipReason = 'Reporting manager unavailable — awaiting HR review';
                } else {
                    $shouldSkip = true;
                    $skipReason = "Auto-skipped — approver employee #{$resolvedEmpId} no longer exists";
                }
            }

            $chain[] = [
                'level' => $i + 1,
                'approver_kind' => $kind,
                'approver_role' => $role,
                'approver_user_id' => $resolvedUserId,
                'approver_employee_id' => $resolvedEmpId,
                'approver_label' => $r['label'] ?? null,
                'skip_if' => $skipIf,
                'status' => $shouldSkip ? 'Skipped' : 'Pending',
                'acted_by' => null,
                'acted_at' => null,
                'comment' => $skipReason,
            ];
        }
        return $chain;
    }

    private function evaluateSkipRule(mixed $rule, array $ctx): bool
    {
        if (!is_array($rule) || empty($rule)) return false;
        $days = (float) ($ctx['days'] ?? 0);
        if (array_key_exists('days_lt', $rule)  && $days < (float) $rule['days_lt'])  return true;
        if (array_key_exists('days_lte', $rule) && $days <= (float) $rule['days_lte']) return true;
        if (array_key_exists('days_gt', $rule)  && $days > (float) $rule['days_gt'])  return true;
        if (array_key_exists('days_gte', $rule) && $days >= (float) $rule['days_gte']) return true;
        return false;
    }

    private function firstActionableLevel(array $chain, int $start): int
    {
        $i = max(1, $start);
        while ($i <= count($chain)) {
            $status = $chain[$i - 1]['status'] ?? 'Pending';
            if ($status === 'Pending') return $i;
            $i++;
        }
        return count($chain) + 1;
    }

    public function canActOnLevel($user, array $chain, int $idx, ?LeaveRequest $request = null): bool
    {
        if (!isset($chain[$idx])) return false;
        $entry = $chain[$idx];
        if (!empty($entry['approver_user_id']) && (int)$entry['approver_user_id'] === (int)$user->id) {
            return true;
        }
        if (!empty($entry['approver_employee_id'])) {
            $myEmpId = $user->employee_id;
            if ($myEmpId && (int)$entry['approver_employee_id'] === (int)$myEmpId) {
                return true;
            }
        }
        if (!empty($entry['approver_role'])) {
            $role = strtolower($entry['approver_role']);
            if ($role === 'hr' && in_array($user->user_type, ['branch_user', 'client_admin'], true)) {
                return true;
            }
            if ($role === 'branch_admin' && $user->user_type === 'branch_user') {
                return true;
            }
            if ($role === 'reporting_manager' && $request) {
                $emp = Employee::find($request->employee_id);
                if ($emp && $emp->reporting_manager_id) {
                    $myEmpId = $user->employee_id;
                    if ($myEmpId && (int)$emp->reporting_manager_id === (int)$myEmpId) return true;
                }
            }
        }
        if (($entry['approver_kind'] ?? '') === 'reporting_manager' && $request) {
            $emp = Employee::find($request->employee_id);
            if ($emp && $emp->reporting_manager_id) {
                $myEmpId = $user->employee_id;
                if ($myEmpId && (int)$emp->reporting_manager_id === (int)$myEmpId) return true;
            }
        }
        return false;
    }

    private function computeLeaveDays(
        Carbon $from,
        Carbon $to,
        string $dayType,
        Employee $employee,
        ?int $ignoreRequestId = null,
        bool $sandwichWaived = false,
        bool $minOneDay = false,
    ): float {
        if ($dayType !== 'full' && $from->isSameDay($to)) return 0.5;

        $weeklyOffLabel = (string) ($employee->weekly_off ?? '');

        $pad     = \App\Support\SandwichPolicy::LOOKAROUND_DAYS;
        $padFrom = $from->copy()->subDays($pad);
        $padTo   = $to->copy()->addDays($pad);

        $holidaySet = $this->holidayDatesInRange($employee, $padFrom, $padTo);

        $isOff = fn (Carbon $d): bool => \App\Support\WeekOff::isOff($weeklyOffLabel, $d)
            || isset($holidaySet[$d->toDateString()]);

        $total = 0.0;
        foreach (CarbonPeriod::create($from->copy()->startOfDay(), $to->copy()->startOfDay()) as $d) {
            if (!$isOff($d)) $total += 1.0;
        }

        if (!$sandwichWaived && \App\Support\SandwichPolicy::appliesTo($employee)) {
            $approved = \App\Support\SandwichPolicy::approvedLeaveDates(
                (int) $employee->id, $padFrom, $padTo, $ignoreRequestId,
            );
            $rangeStart = $from->copy()->startOfDay();
            $rangeEnd   = $to->copy()->startOfDay();
            $isLeave = function (Carbon $d) use ($approved, $rangeStart, $rangeEnd): bool {
                $day = $d->copy()->startOfDay();
                if ($day->gte($rangeStart) && $day->lte($rangeEnd)) return true;
                return isset($approved[$day->toDateString()]);
            };
            $total += count(
                \App\Support\SandwichPolicy::chargeableOffDays($from, $to, $isOff, $isLeave)
            );
        }

        // A full-day leave over a real date range that lands entirely on
        // week-offs/holidays still costs at least one day — a leave is never
        // recorded as 0 days (QA #246/#247). Only the stored leave uses this
        // floor ($minOneDay); the internal sandwich-diff keeps the raw count,
        // and payroll recomputes its own span, so paid/LOP days are unaffected.
        if ($minOneDay && $dayType === 'full' && $from->lte($to) && $total < 1.0) {
            $total = 1.0;
        }

        return $total;
    }

    private function holidayDatesInRange(Employee $employee, Carbon $start, Carbon $end): array
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable('holidays')) return [];

        $groupId  = $employee->holiday_group_id ?? null;
        $clientId = $employee->client_id ?? null;
        $branchId = $employee->branch_id ?? null;

        $rows = DB::table('holidays')
            ->whereNull('deleted_at')
            ->where(function ($q) use ($groupId, $clientId, $branchId) {
                $q->where(function ($w) use ($clientId, $branchId) {
                    $w->whereNull('holiday_group_id');
                    $w->where('client_id', $clientId);
                    if ($branchId) {
                        $w->where(fn($b) => $b->whereNull('branch_id')->orWhere('branch_id', $branchId));
                    }
                });
                if ($groupId) {
                    $q->orWhere('holiday_group_id', $groupId);
                }
            })
            ->get(['date', 'is_recurring']);
        $out = [];
        foreach ($rows as $r) {
            if (!$r->date) continue;
            $d = Carbon::parse($r->date);

            if ($r->is_recurring) {
                foreach (range($start->year, $end->year) as $year) {
                    $anchored = Carbon::create($year, $d->month, $d->day);
                    if ($anchored->gte($start) && $anchored->lte($end)) {
                        $out[$anchored->toDateString()] = true;
                    }
                }
                continue;
            }

            if ($d->lt($start) || $d->gt($end)) continue;
            $out[$d->toDateString()] = true;
        }
        return $out;
    }

    private function rmUnavailableMap($rows): array
    {
        if ($rows->isEmpty()) return [];

        $empIds = $rows->pluck('employee_id')->filter()->unique()->values()->all();
        if (empty($empIds)) return [];

        $employees = Employee::whereIn('id', $empIds)
            ->get(['id', 'reporting_manager_id', 'reporting_manager_user_id'])
            ->keyBy('id');

        $rmEmpIds = $employees->pluck('reporting_manager_id')->filter()->unique()->values()->all();
        $rmUserIds = $employees->pluck('reporting_manager_user_id')->filter()->unique()->values()->all();

        $rmEmployees = $rmEmpIds
            ? Employee::whereIn('id', $rmEmpIds)->get(['id', 'status', 'user_id'])->keyBy('id')
            : collect();

        $userIds = array_values(array_unique(array_merge(
            $rmEmployees->pluck('user_id')->filter()->all(),
            $rmUserIds,
        )));
        $users = $userIds
            ? User::whereIn('id', $userIds)->get(['id', 'status'])->keyBy('id')
            : collect();

        $todayStr = now(self::DISPLAY_TZ)->toDateString();
        $onLeave = $rmEmpIds
            ? LeaveRequest::whereIn('employee_id', $rmEmpIds)
                ->where('status', 'Approved')
                ->whereDate('from_date', '<=', $todayStr)
                ->whereDate('to_date', '>=', $todayStr)
                ->pluck('employee_id')
                ->map(fn ($v) => (int) $v)
                ->flip()
            : collect();

        $out = [];
        foreach ($rows as $row) {
            $emp = $employees->get($row->employee_id);
            if (!$emp) { $out[$row->id] = false; continue; }

            if ($emp->reporting_manager_id) {
                $rm = $rmEmployees->get($emp->reporting_manager_id);
                if (!$rm) { $out[$row->id] = true; continue; }
                if (strcasecmp((string) $rm->status, 'Active') !== 0) { $out[$row->id] = true; continue; }
                if ($rm->user_id) {
                    $u = $users->get($rm->user_id);
                    if ($u && strcasecmp((string) $u->status, 'active') !== 0) { $out[$row->id] = true; continue; }
                }
                $out[$row->id] = $onLeave->has((int) $emp->reporting_manager_id);
                continue;
            }

            if ($emp->reporting_manager_user_id) {
                $u = $users->get($emp->reporting_manager_user_id);
                $out[$row->id] = !$u || strcasecmp((string) $u->status, 'active') !== 0;
                continue;
            }

            $out[$row->id] = true;
        }

        return $out;
    }

    public function isReportingManagerUnavailable(LeaveRequest $row): bool
    {
        $emp = Employee::find($row->employee_id);
        if (!$emp) return false;
        $todayStr = now(self::DISPLAY_TZ)->toDateString();

        if ($emp->reporting_manager_id) {
            $rm = Employee::find($emp->reporting_manager_id);
            if (!$rm) return true;
            if (strcasecmp((string) $rm->status, 'Active') !== 0) return true;
            if ($rm->user_id) {
                $u = User::find($rm->user_id);
                if ($u && strcasecmp((string) $u->status, 'active') !== 0) return true;
            }
            $onLeave = LeaveRequest::where('employee_id', $rm->id)
                ->where('status', 'Approved')
                ->whereDate('from_date', '<=', $todayStr)
                ->whereDate('to_date', '>=', $todayStr)
                ->exists();
            return $onLeave;
        }

        if ($emp->reporting_manager_user_id) {
            $u = User::find($emp->reporting_manager_user_id);
            if (!$u) return true;
            return strcasecmp((string) $u->status, 'active') !== 0;
        }

        return true;
    }

    private function notifyForSubmission(LeaveRequest $row, Employee $employee): void
    {
        foreach ($this->resolveApproverNotifiables($row, 1, $employee) as $r) {
            $this->safeSend($r, new LeaveRequestNotification($row, 'submitted_to_approver'));
        }

        if ($this->isReportingManagerUnavailable($row)) {
            foreach ($this->resolveRoleRecipients('hr', $employee) as $r) {
                $this->safeSend($r, new LeaveRequestNotification($row, 'escalated_to_hr'));
            }
        }

        $ccIds = $this->extractNotifyEmployeeIds($row);
        foreach ($ccIds as $ccEmpId) {
            $cc = Employee::find($ccEmpId);
            if (!$cc) continue;
            $n = LeaveRequestNotification::notifiableFromEmployee($cc);
            $this->safeSend($n instanceof AnonymousNotifiable ? $n->route('mail', $cc->email) : $n,
                new LeaveRequestNotification($row, 'cc_submitted'));
        }
    }

    private function notifyForDecision(LeaveRequest $row, ?string $comment): void
    {
        $employee = Employee::find($row->employee_id);
        if (!$employee) return;
        $employeeNotifiable = LeaveRequestNotification::notifiableFromEmployee($employee);
        $employeeNotifiable = $employeeNotifiable instanceof AnonymousNotifiable
            ? $employeeNotifiable->route('mail', $employee->email)
            : $employeeNotifiable;

        if ($row->status === 'Rejected') {
            $this->safeSend($employeeNotifiable, new LeaveRequestNotification($row, 'rejected', $comment));
            return;
        }

        if ($row->status === 'Approved') {
            $this->safeSend($employeeNotifiable, new LeaveRequestNotification($row, 'approved', $comment));
            return;
        }

        foreach ($this->resolveApproverNotifiables($row, (int)$row->current_approval_level, $employee) as $r) {
            $this->safeSend($r, new LeaveRequestNotification($row, 'submitted_to_approver'));
        }
    }

    private function notifyForCancellation(LeaveRequest $row): void
    {
        $employee = Employee::find($row->employee_id);
        if (!$employee) return;
        foreach ($this->resolveApproverNotifiables($row, (int)$row->current_approval_level, $employee) as $r) {
            $this->safeSend($r, new LeaveRequestNotification($row, 'cancelled'));
        }
    }

    private function resolveApproverNotifiables(LeaveRequest $row, int $level, Employee $employee): array
    {
        $chain = $row->approval_chain ?? [];
        $entry = $chain[$level - 1] ?? null;
        if (!$entry) {
            if ($employee->reporting_manager_id) {
                $rm = Employee::find($employee->reporting_manager_id);
                $r = $rm ? $this->employeeAsRecipient($rm) : null;
                return $r ? [$r] : [];
            }
            return [];
        }

        $kind = $entry['approver_kind'] ?? 'reporting_manager';

        if (!empty($entry['approver_user_id'])) {
            $u = User::find((int)$entry['approver_user_id']);
            return $u && $u->email ? [$u] : [];
        }

        if (!empty($entry['approver_employee_id'])) {
            $emp = Employee::find((int)$entry['approver_employee_id']);
            $r = $emp ? $this->employeeAsRecipient($emp) : null;
            return $r ? [$r] : [];
        }

        if ($kind === 'reporting_manager' && $employee->reporting_manager_id) {
            $rm = Employee::find($employee->reporting_manager_id);
            $r = $rm ? $this->employeeAsRecipient($rm) : null;
            return $r ? [$r] : [];
        }

        if ($kind === 'role' && !empty($entry['approver_role'])) {
            return $this->resolveRoleRecipients((string)$entry['approver_role'], $employee);
        }

        return [];
    }

    private function resolveRoleRecipients(string $role, Employee $employee): array
    {
        $role = strtolower($role);

        if ($role === 'reporting_manager') {
            if (!$employee->reporting_manager_id) return [];
            if ((int) $employee->reporting_manager_id === (int) $employee->id) return [];
            $rm = Employee::find($employee->reporting_manager_id);
            $r = $rm ? $this->employeeAsRecipient($rm) : null;
            return $r ? [$r] : [];
        }

        if (!in_array($role, ['hr', 'branch_admin'], true)) {
            return [];
        }

        $q = User::query()
            ->where('user_type', 'branch_user')
            ->whereNotNull('email');
        if ($employee->client_id) $q->where('client_id', $employee->client_id);
        if ($employee->branch_id) {
            $q->where('branch_id', $employee->branch_id);
        }

        return $q->get()->all();
    }

    private function employeeAsRecipient(Employee $emp): mixed
    {
        if ($emp->user_id) {
            $u = User::find($emp->user_id);
            if ($u && $u->email) return $u;
        }
        if (!empty($emp->email)) {
            return (new AnonymousNotifiable)->route('mail', $emp->email);
        }
        return null;
    }

    private function extractNotifyEmployeeIds(LeaveRequest $row): array
    {
        $notify = $row->notify;
        if (!is_array($notify)) return [];
        $ids = $notify['employee_ids'] ?? null;
        if (!is_array($ids)) return [];
        return array_values(array_filter(array_map('intval', $ids), fn($v) => $v > 0));
    }

    private function findScopedOrFail(int $id, $user): LeaveRequest
    {
        $row = LeaveRequest::findOrFail($id);
        if ($user->user_type !== 'super_admin'
            && $user->client_id
            && (int) $row->client_id !== (int) $user->client_id) {
            abort(404);
        }
        if (($user->user_type ?? null) === 'branch_user'
            && $user->branch_id
            && $row->branch_id
            && (int) $row->branch_id !== (int) $user->branch_id) {
            abort(404);
        }
        return $row;
    }

    private function safeSend(mixed $notifiable, LeaveRequestNotification $notif): void
    {
        if (!$notifiable) return;

        foreach (['database', 'mail'] as $channel) {
            try {
                Notification::sendNow($notifiable, $notif, [$channel]);
            } catch (\Throwable $e) {
                Log::warning("[leave-notify] {$channel} dispatch failed: " . $e->getMessage(), [
                    'request_id' => $notif->request->id ?? null,
                    'kind'       => $notif->kind ?? null,
                ]);
            }
        }
    }
}
