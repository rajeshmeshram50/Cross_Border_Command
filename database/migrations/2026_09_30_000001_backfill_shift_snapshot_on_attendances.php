<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;
use App\Models\Attendance;
use App\Models\Employee;

/**
 * Stamp the existing attendance rows with the shift they currently resolve to.
 * (QA #35 — the re-test of #216.)
 *
 * 2026_09_29_000001 added the columns and deliberately left them null, so that
 * old rows kept resolving from the employee "exactly as before". The reasoning
 * was that a null is honest about what was never recorded. The consequence was
 * that the guarantee did not hold for a single row in the database: every
 * attendance record predating the column still resolved live, so reassigning a
 * shift still relabelled all of it. The fix only governed days punched after it
 * shipped, which is why the ticket came back.
 *
 * Freezing them at the value they resolve to TODAY changes nothing anybody can
 * see right now — it is the same answer the fallback already gives. What it
 * changes is the future: the next shift reassignment can no longer reach back
 * and rewrite these days. That is the property the ticket asks for, and a null
 * cannot provide it.
 *
 * This is not a claim to have recovered lost history. Rows worked under a shift
 * that has since been reassigned are already unrecoverable — the old value was
 * overwritten in place on the employee, and nothing recorded it. This pins down
 * what is left so the same loss stops happening.
 *
 * Only genuinely unstamped rows are touched, so re-running cannot overwrite a
 * real stamp written at punch time.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('attendances') || !Schema::hasColumn('attendances', 'shift_start')) {
            return;
        }

        /* Resolution needs the branch's `shifts` repeater (the employee row only
           holds the shift NAME), so employees are loaded once with their branch
           and reused across their own rows instead of per attendance row. */
        $employees = [];

        Attendance::withTrashed()
            ->whereNull('shift_start')
            ->whereNull('shift_name')
            ->select(['id', 'employee_id'])
            ->chunkById(500, function ($rows) use (&$employees) {
                foreach ($rows as $row) {
                    $empId = (int) $row->employee_id;
                    if ($empId === 0) {
                        continue;
                    }
                    if (!array_key_exists($empId, $employees)) {
                        $employees[$empId] = Employee::withTrashed()
                            ->with('branch:id,shifts')
                            ->find($empId);
                    }
                    $emp = $employees[$empId];
                    if (!$emp) {
                        continue;   // orphaned row — nothing to resolve from
                    }

                    [$start, $end] = $emp->resolveShiftWindow();
                    $name = trim((string) ($emp->shift ?? '')) ?: null;
                    // Nothing resolves → leave the row null. A fabricated
                    // 09:30 default would be worse than the honest fallback.
                    if ($start === null && $name === null) {
                        continue;
                    }

                    Attendance::withTrashed()->where('id', $row->id)->update([
                        'shift_name'  => $name,
                        'shift_start' => $start,
                        'shift_end'   => $end,
                    ]);
                }
            });
    }

    /**
     * Not reversible in any meaningful sense: a stamp written here is
     * indistinguishable from one written at punch time, so clearing them would
     * also discard real ones. The columns' own migration handles teardown.
     */
    public function down(): void
    {
        // no-op
    }
};
