<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\LeaveRequest;
use App\Models\Masters\LeavePlanLeaveType;
use App\Models\Masters\LeavePlans;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class LeavePlanController extends Controller
{

    private const DETAIL_WITH = [
        'employees:id,first_name,last_name,display_name,emp_code,department_id,designation_id,reporting_manager_id,location',
        'employees.department:id,name',
        'employees.designation:id,name',
        'employees.reportingManager:id,first_name,last_name,display_name',
    ];

    private static function detailWith(): array
    {
        return array_merge(self::DETAIL_WITH, [
            'leaveTypes' => fn ($q) => $q->orderBy('master_leave_types.name'),
        ]);
    }

    private static function trimEmployeeAppends(iterable $plans): void
    {
        $hide = [
            'photo_url', 'face_registered', 'profile_completion', 'encrypted_id',
            'other_assets_resolved', 'ancillary_roles_resolved',
        ];
        foreach ($plans as $plan) {
            if (!$plan->relationLoaded('employees')) continue;
            foreach ($plan->employees as $e) {
                $e->makeHidden($hide);
                if ($e->relationLoaded('reportingManager')) $e->reportingManager?->makeHidden($hide);
            }
        }
    }
    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $branchFilter = $request->integer('branch_id') ?: null;

        $q = LeavePlans::query()
            ->with(['client:id,org_name', 'branch:id,name'])
            ->withCount(['employees', 'leaveTypes']);

        if ($request->boolean('with_detail')) {
            $q->with(self::detailWith());
        }

        $this->applyScope($q, $user, $branchFilter);

        if ($search = trim((string) $request->query('search', ''))) {
            $q->where('plan_name', 'ilike', '%' . $search . '%');
        }

        $q->orderByDesc('is_default')->orderBy('plan_name');

        $perPage = (int) $request->integer('per_page');
        $total   = null;
        if ($perPage > 0) {
            $perPage = min($perPage, 100);
            $page    = max(1, (int) $request->integer('page'));
            $total   = (clone $q)->reorder()->count();
            $rows    = $q->forPage($page, $perPage)->get();
        } else {
            $rows = $q->get();
        }

        $planIds = $rows->pluck('id')->all();
        $cfgStats = empty($planIds) ? collect() : DB::table('leave_plan_leave_types')
            ->whereIn('leave_plan_id', $planIds)
            ->selectRaw('leave_plan_id, COUNT(*) as total, SUM(CASE WHEN is_setup THEN 1 ELSE 0 END) as configured')
            ->groupBy('leave_plan_id')
            ->get()
            ->keyBy('leave_plan_id');
        $rows->each(function ($plan) use ($cfgStats) {
            $stat = $cfgStats->get($plan->id);
            $total = $stat ? (int) $stat->total : 0;
            $configured = $stat ? (int) $stat->configured : 0;
            $plan->setup_complete = $total > 0 && $configured === $total;
        });

        self::trimEmployeeAppends($rows);

        return response()->json(
            ['data' => $rows] + ($total !== null ? ['total' => $total] : [])
        );
    }

    public function show(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $plan = $this->findPlanOrFail($user, $id);
        $plan->load(array_merge(
            ['client:id,org_name', 'branch:id,name'],
            self::detailWith(),
        ));
        self::trimEmployeeAppends([$plan]);

        return response()->json(['data' => $plan]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'plan_name' => ['required', 'string', 'max:255', 'regex:/^(?=.*\pL)[\pL\pN \-]+$/u'],
            'description' => ['nullable', 'string'],
            'from_month_type' => ['required', Rule::in(['Calendar', 'If Joining'])],
            'from_month' => ['nullable', Rule::in([
                'January','February','March','April','May','June',
                'July','August','September','October','November','December',
            ])],
            'calendar_year' => ['nullable', 'string', 'max:20'],
            'policy_explanation_mode' => ['nullable', Rule::in(['System', 'Custom'])],
            'policy_doc_path' => ['nullable', 'string', 'max:1024'],
            'status' => ['nullable', Rule::in(['Active', 'Inactive'])],
            'is_default' => ['nullable', 'boolean'],
        ], [
            'plan_name.regex' => 'Leave plan name must include at least one letter, and can only contain letters, numbers, spaces and hyphens.',
        ]);

        [$clientId, $branchId] = $this->resolveOwnership($user, $request);
        $this->assertUniquePlanName($clientId, $branchId, $data['plan_name'], null);

        $data['client_id'] = $clientId;
        $data['branch_id'] = $branchId;
        $data['created_by'] = $user->id;
        $data['status'] = $data['status'] ?? 'Active';
        $data['policy_explanation_mode'] = $data['policy_explanation_mode'] ?? 'System';
        $isDefault = (bool) ($data['is_default'] ?? false);
        $data['is_default'] = $isDefault;

        $plan = DB::transaction(function () use ($data, $isDefault, $clientId, $branchId) {
            if ($isDefault) {
                $this->clearDefaultForBranch($clientId, $branchId);
            }
            return LeavePlans::create($data);
        });

        return response()->json(['data' => $plan], 201);
    }

    public function update(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $plan = $this->findPlanOrFail($user, $id);
        $this->assertPlanEditable($plan);

        $data = $request->validate([
            'plan_name' => ['sometimes', 'required', 'string', 'max:255', 'regex:/^(?=.*\pL)[\pL\pN \-]+$/u'],
            'description' => ['nullable', 'string'],
            'from_month_type' => ['sometimes', 'required', Rule::in(['Calendar', 'If Joining'])],
            'from_month' => ['nullable', Rule::in([
                'January','February','March','April','May','June',
                'July','August','September','October','November','December',
            ])],
            'calendar_year' => ['nullable', 'string', 'max:20'],
            'policy_explanation_mode' => ['nullable', Rule::in(['System', 'Custom'])],
            'policy_doc_path' => ['nullable', 'string', 'max:1024'],
            'status' => ['nullable', Rule::in(['Active', 'Inactive'])],
            'is_default' => ['nullable', 'boolean'],
        ], [
            'plan_name.regex' => 'Leave plan name must include at least one letter, and can only contain letters, numbers, spaces and hyphens.',
        ]);

        if (array_key_exists('plan_name', $data)) {
            $this->assertUniquePlanName($plan->client_id, $plan->branch_id, $data['plan_name'], $plan->id);
        }

        DB::transaction(function () use ($plan, $data) {
            if (array_key_exists('is_default', $data) && (bool) $data['is_default']) {
                $this->clearDefaultForBranch($plan->client_id, $plan->branch_id, exceptId: $plan->id);
            }
            $plan->fill($data)->save();
        });

        return response()->json(['data' => $plan->fresh()]);
    }

    public function destroy(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $plan = $this->findPlanOrFail($user, $id);
        if ($plan->is_default) {
            abort(422, 'Cannot delete the default leave plan. Set another plan as default first.');
        }

        $active = DB::table('leave_requests')
            ->where('leave_plan_id', $plan->id)
            ->whereIn('status', ['Pending', 'Approved'])
            ->count();
        if ($active > 0) {
            abort(422, "Cannot delete this plan — {$active} active (pending/approved) leave request(s) still reference it. Resolve or reassign them first.");
        }

        DB::transaction(function () use ($plan) {
            DB::table('leave_plan_employees')->where('leave_plan_id', $plan->id)->delete();
            DB::table('leave_plan_leave_types')->where('leave_plan_id', $plan->id)->delete();
            $plan->delete();
        });

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function clone(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $source = $this->findPlanOrFail($user, $id);

        $newName = trim((string) $request->input('plan_name', $source->plan_name . ' (Copy)'));
        if ($newName === '') $newName = $source->plan_name . ' (Copy)';

        $clone = DB::transaction(function () use ($source, $newName, $user) {
            $copy = $source->replicate(['is_default']);
            $copy->plan_name = $newName;
            $copy->is_default = false;
            $copy->unlocked = true;
            $copy->created_by = $user->id;
            $copy->save();

            $rows = LeavePlanLeaveType::where('leave_plan_id', $source->id)->get();
            foreach ($rows as $row) {
                LeavePlanLeaveType::create([
                    'leave_plan_id' => $copy->id,
                    'leave_type_id' => $row->leave_type_id,
                    'config_json' => $row->config_json,
                    'quota_summary' => $row->quota_summary,
                    'eoy_summary' => $row->eoy_summary,
                    'is_setup' => $row->is_setup,
                ]);
            }
            return $copy;
        });

        return response()->json(['data' => $clone], 201);
    }

    public function makeDefault(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $plan = $this->findPlanOrFail($user, $id);

        DB::transaction(function () use ($plan) {
            $this->clearDefaultForBranch($plan->client_id, $plan->branch_id, exceptId: $plan->id);
            $plan->is_default = true;
            $plan->save();
        });

        return response()->json(['data' => $plan->fresh()]);
    }

    public function assignTypes(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $plan = $this->findPlanOrFail($user, $id);
        $this->assertPlanEditable($plan);

        $data = $request->validate([
            'leave_type_ids' => ['required', 'array'],
            'leave_type_ids.*' => ['integer', 'exists:master_leave_types,id'],
            'mode' => ['nullable', Rule::in(['replace', 'append'])],
        ]);
        $mode = $data['mode'] ?? 'replace';
        $newIds = array_values(array_unique(array_map('intval', $data['leave_type_ids'])));

        DB::transaction(function () use ($plan, $newIds, $mode) {
            $existingIds = LeavePlanLeaveType::where('leave_plan_id', $plan->id)
                ->pluck('leave_type_id')->map(fn($v) => (int)$v)->all();

            $toAdd = array_diff($newIds, $existingIds);
            foreach ($toAdd as $typeId) {
                LeavePlanLeaveType::create([
                    'leave_plan_id' => $plan->id,
                    'leave_type_id' => $typeId,
                    'config_json' => null,
                    'is_setup' => false,
                ]);
            }

            if ($mode === 'replace') {
                $toRemove = array_diff($existingIds, $newIds);
                if (!empty($toRemove)) {
                    LeavePlanLeaveType::where('leave_plan_id', $plan->id)
                        ->whereIn('leave_type_id', $toRemove)
                        ->delete();
                }
            }
        });

        $plan->load('leaveTypes');
        return response()->json(['data' => $plan]);
    }

    public function removeType(Request $request, int $id, int $typeId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $plan = $this->findPlanOrFail($user, $id);
        $this->assertPlanEditable($plan);

        LeavePlanLeaveType::where('leave_plan_id', $plan->id)
            ->where('leave_type_id', $typeId)
            ->delete();

        return response()->json(['data' => ['removed' => true]]);
    }

    public function saveTypeConfig(Request $request, int $id, int $typeId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $plan = $this->findPlanOrFail($user, $id);
        $this->assertPlanEditable($plan);

        $data = $request->validate([
            'config' => ['required', 'array'],
            'config.accrual.yearlyQuota'      => ['nullable', 'numeric', 'min:0', 'max:365'],
            'config.accrual.attendanceDaysWorked' => ['exclude_unless:config.accrual.mode,attendance', 'nullable', 'numeric', 'min:0', 'max:31'],
            'config.accrual.employeeOverdraft.days' => ['nullable', 'numeric', 'min:0', 'max:365'],
            'config.yearEnd.carryForwardCap'  => ['nullable', 'numeric', 'min:0', 'max:365'],
            'quota_summary' => ['nullable', 'string', 'max:255'],
            'eoy_summary' => ['nullable', 'string', 'max:255'],
            'finalize' => ['sometimes', 'boolean'],
        ], [
            'config.accrual.yearlyQuota.min'     => 'Yearly leave quota cannot be negative.',
            'config.accrual.yearlyQuota.max'     => 'Yearly leave quota cannot exceed 365 days.',
            'config.accrual.yearlyQuota.numeric' => 'Yearly leave quota must be a number.',
            'config.accrual.attendanceDaysWorked.min'     => 'Days worked in a month cannot be negative.',
            'config.accrual.attendanceDaysWorked.max'     => 'Days worked in a month cannot exceed 31.',
            'config.accrual.attendanceDaysWorked.numeric' => 'Days worked in a month must be a number.',
            'config.accrual.employeeOverdraft.days.min'     => 'Extra leave cannot be negative.',
            'config.accrual.employeeOverdraft.days.max'     => 'Extra leave cannot exceed 365 days.',
            'config.accrual.employeeOverdraft.days.numeric' => 'Extra leave must be a number.',
            'config.yearEnd.carryForwardCap.min' => 'Carry-forward cap cannot be negative.',
            'config.yearEnd.carryForwardCap.max' => 'Carry-forward cap cannot exceed 365 days.',
        ]);

        $row = LeavePlanLeaveType::where('leave_plan_id', $plan->id)
            ->where('leave_type_id', $typeId)
            ->first();
        if (!$row) {
            abort(404, 'Leave type is not assigned to this plan.');
        }

        $row->config_json = $request->input('config');
        $row->quota_summary = $data['quota_summary'] ?? $row->quota_summary;
        $row->eoy_summary = $data['eoy_summary'] ?? $row->eoy_summary;
        if ($request->boolean('finalize', true)) {
            $row->is_setup = true;
        }
        $row->save();

        if ($plan->unlocked && $this->isPlanSetupComplete($plan->id)) {
            $plan->unlocked = false;
            $plan->save();
        }

        return response()->json(['data' => $row]);
    }

    public function assignEmployees(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $plan = $this->findPlanOrFail($user, $id);

        $data = $request->validate([
            'employee_ids' => ['required', 'array'],
            'employee_ids.*' => ['integer', 'exists:employees,id'],
        ]);
        $ids = array_values(array_unique(array_map('intval', $data['employee_ids'])));

        $allowed = Employee::whereIn('id', $ids)
            ->where('client_id', $plan->client_id)
            ->when($plan->branch_id !== null, function ($q) use ($plan) {
                $q->where(function ($w) use ($plan) {
                    $w->where('branch_id', $plan->branch_id)
                      ->orWhereNull('branch_id');
                });
            })
            ->pluck('id')->map(fn($v) => (int)$v)->all();

        if (count($allowed) !== count($ids)) {
            $missing = array_diff($ids, $allowed);
            abort(422, 'Some employees do not belong to this plan\'s tenant scope: ' . implode(',', $missing));
        }

        DB::transaction(function () use ($plan, $allowed, $user) {
            foreach ($allowed as $empId) {
                DB::table('leave_plan_employees')->updateOrInsert(
                    ['employee_id' => $empId],
                    [
                        'leave_plan_id' => $plan->id,
                        'assigned_at' => now(),
                        'assigned_by' => $user->id,
                        'updated_at' => now(),
                        'created_at' => now(),
                    ]
                );
            }
        });

        return response()->json(['data' => ['assigned' => count($allowed)]]);
    }

    public function employeeBalances(Request $request, int $employeeId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $employee = Employee::with(['department:id,name'])->find($employeeId);
        if (!$employee) abort(404, 'Employee not found.');

        if ($user->user_type !== 'super_admin'
            && (int) $employee->client_id !== (int) $user->client_id) {
            abort(403, 'You do not have access to this employee.');
        }

        $planId = DB::table('leave_plan_employees')
            ->where('employee_id', $employeeId)
            ->value('leave_plan_id');
        if (!$planId && is_numeric($employee->leave_plan)) {
            $planId = (int) $employee->leave_plan;
        }
        $planRow = $planId
            ? DB::table('master_leave_plans')
                ->where('id', $planId)
                ->select('id', 'plan_name', 'from_month', 'calendar_year')
                ->first()
            : null;

        if (!$planRow) {
            return response()->json([
                'data' => [
                    'employee' => [
                        'id' => $employee->id,
                        'name' => trim(($employee->display_name ?? '') ?: trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? ''))),
                        'plan_id' => null,
                        'plan_name' => null,
                    ],
                    'types' => [],
                ],
            ]);
        }

        $planTypeRows = DB::table('leave_plan_leave_types as lplt')
            ->join('master_leave_types as lt', 'lt.id', '=', 'lplt.leave_type_id')
            ->where('lplt.leave_plan_id', $planRow->id)
            ->select(
                'lplt.leave_type_id',
                'lplt.config_json',
                'lplt.quota_summary',
                'lt.name as type_name',
                'lt.short_code',
                'lt.type as category',
                'lt.paid_unpaid'
            )->get();

        $requestsByType = LeaveRequest::query()
            ->where('employee_id', $employeeId)
            ->whereIn('leave_type_id', $planTypeRows->pluck('leave_type_id'))
            ->orderBy('from_date')
            ->get(['id', 'leave_type_id', 'from_date', 'to_date', 'days', 'status'])
            ->groupBy('leave_type_id');

        $types = $planTypeRows->map(function ($row) use ($requestsByType, $planRow) {
            $cfg = $row->config_json ? json_decode($row->config_json, true) : null;
            $accrual = $cfg['accrual'] ?? null;
            $unlimited = (bool) ($accrual['unlimited'] ?? false);
            $quota = (float) ($accrual['yearlyQuota'] ?? 0);
            $overdraft = $accrual['employeeOverdraft'] ?? null;
            $extra = (!$unlimited && ($overdraft['enabled'] ?? false))
                ? (float) ($overdraft['days'] ?? 0)
                : 0.0;
            $reqs = $requestsByType[$row->leave_type_id] ?? collect();

            $transactions = [];
            $balance = 0.0;
            if (!$unlimited && $quota > 0) {
                $yearStart = self::planYearStart($planRow->from_month, $planRow->calendar_year);
                $balance = $quota;
                $transactions[] = [
                    'date' => $yearStart->format('d M Y'),
                    'change' => "+ " . rtrim(rtrim(number_format($quota, 2), '0'), '.'),
                    'balance' => round($balance, 2),
                    'reason' => 'Annual leave quota granted for the year.',
                    'kind' => 'accrual',
                ];
                if ($extra > 0) {
                    $balance += $extra;
                    $transactions[] = [
                        'date' => $yearStart->format('d M Y'),
                        'change' => "+ " . rtrim(rtrim(number_format($extra, 2), '0'), '.'),
                        'balance' => round($balance, 2),
                        'reason' => 'Extra leave allowance.',
                        'kind' => 'accrual',
                    ];
                }
            }

            $used = 0.0;
            foreach ($reqs as $r) {
                if ($r->status === 'Approved') {
                    $days = (float) $r->days;
                    $used += $days;
                    $balance = max(0, $balance - $days);
                    $transactions[] = [
                        'date' => optional($r->from_date)->format('d M Y') ?? '',
                        'change' => "- " . rtrim(rtrim(number_format($days, 2), '0'), '.'),
                        'balance' => round($balance, 2),
                        'reason' => 'Leave taken (' . optional($r->from_date)->format('d M') . ' – ' . optional($r->to_date)->format('d M') . ')',
                        'kind' => 'approved',
                    ];
                }
            }
            $used      = round($used, 2);
            $available = $unlimited ? null : round(max(0, ($quota + $extra) - $used), 2);

            return [
                'leave_type_id' => (int) $row->leave_type_id,
                'name' => $row->type_name,
                'short_code' => $row->short_code,
                'category' => $row->category,
                'paid_unpaid' => $row->paid_unpaid,
                'quota' => $quota,
                'accrued' => $unlimited ? null : round($quota, 2),
                'extra' => $extra,
                'used' => $used,
                'available' => $available,
                'unlimited' => $unlimited,
                'allow_half_day' => (bool) ($cfg['leaveApp']['allowHalfDay'] ?? false),
                'transactions' => $transactions,
            ];
        })->values();

        return response()->json([
            'data' => [
                'employee' => [
                    'id' => $employee->id,
                    'name' => trim(($employee->display_name ?? '') ?: trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? ''))),
                    'department' => $employee->department?->name,
                    'plan_id' => (int) $planRow->id,
                    'plan_name' => $planRow->plan_name,
                ],
                'types' => $types,
            ],
        ]);
    }

    public function removeEmployee(Request $request, int $id, int $employeeId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $plan = $this->findPlanOrFail($user, $id);

        DB::table('leave_plan_employees')
            ->where('leave_plan_id', $plan->id)
            ->where('employee_id', $employeeId)
            ->delete();

        return response()->json(['data' => ['removed' => true]]);
    }

    public static function planYearStart(?string $fromMonth, $calendarYear): \Illuminate\Support\Carbon
    {
        $startMonth = 1;
        if ($fromMonth) {
            try {
                $startMonth = \Illuminate\Support\Carbon::parse('01 ' . substr($fromMonth, 0, 3) . ' 2000')->month;
            } catch (\Throwable $e) {
                $startMonth = 1;
            }
        }
        $year = is_numeric($calendarYear) ? (int) $calendarYear : \Illuminate\Support\Carbon::now()->year;
        return \Illuminate\Support\Carbon::create($year, $startMonth, 1)->startOfDay();
    }

    public static function accrualEvents(array $accrual, ?string $fromMonth, $calendarYear, ?\Illuminate\Support\Carbon $asOf = null): array
    {
        $quota = (float) ($accrual['yearlyQuota'] ?? 0);
        if ($quota <= 0) return [];

        $asOf = $asOf ?: \Illuminate\Support\Carbon::now();

        $startMonth = 1;
        if ($fromMonth) {
            try {
                $startMonth = \Illuminate\Support\Carbon::parse('01 ' . substr($fromMonth, 0, 3) . ' 2000')->month;
            } catch (\Throwable $e) {
                $startMonth = 1;
            }
        }
        $year = is_numeric($calendarYear) ? (int) $calendarYear : $asOf->year;
        $yearStart = \Illuminate\Support\Carbon::create($year, $startMonth, 1)->startOfDay();
        if ($asOf->lt($yearStart)) return [];

        $mode = $accrual['mode'] ?? 'periodic';
        if ($mode !== 'periodic') {
            return [['date' => $yearStart, 'amount' => round($quota, 2)]];
        }

        $periodsPerYear = match ($accrual['frequency'] ?? 'monthly') {
            'monthly'     => 12,
            'quarterly'   => 4,
            'half_yearly' => 2,
            'yearly'      => 1,
            default       => 12,
        };
        $monthsPerPeriod = intdiv(12, $periodsPerYear);
        $rate = $quota / $periodsPerYear;
        $dayOfMonth = max(1, (int) ($accrual['dayOfMonth'] ?? 1));

        $events = [];
        $running = 0.0;
        for ($p = 0; $p < $periodsPerYear; $p++) {
            $d = $yearStart->copy()->addMonths($p * $monthsPerPeriod);
            $d->day = min($dayOfMonth, $d->daysInMonth);
            if ($d->gt($asOf)) break;
            $amount = min($rate, $quota - $running);
            if ($amount <= 0) break;
            $events[] = ['date' => $d->copy(), 'amount' => round($amount, 2)];
            $running += $amount;
        }
        return $events;
    }

    public static function accruedToDate(array $accrual, ?string $fromMonth, $calendarYear, ?\Illuminate\Support\Carbon $asOf = null): float
    {
        $sum = 0.0;
        foreach (self::accrualEvents($accrual, $fromMonth, $calendarYear, $asOf) as $e) {
            $sum += $e['amount'];
        }
        return round($sum, 2);
    }

    public function leaveBalances(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $branchFilter = $request->integer('branch_id') ?: null;

        $planQ = LeavePlans::query();
        $this->applyScope($planQ, $user, $branchFilter);
        $planIds = $planQ->pluck('id')->all();

        $planTypeRows = empty($planIds) ? collect() : DB::table('leave_plan_leave_types as lplt')
            ->join('master_leave_types as lt', 'lt.id', '=', 'lplt.leave_type_id')
            ->whereIn('lplt.leave_plan_id', $planIds)
            ->select(
                'lplt.leave_plan_id',
                'lplt.leave_type_id',
                'lplt.config_json',
                'lplt.quota_summary',
                'lt.name as type_name',
                'lt.short_code',
                'lt.type as category',
                'lt.paid_unpaid'
            )->get();

        $columns = $planTypeRows
            ->unique('leave_type_id')
            ->sortBy('type_name')
            ->values()
            ->map(fn($r) => [
                'leave_type_id' => (int) $r->leave_type_id,
                'name' => $r->type_name,
                'short_code' => $r->short_code,
                'category' => $r->category,
                'paid_unpaid' => $r->paid_unpaid,
            ])->all();

        $planMeta = empty($planIds) ? collect() : LeavePlans::whereIn('id', $planIds)
            ->get(['id', 'from_month', 'calendar_year'])
            ->keyBy('id');

        $quotaByPlanType = [];
        foreach ($planTypeRows as $row) {
            $cfg = $row->config_json ? json_decode($row->config_json, true) : null;
            $accrual = $cfg['accrual'] ?? null;
            $unlimited = (bool) ($accrual['unlimited'] ?? false);
            $quota = (float) ($accrual['yearlyQuota'] ?? 0);
            $overdraft = $accrual['employeeOverdraft'] ?? null;
            $extra = (!$unlimited && ($overdraft['enabled'] ?? false))
                ? (float) ($overdraft['days'] ?? 0)
                : 0.0;
            $quotaByPlanType[$row->leave_plan_id][$row->leave_type_id] = [
                'quota' => $quota,
                'accrued' => $quota,
                'extra' => $extra,
                'unlimited' => $unlimited,
            ];
        }

        $empQ = Employee::query()
            ->select([
                'employees.id', 'employees.emp_code', 'employees.first_name', 'employees.last_name',
                'employees.display_name', 'employees.location', 'employees.department_id',
                'employees.designation_id', 'employees.client_id', 'employees.branch_id',
                'lpe.leave_plan_id',
            ])
            ->join('leave_plan_employees as lpe', 'lpe.employee_id', '=', 'employees.id')
            ->whereIn('lpe.leave_plan_id', $planIds)
            ->whereRaw('(employees.status IS NULL OR LOWER(employees.status) NOT IN (?, ?, ?, ?))', ['inactive', 'resigned', 'terminated', 'exited'])
            ->with([
                'department:id,name',
                'designation:id,name',
            ]);

        if ($departmentId = $request->integer('department_id')) {
            $empQ->where('employees.department_id', $departmentId);
        }
        if ($location = trim((string) $request->input('location', ''))) {
            if ($location !== '') $empQ->where('employees.location', $location);
        }
        if ($search = trim((string) $request->input('search', ''))) {
            if ($search !== '') {
                $like = '%' . $search . '%';
                $empQ->where(function ($w) use ($like) {
                    $w->where('employees.first_name', 'ilike', $like)
                      ->orWhere('employees.last_name', 'ilike', $like)
                      ->orWhere('employees.display_name', 'ilike', $like)
                      ->orWhere('employees.emp_code', 'ilike', $like);
                });
            }
        }

        $employees = $empQ->orderBy('employees.id')->get();

        $planNames = LeavePlans::whereIn('id', $planIds)->pluck('plan_name', 'id')->all();

        $empIds = $employees->pluck('id')->all();
        $usedByEmpType = [];
        if (!empty($empIds)) {
            $usedRows = DB::table('leave_requests')
                ->whereIn('employee_id', $empIds)
                ->where('status', 'Approved')
                ->groupBy('employee_id', 'leave_type_id')
                ->select('employee_id', 'leave_type_id', DB::raw('SUM(days) as used_days'))
                ->get();
            foreach ($usedRows as $r) {
                $usedByEmpType[(int)$r->employee_id][(int)$r->leave_type_id] = (float) $r->used_days;
            }
        }

        $rows = $employees->map(function ($e) use ($columns, $quotaByPlanType, $planNames, $usedByEmpType) {
            $planId = (int) $e->leave_plan_id;
            $planQuotas = $quotaByPlanType[$planId] ?? [];
            $empUsed = $usedByEmpType[$e->id] ?? [];
            $balances = [];
            foreach ($columns as $col) {
                $entry = $planQuotas[$col['leave_type_id']] ?? null;
                if (!$entry) {
                    $balances[] = [
                        'leave_type_id' => $col['leave_type_id'],
                        'applies' => false,
                        'unlimited' => false,
                        'quota' => 0,
                        'used' => 0,
                        'available' => 0,
                    ];
                    continue;
                }
                $used = round((float) ($empUsed[$col['leave_type_id']] ?? 0), 2);
                $balances[] = [
                    'leave_type_id' => $col['leave_type_id'],
                    'applies' => true,
                    'unlimited' => $entry['unlimited'],
                    'quota' => $entry['quota'],
                    'used' => $used,
                    'available' => $entry['unlimited'] ? null : round(max(0, ($entry['quota'] + ($entry['extra'] ?? 0)) - $used), 2),
                ];
            }

            $fullName = trim($e->display_name ?: trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')));
            return [
                'id' => $e->id,
                'emp_code' => $e->emp_code,
                'name' => $fullName,
                'department' => $e->department?->name,
                'designation' => $e->designation?->name,
                'location' => $e->location,
                'plan_id' => $planId,
                'plan_name' => $planNames[$planId] ?? null,
                'balances' => $balances,
            ];
        });

        $filterBaseQ = Employee::query()
            ->select(['employees.id', 'employees.location', 'employees.department_id'])
            ->join('leave_plan_employees as lpe2', 'lpe2.employee_id', '=', 'employees.id')
            ->whereIn('lpe2.leave_plan_id', $planIds)
            ->whereRaw('(employees.status IS NULL OR LOWER(employees.status) NOT IN (?, ?, ?, ?))', ['inactive', 'resigned', 'terminated', 'exited'])
            ->with(['department:id,name']);
        $filterPool = $filterBaseQ->get();

        $departments = $filterPool
            ->pluck('department.name')->filter()->unique()->sort()->values()->all();
        $locations = $filterPool
            ->pluck('location')->filter()->unique()->sort()->values()->all();

        return response()->json([
            'data' => [
                'columns' => $columns,
                'employees' => $rows,
                'filters' => [
                    'departments' => $departments,
                    'locations' => $locations,
                ],
            ],
        ]);
    }

    private function findPlanOrFail($user, int $id): LeavePlans
    {
        $q = LeavePlans::query();
        $this->applyScope($q, $user, null);
        $plan = $q->where('id', $id)->first();
        if (!$plan) abort(404, 'Leave plan not found.');
        return $plan;
    }

    private function isPlanSetupComplete(int $planId): bool
    {
        $stat = DB::table('leave_plan_leave_types')
            ->where('leave_plan_id', $planId)
            ->selectRaw('COUNT(*) as total, SUM(CASE WHEN is_setup THEN 1 ELSE 0 END) as configured')
            ->first();
        $total = (int) ($stat->total ?? 0);
        $configured = (int) ($stat->configured ?? 0);
        return $total > 0 && $configured === $total;
    }

    private function assertPlanEditable(LeavePlans $plan): void
    {
        if (!$plan->unlocked && $this->isPlanSetupComplete($plan->id)) {
            abort(422, 'This leave plan is fully set up and locked. To change it, clone it into a new plan and edit that.');
        }
    }

    private function clearDefaultForBranch(?int $clientId, ?int $branchId, ?int $exceptId = null): void
    {
        $q = LeavePlans::query()->where('is_default', true);
        $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId);
        $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId);
        if ($exceptId !== null) $q->where('id', '!=', $exceptId);
        $q->update(['is_default' => false]);
    }

    private function assertUniquePlanName(?int $clientId, ?int $branchId, string $name, ?int $exceptId): void
    {
        $exists = LeavePlans::query()
            ->where(fn ($q) => $clientId === null ? $q->whereNull('client_id') : $q->where('client_id', $clientId))
            ->where(fn ($q) => $branchId === null ? $q->whereNull('branch_id') : $q->where('branch_id', $branchId))
            ->when($exceptId, fn ($q) => $q->where('id', '!=', $exceptId))
            ->whereRaw('LOWER(plan_name) = LOWER(?)', [trim($name)])
            ->exists();
        if ($exists) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'plan_name' => ['A leave plan with this name already exists.'],
            ]);
        }
    }

    private function resolveOwnership($user, Request $request): array
    {
        if ($user->user_type === 'super_admin') {
            $clientId = $request->integer('client_id') ?: null;
            $branchId = $request->integer('branch_id') ?: null;
            return [$clientId, $branchId];
        }
        $clientId = $user->client_id;
        $branchId = $user->branch_id;
        return [$clientId, $branchId];
    }

    private function applyScope($q, $user, ?int $branchFilter = null): void
    {
        if (!$user) return;
        if ($user->user_type === 'super_admin') {
            if ($branchFilter !== null) $q->where('branch_id', $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['client_admin', 'client_user'], true)) {
            $clientId = $user->client_id;
            $q->where(function ($w) use ($clientId) {
                $w->whereNull('client_id')->orWhere('client_id', $clientId);
            });
            $this->applySwitcherBranchFilter($q, $user, $branchFilter);
            return;
        }

        if (in_array($user->user_type, ['branch_user', 'employee'], true)) {
            $clientId = $user->client_id;
            $branchId = $user->branch_id;

            $q->where(function ($w) use ($clientId, $branchId) {
                $w->whereNull('client_id')
                  ->orWhere(function ($ww) use ($clientId, $branchId) {
                      $ww->where('client_id', $clientId)
                         ->where(function ($wb) use ($branchId) {
                             $wb->whereNull('branch_id')
                                ->orWhere('branch_id', $branchId);
                         });
                  });
            });
            return;
        }

        $q->whereRaw('1 = 0');
    }

    private function applySwitcherBranchFilter($q, $user, ?int $branchFilter): void
    {
        if ($branchFilter === null) return;
        $belongsToClient = Branch::where('id', $branchFilter)
            ->where('client_id', $user->client_id)
            ->exists();
        if (!$belongsToClient) return;
        $q->where('branch_id', $branchFilter);
    }
}
