<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Regularization: remember the day the request was DRAFTED from.
 *
 * A day may now carry more than one correction, and more than one of them may
 * be pending at the same time. That is only safe if approval stops replacing
 * the day wholesale.
 *
 * The modal opens prefilled with the day's punches, so a request's `punches`
 * column is "the whole day as I want it to end up" — the rows it inherited plus
 * the one it is adding. Approving it used to delete every punch on the day and
 * write that set back, which is correct for one request and destructive for
 * two: file "add 14:00–15:00" and "add 16:00–17:00" while both are pending,
 * approve both, and the second approval writes a day that never heard of
 * 14:00–15:00 — the first correction is gone with no trace on either request.
 *
 * `base_punches` is the day as it stood when the request was filed. With it,
 * approval can work out what the request actually CHANGES (base → punches) and
 * apply just that to the day as it stands now, instead of overwriting whatever
 * landed in between.
 *
 * Nullable, and rows filed before this column existed keep the old
 * replace-the-day behaviour — there is no base to diff against, and inventing
 * one would guess at intent.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendance_regularizations', function (Blueprint $table) {
            // [{ "in": "09:56", "out": "18:45" }, …] — IST wall-clock, ordered,
            // the same shape as `punches`. `out` is null for an open stretch.
            $table->json('base_punches')->nullable()->after('punches');
        });
    }

    public function down(): void
    {
        Schema::table('attendance_regularizations', function (Blueprint $table) {
            $table->dropColumn('base_punches');
        });
    }
};
