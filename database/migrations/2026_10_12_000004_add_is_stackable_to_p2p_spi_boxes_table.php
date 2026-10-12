<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · Stackable belongs to the BOX, not to what is inside it.
 *
 * Stage 03 shows one Stackable toggle per box, because that is what it is: a
 * fact about the carton — whether another may be put on top of it. It was
 * being written onto every ITEM in the box and read back from whichever item
 * happened to be first, so a mixed carton carried the same answer duplicated
 * across its lines, and nothing could say what the BOX was without opening it.
 *
 * Default 0. A carton is not stackable until someone says it is: assuming the
 * opposite is how a crate ends up under a pallet it cannot carry. Note this
 * reverses the item column's default of true, which was the wrong way round
 * for a safety flag.
 *
 * smallint 0/1 rather than boolean, matching the 0/1 flag convention used by
 * the inventory masters. p2p_spi_box_items.is_stackable stays a boolean and
 * stays where it is — nothing reads it but the screen that wrote it, and
 * dropping a column is not worth the risk for a field this small.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_spi_boxes', function (Blueprint $t) {
            $t->smallInteger('is_stackable')->default(0)->after('condition');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_spi_boxes', function (Blueprint $t) {
            $t->dropColumn('is_stackable');
        });
    }
};
