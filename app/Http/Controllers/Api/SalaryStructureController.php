<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\SalaryStructure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Versioned salary-structure management (Rule 5 + Rule 19).
 *
 * Creating a structure for an employee who already has an active one does NOT
 * overwrite it — the old row is superseded and a new version is inserted with
 * its own effective_from, preserving history for past payslips.
 *
 *   GET    /salary-structures?employee_id=   list (latest first)
 *   POST   /salary-structures                create / revise
 *   GET    /salary-structures/{id}           show
 *   DELETE /salary-structures/{id}           soft delete (draft only)
 */
class SalaryStructureController extends Controller
{
    /**
     * Salary roster — every payable employee with their CURRENT structure
     * status. Drives the "Salary Setup" tab so HR can see who has a salary
     * configured (and who falls back to annual_salary / nothing) before running
     * payroll. Tenant + branch scoped.
     */
    public function employees(Request $request)
    {
        $user = $request->user();
        $branch = $request->integer('branch_id') ?: ($user && $user->user_type === 'branch_user' ? $user->branch_id : null);

        $eq = Employee::query()
            ->whereNotIn('status', ['Inactive', 'Resigned', 'Terminated'])
            ->orderBy('first_name');
        if ($user && $user->client_id) $eq->where('client_id', $user->client_id);
        if ($branch) $eq->where('branch_id', $branch);

        $employees = $eq->get();
        $ids = $employees->pluck('id')->all();

        // Active structure per employee (one query).
        $active = SalaryStructure::whereIn('employee_id', $ids)
            ->where('status', 'active')
            ->get()->keyBy('employee_id');

        // Master name caches.
        $deptNames = $this->masterNames('master_departments');
        $desigNames = $this->masterNames('master_designations');

        $rows = $employees->map(function (Employee $e) use ($active, $deptNames, $desigNames) {
            $s = $active->get($e->id);
            return [
                'employee_id'   => $e->id,
                'emp_code'      => $e->emp_code,
                'name'          => trim(($e->first_name ?? '') . ' ' . ($e->last_name ?? '')) ?: $e->display_name,
                'department'    => $deptNames[$e->department_id] ?? null,
                'designation'   => $desigNames[$e->designation_id] ?? null,
                'pf_eligible'   => (bool) $e->pf_eligible,
                'annual_salary' => $e->annual_salary !== null ? (float) $e->annual_salary : null,
                'has_structure' => (bool) $s,
                'structure_id'  => $s?->id,
                'monthly_gross' => $s ? (float) $s->monthly_gross : ($e->annual_salary ? round((float) $e->annual_salary / 12, 2) : 0),
                'version'       => $s?->version,
                'effective_from'=> optional($s?->effective_from)->toDateString(),
                'source'        => $s ? 'structure' : ($e->annual_salary ? 'annual_salary' : 'none'),
            ];
        })->values();

        return response()->json(['data' => $rows]);
    }

    private function masterNames(string $table): array
    {
        if (!\Illuminate\Support\Facades\Schema::hasTable($table) || !\Illuminate\Support\Facades\Schema::hasColumn($table, 'name')) {
            return [];
        }
        return DB::table($table)->pluck('name', 'id')->all();
    }

    public function index(Request $request)
    {
        $user = $request->user();
        $q = SalaryStructure::query()->orderByDesc('id');

        if ($user && $user->client_id) {
            $q->where('client_id', $user->client_id);
        }
        if ($branch = $request->integer('branch_id')) {
            $q->where('branch_id', $branch);
        }
        if ($employeeId = $request->integer('employee_id')) {
            $q->where('employee_id', $employeeId);
        }
        if ($request->boolean('active_only')) {
            $q->where('status', 'active');
        }

        return response()->json(['data' => $q->get()->map(fn ($s) => $this->serialize($s))]);
    }

    public function show(Request $request, int $id)
    {
        $s = $this->findScoped($request, $id);
        abort_unless($s, 404, 'Salary structure not found.');
        return response()->json(['data' => $this->serialize($s)]);
    }

