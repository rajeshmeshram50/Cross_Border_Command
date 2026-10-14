<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory · A zone can say how full it is, not only how big it is.
 *
 * The zone master has every capacity column — area_sqft, volume,
 * usable_volume, usable_pct, capacity_litres — and not one column saying how
 * much of it is in use. Shelves have the pair (max_weight_kg / used_weight_kg,
 * boxes_count); zones have only the first half.
 *
 * That is survivable while every box lands on a shelf, because the zone's
 * figure rolls up from its shelves. It stops being survivable in a NO-RACK
 * zone, where the zone IS the location: there are no shelves underneath to roll
 * up from, so the zone's "47% used" has nothing behind it. Stage 04 offers
 * exactly that choice — Storage Zone without Rack — and two of the three zones
 * configured today are no-rack.
 *
 * Mirrors the shelf columns deliberately, including their nature: these are a
 * CACHE of inventory_location_occupancy, written in the same transaction as the
 * ledger row and rebuilt from it by the reconcile job. The ledger is the
 * authority. They exist so that drawing a rack map does not mean an aggregate
 * per zone, not because they are the truth.
 *
 * Like the shelf pair, they are NOT the form's to write — the put-away sets
 * them and the zone master leaves them alone.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inventory_zones', function (Blueprint $t) {
            $t->decimal('used_volume', 16, 3)->default(0)->after('usable_volume');
            $t->decimal('used_area_sqft', 14, 3)->default(0)->after('used_volume');
            $t->decimal('used_weight_kg', 14, 3)->default(0)->after('used_area_sqft');
            $t->unsignedInteger('boxes_count')->default(0)->after('used_weight_kg');
        });
    }

    public function down(): void
    {
        Schema::table('inventory_zones', function (Blueprint $t) {
            $t->dropColumn(['used_volume', 'used_area_sqft', 'used_weight_kg', 'boxes_count']);
        });
    }
};
