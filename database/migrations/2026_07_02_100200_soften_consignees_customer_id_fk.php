<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The consignee's "primary" customer_id used to be a NOT-NULL FK with
 * cascadeOnDelete — deleting a customer hard-deleted its consignees. With the
 * new many-to-many mapping, deleting one customer should only UNLINK it (the
 * consignee survives if it is still mapped to other customers). So we make
 * customer_id nullable and switch the FK to nullOnDelete; the application layer
 * (CustomerController::destroy) reassigns the primary or soft-deletes a
 * consignee that has no customers left.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('consignees', function (Blueprint $table) {
            $table->dropForeign(['customer_id']);
        });
        Schema::table('consignees', function (Blueprint $table) {
            $table->foreignId('customer_id')->nullable()->change();
            $table->foreign('customer_id')->references('id')->on('customers')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('consignees', function (Blueprint $table) {
            $table->dropForeign(['customer_id']);
        });
        Schema::table('consignees', function (Blueprint $table) {
            // Restore the original cascade FK. Left nullable to avoid failing on
            // any rows that were unlinked while this migration was applied.
            $table->foreign('customer_id')->references('id')->on('customers')->cascadeOnDelete();
        });
    }
};
