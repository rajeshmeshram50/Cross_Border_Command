<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A payroll run = one execution of the engine against a period (Rule 14).
 *
 * Status ladder (locking rules):
 *   draft      → editable, can be regenerated freely
 *   generated  → recalculation still allowed
 *   approved   → edit locked (Rule 15 — adjustments go to next cycle)
 *   paid       → fully locked + period locked
 *
 * Only one non-superseded run exists per period; regenerating a draft replaces
 * its payslips rather than stacking a second run (Rule 13).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_runs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('payroll_period_id')->index();

            $table->enum('status', ['draft', 'generated', 'approved', 'paid'])->default('draft');

            // Headline totals — recomputed on every generate so the dashboard
            // and the "Run Payroll" pre-flight read them without re-summing.
            $table->unsignedInteger('total_employees')->default(0);
            $table->unsignedInteger('employees_on_hold')->default(0);
            $table->decimal('total_gross', 16, 2)->default(0);
            $table->decimal('total_deductions', 16, 2)->default(0);
            $table->decimal('total_net', 16, 2)->default(0);

            $table->unsignedBigInteger('generated_by')->nullable();
            $table->timestamp('generated_at')->nullable();
            $table->unsignedBigInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->unsignedBigInteger('paid_by')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->text('notes')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_runs');
    }
};
