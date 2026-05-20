<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marks consignees that were created with the "Same as Customer"
 * toggle on. The flag is what powers the warning popup on the
 * customer list when a user clicks Edit — updating the customer's
 * Stage 1 fields would semantically affect every consignee that
 * mirrors them.
 *
 * Flag is persisted only as a record of intent — when set, the
 * frontend re-mirrors via the clone-from-customer endpoint on every
 * Save & Next from Stage 1, so the actual data stays in sync.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('consignees', function (Blueprint $table) {
            $table->boolean('same_as_customer')->default(false)->after('status');
            $table->index(['customer_id', 'same_as_customer']);
        });
    }

    public function down(): void
    {
        Schema::table('consignees', function (Blueprint $table) {
            $table->dropIndex(['customer_id', 'same_as_customer']);
            $table->dropColumn('same_as_customer');
        });
    }
};
