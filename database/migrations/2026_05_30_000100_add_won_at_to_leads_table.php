<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Sales Matrix → Stage 6 (Victory Stage) marker.
 *
 *  `won_at` is the timestamp when the deal was committed as won. The
 *  controller auto-sets it whenever `lead_stage_id` transitions to 6 so
 *  the application always has a true "deal won at" date without relying
 *  on `updated_at` (which is mutable by any field change).
 *
 *  The column is nullable on existing leads — they pre-date this concept
 *  and won't show a Victory date until they advance through the matrix
 *  flow afresh.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leads', function (Blueprint $table) {
            $table->timestamp('won_at')->nullable()->after('lead_ack_reason_id');
        });
    }

    public function down(): void
    {
        Schema::table('leads', function (Blueprint $table) {
            $table->dropColumn('won_at');
        });
    }
};
