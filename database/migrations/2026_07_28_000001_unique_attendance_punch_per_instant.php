<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * DB-level idempotency for attendance punches: one employee cannot have two
 * (non-deleted) punches at the exact same instant. Backs the importer's
 * check-then-insert dedup against a concurrency race (two overlapping imports,
 * or an import racing a live punch), and makes re-pushed device buffers safe.
 *
 * Partial (WHERE deleted_at IS NULL) so a deliberately soft-deleted punch does
 * not block a genuinely different future punch — resurrection is separately
 * prevented in the importer via a withTrashed() existence check.
 *
 * See docs/ATTENDANCE_AUDIT_2026-07-28.md (F: importer idempotency).
 */
return new class extends Migration {
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        // Pre-flight: abort with an actionable count if duplicate punch instants
        // already exist (they'd block the unique index).
        $dupes = DB::selectOne(
            'SELECT count(*) AS c FROM (
                SELECT employee_id, punched_at FROM attendance_punches
                 WHERE deleted_at IS NULL
                 GROUP BY employee_id, punched_at HAVING count(*) > 1
             ) x'
        );
        if ($dupes && (int) $dupes->c > 0) {
            throw new \RuntimeException(
                "Cannot create attendance_punches_emp_instant_unique — {$dupes->c} duplicate "
                . '(employee_id, punched_at) group(s) exist. De-duplicate them (keep one punch '
                . 'per employee per instant), then re-run migrate.'
            );
        }

        DB::statement(
            'CREATE UNIQUE INDEX IF NOT EXISTS attendance_punches_emp_instant_unique '
            . 'ON attendance_punches (employee_id, punched_at) WHERE deleted_at IS NULL'
        );
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }
        DB::statement('DROP INDEX IF EXISTS attendance_punches_emp_instant_unique');
    }
};
