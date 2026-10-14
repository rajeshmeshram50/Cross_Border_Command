<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * P2P · A put-away that was started and left says so.
 *
 * Somebody picks a shelf for a box, holds it, and then walks away — a call
 * comes in, the shift ends, the tab is closed. The box is not pending, because
 * a location is already reserved for it and nobody else is being offered that
 * space. It is not placed either. It is a DRAFT, and until now there was no
 * word for it: the row simply existed with confirmed_at null, which reads the
 * same as a box being worked on right now.
 *
 * Four states, and only one of them is final:
 *
 *   pending        no location held
 *   draft          a location is reserved and nothing has confirmed it
 *   awaiting_scan  a Zebra task is open; the floor has the box
 *   placed         confirmed by a person or a device — final
 *
 * A CACHE, LIKE THE SHELF COUNTERS. SpiPutaway::stage4Status() derives the same
 * answer from confirmed_at, the location columns and the open task, and that
 * derivation remains the authority — this column is written in the same
 * transaction so the two cannot be seen out of step. It exists because the
 * questions worth asking are asked ACROSS boxes: every draft left in this
 * branch, every box awaiting a scan. Derived, each of those is a NOT EXISTS
 * against the task table per row; stored and indexed, it is one read.
 *
 * assigned_at / assigned_by are not derivable at all. scanned_by is whoever
 * worked the hand-scan chain and confirmed_by is whoever signed it off; neither
 * says who took the shelf, which is the only name on an abandoned draft.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_spi_putaways', function (Blueprint $t) {
            $t->string('status', 16)->default('pending')->after('destination');
            $t->timestamp('assigned_at')->nullable()->after('status');
            $t->unsignedBigInteger('assigned_by')->nullable()->after('assigned_at');
        });

        DB::statement(
            "alter table p2p_spi_putaways add constraint p2p_spi_putaways_status_check
             check (status in ('pending','draft','awaiting_scan','placed'))"
        );

        /* Existing rows, from the same rule the derivation uses. There are none
           today — the table has never been written to — but a backfill that
           only works on an empty table is not a backfill. */
        DB::table('p2p_spi_putaways')->whereNotNull('confirmed_at')->update(['status' => 'placed']);
        DB::table('p2p_spi_putaways')->whereNull('confirmed_at')
            ->where(fn ($q) => $q->whereNotNull('shelf_id')->orWhereNotNull('zone_id'))
            ->update(['status' => 'draft']);

        /* The two cross-box reads: this branch's unfinished work, and this
           invoice's. Partial, because a placed box is the one state nobody
           needs a worklist of — and it is the state every row ends in, so the
           index stays the size of the work outstanding. */
        DB::statement(
            "create index idx_putaway_open_branch on p2p_spi_putaways (branch_id, status)
             where status <> 'placed' and deleted_at is null"
        );
        DB::statement(
            "create index idx_putaway_open_spi on p2p_spi_putaways (supplier_invoice_id, status)
             where status <> 'placed' and deleted_at is null"
        );
    }

    public function down(): void
    {
        DB::statement('drop index if exists idx_putaway_open_branch');
        DB::statement('drop index if exists idx_putaway_open_spi');
        DB::statement('alter table p2p_spi_putaways drop constraint if exists p2p_spi_putaways_status_check');

        Schema::table('p2p_spi_putaways', function (Blueprint $t) {
            $t->dropColumn(['status', 'assigned_at', 'assigned_by']);
        });
    }
};
