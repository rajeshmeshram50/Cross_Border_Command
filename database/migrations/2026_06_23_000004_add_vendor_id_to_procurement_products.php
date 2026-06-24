<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Record the ACTUAL sourced supplier on a procurement line.
 *
 * Until now a procurement carried no vendor at all — the only vendor↔deal link
 * was product-scoped (vendor_product_mappings), so a supplier flipped to
 * "Recurring" merely by sharing a product with someone else's procurement.
 *
 * procurement_products.vendor_id pins the supplier per line. Going forward the
 * procurement flow sets it (explicit pick, or auto when a product has a single
 * mapped vendor). Fresh/Recurring + the Evidence-Vault deal matrix then count
 * on THIS column instead of the product hop.
 *
 * Backfill rule: assign the line to the product's vendor ONLY when that product
 * is supplied by exactly one vendor (unambiguous). Products shared by several
 * vendors stay NULL — we genuinely can't infer who was sourced, so none of them
 * is wrongly credited.
 */
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
