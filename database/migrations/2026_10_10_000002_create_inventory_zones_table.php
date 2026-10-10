<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory · Zone Master. A zone is either racked or not, and that one choice
 * decides which columns below apply:
 *
 *   rack    → racks live inside it and a box is put away to a shelf, so the
 *             shelves carry the capacity and everything below stays null.
 *   norack  → no shelf to scan, so the zone states its own capacity: a fridge
 *             in litres, or an open floor by length × width × height.
 *
 * No code column: the displayed ZN-003 is "ZN-" + the id, zero-padded to 3.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_zones', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable()->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            $t->unsignedBigInteger('warehouse_id')->nullable();

            $t->string('zone_name', 180)->nullable();
            $t->enum('rack_mode', ['rack', 'norack'])->nullable();
            $t->decimal('area_sqft', 14, 2)->nullable();
            // From a fixed list, or free text once the list is on 'Other'.
            $t->string('purpose', 120)->nullable();

            // 1 = yes, 0 = no.
            $t->unsignedTinyInteger('cold_chain')->default(0);
            // Only meaningful while cold_chain is 1; null rather than 0, which
            // would read as "zero degrees".
            $t->decimal('temp_min_c', 6, 2)->nullable();
            $t->decimal('temp_max_c', 6, 2)->nullable();
            $t->unsignedTinyInteger('hazardous')->default(0);

            // norack only: a refrigerator measured in litres, or an open floor
            // measured by its dimensions. Never both.
            $t->enum('storage_mode', ['regular', 'fridge'])->nullable();
            $t->decimal('capacity_litres', 14, 2)->nullable();

            /* norack + regular. usable_pct is the share actually stackable once
               aisles and clearance come out, so usable_volume is what planning
               reads — gross volume always overstates it. Every figure here is
               computed on the screen and stored as sent. */
            $t->string('dim_unit', 4)->nullable();
            $t->decimal('length', 12, 2)->nullable();
            $t->decimal('width', 12, 2)->nullable();
            $t->decimal('height', 12, 2)->nullable();
            $t->decimal('usable_pct', 5, 2)->nullable();
            $t->decimal('floor_area', 14, 2)->nullable();
            $t->decimal('volume', 16, 3)->nullable();
            $t->decimal('usable_volume', 16, 3)->nullable();

            // 1 = active, 0 = inactive.
            $t->unsignedTinyInteger('status')->default(1);
            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();

            // The rack form lists only racked zones of the chosen warehouse.
            $t->index(['warehouse_id', 'rack_mode'], 'inv_zone_wh_mode_idx');
            $t->index(['client_id', 'status'], 'inv_zone_client_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_zones');
    }
};
