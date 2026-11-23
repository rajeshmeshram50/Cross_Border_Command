<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

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

        $structures = DB::table('salary_structures')
            ->where('status', 'active')
            ->orderBy('employee_id')
            ->orderBy('version')
            ->get(['employee_id', 'pf_applicable', 'esi_applicable']);

        $latest = [];
        foreach ($structures as $s) {
            $latest[$s->employee_id] = $s;
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
    }
};
