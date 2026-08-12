<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One-time DIRECT repayments against a SELF advance's pending EMI recovery.
 *
 * Normally a self advance is recovered from salary (the payroll engine writes the
 * `advance_recovery_ledger`). But an employee can also pay the outstanding balance
 * back directly from their profile — typically at EXIT, when there is no more
 * payroll to deduct from and the advance can't simply be removed. Those manual
 * pay-offs are recorded here (they are NOT payroll deductions), each row:
 *   { amount, method, reference, note, proof_path, proof_name, paid_by, paid_at }
 * The self "recovered" total = payroll ledger (self) + Σ these direct payments.
 * Guarded so it's a no-op where the column already exists.
 */
return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasColumn('advance_requests', 'recovery_direct_payments')) {
            Schema::table('advance_requests', function (Blueprint $table) {
                $table->json('recovery_direct_payments')->nullable()->after('recovery_start');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('advance_requests', 'recovery_direct_payments')) {
            Schema::table('advance_requests', function (Blueprint $table) {
                $table->dropColumn('recovery_direct_payments');
            });
        }
    }
};
