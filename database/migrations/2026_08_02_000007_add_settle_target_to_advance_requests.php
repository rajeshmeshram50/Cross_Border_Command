<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Declared settlement target — captured up front when the employee starts
 * settling a company advance and LOCKED for the life of the settlement:
 *   - settle_declared_type: 'equal' | 'minimum' | 'maximum' (used exactly /
 *     less / more than the advance).
 *   - settle_target_amount: the total the employee will account for. For
 *     'equal' it equals the advance; for 'minimum' it's < advance; for
 *     'maximum' it's > advance. Finalising requires the itemised bills to sum
 *     to this target. Persisted so incremental bill-by-bill saves survive
 *     across sessions.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->string('settle_declared_type', 16)->nullable()->after('settle_items');
            $table->decimal('settle_target_amount', 18, 2)->nullable()->after('settle_declared_type');
        });
    }

    public function down(): void
    {
        Schema::table('advance_requests', function (Blueprint $table) {
            $table->dropColumn(['settle_declared_type', 'settle_target_amount']);
        });
    }
};
