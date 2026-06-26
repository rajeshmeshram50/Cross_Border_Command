<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Models\Employee;
use App\Models\LeaveRequest;
use App\Models\Masters\LeavePlanLeaveType;
use App\Models\Masters\LeavePlans;
use App\Models\Masters\LeaveTypes;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;


class LeavePlanController extends Controller
{
    private const VALID_TYPE_CATEGORIES = ['Regular', 'Incident Based Leave', 'Unpaid Leave', 'Compoff'];

    // ─────────────────────────────────────────────────────────────────────
    // Plan-level CRUD
    // ─────────────────────────────────────────────────────────────────────

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $branchFilter = $request->integer('branch_id') ?: null;

        $q = LeavePlans::query()
            ->with(['client:id,org_name', 'branch:id,name'])
            ->withCount(['employees', 'leaveTypes']);
        $this->applyScope($q, $user, $branchFilter);

        $rows = $q->orderByDesc('is_default')->orderBy('plan_name')->get();
        return response()->json(['data' => $rows]);
    }

    public function show(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $plan = $this->findPlanOrFail($user, $id);
        $plan->load([
            'client:id,org_name',
            'branch:id,name',
            'leaveTypes' => function ($q) {
                $q->orderBy('master_leave_types.name');
            },
            'employees:id,first_name,last_name,display_name,emp_code,department_id,designation_id,reporting_manager_id,location',
            'employees.department:id,name',
            'employees.designation:id,name',
            'employees.reportingManager:id,first_name,last_name,display_name',
        ]);

        return response()->json(['data' => $plan]);
    }

    public function store(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $data = $request->validate([
            'plan_name' => ['required', 'string', 'max:255'],
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

        $data = $request->validate([
            'plan_name' => ['sometimes', 'required', 'string', 'max:255'],
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

        // LV-25: refuse to delete a plan that still has in-flight requests —
        // deleting would strand them with a dangling leave_plan_id and unassign
        // the affected employees mid-cycle.
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
            $copy->created_by = $user->id;
            $copy->save();

            // Copy assigned types + their config (but no employees)
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

    // ─────────────────────────────────────────────────────────────────────
    // Leave-type assignment within a plan
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Replace-or-append the set of leave types attached to a plan. The
     * payload is a flat array of leave_type ids; existing rows whose id
     * is in the payload are kept (config preserved), new ids are inserted
     * with default empty config, and ids removed from the payload are
     * detached. This matches the "Assign Leave Types" multi-select modal.
     */
    public function assignTypes(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $plan = $this->findPlanOrFail($user, $id);

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

        LeavePlanLeaveType::where('leave_plan_id', $plan->id)
            ->where('leave_type_id', $typeId)
            ->delete();

        return response()->json(['data' => ['removed' => true]]);
    }

    /**
     * Persist the 6-tab Setup popup payload for a single (plan, type) pair.
     * The frontend posts the entire LeaveTypeConfig blob as `config` plus
     * the two summary strings the Configuration table renders.
     */
    public function saveTypeConfig(Request $request, int $id, int $typeId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $plan = $this->findPlanOrFail($user, $id);

        $data = $request->validate([
            'config' => ['required', 'array'],
            'quota_summary' => ['nullable', 'string', 'max:255'],
            'eoy_summary' => ['nullable', 'string', 'max:255'],
        ]);

        $row = LeavePlanLeaveType::where('leave_plan_id', $plan->id)
            ->where('leave_type_id', $typeId)
            ->first();
        if (!$row) {
            abort(404, 'Leave type is not assigned to this plan.');
        }

        $row->config_json = $data['config'];
        $row->quota_summary = $data['quota_summary'] ?? $row->quota_summary;
        $row->eoy_summary = $data['eoy_summary'] ?? $row->eoy_summary;
        $row->is_setup = true;
        $row->save();

        return response()->json(['data' => $row]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Employee assignment
    // ─────────────────────────────────────────────────────────────────────

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

        // Verify all employees belong to the plan's tenant. Client_id is
        // required to match; branch_id is permissive — an employee whose
        // own branch_id is NULL (common when HR didn't set it on intake)
        // can still be assigned to a branch-scoped plan in the same
        // client. This matches the relaxed scoping the master pages use
        // and avoids "silent assign failed" UX when the form doesn't
        // expose branch_id during onboarding.
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
            // Each employee belongs to exactly one plan — upsert moves them
            // off any prior plan automatically (unique on employee_id).
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

    /**
     * Per-employee balance summary — used by the Leave tab on the Employee
     * Profile to render donut cards (one per assigned type) plus a simple
     * balance ledger for the Balance History modal. Returns:
     *   {
     *     employee: { id, name, plan_id, plan_name },
     *     types: [{ leave_type_id, name, short_code, category,
     *                 quota, used, available, unlimited,
     *                 transactions: [{ date, change, balance, reason }] }]
     *   }
     */
    public function employeeBalances(Request $request, int $employeeId)
    {
        $user = $request->user();
        if (!$user) abort(401);

        $employee = Employee::with(['department:id,name'])->find($employeeId);
        if (!$employee) abort(404, 'Employee not found.');

        // Tenant guard — a user may only read balances for employees in their own
        // client (super_admin sees any). Without this, any authenticated user can
        // enumerate employeeId and read another tenant's leave ledger (IDOR).
        // Null client_id is treated as a mismatch so orphan rows aren't exposed.
        if ($user->user_type !== 'super_admin'
            && (int) $employee->client_id !== (int) $user->client_id) {
            abort(403, 'You do not have access to this employee.');
        }

        // Resolve the employee's current leave plan. Prefer the explicit
        // leave_plan_employees pivot; fall back to the plan stamped on the
        // employee record (set via the onboarding wizard / employee form) so an
        // employee assigned that way still resolves a plan + balances.
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

        // Pull this employee's approved+pending leave requests in one pass —
        // approved rows contribute to `used`, every row appears in the ledger.
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
            $quota = (float) ($accrual['yearlyQuota'] ?? 0); // LV-05: keep fractional (½-day) quotas; enforcement uses float too
            $reqs = $requestsByType[$row->leave_type_id] ?? collect();

            // Build a simple ledger: start-of-year accrual, then each
            // approved leave as a deduction. Pending entries surface but
            // don't affect the running balance.
            $transactions = [];
            $balance = 0;
            if (!$unlimited && $quota > 0) {
                $accrualDate = $planRow->from_month && $planRow->calendar_year
                    ? sprintf('01 %s %s', substr($planRow->from_month, 0, 3), $planRow->calendar_year)
                    : 'Start of year';
                $transactions[] = [
                    'date' => $accrualDate,
                    'change' => "+ {$quota}",
                    'balance' => $quota,
                    'reason' => 'Leave Accrual allocated at the start of year.',
                    'kind' => 'accrual',
                ];
                $balance = $quota;
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
                        'balance' => $balance,
                        'reason' => 'Leave taken (' . optional($r->from_date)->format('d M') . ' – ' . optional($r->to_date)->format('d M') . ')',
                        'kind' => 'approved',
                    ];
                }
            }

            return [
                'leave_type_id' => (int) $row->leave_type_id,
                'name' => $row->type_name,
                'short_code' => $row->short_code,
                'category' => $row->category,
                'paid_unpaid' => $row->paid_unpaid,
                'quota' => $quota,
                'used' => $used,
                'available' => $unlimited ? null : max(0, $quota - $used),
                'unlimited' => $unlimited,
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

    // ─────────────────────────────────────────────────────────────────────
    // Leave Balances — aggregated read for the Leave Balances tab.
    // Returns a dynamic column set (every leave type that any plan in the
    // current scope has assigned) plus per-employee balances. We don't
    // track actual leave usage yet, so `used` always returns 0; once a
    // leave_requests table exists this is the place to join it in.
    // ─────────────────────────────────────────────────────────────────────
    public function leaveBalances(Request $request)
    {
        $user = $request->user();
        if (!$user) abort(401);
        $branchFilter = $request->integer('branch_id') ?: null;

        // 1) Plans visible to this user (scope-aware) and the leave types
        //    they've assigned. We use the assigned set (not the whole
        //    catalog) so columns mirror what HR has actually configured.
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

        // 2) Build the column list — distinct leave_type_id ordered by name.
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

        // 3) Per-(plan, type) quota lookup keyed for O(1) rendering below.
        //    `unlimited` short-circuits to a sentinel; everything else
        //    falls back to 0 if the Setup popup hasn't been touched.
        $quotaByPlanType = [];
        foreach ($planTypeRows as $row) {
            $cfg = $row->config_json ? json_decode($row->config_json, true) : null;
            $accrual = $cfg['accrual'] ?? null;
            $unlimited = (bool) ($accrual['unlimited'] ?? false);
            $quota = (float) ($accrual['yearlyQuota'] ?? 0); // LV-05: keep fractional (½-day) quotas; enforcement uses float too
            $quotaByPlanType[$row->leave_plan_id][$row->leave_type_id] = [
                'quota' => $quota,
                'unlimited' => $unlimited,
            ];
        }

        // 4) Employees in scope — only those assigned to one of the
        //    in-scope plans. Apply optional department / location filters
        //    so the frontend dropdowns translate directly to SQL.
        $empQ = Employee::query()
            ->select([
                'employees.id', 'employees.emp_code', 'employees.first_name', 'employees.last_name',
                'employees.display_name', 'employees.location', 'employees.department_id',
                'employees.designation_id', 'employees.client_id', 'employees.branch_id',
                'lpe.leave_plan_id',
            ])
            ->join('leave_plan_employees as lpe', 'lpe.employee_id', '=', 'employees.id')
            ->whereIn('lpe.leave_plan_id', $planIds)
            // Drop employees who have left the company so the balance grid only
            // lists people who still accrue/consume leave. Soft-deleted rows are
            // already excluded by Eloquent's default scope; this additionally
            // hides exit/terminal statuses that keep their pivot row but should
            // no longer show up (HRMS-BUG-078). Probation / Notice Period /
            // On Leave staff are still active and remain visible.
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

        $employees = $empQ->orderBy('employees.first_name')->get();

        // Plan name lookup so each row can show which plan an employee is on.
        $planNames = LeavePlans::whereIn('id', $planIds)->pluck('plan_name', 'id')->all();

        // Used-days lookup: SUM(days) of Approved leave_requests per
        // (employee, leave_type). Single SQL pass; cell render below does
        // O(1) hash lookup. Period-aware proration is a future task — for
        // now we sum across all approved history.
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
                    // Plan doesn't include this type — render as N/A on FE.
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
                $used = (float) ($empUsed[$col['leave_type_id']] ?? 0);
                $balances[] = [
                    'leave_type_id' => $col['leave_type_id'],
                    'applies' => true,
                    'unlimited' => $entry['unlimited'],
                    'quota' => $entry['quota'],
                    'used' => $used,
                    'available' => $entry['unlimited'] ? null : max(0, $entry['quota'] - $used),
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

        // Distinct values for the filter dropdowns — limited to the in-scope
        // employees so the dropdowns don't expose other branches.
        $departments = $employees
            ->pluck('department.name')->filter()->unique()->sort()->values()->all();
        $locations = $employees
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

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    private function findPlanOrFail($user, int $id): LeavePlans
    {
        $q = LeavePlans::query();
        $this->applyScope($q, $user, null);
        $plan = $q->where('id', $id)->first();
        if (!$plan) abort(404, 'Leave plan not found.');
        return $plan;
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

    /**
     * Pick the (client_id, branch_id) tuple a new plan will be stamped with.
     * Mirrors MasterController::resolveOwnership: super_admin may pass
     * explicit ids; everyone else is locked to their own tenant.
     */
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

    /**
     * Tenant scope copied from MasterController. Kept inline here so this
     * controller doesn't depend on MasterController's private API.
     */
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

            // Every branch is an isolated peer — globals + client-level rows + own branch only.
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
