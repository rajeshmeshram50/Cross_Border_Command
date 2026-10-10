<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory · Shelf Master — one level inside a rack, and the thing an SPI box
 * is actually scanned onto.
 *
 * height_cm is stored beside height because the form validates the stack
 * against the rack height in centimetres whatever unit was typed, and the guard
 * sums it per rack — kept in one unit rather than converted on every read.
 *
 * used_weight_kg and boxes_count are live occupancy owned by the put-away, not
 * by this form: it writes them as 0 and never touches them again. Occupancy
 * state (Available / Full) is read off used vs max, so it is not a column.
 *
 * No temperature range either: it belongs to the zone, reached through the
 * rack. cold_chain here only says whether this shelf may use it, and the form
 * locks it off unless the rack allows cold.
 *
 * No code column: the displayed RK-001-SH-01 is built from the rack and level_no.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_shelves', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->nullable()->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            $t->unsignedBigInteger('rack_id')->nullable();

            $t->string('shelf_name', 180)->nullable();
            // 1 is the bottom level; the screen names it from the rack's count.
            $t->unsignedSmallInteger('level_no')->nullable();
            $t->string('shelf_type', 60)->nullable();
            $t->decimal('max_weight_kg', 14, 2)->nullable();
            $t->string('purpose', 120)->nullable();

            // 1 = yes, 0 = no.
            $t->unsignedTinyInteger('cold_chain')->default(0);
            $t->unsignedTinyInteger('hazardous')->default(0);

            $t->string('dim_unit', 4)->nullable();
            $t->decimal('length', 12, 2)->nullable();
            $t->decimal('width', 12, 2)->nullable();
            $t->decimal('height', 12, 2)->nullable();
            $t->decimal('area', 14, 2)->nullable();
            $t->decimal('volume', 16, 3)->nullable();
            $t->decimal('height_cm', 12, 2)->nullable();

            $t->decimal('used_weight_kg', 14, 2)->default(0);
            $t->unsignedInteger('boxes_count')->default(0);

            // 1 = active, 0 = inactive.
            $t->unsignedTinyInteger('status')->default(1);
            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();

            // One shelf per level, and one name, inside a rack.
            $t->unique(['rack_id', 'level_no'], 'inv_shelf_rack_level_uq');
            $t->unique(['rack_id', 'shelf_name'], 'inv_shelf_rack_name_uq');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_shelves');
    }
};
