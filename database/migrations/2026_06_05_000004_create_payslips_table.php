<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payslips', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('payroll_run_id')->index();
            $table->unsignedBigInteger('payroll_period_id')->index();
            $table->unsignedBigInteger('employee_id')->index();

            $table->string('employee_code', 40)->nullable();
            $table->string('employee_name', 191)->nullable();
            $table->string('department', 191)->nullable();
            $table->string('designation', 191)->nullable();

            $table->decimal('working_days', 6, 2)->default(0);
            $table->decimal('present_days', 6, 2)->default(0);
            $table->decimal('paid_days', 6, 2)->default(0);
            $table->decimal('lop_days', 6, 2)->default(0);
            $table->decimal('paid_leave_days', 6, 2)->default(0);
            $table->decimal('unpaid_leave_days', 6, 2)->default(0);
            $table->unsignedSmallInteger('late_marks')->default(0);
            $table->unsignedSmallInteger('missing_punches')->default(0);
            $table->decimal('overtime_hours', 6, 2)->default(0);
            $table->string('att_source', 16)->default('Manual');

            $table->json('earnings')->nullable();
            $table->json('deductions')->nullable();

            $table->decimal('gross_earnings', 14, 2)->default(0);
            $table->decimal('basic', 14, 2)->default(0);
            $table->decimal('overtime_amount', 14, 2)->default(0);
            $table->decimal('bonus_amount', 14, 2)->default(0);

            $table->decimal('pf_employee', 14, 2)->default(0);
            $table->decimal('esi', 14, 2)->default(0);
            $table->decimal('pt', 14, 2)->default(0);
            $table->decimal('tds', 14, 2)->default(0);
            $table->decimal('lop_amount', 14, 2)->default(0);
            $table->decimal('advance_recovery', 14, 2)->default(0);
            $table->decimal('loan_recovery', 14, 2)->default(0);
            $table->decimal('other_deductions', 14, 2)->default(0);
            $table->decimal('total_deductions', 14, 2)->default(0);

            $table->decimal('net_pay', 14, 2)->default(0);

            $table->string('status', 24)->default('Ready');
            $table->text('hold_reason')->nullable();
            $table->json('exceptions')->nullable();

            $table->string('bank_account_number', 64)->nullable();
            $table->string('ifsc_code', 24)->nullable();
            $table->boolean('bank_verified')->default(false);

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['payroll_run_id', 'employee_id'], 'payslips_run_emp_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payslips');
    }
};
