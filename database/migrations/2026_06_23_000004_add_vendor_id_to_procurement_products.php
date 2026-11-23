<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('procurement_products', function (Blueprint $table) {
            if (!Schema::hasColumn('procurement_products', 'vendor_id')) {
                $table->foreignId('vendor_id')->nullable()->after('product_id')
                    ->constrained('vendors')->nullOnDelete();
            }
        });

        DB::statement(<<<'SQL'
            UPDATE procurement_products pp
            SET vendor_id = sub.vendor_id
            FROM (
                SELECT product_id, MIN(vendor_id) AS vendor_id
                FROM vendor_product_mappings
                GROUP BY product_id
                HAVING COUNT(DISTINCT vendor_id) = 1
            ) sub
            WHERE pp.product_id = sub.product_id AND pp.vendor_id IS NULL
        SQL);
    }

    public function down(): void
    {
        Schema::table('procurement_products', function (Blueprint $table) {
            if (Schema::hasColumn('procurement_products', 'vendor_id')) {
                $table->dropConstrainedForeignId('vendor_id');
            }
        });
    }
};
