<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stage 04 · the handheld scan is two acts per slot, not one.
 *
 * The operator scans, reads back what the screen says it is, and only then
 * confirms. A scan that was never confirmed is somebody waving a barcode past
 * a lens; the confirm is the person saying "yes, that is the box in my hand".
 * Two events cannot share one timestamp column, so each slot gets its own.
 *
 * fail_count drives the three-strike reset. It counts REFUSALS IN A ROW and is
 * cleared by any good scan, so a slow operator is not punished for a bad hour —
 * only for three bad reads back to back, which usually means they are at the
 * wrong rack and should start over.
 *
 * No status column is added on purpose. uq_putaway_task_open_box is a PARTIAL
 * unique index over `WHERE status = 'pending'`, and it is the only thing
 * stopping a second task being opened for a box that is already mid-scan. A
 * row moved to an 'in_progress' status would drop out of that index and the
 * guarantee would vanish silently. Progress is read from the timestamps below
 * instead, and the task stays 'pending' until it is finished or cancelled.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_spi_putaway_tasks', function (Blueprint $table) {
            $table->timestamp('box_confirmed_at')->nullable()->after('box_scan_at');
            $table->timestamp('shelf_confirmed_at')->nullable()->after('shelf_scan_at');
            $table->unsignedSmallInteger('fail_count')->default(0)->after('shelf_confirmed_at');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_spi_putaway_tasks', function (Blueprint $table) {
            $table->dropColumn(['box_confirmed_at', 'shelf_confirmed_at', 'fail_count']);
        });
    }
};
