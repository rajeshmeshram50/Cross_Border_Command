<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Domestic shipment fields.
 *
 * A shipment follows its Proforma Invoice's doc_type, and the two flows capture
 * genuinely different logistics data:
 *
 *   International → freight_cost, zip_code, inco_term, port_of_loading,
 *                   port_of_unloading, final_destination, origin_country
 *   Domestic      → shipping_cost, pin_code, place_of_dispatch,
 *                   place_of_delivery   (no INCO term / ports / origin country)
 *
 * The domestic values get their OWN columns rather than reusing the export
 * ones. They are near-synonyms (freight↔shipping cost, ZIP↔PIN), so one shared
 * column would physically work — but then a row's meaning would depend on
 * reading its PI's doc_type, and flipping that type would silently re-label
 * stored data. Separate nullable columns keep each flow's values where they
 * belong and make "which columns are populated" self-describing.
 *
 * All nullable: an international row has no domestic values (and never will),
 * and vice versa. Existing rows are untouched — this only adds columns.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shipment_orders', function (Blueprint $table) {
            // Domestic counterpart of freight_cost.
            $table->decimal('shipping_cost', 15, 2)->nullable()->after('freight_cost');
            // Domestic counterpart of zip_code (Indian 6-digit PIN).
            $table->string('pin_code', 12)->nullable()->after('zip_code');
            // Domestic replaces the port / destination block with these two.
            $table->string('place_of_dispatch', 128)->nullable()->after('origin_country');
            $table->string('place_of_delivery', 128)->nullable()->after('place_of_dispatch');
        });
    }

    public function down(): void
    {
        Schema::table('shipment_orders', function (Blueprint $table) {
            $table->dropColumn([
                'shipping_cost',
                'pin_code',
                'place_of_dispatch',
                'place_of_delivery',
            ]);
        });
    }
};
