<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory · Rack Master. A rack sits in one racked zone.
 *
 * warehouse_id is kept beside zone_id even though the zone knows it: the grid
 * and the put-away scan both filter racks by warehouse without the zone.
 *
 * Warehouse type, warehouse area, location and the zone's own area / cold /
 * hazardous flags are shown on the form as AUTO but fetched from the parent
 * rows — not copied here. Nor is the temperature range: it belongs to the zone,
 * and cold_chain here only says whether this rack may use it.
 *
 * No code column: the displayed RK-001 is "RK-" + the id, zero-padded to 3.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_racks', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable()->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            $t->unsignedBigInteger('warehouse_id')->nullable();
            $t->unsignedBigInteger('zone_id')->nullable();

            $t->string('rack_name', 180)->nullable();

            // 1 = yes, 0 = no.
            $t->unsignedTinyInteger('cold_chain')->default(0);
            $t->unsignedTinyInteger('hazardous')->default(0);

            /* Dimensions as typed, in the unit the screen was on. area_sqft is
               stored because the zone-capacity guard sums it across the zone's
               racks — a stored column beats re-deriving length × width × unit
               in SQL on every save. */
            $t->string('dim_unit', 4)->nullable();
            $t->decimal('length', 12, 2)->nullable();
            $t->decimal('width', 12, 2)->nullable();
            $t->decimal('height', 12, 2)->nullable();
            $t->decimal('area_sqft', 14, 2)->nullable();

            // 1 = active, 0 = inactive.
            $t->unsignedTinyInteger('status')->default(1);
            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();

            // A rack name must be unique inside its zone — the form says so.
            $t->unique(['zone_id', 'rack_name'], 'inv_rack_zone_name_uq');
            $t->index(['warehouse_id', 'status'], 'inv_rack_wh_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_racks');
    }
};
