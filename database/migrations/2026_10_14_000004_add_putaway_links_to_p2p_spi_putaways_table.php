<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · The put-away row points at the occupancy it holds and the task it waits on.
 *
 * Both sides carry the link so a change on either is one update: the occupancy
 * row finds its box through occupant_type/_id, the put-away row finds its
 * occupancy through this column.
 *
 * The shelf master deliberately gets no matching column — a shelf holds many
 * boxes, so there is no single occupancy_id to put on it. Its reverse link is
 * the partial index on (shelf_id, status), which is what makes "what is on this
 * shelf" one query.
 *
 * verify_method records HOW the placement was attested, and the two are not
 * equivalent evidence: a Zebra scan proves a person stood at the shelf with the
 * box in hand, a manual confirmation is somebody's word. An audit that cannot
 * tell them apart cannot weigh either.
 *
 * suggested_shelf_id is the one column that lets the recommendation ever
 * improve. Without it there is no way to ask "did the operator take our
 * suggestion?", and a ranking nobody can measure is a ranking nobody can tune.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_spi_putaways', function (Blueprint $t) {
            $t->unsignedBigInteger('occupancy_id')->nullable()->after('shelf_id');
            $t->unsignedBigInteger('task_id')->nullable()->after('occupancy_id');
            // What the engine offered, kept even when the operator chose otherwise.
            $t->unsignedBigInteger('suggested_shelf_id')->nullable()->after('task_id');
            $t->string('verify_method', 10)->nullable()->after('confirmed_by');  // manual | zebra
        });
    }

    public function down(): void
    {
        Schema::table('p2p_spi_putaways', function (Blueprint $t) {
            $t->dropColumn(['occupancy_id', 'task_id', 'suggested_shelf_id', 'verify_method']);
        });
    }
};
