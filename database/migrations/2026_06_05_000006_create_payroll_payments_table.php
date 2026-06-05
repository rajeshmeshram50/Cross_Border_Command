<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Payment disbursement record for a payroll run — the "Proceed to Pay" flow.
 *
 * One payment per run. Captures the chosen mode (cheque / online NEFT batch),
 * a 3-level compliance sign-off (Prepared → Verified → Approved), and the
 * status as it moves draft → pending_approval → approved → paid. The actual
 * payslip "Paid" marking + period lock happens on `initiate` (reusing the
 * payroll pay logic), so this layer is the audit/approval wrapper around it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->unsignedBigInteger('payroll_run_id')->index();
            $table->unsignedBigInteger('payroll_period_id')->index();

            // cheque | online
            $table->string('mode', 16);
            // draft → pending_approval → approved → paid
            $table->string('status', 24)->default('draft');

            $table->unsignedInteger('employee_count')->default(0);
            $table->decimal('total_amount', 16, 2)->default(0);

            // Header snapshot for the advice/batch document.
            $table->string('company_name', 191)->nullable();
            $table->string('bank_name', 191)->nullable();

            // 3-level sign-off (names typed at confirm time — compliance record).
            $table->string('prepared_by_name', 191)->nullable();
            $table->string('verified_by_name', 191)->nullable();
            $table->string('approved_by_name', 191)->nullable();
            $table->timestamp('approved_at')->nullable();

            // Generated batch reference (NEFT batch / cheque advice no.).
            $table->string('batch_ref', 40)->nullable();
            $table->timestamp('paid_at')->nullable();

            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_payments');
    }
};
