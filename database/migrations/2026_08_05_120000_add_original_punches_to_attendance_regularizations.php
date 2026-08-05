<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Regularization: keep a snapshot of what the day looked like BEFORE approval.
 *
 * Approving an "adjust" request soft-deletes every punch on that day and writes
 * the corrected set. The original biometric punches therefore vanish from the
 * timeline — the day silently reads as though it was always punched at the
 * corrected times, and neither the approver nor an auditor can see what was
 * actually changed.
 *
 * The rows still exist (the delete is a soft delete), but nothing surfaces
 * them. Snapshotting the original punches onto the REQUEST is the fix: the
 * day keeps showing the effective truth, while the correction record carries
 * the before/after — which is also what the approver needs to see before
 * agreeing to it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_regularizations', function (Blueprint $table) {
            // [{ "time": "09:56", "direction": "in", "label": "Check In",
            //    "method": "face" }, …] — IST wall-clock, ordered.
            $table->json('original_punches')->nullable()->after('punches');
            // Denormalised so a list can show "09:56 – 18:45" without unpacking
            // the json for every row.
            $table->string('original_summary', 60)->nullable()->after('original_punches');
        });
    }

    public function down(): void
    {
        Schema::table('attendance_regularizations', function (Blueprint $table) {
            $table->dropColumn(['original_punches', 'original_summary']);
        });
    }
};
