<?php

use App\Support\WeekOff;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Employees: store a REAL weekly-off pattern instead of a placeholder label.
 *
 * `employees.weekly_off` held the literal string "Week Off Policy" — the form
 * field's own caption, which had leaked into its dropdown as the first (and so
 * default) option. It names no day, so the old parser matched nothing and fell
 * back to Sunday: the entire workforce was silently running on Sunday-only,
 * whatever the actual policy was.
 *
 * WeekOff::normalise() maps every legacy value onto one of the four canonical
 * patterns, and it maps the unparseable ones to "Sunday Only" — exactly what
 * the old fallback already produced. So this migration makes the DATA honest
 * without changing anyone's effective off days.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (DB::table('employees')->get(['id', 'weekly_off']) as $e) {
            $canonical = WeekOff::normalise($e->weekly_off);
            if ((string) $e->weekly_off === $canonical) continue;
            DB::table('employees')->where('id', $e->id)->update(['weekly_off' => $canonical]);
        }
    }

    public function down(): void
    {
        // Irreversible by design: the old values were placeholders, not data,
        // and the canonical labels resolve to the same off days they did.
    }
};
