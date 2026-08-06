<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Payroll-recovery plan for a "return" (used-less) settlement when the employee
 * chooses "Cut from Payroll" instead of paying directly. Captured on OUR side
 * now (schedule metadata); the payroll engine will consume these later:
 *   - settle_return_recovery_start : first payroll month the deduction applies
 *   - settle_return_recovery_mode  : emi | lumpsum | bimonthly
 *   - settle_return_recovery_months: number of instalments (emi/bimonthly)
 *   - settle_return_monthly        : per-cycle amount (emi/bimonthly)
 *   - settle_return_scheduled_at   : when the payroll plan was set up
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->date('settle_return_recovery_start')->nullable()->after('settle_return_payments');
            $table->string('settle_return_recovery_mode', 16)->nullable()->after('settle_return_recovery_start');
            $table->integer('settle_return_recovery_months')->nullable()->after('settle_return_recovery_mode');
            $table->decimal('settle_return_monthly', 18, 2)->nullable()->after('settle_return_recovery_months');
            $table->timestamp('settle_return_scheduled_at')->nullable()->after('settle_return_monthly');
        });
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn([
                'settle_return_recovery_start', 'settle_return_recovery_mode',
                'settle_return_recovery_months', 'settle_return_monthly', 'settle_return_scheduled_at',
            ]);
        });
    }
};
