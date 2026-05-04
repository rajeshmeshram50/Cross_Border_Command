<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\EmployeeExit;
use App\Models\Module;
use App\Models\Permission;
use Illuminate\Http\Request;

/**
 * Exit Process — Stage 1 (Exit Initiation & Approval) backend.
 *
 *   GET /api/employees/{employee}/exit          show
 *   PUT /api/employees/{employee}/exit          upsert
 *
 * Subsequent stages (asset return, clearance, FnF, etc.) will layer on
 * additional endpoints; this controller's `show` always returns one row
 * (created lazily on first PUT), so the SPA can render the form
 * regardless of whether the admin has saved anything yet.
 */
class ExitController extends Controller
{
    public function show(Request $request, Employee $employee)
    {
        $this->guardSameTenant($request, $employee);
        $row = EmployeeExit::with(['manager:id,first_name,middle_name,last_name,display_name,emp_code'])
            ->where('employee_id', $employee->id)
            ->first();
        return response()->json($this->format($row, $employee));
    }

    public function upsert(Request $request, Employee $employee)
    {
        $this->guardSameTenant($request, $employee);
        $data = $this->validatePayload($request);

        $row = EmployeeExit::firstOrNew(['employee_id' => $employee->id]);
        $row->fill($data);
        $row->employee_id          = $employee->id;
        $row->client_id            = $employee->client_id;
        $row->branch_id            = $employee->branch_id;
        $row->reporting_manager_id = $row->reporting_manager_id ?? $employee->reporting_manager_id;
        if (!$row->exists) $row->created_by = $request->user()?->id;
        $row->save();

        $row->load(['manager:id,first_name,middle_name,last_name,display_name,emp_code']);
        return response()->json([
            'message' => 'Saved',
            'exit'    => $this->format($row, $employee),
        ]);
    }

    /* ── Helpers ───────────────────────────────────────────────────── */

    private function validatePayload(Request $request): array
    {
        return $request->validate([
            'exit_type'             => 'nullable|in:Resignation,Termination,Retirement,End of Contract,Absconding,Other',
            'initiated_by'          => 'nullable|in:Employee,HR,Manager',
            'reason_for_exit'       => 'nullable|in:Better Opportunity,Personal Reasons,Higher Studies,Relocation,Health,Performance,Other',
            'other_reason'          => 'nullable|string|max:255',
            'notice_date'           => 'nullable|date',
            'last_working_day'      => 'nullable|date|after_or_equal:notice_date',
            'reporting_manager_id'  => 'nullable|integer|exists:employees,id',
            'comments'              => 'nullable|string|max:2000',
            'business_impact'       => 'nullable|in:Low,Medium,High,Critical',
            'replacement_required'  => 'nullable|in:Yes — Immediate,Yes — Within 30 days,Yes — Within 90 days,No',
        ]);
    }

    /** Same scope rule as EmployeeController. Super admins see everything;
     *  other roles must share the employee's client_id. */
    private function guardSameTenant(Request $request, Employee $employee): void
    {
        $user = $request->user();
        if (!$user) abort(401);
        $this->authorizeMaster($user);
        if ($user->isSuperAdmin()) return;
        if ($employee->client_id && $user->client_id !== $employee->client_id) {
            abort(403, 'Employee belongs to a different organization.');
        }
    }

    /** Cap the granular permission check to the 'master.employees' module —
     *  exit management piggy-backs on it since it's a per-employee action. */
    private function authorizeMaster($user): void
    {
        if ($user->isSuperAdmin()) return;
        $moduleId = Module::where('slug', 'master.employees')->value('id');
        if (!$moduleId) {
            if (in_array($user->user_type, ['client_admin', 'branch_user'], true)) return;
            abort(403, 'Employees module not enabled.');
        }
        $allowed = Permission::where('user_id', $user->id)
            ->where('module_id', $moduleId)
            ->where('can_edit', true)
            ->exists();
        if (!$allowed) abort(403, 'Missing can_edit on master.employees');
    }

    /**
     * Project a (possibly null) exit row into a stable JSON shape. Falls
     * back to the employee's current `reporting_manager_id` so the form
     * pre-fills even on first open.
     */
    private function format(?EmployeeExit $row, Employee $employee): array
    {
        $managerId = $row?->reporting_manager_id ?? $employee->reporting_manager_id;
        $manager   = $row?->manager;
        if (!$manager && $managerId) {
            // Include soft-deleted managers — the manager record might
            // have been disabled after the employee row was set up.
            $manager = Employee::withTrashed()
                ->select('id', 'first_name', 'middle_name', 'last_name', 'display_name', 'emp_code')
                ->find($managerId);
        }

        return [
            'id'                    => $row?->id,
            'employee_id'           => $employee->id,
            'exit_type'             => $row?->exit_type,
            'initiated_by'          => $row?->initiated_by,
            'reason_for_exit'       => $row?->reason_for_exit,
            'other_reason'          => $row?->other_reason,
            'notice_date'           => $row?->notice_date?->toDateString(),
            'last_working_day'      => $row?->last_working_day?->toDateString(),
            'reporting_manager_id'  => $managerId,
            'reporting_manager'     => $manager ? [
                'id'           => $manager->id,
                'display_name' => $manager->display_name
                                  ?: trim(($manager->first_name ?? '') . ' ' . ($manager->last_name ?? '')),
                'emp_code'     => $manager->emp_code,
            ] : null,
            'comments'              => $row?->comments,
            'business_impact'       => $row?->business_impact,
            'replacement_required'  => $row?->replacement_required,
            'updated_at'            => $row?->updated_at?->toIso8601String(),
        ];
    }
}
