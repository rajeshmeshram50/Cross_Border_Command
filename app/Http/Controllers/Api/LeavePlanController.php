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

        // Per-plan setup completeness. A plan is "configured" only when it has
        // at least one leave type AND every assigned type has FINISHED its setup
        // wizard (leave_plan_leave_types.is_setup = true — flipped only on the
        // wizard's final Save & Close, not on intermediate section saves). The
        // employee form's leave-plan dropdown uses this to hide unconfigured /
        // draft plans, so a plan mid-setup stays hidden until fully finalized.
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
            /* Letters, numbers, spaces and hyphens, and at least one LETTER. (#126)
             *
             * There was no format rule at all — "12345" and "@#$%" both saved
             * as plan names, and a plan is picked from a dropdown by people who
             * have to recognise it. Digits stay legal inside a name so
             * "Leave Plan 2026" works; the lookahead only refuses a name made
             * entirely of digits, spaces, hyphens or symbols. Same rule as the
             * holiday group name (#58). */
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
            // Names the rule that failed. Laravel's default ("format is
            // invalid") leaves the user guessing which character to drop. (#126)
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
        // Locked once fully set up — edit by cloning. (make-default has its own
        // endpoint and stays allowed.)
        $this->assertPlanEditable($plan);

        $data = $request->validate([
            // Same rule as store() — a form that writes the same column through
            // a second door needs the same lock on it. (#126)
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
            // Born editable: a clone copies the source's full config, so without
            // this override it would be "setup-complete" and locked the instant
            // it is created. `unlocked` keeps it an editable draft so quotas can
            // be changed freely (the whole point of cloning).
            $copy->unlocked = true;
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
        // Allowed while the plan is still incomplete (incl. the save that
        // completes the last type); blocked once every type is configured.
        $this->assertPlanEditable($plan);

        $data = $request->validate([
            'config' => ['required', 'array'],
            // Bound the numeric quota fields so a negative or absurdly large
            // value can't be stored (bug #64). Quota/carry-forward are whole
            // days within a year, so 0..365 is the valid range. `nullable`
            // keeps the rules inert when a section that doesn't carry these
            // keys is saved, or when Unlimited quota is selected.
            'config.accrual.yearlyQuota'      => ['nullable', 'numeric', 'min:0', 'max:365'],
            // Attendance-accrual threshold — "for every X days worked in a
            // month". A month has at most 31 days, so 0..31 (bug #65). min:0
            // (not 1) so a non-attendance save carrying the default 0 still
            // passes; the frontend enforces >=1 when attendance mode is on.
            // Only bound the attendance threshold when attendance accrual is
            // actually selected — otherwise a stale value left over from that
            // mode blocks the save after the user switches to periodic (bug #73).
            'config.accrual.attendanceDaysWorked' => ['exclude_unless:config.accrual.mode,attendance', 'nullable', 'numeric', 'min:0', 'max:31'],
            // Extra leave (overdraft) — days beyond balance, 0..365 (bug #72).
            // min:0 keeps a disabled/default value valid; the frontend enforces
            // >=1 when the option is enabled.
            'config.accrual.employeeOverdraft.days' => ['nullable', 'numeric', 'min:0', 'max:365'],
            'config.yearEnd.carryForwardCap'  => ['nullable', 'numeric', 'min:0', 'max:365'],
            'quota_summary' => ['nullable', 'string', 'max:255'],
            'eoy_summary' => ['nullable', 'string', 'max:255'],
            // The setup wizard has N sections; each "Save & Next" posts here.
            // Only the last section (Save & Close) sends finalize=true. Absent
            // (legacy/direct API callers) it defaults to true so a single save
            // still completes the type. See is_setup handling below.
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

        // Persist the FULL config from the raw input, not $data['config'] —
        // validated() prunes the array down to only the keys that have nested
        // rules (accrual/yearEnd), which would silently drop the leaveApp,
        // approval, probation and noticePeriod sections. Bounds were already
        // enforced by the validate() call above.
        $row->config_json = $request->input('config');
        $row->quota_summary = $data['quota_summary'] ?? $row->quota_summary;
        $row->eoy_summary = $data['eoy_summary'] ?? $row->eoy_summary;
        // Mark the type "set up" ONLY when the wizard's final section is saved.
        // Intermediate section saves persist config but must not flip is_setup —
        // otherwise a single-type plan would count as complete after section 1
        // and assertPlanEditable() would 422-reject sections 2..N even though
        // the data saved (bug #63). Never downgrade an already-set-up type, so
        // re-editing a cloned plan's sections doesn't transiently un-complete it.
        if ($request->boolean('finalize', true)) {
            $row->is_setup = true;
        }
        $row->save();

        // Once the save that just completed leaves the plan fully set up, a
        // cloned plan's editable-draft override (`unlocked`) has done its job —
        // clear it so the plan locks like any other completed plan. Without
        // this a clone stays `unlocked = true` forever and its Setup buttons
        // never turn into the "Locked" indicator (bug #61).
        if ($plan->unlocked && $this->isPlanSetupComplete($plan->id)) {
            $plan->unlocked = false;
            $plan->save();
        }

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
            // "Extra Leave" overdraft from the plan setup — how many days the
            // employee may avail beyond their accrued balance. Surfaced as a
            // breakdown alongside the base quota (yearly + extra = total
            // allowance); it does NOT inflate the accrued quota/available here.
            $overdraft = $accrual['employeeOverdraft'] ?? null;
            $extra = (!$unlimited && ($overdraft['enabled'] ?? false))
                ? (float) ($overdraft['days'] ?? 0)
                : 0.0;
            $reqs = $requestsByType[$row->leave_type_id] ?? collect();

            // Build the ledger: the FULL annual entitlement is granted upfront
            // at the plan-year start (no monthly vesting) — a single opening
            // grant for the quota, plus an optional extra-allowance grant — then
            // each approved leave as a deduction. Pending entries surface in the
            // request list but don't affect the running balance.
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
            // Full entitlement (quota + extra) is available from day one; only
            // approved leave reduces it.
            $available = $unlimited ? null : round(max(0, ($quota + $extra) - $used), 2);

            return [
                'leave_type_id' => (int) $row->leave_type_id,
                'name' => $row->type_name,
                'short_code' => $row->short_code,
                'category' => $row->category,
                'paid_unpaid' => $row->paid_unpaid,
                'quota' => $quota,
                // Full quota is available upfront, so "accrued" == the quota.
                'accrued' => $unlimited ? null : round($quota, 2),
                'extra' => $extra,
                'used' => $used,
                'available' => $available,
                'unlimited' => $unlimited,
                // Whether this leave type permits half-day requests (drives the
                // Custom / half-day option in the Request Leave modal).
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

    /**
     * Accrual events that have occurred up to `asOf` for a leave type, honouring
     * the configured accrual mode/frequency. Each event is ['date' => Carbon,
     * 'amount' => float]. Periodic accrual produces one event per elapsed period
     * (e.g. 1 day on the 1st of every month) so the balance grows over the year
     * instead of dropping the whole yearly quota in on day one. "Immediate" mode
     * (and attendance-based accrual, which isn't time-derivable here) hands over
     * the full quota up front in a single event. The summed amount never exceeds
     * the yearly quota.
     *
     * Plan-year start = the 1st of the plan's `from_month` in its `calendar_year`
     * (sensible fallbacks when unset). Before the year starts → no events; after
     * it ends → the full quota.
     */
    /** Resolve the plan-year start = the 1st of the plan's `from_month` in its
     *  `calendar_year` (Jan / current year fallbacks when unset). */
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

        // Resolve the plan-year start.
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

        // Non-periodic accrual: the full quota is available from the year start.
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
            // Trim the final event so rounding can't push the total over quota.
            $amount = min($rate, $quota - $running);
            if ($amount <= 0) break;
            $events[] = ['date' => $d->copy(), 'amount' => round($amount, 2)];
            $running += $amount;
        }
        return $events;
    }

    /** Total days accrued so far (sum of {@see accrualEvents}), capped at quota. */
    public static function accruedToDate(array $accrual, ?string $fromMonth, $calendarYear, ?\Illuminate\Support\Carbon $asOf = null): float
    {
        $sum = 0.0;
        foreach (self::accrualEvents($accrual, $fromMonth, $calendarYear, $asOf) as $e) {
            $sum += $e['amount'];
        }
        return round($sum, 2);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Leave Balances — aggregated read for the Leave Balances tab.
    // Returns a dynamic column set (every leave type that any plan in the
    // current scope has assigned) plus per-employee balances.
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

        // Plan-year meta (from_month / calendar_year) per plan so accrual can be
        // time-phased the same way the employee profile does.
        $planMeta = empty($planIds) ? collect() : LeavePlans::whereIn('id', $planIds)
            ->get(['id', 'from_month', 'calendar_year'])
            ->keyBy('id');

        // 3) Per-(plan, type) quota lookup keyed for O(1) rendering below.
        //    `unlimited` short-circuits to a sentinel; everything else
        //    falls back to 0 if the Setup popup hasn't been touched. `accrued`
        //    is the days vested so far this plan year (drives `available`).
        $quotaByPlanType = [];
        foreach ($planTypeRows as $row) {
            $cfg = $row->config_json ? json_decode($row->config_json, true) : null;
            $accrual = $cfg['accrual'] ?? null;
            $unlimited = (bool) ($accrual['unlimited'] ?? false);
            $quota = (float) ($accrual['yearlyQuota'] ?? 0); // LV-05: keep fractional (½-day) quotas; enforcement uses float too
            // Extra/overdraft allowance — added to the entitlement (available
            // upfront alongside the quota).
            $overdraft = $accrual['employeeOverdraft'] ?? null;
            $extra = (!$unlimited && ($overdraft['enabled'] ?? false))
                ? (float) ($overdraft['days'] ?? 0)
                : 0.0;
            // Full quota is available upfront (no monthly vesting).
            $quotaByPlanType[$row->leave_plan_id][$row->leave_type_id] = [
                'quota' => $quota,
                'accrued' => $quota,
                'extra' => $extra,
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

        // Order by Employee ID so the balance grid follows a stable,
        // predictable sequence rather than name/insert order (bug #10).
        $employees = $empQ->orderBy('employees.id')->get();

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
                $used = round((float) ($empUsed[$col['leave_type_id']] ?? 0), 2);
                $balances[] = [
                    'leave_type_id' => $col['leave_type_id'],
                    'applies' => true,
                    'unlimited' => $entry['unlimited'],
                    'quota' => $entry['quota'],
                    'used' => $used,
                    // Full entitlement (quota + extra) is available upfront;
                    // only approved leave reduces it.
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

        /* Distinct values for the filter dropdowns — from every in-scope
         * employee, NOT from the filtered result. (#127)
         *
         * These were plucked off $employees, which already has the caller's own
         * location/search/department filters applied. So picking "Pune" made
         * the response describe a world containing only Pune, the Location
         * dropdown rebuilt itself from that, and the user was left with the one
         * option they had already chosen and no way back to the others.
         *
         * A filter list has to describe what is AVAILABLE, not what is
         * currently shown — otherwise choosing a value destroys the means of
         * changing it. Rebuilt from the same tenant/plan scope with the user's
         * filters left off, so the dropdowns still never expose another
         * branch's data. Two thin id/location/department reads, no eager loads.
         *
         * Kept as one query with a join rather than reusing $empQ — cloning
         * that after the filters are applied would carry them along, which is
         * the bug itself. */
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

    /**
     * A plan is "setup-complete" once it has at least one assigned leave type
     * AND every assigned type has FINISHED its setup wizard (is_setup = true,
     * flipped only on the wizard's final Save & Close). Same definition as the
     * `setup_complete` flag returned by index(). Keying off is_setup (not
     * config_json) is what stops the lock from tripping mid-wizard: a section's
     * "Save & Next" persists config_json but leaves is_setup false, so the plan
     * isn't considered complete until the user finishes (bug #63).
     */
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

    /**
     * Block mutations to a plan's SETUP once it is fully configured. A
     * completed plan is view-only — changes are made by cloning it into a new
     * plan. (Assigning/removing employees, cloning and make-default stay
     * allowed; this only guards the leave-policy setup itself.)
     *
     * The `unlocked` override exempts cloned plans: a clone is born fully
     * configured, so without this it would be locked the instant it is created
     * and could never be edited. A clone stays `unlocked = true` (editable)
     * only until the next config save leaves it fully set up — at that point
     * saveTypeConfig() clears the flag so the plan locks like any other
     * completed plan (see bug #61).
     */
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
