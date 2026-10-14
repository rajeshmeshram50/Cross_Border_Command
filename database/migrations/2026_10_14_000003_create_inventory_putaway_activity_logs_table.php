<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory · Everything that was done to a put-away, in the order it happened.
 *
 * p2p_spi_scan_logs knows about scans and nothing else. But a placement is
 * final — the dialog tells the operator the shelf is locked and the location
 * cannot be changed — and a record that cannot be undone has to be able to say
 * how it came about. None of these are scans: a location assigned, the operator
 * pressing Change and assigning another, a Zebra task raised, that task
 * cancelled, a manual confirmation taken on somebody's word, the shelf released
 * at GRN. Today not one of them leaves a trace.
 *
 * APPEND ONLY — no updated_at, no deleted_at, no soft delete. A log you can
 * edit answers nothing it is asked. Corrections are new rows.
 *
 * The three handles (occupancy_id, putaway_id, task_id) are stored beside the
 * polymorphic subject on purpose: with them, "what happened to this box",
 * "what did this operator do today" and "who filled this shelf" are each one
 * indexed read instead of a join across four tables.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_putaway_activity_logs', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('client_id')->index();
            $t->unsignedBigInteger('branch_id')->nullable()->index();

            $t->string('subject_type', 40);          // putaway | task | occupancy
            $t->unsignedBigInteger('subject_id');

            $t->unsignedBigInteger('occupancy_id')->nullable();
            $t->unsignedBigInteger('putaway_id')->nullable();
            $t->unsignedBigInteger('task_id')->nullable();
            $t->unsignedBigInteger('box_id')->nullable();

            /* assigned · reassigned · task_created · task_cancelled ·
               scan_passed · scan_failed · confirmed_manual · confirmed_device ·
               released. Left as a string, not an enum: a log that refuses to
               record an event it was not built for is worse than one that
               records an unfamiliar name. */
            $t->string('event', 30);

            // Snapshots, not ids — the address as it read AT THE TIME, so the
            // trail survives a zone being renamed or a shelf being retired.
            $t->json('from_location')->nullable();
            $t->json('to_location')->nullable();

            $t->string('actor_type', 20)->nullable();  // user | device | system
            $t->unsignedBigInteger('actor_id')->nullable();
            $t->unsignedBigInteger('device_id')->nullable();
            // Reason, percentages, failure detail — whatever the event carries.
            $t->json('meta')->nullable();

            /* created_by for consistency with every other table here, even
               though actor_id usually holds the same person — they differ when
               the system or a device writes the row on somebody's behalf.
               NO updated_by: the table is append-only, and a column implying a
               row can be edited is worse than no column. */
            $t->unsignedBigInteger('created_by')->nullable();

            $t->timestamp('created_at')->useCurrent();

            $t->index(['box_id', 'created_at']);
            $t->index(['occupancy_id', 'created_at']);
            $t->index(['client_id', 'actor_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_putaway_activity_logs');
    }
};
