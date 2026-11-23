<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

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
