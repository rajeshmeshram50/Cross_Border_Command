<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->deleteOrphans('payslips', 'payroll_run_id', 'payroll_runs');
        $this->deleteOrphans('payslips', 'payroll_period_id', 'payroll_periods');
        $this->deleteOrphans('payslips', 'employee_id', 'employees');
        $this->deleteOrphans('payroll_runs', 'payroll_period_id', 'payroll_periods');
        $this->deleteOrphans('leave_requests', 'employee_id', 'employees');
        $this->nullOrphans('leave_requests', 'leave_plan_id', 'master_leave_plans');
        $this->deleteOrphans('leave_requests', 'leave_type_id', 'master_leave_types');
        $this->deleteOrphans('employee_documents', 'employee_id', 'employees');
        $this->deleteOrphans('previous_employments', 'employee_id', 'employees');

        if (Schema::hasTable('payslips')) {
            Schema::table('payslips', function (Blueprint $t) {
                $t->foreign('payroll_run_id')->references('id')->on('payroll_runs')->cascadeOnDelete();
                $t->foreign('payroll_period_id')->references('id')->on('payroll_periods')->cascadeOnDelete();
                $t->foreign('employee_id')->references('id')->on('employees')->cascadeOnDelete();
            });
        }
        if (Schema::hasTable('payroll_runs')) {
            Schema::table('payroll_runs', function (Blueprint $t) {
                $t->foreign('payroll_period_id')->references('id')->on('payroll_periods')->cascadeOnDelete();
            });
        }
        if (Schema::hasTable('leave_requests')) {
            Schema::table('leave_requests', function (Blueprint $t) {
                $t->foreign('employee_id')->references('id')->on('employees')->cascadeOnDelete();
                $t->foreign('leave_plan_id')->references('id')->on('master_leave_plans')->nullOnDelete();
                $t->foreign('leave_type_id')->references('id')->on('master_leave_types')->restrictOnDelete();
            });
        }
        if (Schema::hasTable('employee_documents')) {
            Schema::table('employee_documents', function (Blueprint $t) {
                $t->foreign('employee_id')->references('id')->on('employees')->cascadeOnDelete();
            });
        }
        if (Schema::hasTable('previous_employments')) {
            Schema::table('previous_employments', function (Blueprint $t) {
                $t->foreign('employee_id')->references('id')->on('employees')->cascadeOnDelete();
            });
        }

        DB::statement("
            UPDATE employees e
            SET emp_code = e.emp_code || '-' || e.id::text
            WHERE e.emp_code IS NOT NULL AND e.emp_code <> ''
              AND EXISTS (
                SELECT 1 FROM employees e2
                WHERE e2.client_id = e.client_id
                  AND e2.emp_code = e.emp_code
                  AND e2.id < e.id
              )
        ");

        DB::statement("CREATE UNIQUE INDEX IF NOT EXISTS employees_client_emp_code_unique
            ON employees (client_id, emp_code)
            WHERE emp_code IS NOT NULL AND emp_code <> ''");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS employees_client_emp_code_unique');

        foreach ([
            'payslips'             => ['payroll_run_id', 'payroll_period_id', 'employee_id'],
            'payroll_runs'         => ['payroll_period_id'],
            'leave_requests'       => ['employee_id', 'leave_plan_id', 'leave_type_id'],
            'employee_documents'   => ['employee_id'],
            'previous_employments' => ['employee_id'],
        ] as $table => $cols) {
            if (!Schema::hasTable($table)) continue;
            Schema::table($table, function (Blueprint $t) use ($cols) {
                foreach ($cols as $c) {
                    try { $t->dropForeign([$c]); } catch (\Throwable $e) { }
                }
            });
        }
    }

    private function deleteOrphans(string $child, string $fk, string $parent): void
    {
        if (!Schema::hasTable($child) || !Schema::hasTable($parent)) return;
        DB::table($child)
            ->whereNotNull($fk)
            ->whereNotIn($fk, fn ($q) => $q->select('id')->from($parent))
            ->delete();
    }

    private function nullOrphans(string $child, string $fk, string $parent): void
    {
        if (!Schema::hasTable($child) || !Schema::hasTable($parent)) return;
        DB::table($child)
            ->whereNotNull($fk)
            ->whereNotIn($fk, fn ($q) => $q->select('id')->from($parent))
            ->update([$fk => null]);
    }
};
