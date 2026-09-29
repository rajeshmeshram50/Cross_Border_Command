<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Freeze the shift onto each attendance row. (QA #216)
 *
 * `employees.shift` holds only the shift NAME, and every consumer resolved it
 * to a window at READ time via Employee::resolveShiftWindow(). The employee row
 * has exactly one shift, so that resolution answered "what shift is this person
 * on NOW?" for a question that was really "what shift were they on THAT DAY?".
 *
 * Moving someone from General to Night therefore rewrote their whole history:
 * six months of punches were re-judged against 21:00, and days that were on
 * time became late (or the reverse) retroactively. The same read also made a
 * shift assigned at 3pm apply to a day the employee had already worked and
 * punched out of.
 *
 * Stamping the window at punch time makes each day carry the terms it was
 * actually worked under, which is what a shift change "taking effect tomorrow"
 * means in practice: today's row already holds today's shift.
 *
 * Nullable and NOT backfilled on purpose. A null means "we never recorded it",
 * and the readers fall back to resolving from the employee exactly as before —
 * the old behaviour for old rows, rather than a fabricated history that claims
 * a certainty this database does not have.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->string('shift_name', 120)->nullable()->after('status');
            // "HH:MM" — same shape resolveShiftWindow() returns, so the readers
            // can use either source without converting.
            $table->string('shift_start', 5)->nullable()->after('shift_name');
            $table->string('shift_end', 5)->nullable()->after('shift_start');
        });
    }

    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropColumn(['shift_name', 'shift_start', 'shift_end']);
        });
    }
};