    public function store(Request $request)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to manage salary structures.'], 403);
        }
        $data = $request->validate([
            'employee_id'     => ['required', 'integer'],
            'effective_from'  => ['required', 'date'],
            'earnings'        => ['required', 'array', 'min:1'],
            'earnings.*.code'   => ['required', 'string', 'max:40'],
            'earnings.*.label'  => ['required', 'string', 'max:120'],
            'earnings.*.amount' => ['required', 'numeric', 'min:0', 'max:99999999.99'],
            'deductions'      => ['nullable', 'array'],
            'deductions.*.code'   => ['required_with:deductions', 'string', 'max:40'],
            'deductions.*.label'  => ['required_with:deductions', 'string', 'max:120'],
            'deductions.*.amount' => ['required_with:deductions', 'numeric', 'min:0', 'max:99999999.99'],
            'pf_applicable'   => ['boolean'],
            'esi_applicable'  => ['boolean'],
            'pt_applicable'   => ['boolean'],
            'revision_note'   => ['nullable', 'string', 'max:500'],
        ]);

        $user = $request->user();
        // Tenant-safe: derive client/branch from the employee, never the body.
        $employee = Employee::find($data['employee_id']);
        abort_unless($employee, 422, 'Employee not found.');
        if ($user && $user->client_id && (int) $employee->client_id !== (int) $user->client_id) {
            abort(403, 'Employee belongs to another tenant.');
        }

        $monthlyGross = collect($data['earnings'])->sum(fn ($c) => (float) $c['amount']);
        $monthlyDeductions = collect($data['deductions'] ?? [])->sum(fn ($c) => (float) $c['amount']);

        $structure = DB::transaction(function () use ($data, $employee, $user, $monthlyGross, $monthlyDeductions) {
            // Supersede the current active structure (Rule 19 — never overwrite).
            $prev = SalaryStructure::where('employee_id', $employee->id)
                ->where('status', 'active')
                ->orderByDesc('version')
                ->first();
            $version = $prev ? $prev->version + 1 : 1;
            if ($prev) {
                $prev->update(['status' => 'superseded']);
            }

            return SalaryStructure::create([
                'client_id'       => $employee->client_id,
                'branch_id'       => $employee->branch_id,
                'employee_id'     => $employee->id,
                'version'         => $version,
                'effective_from'  => $data['effective_from'],
                'status'          => 'active',
                'earnings'        => array_values($data['earnings']),
                'deductions'      => array_values($data['deductions'] ?? []),
                'monthly_gross'   => round($monthlyGross, 2),
                'monthly_ctc'     => round($monthlyGross, 2),
                'pf_applicable'   => $data['pf_applicable'] ?? (bool) $employee->pf_eligible,
                'esi_applicable'  => $data['esi_applicable'] ?? ($monthlyGross <= 21000),
                'pt_applicable'   => $data['pt_applicable'] ?? true,
                'approval_status' => 'approved',
                'approved_by'     => $user?->id,
                'approved_at'     => now(),
                'revision_note'   => $data['revision_note'] ?? null,
                'created_by'      => $user?->id,
            ]);
        });

        // Propagate the new salary to any non-locked payroll already generated
        // for this employee, so the payroll table reflects it everywhere
        // without a manual re-run (approved/paid runs stay frozen).
        $recomputed = app(\App\Services\PayrollService::class)->recomputeEmployeePayslips($employee->id);

        return response()->json([
            'message' => 'Salary structure saved (version ' . $structure->version . ').'
                . ($recomputed > 0 ? " {$recomputed} draft payslip(s) updated." : ''),
            'data'    => $this->serialize($structure),
        ], 201);
    }

    public function destroy(Request $request, int $id)
    {
        if (!$this->canManage($request)) {
            return response()->json(['message' => 'You are not allowed to manage salary structures.'], 403);
        }
        $s = $this->findScoped($request, $id);
        abort_unless($s, 404, 'Salary structure not found.');
        if ($s->status === 'active') {
            return response()->json(['message' => 'Cannot delete the active structure — revise it instead.'], 422);
        }
        $s->delete();
        return response()->json(['message' => 'Salary structure removed.']);
    }

    /** Only payroll managers (not plain employees) may create/revise/delete structures. */
    private function canManage(Request $request): bool
    {
        $user = $request->user();
        if (!$user) return false;
        if (in_array($user->user_type, ['super_admin', 'client_admin'], true)) return true;
        if ($user->user_type === 'employee') return false;
        $perm = $user->permissions['hr.payroll'] ?? null;
        if (is_array($perm) && (($perm['can_edit'] ?? false) || ($perm['can_approve'] ?? false))) return true;
        return $user->user_type === 'branch_user';
    }

    private function findScoped(Request $request, int $id): ?SalaryStructure
    {
        $user = $request->user();
        $s = SalaryStructure::find($id);
        if (!$s) return null;
        if ($user && $user->client_id && $s->client_id && (int) $s->client_id !== (int) $user->client_id) {
            return null;
        }
        return $s;
    }

    private function serialize(SalaryStructure $s): array
    {
        return [
            'id'              => $s->id,
            'employee_id'     => $s->employee_id,
            'version'         => $s->version,
            'effective_from'  => optional($s->effective_from)->toDateString(),
            'status'          => $s->status,
            'earnings'        => $s->earnings ?: [],
            'deductions'      => $s->deductions ?: [],
            'monthly_gross'   => (float) $s->monthly_gross,
            'monthly_ctc'     => (float) $s->monthly_ctc,
            'pf_applicable'   => (bool) $s->pf_applicable,
            'esi_applicable'  => (bool) $s->esi_applicable,
            'pt_applicable'   => (bool) $s->pt_applicable,
            'revision_note'   => $s->revision_note,
            'created_at'      => optional($s->created_at)->toIso8601String(),
        ];
    }
}
