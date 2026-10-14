<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory · What is standing in each location, right now.
 *
 * p2p_spi_putaways answers "where did THIS SPI box go". It cannot answer the
 * question the warehouse actually asks — "what is on this shelf" — for three
 * reasons: it is SPI-scoped, so a GRN box, a return or a transfer has no row
 * in it; a temporary put-away is RELEASED when the box converts at GRN and
 * nothing there says the shelf is free again; and it keeps one row per box
 * forever, so reading one shelf means scanning every put-away ever made.
 *
 * So: one row per occupant that is CURRENTLY in a location, closed rather than
 * deleted. occupant_type/_id keep it open to whatever comes to occupy a shelf
 * next — today an SPI box, tomorrow a GRN box or a sales return.
 *
 * RESERVED IS NOT A DRAFT. Capacity is taken when the location is assigned,
 * not when the box is confirmed, because a Zebra verification task can sit
 * open for hours and the shelf must not read as free in the meantime. The
 * three states are the box's actual relationship to the shelf:
 *
 *   reserved  the shelf is held for it; nobody else may take that space
 *   occupied  it is physically there, verified by a device or by a person
 *   released  it has left; the row stays as history
 *
 * The shelf master's used_weight_kg / boxes_count become a CACHE of this table
 * and are written in the same transaction. This table is the authority: a
 * counter that only ever increments has nothing to be checked against, and one
 * double callback or one half-failed transaction leaves it wrong forever.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_location_occupancy', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();

            /* The whole address is kept on the row, not just the leaf. A zone
               or rack total is then one query instead of a three-level join,
               and a rack map asking for 2,000 shelves at once stays flat. */
            $t->unsignedBigInteger('warehouse_id')->index();
            $t->unsignedBigInteger('zone_id')->index();
            // Null in a no-rack zone: there the ZONE is the location.
            $t->unsignedBigInteger('rack_id')->nullable();
            $t->unsignedBigInteger('shelf_id')->nullable();

            $t->string('occupant_type', 40);        // spi_box | grn_box | return …
            $t->unsignedBigInteger('occupant_id');
            // Printed on the box; kept here so a shelf reads without a join.
            $t->string('box_code', 40)->nullable();

            /* What this occupant consumes. Three figures because capacity is
               three different limits — a shelf runs out of kilos, of height,
               or of floor — and which one binds depends on the goods. */
            $t->decimal('weight_kg', 12, 3)->default(0);
            $t->decimal('volume_cm3', 16, 2)->nullable();
            $t->decimal('footprint_cm2', 14, 2)->nullable();

            $t->string('status', 12)->default('reserved');
            $t->timestamp('reserved_at')->nullable();
            $t->timestamp('placed_at')->nullable();
            $t->unsignedBigInteger('placed_by')->nullable();
            $t->timestamp('released_at')->nullable();
            // reassigned | grn_converted | task_expired | corrected …
            $t->string('released_reason', 120)->nullable();

            /* placed_by is the person who put the box THERE; these two are who
               touched the ROW, as every inventory master records. They diverge
               the moment a supervisor corrects somebody else's placement. */
            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();

            $t->timestamps();

            $t->index(['occupant_type', 'occupant_id']);
        });

        DB::statement(
            "alter table inventory_location_occupancy add constraint occ_status_check
             check (status in ('reserved','occupied','released'))"
        );

        /* PARTIAL INDEXES, and they are not a refinement.
           Released rows accumulate for the life of the warehouse. Without the
           WHERE clause every "is this shelf free" read drags the whole history
           behind it, and the one index that actually prevents double-booking
           could not exist at all — a box may occupy one place at a time, but it
           may have occupied a hundred over its life. */
        DB::statement(
            "create unique index uq_occ_occupant_live on inventory_location_occupancy
             (occupant_type, occupant_id) where status in ('reserved','occupied')"
        );
        DB::statement(
            "create index idx_occ_shelf_live on inventory_location_occupancy
             (shelf_id) where status in ('reserved','occupied')"
        );
        DB::statement(
            "create index idx_occ_zone_live on inventory_location_occupancy
             (zone_id) where status in ('reserved','occupied')"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_location_occupancy');
    }
};
