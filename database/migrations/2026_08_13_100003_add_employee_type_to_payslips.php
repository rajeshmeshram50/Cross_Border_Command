<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Rule 17 — snapshot the employment type onto the payslip so the payroll export
 * can filter by it.
 *
 * Joining employees at export time would have been less work, but it breaks the
 * payslip's defining property: it is a self-contained snapshot, reproducible
 * long after the employee record has moved on. An employee promoted from
 * Contract to Full-time in November would otherwise retroactively change which
 * rows a re-run of the March export returns.
 *
 * Backfilled from the employee's current type, which is the best available
 * answer for slips generated before the column existed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->string('employee_type', 30)->nullable()->after('designation')->index();
        });

        if (Schema::hasColumn('employees', 'employee_type')) {
            DB::statement(
                'UPDATE payslips SET employee_type = e.employee_type
                 FROM employees e
                 WHERE e.id = payslips.employee_id AND e.employee_type IS NOT NULL'
            );
        }
    }

    public function down(): void
    {
        Schema::table('payslips', function (Blueprint $table) {
            $table->dropColumn('employee_type');
        });
    }
};
