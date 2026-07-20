<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Shipment orders referenced their INCO term by the dropdown's display LABEL
 * ("FOB – Free On Board") in the varchar `inco_term` column, so a rename in
 * Masters → Incoterms never reached the shipments that used it.
 *
 * This adds the real reference. New saves write `inco_term_id`; reads resolve
 * the live master name from it. `inco_term` stays as the historical snapshot —
 * shipments created before this migration have no id, so they keep rendering
 * from that text exactly as they do today (nothing to backfill, nothing breaks).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('shipment_orders', 'inco_term_id')) return;

        Schema::table('shipment_orders', function (Blueprint $t) {
            $t->unsignedBigInteger('inco_term_id')->nullable()->after('inco_term')->index();
        });
    }

    public function down(): void
    {
        if (!Schema::hasColumn('shipment_orders', 'inco_term_id')) return;

        Schema::table('shipment_orders', function (Blueprint $t) {
            $t->dropColumn('inco_term_id');
        });
    }
};
