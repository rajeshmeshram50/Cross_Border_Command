<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

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
