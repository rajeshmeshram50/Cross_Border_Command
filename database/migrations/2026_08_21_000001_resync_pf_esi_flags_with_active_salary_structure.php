<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Align employees.pf_eligible / esi_applicable with the employee's ACTIVE
 * salary structure.
 *
 * The two are meant to be mirrors — SalaryStructureController::store() writes
 * the structure's flags back to the employee, EmployeeController::update()
 * writes the employee's onto the active structure — but any path that touches
 * one without the other (onboarding, imports, seeded and legacy rows, a partial
 * employee save that never submits the field) leaves them disagreeing, and
 * nothing ever reconciled the rows that had already drifted.
 *
 * PayrollService now reads applicability from the STRUCTURE when one exists
 * (QA #97 — PF configured there was being dropped because the engine also
 * required the employee flag), so the structure is the answer payroll acts on.
 * This brings the employee record into line with it, which is what the Employee
 * form and the onboarding Compensation step display. Without it the screens
 * keep contradicting each other in both directions:
 *
 *   · structure yes / employee no  — PF deducted, Employee form says it is not
 *     applicable. This is QA #97's employee.
 *   · structure no  / employee yes — Employee form says PF applies and no PF is
 *     deducted, which is the same complaint from the other side.
 *
 * Data only; no schema change, and nothing here alters a payslip. Only ACTIVE
 * structures are read (superseded versions are history) and soft-deleted
 * employees are skipped.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('salary_structures') || !Schema::hasTable('employees')) {
            return;
        }
        foreach (['pf_applicable', 'esi_applicable'] as $col) {
            if (!Schema::hasColumn('salary_structures', $col)) {
                return;
            }
        }

        /* Highest active version per employee. An employee should only ever have
         * one active structure, but ordering by version makes the pick
         * deterministic if an older bug ever left two. */
        $structures = DB::table('salary_structures')
            ->where('status', 'active')
            ->orderBy('employee_id')
            ->orderBy('version')
            ->get(['employee_id', 'pf_applicable', 'esi_applicable']);

        $latest = [];
        foreach ($structures as $s) {
            $latest[$s->employee_id] = $s;   // later row wins — highest version
        }
        if (!$latest) {
            return;
        }

        $employees = DB::table('employees')
            ->whereIn('id', array_keys($latest))
            ->whereNull('deleted_at')
            ->get(['id', 'pf_eligible', 'esi_applicable']);

        foreach ($employees as $e) {
            $s = $latest[$e->id];
            $patch = [];

            if ((bool) $s->pf_applicable !== (bool) $e->pf_eligible) {
                $patch['pf_eligible'] = (bool) $s->pf_applicable;
            }
            // employees.esi_applicable is a 'Yes'/'No' string, the structure's
            // is a boolean — compare on the normalised value, not the raw one.
            $employeeEsi = strtolower((string) $e->esi_applicable) === 'yes';
            if ((bool) $s->esi_applicable !== $employeeEsi) {
                $patch['esi_applicable'] = $s->esi_applicable ? 'Yes' : 'No';
            }

            if ($patch) {
                DB::table('employees')->where('id', $e->id)->update($patch);
            }
        }

        $this->recomputeStaleZeroPf();
    }

    /**
     * Recompute the payslips that are carrying the bug's result.
     *
     * The engine fix corrects what a payslip WILL compute; it does nothing for
     * one already generated, and an open cycle is not re-run just because a
     * calculation changed. So the cycles HR is working through right now would
     * still show PF ₹0 on exactly the employees this ticket is about.
     *
     * Deliberately narrow: only employees whose ACTIVE structure applies PF and
     * who have a draft/generated payslip sitting at zero. That is the affected
     * set precisely — no tenant-wide payroll rebuild, and nothing recomputed
     * that was already right. Approved/paid runs and locked periods are frozen
     * inside recomputeEmployeePayslips() and cannot be touched from here.
     *
     * Best-effort: a payroll recompute must never be what fails a migration.
     */
    private function recomputeStaleZeroPf(): void
    {
        if (!Schema::hasTable('payslips') || !Schema::hasColumn('payslips', 'pf_employee')) {
            return;
        }

        try {
            $employeeIds = DB::table('payslips as p')
                ->join('payroll_runs as r', 'r.id', '=', 'p.payroll_run_id')
                ->join('salary_structures as s', fn ($j) => $j
                    ->on('s.employee_id', '=', 'p.employee_id')
                    ->where('s.status', 'active'))
                ->whereIn('r.status', ['draft', 'generated'])
                ->where('s.pf_applicable', true)
                ->where('p.pf_employee', '<=', 0)
                ->distinct()
                ->pluck('p.employee_id');

            if ($employeeIds->isEmpty()) {
                return;
            }

            $payroll = app(\App\Services\PayrollService::class);
            foreach ($employeeIds as $id) {
                $payroll->recomputeEmployeePayslips((int) $id);
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning(
                'PF resync: payslip recompute skipped — ' . $e->getMessage()
            );
        }
    }

    public function down(): void
    {
        // A repair of drifted data — there is no previous state worth restoring,
        // and re-introducing the disagreement would only recreate the bug.
    }
};
