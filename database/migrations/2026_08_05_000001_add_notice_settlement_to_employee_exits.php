<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Exit Process — notice-period settlement + Full & Final settlement.
 *
 * The exit type now decides how the notice period is settled, and that
 * settlement gets its own wizard stage:
 *   · Resignation                        → notice served, nothing changes hands
 *   · Resignation without notice period  → the employee PAYS the unserved days;
 *                                          HR verifies the receipt and approves
 *   · Termination                        → the company PAYS in lieu of notice,
 *                                          disbursed through a Full & Final stage
 *
 * `notice_payment` and `fnf` are JSON blobs owned by the React wizard, matching
 * how `clearances` / `asset_returns` are already stored — the shapes are still
 * evolving and a stage that reopens must restore exactly what HR left behind.
 * The scalar columns beside them are the figures other modules need to read
 * (payroll / F&F), so those are NOT buried in JSON.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            // Derived from exit_type — stored so a reopened case shows the same
            // settlement the figures were computed under, even if the mapping
            // rules change later. served | recover | pay_in_lieu
            $table->string('notice_settlement_mode', 20)->nullable()->after('replacement_required');

            $table->unsignedSmallInteger('notice_days_required')->nullable()->after('notice_settlement_mode');
            $table->unsignedSmallInteger('notice_days_served')->nullable()->after('notice_days_required');
            $table->unsignedSmallInteger('notice_days_unserved')->nullable()->after('notice_days_served');

            // gross | basic — which salary head the per-day rate came off.
            $table->string('notice_settlement_basis', 10)->nullable()->after('notice_days_unserved');
            $table->decimal('notice_per_day_rate', 12, 2)->nullable()->after('notice_settlement_basis');
            $table->decimal('notice_settlement_amount', 12, 2)->nullable()->after('notice_per_day_rate');

            // NA | Pending | Settled | Rejected. Stage "Final Deactivation &
            // Closure" refuses to complete while this is Pending or Rejected.
            $table->string('notice_settlement_status', 20)->nullable()->after('notice_settlement_amount');

            // The recorded payment + HR verification (recovery side) or the
            // disbursement ledger (payment-in-lieu side).
            $table->json('notice_payment')->nullable()->after('notice_settlement_status');

            // Full & Final settlement stage — earnings/deductions lines, finance
            // approval, payment mode/status/date.
            $table->json('fnf')->nullable()->after('notice_payment');

            $table->index('notice_settlement_status');
        });
    }

    public function down(): void
    {
        Schema::table('employee_exits', function (Blueprint $table) {
            $table->dropIndex(['notice_settlement_status']);
            $table->dropColumn([
                'notice_settlement_mode',
                'notice_days_required',
                'notice_days_served',
                'notice_days_unserved',
                'notice_settlement_basis',
                'notice_per_day_rate',
                'notice_settlement_amount',
                'notice_settlement_status',
                'notice_payment',
                'fnf',
            ]);
        });
    }
};
