<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Shipment IDs (SHP-NNN) are sequenced per BRANCH (not per client). To scope
 * the counter we add a `branch_id` to shipment_orders and back-fill it from the
 * owning opportunity's branch (leads.branch_id).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasColumn('shipment_orders', 'branch_id')) {
            Schema::table('shipment_orders', function (Blueprint $table) {
                $table->foreignId('branch_id')->nullable()->after('client_id')
                      ->constrained('branches')->nullOnDelete();
                $table->index(['client_id', 'branch_id', 'shipment_code']);
            });
        }

        // Back-fill from the linked lead's branch so existing rows are scoped.
        DB::statement("
            UPDATE shipment_orders so
            SET branch_id = l.branch_id
            FROM leads l
            WHERE l.id = so.lead_id AND so.branch_id IS NULL
        ");
    }

    public function down(): void
    {
        if (Schema::hasColumn('shipment_orders', 'branch_id')) {
            Schema::table('shipment_orders', function (Blueprint $table) {
                $table->dropIndex(['client_id', 'branch_id', 'shipment_code']);
                $table->dropConstrainedForeignId('branch_id');
            });
        }
    }
};
