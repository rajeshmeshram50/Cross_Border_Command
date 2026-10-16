<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The location half of a scan is a CHAIN, not one slot.
 *
 * A box goes to zone A / rack B / shelf C, and operators prove that in
 * whichever way suits the aisle they are standing in:
 *
 *   · scan shelf C alone        — the deepest label proves all three, because
 *                                 a shelf cannot be anywhere but its own rack
 *                                 and zone. One scan, done.
 *   · zone A → rack B → shelf C — walking in, confirming at each step.
 *   · zone A → shelf C          — starting broad, then jumping.
 *
 * Only the deepest ASSIGNED level finishes the location: the task says shelf
 * C, so shelf C has to be read. Zone and rack are waypoints — proof of
 * progress, never proof of arrival.
 *
 * These are stored rather than held in the page because a camera scan is a
 * fresh page load every time. Without them, walking zone → rack → shelf would
 * forget the first two steps before reaching the third.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('p2p_spi_putaway_tasks', function (Blueprint $table) {
            $table->timestamp('zone_scan_at')->nullable()->after('box_confirmed_at');
            $table->timestamp('rack_scan_at')->nullable()->after('zone_scan_at');
        });
    }

    public function down(): void
    {
        Schema::table('p2p_spi_putaway_tasks', function (Blueprint $table) {
            $table->dropColumn(['zone_scan_at', 'rack_scan_at']);
        });
    }
};
