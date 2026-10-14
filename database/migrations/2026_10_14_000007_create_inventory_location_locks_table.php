<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory · A location one person is working on is not offered to anybody else.
 *
 * This is the THIRD kind of lock in the put-away flow and it is worth saying
 * what the other two are, because none of them substitutes for another:
 *
 *   · select ... for update  holds the shelf ROW so two transactions cannot
 *                            both pass the same capacity check. Milliseconds.
 *   · occupancy 'reserved'   holds CAPACITY — 12.9% of the shelf. The other
 *                            87% stays open to everyone, correctly.
 *   · this table             holds THE LOCATION, exclusively. Nobody else is
 *                            shown it, recommended it, or allowed to take it
 *                            until the work finishes or is given up.
 *
 * A table rather than locked_by/locked_at columns on the masters, for four
 * reasons: the lock applies to zones, racks and shelves alike, so columns would
 * mean the same four on three masters; a master is reference data the whole app
 * caches and a lock is transient, high-churn state; overwriting columns loses
 * the history of who held what and for how long, which is a question warehouses
 * actually ask; and the partial unique index below settles a race between two
 * operators in the database rather than in application code — one insert wins,
 * the other is refused and shown who holds it.
 *
 * IT MUST EXPIRE. A lock that only a happy path releases means the first closed
 * laptop takes a shelf out of service permanently. last_heartbeat_at is pinged
 * by the open screen; a reaper releases anything stale. The Zebra case is the
 * exception and ties its expiry to the task's own, because that one is MEANT to
 * sit open for hours.
 *
 * A locked location is ineligible in Step 02 — greyed in the tree, out of the
 * eligible count, never recommended. Its reason reads differently from the
 * others: "in use", about a person, not "unavailable", about the goods.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_location_locks', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();

            $t->string('location_type', 10);            // zone | rack | shelf
            $t->unsignedBigInteger('location_id');
            // Denormalised so every live lock in a warehouse is one indexed read.
            $t->unsignedBigInteger('warehouse_id')->index();

            $t->unsignedBigInteger('held_by')->nullable();
            /* What the lock is FOR — a put-away row, or the Zebra task that
               carries on holding it after the screen is closed. */
            $t->string('held_for_type', 40)->nullable();
            $t->unsignedBigInteger('held_for_id')->nullable();
            // The tab that took it; two tabs of one user are two workers.
            $t->string('session_id', 64)->nullable();
            $t->string('reason', 30)->default('putaway');   // putaway | stocktake | maintenance

            $t->timestamp('acquired_at')->nullable();
            $t->timestamp('last_heartbeat_at')->nullable();
            $t->timestamp('expires_at')->nullable();

            $t->timestamp('released_at')->nullable();
            // completed | cancelled | reassigned | expired | force_released
            $t->string('released_reason', 30)->nullable();

            $t->unsignedBigInteger('created_by')->nullable();
            $t->unsignedBigInteger('updated_by')->nullable();
            $t->timestamps();

            $t->index(['held_for_type', 'held_for_id']);
        });

        DB::statement(
            "alter table inventory_location_locks add constraint location_lock_type_check
             check (location_type in ('zone','rack','shelf'))"
        );

        /* One live lock per location. Released rows pile up forever, so the
           WHERE clause is what keeps this index the size of the warehouse
           rather than the size of its history — and it is also the only reason
           the index can be unique at all, since a shelf is locked and freed
           hundreds of times. */
        DB::statement(
            "create unique index uq_loc_lock_live on inventory_location_locks
             (location_type, location_id) where released_at is null"
        );
        DB::statement(
            "create index idx_loc_lock_warehouse_live on inventory_location_locks
             (warehouse_id) where released_at is null"
        );
        // The reaper's query: everything live and past its deadline.
        DB::statement(
            "create index idx_loc_lock_expiry on inventory_location_locks
             (expires_at) where released_at is null"
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_location_locks');
    }
};
