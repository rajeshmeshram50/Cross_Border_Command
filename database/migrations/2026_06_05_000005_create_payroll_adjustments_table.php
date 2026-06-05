<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-employee, per-month payroll adjustments — the source of truth for
 * Overtime (Rule 4) and Bonus / Incentive (Rule 10), plus ad-hoc one-off
 * deductions. Only APPROVED rows are picked up by the payroll engine; pending /
 * rejected rows are ignored (Rule 4/10 validation).
 *
 * Keyed by (employee, month, year) rather than payroll_period_id so HR can
 * record an adjustment before a period/run exists; the engine matches on the
 * cycle's month+year.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_adjustments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('employee_id')->index();

            $table->unsignedTinyInteger('month');
            $table->unsignedSmallInteger('year');

            // overtime | bonus | incentive | deduction
            $table->string('type', 20);
            $table->string('label', 120)->nullable();
            $table->decimal('amount', 14, 2)->default(0);
            // Overtime metadata (optional) — hours × rate = amount.
            $table->decimal('hours', 8, 2)->nullable();
            $table->decimal('rate', 10, 2)->nullable();

            $table->enum('status', ['pending', 'approved', 'rejected'])->default('pending');
            $table->unsignedBigInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->text('reason')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['client_id', 'employee_id', 'year', 'month'], 'payroll_adj_emp_cycle_idx');
            $table->index(['employee_id', 'year', 'month', 'status'], 'payroll_adj_lookup_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_adjustments');
    }
};
