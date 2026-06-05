<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One payslip per (run, employee). Carries a full self-contained snapshot of
 * the calculation so a payslip stays reproducible even if the employee /
 * salary structure later changes (Rule 16 / 18).
 *
 * `earnings` / `deductions` are JSON component lists mirroring the structure;
 * the individual statutory heads (pf/esi/pt/tds/lop/advance) are also broken
 * out into columns so the Salary Report grid can render + aggregate them
 * without parsing JSON.
 *
 * `exceptions` is a JSON list of {type: blocking|warning, reason} entries that
 * feed the "Run Payroll" pre-flight modal.
 */
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

            // Snapshot of identity at run time (so a renamed/transferred
            // employee doesn't mutate historical payslips).
            $table->string('employee_code', 40)->nullable();
            $table->string('employee_name', 191)->nullable();
            $table->string('department', 191)->nullable();
            $table->string('designation', 191)->nullable();

            // Attendance inputs (Rule 2 / 3 / 6).
            $table->decimal('working_days', 6, 2)->default(0);
            $table->decimal('present_days', 6, 2)->default(0);
            $table->decimal('paid_days', 6, 2)->default(0);
            $table->decimal('lop_days', 6, 2)->default(0);
            $table->decimal('paid_leave_days', 6, 2)->default(0);
            $table->decimal('unpaid_leave_days', 6, 2)->default(0);
            $table->unsignedSmallInteger('late_marks')->default(0);
            $table->unsignedSmallInteger('missing_punches')->default(0);
            $table->decimal('overtime_hours', 6, 2)->default(0);
            // Biometric/Review/Manual — drives the Biometric Input tab pill.
            $table->string('att_source', 16)->default('Manual');

            // Component breakdown.
            $table->json('earnings')->nullable();
            $table->json('deductions')->nullable();

            // Money — earnings side.
            $table->decimal('gross_earnings', 14, 2)->default(0);
            $table->decimal('basic', 14, 2)->default(0);
            $table->decimal('overtime_amount', 14, 2)->default(0);
            $table->decimal('bonus_amount', 14, 2)->default(0);

            // Money — deduction heads (Rule 8/9/11).
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

            // Per-payslip lifecycle. Ready/Processed/Pending Review/On Hold map
            // 1:1 to the SPA's RowStatus; approved/paid follow the run.
            $table->string('status', 24)->default('Ready');
            $table->text('hold_reason')->nullable();
            $table->json('exceptions')->nullable();

            // Bank snapshot + verification flag (Rule 12 — calc always runs but
            // payout/export is blocked when these are missing/invalid).
            $table->string('bank_account_number', 64)->nullable();
            $table->string('ifsc_code', 24)->nullable();
            $table->boolean('bank_verified')->default(false);

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            // One payslip per employee per run.
            $table->unique(['payroll_run_id', 'employee_id'], 'payslips_run_emp_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payslips');
    }
};
